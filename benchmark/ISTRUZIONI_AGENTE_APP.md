# Misurare le prestazioni dell'app mobile LIRA (Android) per l'articolo

Documento per chi lavora sull'app React Native. Chi legge non ha bisogno di
conoscere il resto del progetto: qui c'è tutto quello che serve. Le misure si
fanno **solo su Android**.

## Perché serve

LIRA è un assistente di finanza personale (italiano e inglese) che risponde
usando piccoli modelli linguistici fine-tuned, eseguiti **direttamente sul
telefono** in formato GGUF. L'articolo sostiene tre cose sul mobile:

1. i modelli girano sul dispositivo con tempi di risposta accettabili;
2. l'app funziona **senza rete**;
3. lo storico delle transazioni **non lascia mai il telefono**.

Oggi nessuna delle tre è misurata. Il compito è scrivere il codice che le
misura in modo riproducibile e consegnare i dati grezzi. Le tabelle
dell'articolo le costruiamo noi dai dati.

Allegati a questo documento:
- `domande_it.jsonl`, `domande_en.jsonl` — le domande da usare (30 per lingua)
- `CONSEGNA_APP_MOBILE.md` — i tre difetti del mobile da correggere prima

---

## 0. PRIMA DI MISURARE — prerequisito bloccante

`CONSEGNA_APP_MOBILE.md` elenca tre difetti del mobile. **Se non sono
corretti, le misure descrivono un sistema diverso da quello dell'articolo e
non si possono usare.** Il difetto 1 falsa proprio i tempi: con `n_ctx = 2048`
il prompt viene troncato, quindi l'elaborazione del prompt risulta più corta e
più veloce di quella vera.

Prima di iniziare verifica, e scrivi l'esito nel rapporto finale:

| controllo | come verificarlo | atteso |
|---|---|---|
| istruzione di livello in seconda posizione | stampa il prompt di sistema | subito dopo `Sei un assistente di finanza personale. `, prima di `REGOLE:` |
| mappa livello → istruzione | chiedi `base`, guarda la stringa inserita | quella di `base`, non di `advanced` |
| `n_ctx` | configurazione del contesto | **4096** |
| corpus di recupero | primo documento nel prompt | un paragrafo con identificatore tipo `le_obbligazioni#p000`, **non** una coppia domanda+risposta |
| testo delle REGOLE | stampa il prompt | identico a quello di addestramento (vedi `CONSEGNA_APP_MOBILE.md`) |

Se anche uno solo fallisce: fermati, correggi, poi misura.

---

## 1. Cosa misurare — definizioni esatte

Ogni tempo ha un punto di inizio e uno di fine precisi: senza questo, due
misure con lo stesso nome non sono confrontabili. Usa un orologio monotono
(`performance.now()` in JS, `SystemClock.elapsedRealtimeNanos()` nel nativo),
mai l'ora di sistema.

### 1a. Tempi per ogni domanda

| campo | inizia quando | finisce quando |
|---|---|---|
| `retrieval_ms` | la domanda è pronta | BM25 ha restituito i sei paragrafi |
| `prompt_build_ms` | i sei paragrafi sono pronti | la stringa del prompt è costruita |
| `prompt_tokens` | — | numero di token del prompt dopo la tokenizzazione (dal runtime) |
| `prefill_ms` | la chiamata di completamento parte | il runtime ha finito di elaborare il prompt |
| `ttft_engine_ms` | la chiamata di completamento parte | arriva la callback del **primo token** |
| `ttft_ui_ms` | l'utente tocca "invia" | il primo token è **visibile** sullo schermo |
| `decode_ms` | primo token | ultimo token |
| `output_tokens` | — | token generati |
| `e2e_ms` | l'utente tocca "invia" | la risposta completa è visibile |

Da questi si ricavano `prefill_tok_s = prompt_tokens / prefill_ms × 1000` e
`decode_tok_s = (output_tokens − 1) / decode_ms × 1000`.

Se `llama.rn` restituisce un oggetto `timings` (in llama.cpp contiene
`prompt_n`, `prompt_ms`, `predicted_n`, `predicted_ms`), **registralo così
com'è**, ma misura anche i tempi a orologio da fuori: i due devono coincidere
entro qualche percento, e se non coincidono è un'informazione che ci serve.

`ttft_ui_ms` e `ttft_engine_ms` servono entrambi: il primo è quello che
l'utente percepisce, il secondo quello del modello. La differenza è il costo
di recupero, costruzione del prompt e disegno a schermo.

### 1b. Tempi una tantum per modello

| campo | cosa |
|---|---|
| `load_cold_ms` | caricamento del modello dopo aver **chiuso l'app** (processo nuovo, `adb shell am force-stop <pacchetto>`) |
| `load_warm_ms` | secondo caricamento, app già aperta |
| `model_file_mb` | dimensione del file GGUF su disco |
| `download_ms` | se il modello si scarica al primo avvio: tempo e dimensione (se è incluso nell'app, scrivilo) |

### 1c. Risorse durante la generazione

| campo | cosa | come |
|---|---|---|
| `mem_before_mb` | memoria dell'app prima della domanda | PSS totale del processo |
| `peak_mem_mb` | **picco** di memoria durante la generazione | campiona ogni 250 ms dal thread JS mentre il nativo genera, tieni il massimo |
| `thermal_before`, `thermal_after` | stato termico | `PowerManager.getCurrentThermalStatus()` |
| `battery_before`, `battery_after`, `charging` | batteria | `react-native-device-info` |

La memoria è il PSS totale del processo (`Debug.getMemoryInfo()`, oppure
`ActivityManager.getProcessMemoryInfo()`); `react-native-device-info` →
`getUsedMemory()` va bene per il campionamento. **Per una configurazione**
conferma il picco con il Memory Profiler di Android Studio o con
`adb shell dumpsys meminfo <pacchetto>`, e scrivi nel rapporto se i due valori
coincidono.

### 1d. Configurazione del runtime (una volta per sessione)

`runtime` (nome e versione, es. `llama.rn 0.x.y`), `backend` (CPU / OpenCL /
Vulkan), `n_gpu_layers`, `n_threads`, `n_batch`, `n_ctx`, `flash_attn`,
`use_mmap`, `use_mlock`, `max_new_tokens`, `temperature`, `top_p`, `seed`. Se
una di queste non è impostata esplicitamente, scrivi il valore di default che
il runtime usa.

---

## 2. Cosa misurare — le configurazioni

### Modelli

Pubblici su Hugging Face, account `Stee201`. Ogni repository contiene due file
GGUF: `<repo>-Q8_0.gguf` (8 bit) e `<repo>-Q4_K_M.gguf` (4 bit).

| modello | repository italiano | 8 bit | 4 bit |
|---|---|---|---|
| Gemma3-270M | `Stee201/lira-gemma3-270m-ita-sipar-3reg` | 278 MB | 241 MB |
| Gemma3-1B | `Stee201/lira-gemma3-1b-ita-sipar-3reg` | 1020 MB | 769 MB |
| SmolLM3-3B | `Stee201/lira-smollm3-3b-ita-sipar-3reg` | 3124 MB | 1827 MB |

Gli equivalenti inglesi hanno `ing` al posto di `ita`.

### Matrice da misurare

| | 270M Q8 | 270M Q4 | 1B Q8 | 1B Q4 | 3B Q4 | 3B Q8 |
|---|---|---|---|---|---|---|
| italiano, ogni telefono | ✔ | ✔ | ✔ | ✔ | ✔ | prova |
| inglese, telefono principale | | | | ✔ | | |

**3B a 8 bit** occupa 3,1 GB: su molti telefoni non entra. Provalo comunque.
Se l'app viene chiusa per memoria o il caricamento fallisce, **quello è un
risultato**: registralo (`error: "OOM"` e il telefono) invece di saltarlo.

L'inglese su una sola configurazione basta: l'architettura è la stessa, cambia
la lunghezza del prompt in token. Ci serve un punto per mostrarlo.

### Telefoni

- **telefono principale**: un Android di fascia media, 6–8 GB di RAM
- **se disponibile**, un secondo Android con meno RAM (4 GB) o di fascia
  diversa: mostra dove il 1B e il 3B smettono di funzionare

Per ogni telefono registra: modello esatto, SoC, RAM, versione di Android,
spazio libero.

### Domande

Usa **esattamente** i file allegati, non domande scelte a mano. Sono estratte a
caso con seme fisso dal test set, e sono domande su cui l'articolo riporta già
la qualità delle risposte: così tempi e qualità si riferiscono agli stessi
casi. Ogni riga ha `n`, `pair_id`, `question` e `gold_passage_id` (il
paragrafo da cui viene la risposta corretta).

**Ogni domanda va posta ai tre livelli** (`base`, `intermediate`, `advanced`).
Le risposte `advanced` sono circa quattro volte più lunghe delle `base`: con un
livello solo, il tempo nell'articolo sarebbe sbagliato per gli altri due.

Totale per configurazione: 30 domande × 3 livelli = 90 esecuzioni, più il
riscaldamento.

---

## 3. Protocollo

### Condizioni del telefono — le stesse per ogni sessione

- **build di release**, non di sviluppo; Metro scollegato; nessun debugger o
  profiler attivo (tranne nella sola sessione di conferma della memoria)
- **modalità aereo** attiva, Wi-Fi e Bluetooth spenti
- batteria sopra il 50%, **non in carica**, risparmio energetico **spento**
- luminosità fissa, schermo acceso con timeout disattivato, app in primo piano
- nessun'altra app aperta; riavvia il telefono prima di ogni sessione
- telefono a temperatura ambiente: se `thermal_before` non è
  `THERMAL_STATUS_NONE`, aspetta

### Sequenza per ogni configurazione (telefono × modello × quantizzazione)

1. chiudi l'app (`force-stop`), riaprila, carica il modello → `load_cold_ms`
2. **3 domande di riscaldamento** (le prime tre del file, livello
   `intermediate`), marcate `warmup: true`. Non entrano nelle statistiche.
3. le 90 esecuzioni, **in ordine fisso**: domanda 0 base, 0 intermediate,
   0 advanced, domanda 1 base, … Stesso ordine su tutti i telefoni.
4. alla fine, stato termico e batteria

Tra un'esecuzione e l'altra **non** aggiungere pause artificiali: vogliamo
vedere anche se il telefono si scalda e rallenta durante una sessione lunga.
Per questo registra l'ordine e il timestamp di ogni esecuzione.

### Ripetibilità

Su **una sola** configurazione (1B Q4, telefono principale): 5 domande ×
livello `intermediate` × 5 ripetizioni. Serve a dire quanto varia la misura a
parità di tutto; sulle altre configurazioni non ripetere.

### Generazione

Usa le impostazioni di produzione dell'app, **identiche per tutti i modelli**,
e registrale. Se la produzione campiona (temperature > 0), fissa il `seed`.
Registra `max_new_tokens`: se una risposta lo raggiunge, segnalalo
(`truncated_by_max_tokens: true`), perché quella risposta non è finita e il suo
tempo è sottostimato.

---

## 4. Controlli di validità su ogni esecuzione

Il codice deve scriverli per ogni riga, non solo a campione:

| campo | cosa controlla |
|---|---|
| `prompt_tokens_lt_n_ctx` | il prompt non è stato troncato |
| `level_ok` | la stringa di livello inserita è quella del livello richiesto, in seconda posizione |
| `passage_ids` | i sei identificatori finiti nel prompt, nell'ordine |
| `gold_in_prompt` | il `gold_passage_id` della domanda è fra i sei |
| `network_requests` | richieste di rete durante l'esecuzione (deve essere **0**) |

`network_requests` si ottiene intercettando `fetch`/`XMLHttpRequest` nel JS
per la durata del benchmark. È la prova che l'app non chiama un server.

**Sul `gold_in_prompt`**: sul server il paragrafo corretto è fra i sei
recuperati nel 93,7% delle domande italiane e nel 94,8% di quelle inglesi. Se
sul mobile il valore è molto diverso, il recupero del mobile non è quello del
server: segnalalo prima di consegnare.

---

## 5. Il secondo flusso: analisi delle spese

L'articolo afferma che lo storico delle transazioni non lascia mai il
telefono. Va verificato, non assunto:

1. con modalità aereo attiva, apri il cruscotto spese con un insieme fisso di
   transazioni (20 transazioni di prova su 5 categorie, sempre le stesse,
   salvate come file di fixture)
2. genera i consigli ai tre livelli
3. registra: **quale modello** li genera (fine-tuned o base, e quale file),
   `e2e_ms`, `output_tokens`, `peak_mem_mb`, `network_requests`

Sul server questo flusso usa **Gemma3-1B base, non fine-tuned**. Dicci cosa usa
il mobile. Se il consiglio sulle spese sul mobile passa da un server, scrivilo
in grassetto nel rapporto: cambia una frase dell'articolo.

Ripeti 10 volte a livello `intermediate` sul telefono principale per avere una
mediana.

---

## 6. Formato dei dati da consegnare

### `runs.jsonl` — una riga per esecuzione, nessuna esclusa

```json
{
  "run_id": "pixel7a_1b_q4_0042",
  "timestamp": "2026-09-12T10:31:07.221Z",
  "device": {"model": "Pixel 7a", "soc": "Tensor G2", "ram_gb": 8, "android": "15", "free_storage_gb": 41},
  "build": "release",
  "runtime": {"name": "llama.rn", "version": "0.x.y", "backend": "CPU",
              "n_gpu_layers": 0, "n_threads": 4, "n_batch": 512, "n_ctx": 4096,
              "flash_attn": false, "use_mmap": true, "use_mlock": false},
  "generation": {"max_new_tokens": 512, "temperature": 0.0, "top_p": 1.0, "seed": 42},
  "model_file": "lira-gemma3-1b-ita-sipar-3reg-Q4_K_M.gguf",
  "model_file_mb": 769,
  "workflow": "chat",
  "lingua": "it",
  "n": 14, "pair_id": 908, "livello": "advanced",
  "order_in_session": 45,
  "warmup": false,
  "retrieval_ms": 12.4, "prompt_build_ms": 0.8,
  "prompt_tokens": 1843,
  "prefill_ms": 3120.5, "ttft_engine_ms": 3160.2, "ttft_ui_ms": 3201.7,
  "decode_ms": 9840.0, "output_tokens": 231, "e2e_ms": 13090.1,
  "runtime_timings": {"prompt_n": 1843, "prompt_ms": 3118.9, "predicted_n": 231, "predicted_ms": 9832.4},
  "truncated_by_max_tokens": false,
  "mem_before_mb": 812, "peak_mem_mb": 1104,
  "thermal_before": "THERMAL_STATUS_NONE", "thermal_after": "THERMAL_STATUS_LIGHT",
  "battery_before": 78, "battery_after": 78, "charging": false,
  "prompt_tokens_lt_n_ctx": true, "level_ok": true,
  "passage_ids": ["le_obbligazioni#p000", "..."],
  "gold_in_prompt": true,
  "network_requests": 0,
  "error": null,
  "output_text": "..."
}
```

**`output_text` va sempre incluso**, per intero. Ci serve per verificare che
il modello quantizzato sul telefono si comporti come quello del server — in
particolare che le tre risposte ai tre livelli siano diverse, cosa che oggi sul
mobile non succede. La leggibilità la calcoliamo noi.

Le esecuzioni fallite restano nel file con `error` compilato (`"OOM"`,
`"load_failed"`, `"timeout"`, `"crash"`). Non cancellare nulla.

### `sessioni.jsonl` — una riga per configurazione

`device`, `model_file`, `load_cold_ms`, `load_warm_ms`, `download_ms`, spazio
libero prima e dopo, inizio e fine sessione, esito dei controlli della
sezione 0.

### `RAPPORTO.md` — breve, in italiano

- esito dei controlli della sezione 0, uno per uno
- versione dell'app e commit misurato
- telefoni usati, con le specifiche
- cosa non è stato possibile misurare e perché
- tutto ciò che è sembrato strano (un modello più lento del previsto, un
  telefono che si scalda, `gold_in_prompt` basso, risposte identiche ai tre
  livelli)

---

## 7. Come deve essere fatto il codice

- una **schermata di benchmark nascosta** dietro un flag di sviluppo (non
  visibile agli utenti), che legge `domande_*.jsonl`, esegue la sequenza della
  sezione 3 **da sola**, senza tocchi, e scrive `runs.jsonl` nella cartella
  dell'app
- esportazione dei file con `adb pull`: scrivi il comando esatto nel rapporto
- `ttft_ui_ms` e `e2e_ms` devono passare per **lo stesso percorso di codice
  della chat vera** (stessa funzione di recupero, stessa costruzione del
  prompt, stesso rendering). Un benchmark che chiama il modello per una strada
  diversa da quella dell'utente misura un'altra cosa
- nessuna modifica al comportamento dell'app normale: il codice di misura non
  deve cambiare prompt, parametri o recupero

---

## 8. Cosa NON fare

- non misurare in build di sviluppo o con Metro collegato: il JS è molto più
  lento e sposta `ttft_ui_ms` e `e2e_ms`
- non contare le esecuzioni di riscaldamento
- non escludere le esecuzioni lente o fallite: il picco e il fallimento sono
  dati
- non cambiare impostazioni fra una configurazione e l'altra; se devi, rifai
  tutte le configurazioni
- non misurare in carica o col risparmio energetico attivo
- non riassumere i dati in medie prima di consegnarli: vogliamo i grezzi

---

## 9. Cosa andrà nell'articolo

Perché tu sappia quali numeri contano davvero. Dai tuoi dati costruiremo:

**Una tabella**, una riga per telefono × modello × quantizzazione:

| telefono | modello | quant. | file | caricamento | primo token | velocità | risposta intermedia | picco RAM |
|---|---|---|---|---|---|---|---|---|
| Android … | Gemma3-1B | Q4 | 769 MB | 1,9 s | 3,2 s | 23 tok/s | 8,4 s | 1,1 GB |

dove "primo token" è la mediana di `ttft_ui_ms`, "velocità" la mediana di
`decode_tok_s`, "risposta intermedia" la mediana di `e2e_ms` al livello
intermediate (con il 90° percentile fra parentesi).

**Due o tre frasi** nel testo:
- quanto cresce il tempo di risposta dal livello base all'avanzato
- se il telefono rallenta durante una sessione lunga (dall'ordine e dallo
  stato termico)
- che entrambi i flussi funzionano in modalità aereo, con zero richieste di
  rete, e quale modello genera i consigli sulle spese

I numeri della riga d'esempio sono **inventati** per mostrare il formato: non
usarli come obiettivo né come riferimento.
