# Procedura di misura — app LIRA su Android

Come eseguire il protocollo di `ISTRUZIONI_AGENTE_APP.md` con la schermata di
benchmark dell'app. I comandi vanno lanciati dalla cartella `yourmoney/`.

## Una volta sola

1. **Build dell'APK di benchmark** (release, con la schermata nascosta attiva):

   ```
   npm run benchmark:apk
   ```

   Rigenera i dati inclusi nell'app (`lib/benchmark/data/`, con il commit
   corrente) e compila `android/app/build/outputs/apk/release/app-release.apk`.
   Fai un commit **prima** della build: il commit finisce in ogni riga di
   `runs.jsonl`, e se ci sono modifiche non committate la riga lo segnala
   (`commit_dirty: true`).

2. **Installazione** (i dati dell'app, compresi i modelli già scaricati, restano):

   ```
   adb install -r android/app/build/outputs/apk/release/app-release.apk
   ```

3. **Download dei modelli** (circa 8,4 GB, con il Wi-Fi acceso). Parte da solo
   con questo comando (oppure premi **Scarica modelli** sulla schermata):

   ```
   adb shell "am start -a android.intent.action.VIEW -d 'com.stefano10.yourmoney://benchmark?action=download'"
   ```

   I tempi di download finiscono in `download.jsonl`.

4. **Prova** (facoltativa, non sono dati): 1 riscaldamento + 2 esecuzioni, per
   verificare che tutto funzioni e stimare la durata di una sessione. Scrive in
   `benchmark/prova/`, separato dalle misure. `model=app` usa il modello che
   l'app ha già scaricato (identico a `1b-q8-it`):

   ```
   adb shell "am start -a android.intent.action.VIEW -d 'com.stefano10.yourmoney://benchmark?model=app&mode=prova&autostart=1'"
   ```

## Ogni sessione (una per configurazione)

1. Carica la batteria (serve **più del 50%** per tutta la sessione: meglio 100%).
2. **Riavvia il telefono.**
3. Attiva la **modalità aereo**, spegni **Wi-Fi** e **Bluetooth**, disattiva il
   **risparmio energetico** e la luminosità automatica. Chiudi le altre app.
4. Collega il cavo USB e avvia la sessione (sostituisci `<ID>` e `<MODO>`):

   ```
   adb shell am force-stop com.stefano10.yourmoney
   adb shell "am start -a android.intent.action.VIEW -d 'com.stefano10.yourmoney://benchmark?model=<ID>&mode=<MODO>&autostart=1'"
   ```

5. **Stacca il cavo.** L'app aspetta da sola che tutte le condizioni del
   protocollo siano vere (cavo staccato, modalità aereo, Wi-Fi/Bluetooth spenti,
   batteria > 50%, stato termico normale) e poi parte senza tocchi. La
   schermata mostra cosa manca. Lo schermo resta acceso da solo.
6. Quando il registro mostra `fine`, ricollega il cavo e scarica i risultati:

   ```
   adb pull /sdcard/Android/data/com.stefano10.yourmoney/files/benchmark risultati/
   ```

I file sono cumulativi: ogni sessione aggiunge righe, nessuna viene cancellata.

## Sessioni del telefono principale

| # | `<ID>` | `<MODO>` | cosa | durata stimata |
|---|---|---|---|---|
| 1 | `270m-q8-it` | `full` | Gemma3-270M Q8, italiano | 20–30 min |
| 2 | `270m-q4-it` | `full` | Gemma3-270M Q4, italiano | 20–30 min |
| 3 | `1b-q8-it` | `full` | Gemma3-1B Q8, italiano | circa 1 h 30 |
| 4 | `1b-q4-it` | `full` | Gemma3-1B Q4, italiano | 1 h 15 – 1 h 30 |
| 5 | `3b-q4-it` | `full` | SmolLM3-3B Q4, italiano | 5–7 h (di notte) |
| 6 | `3b-q8-it` | `full` | SmolLM3-3B Q8 (prova: può finire in OOM, è un risultato) | probabile OOM al caricamento |
| 7 | `1b-q4-en` | `full` | Gemma3-1B Q4, inglese | circa 1 h |
| 8 | `1b-q4-it` | `repeat` | ripetibilità: 5 domande × intermediate × 5 | circa 25 min |
| 9 | qualsiasi | `advices` | consigli sulle spese, 10 volte, transazioni fisse | 15–25 min |

`full` = 3 domande di riscaldamento + 90 esecuzioni (30 domande × 3 livelli).

`ridotta` = 3 domande di riscaldamento + 30 esecuzioni: una domanda ogni tre
(n = 0, 3, 6, … 27) × 3 livelli, nell'ordine fisso. È una **deviazione dal
protocollo**, da dichiarare nel rapporto, pensata per SmolLM3-3B, troppo lento
per una sessione completa su una carica. Sulle sessioni complete già misurate
(270M Q8/Q4, 1B Q8/Q4) il sottoinsieme di 30 esecuzioni ha dato mediane di primo
token, risposta intermediate e suo 90° percentile entro circa il 5–10% delle 90;
non è affidabile per il rapporto fra lunghezza delle risposte advanced e base,
e una sessione corta scalda meno il telefono.

Le durate vengono dalla prova del 10/09/2026 con Gemma3-1B Q8 sul Galaxy A52:
circa 43 s per elaborare il prompt (circa 2000 token, ~47 token/s) più circa
7 token/s di generazione, quindi ~55 s per esecuzione. Gli altri modelli sono
stimati in proporzione alla dimensione. Il 3B Q8 difficilmente si carica: in
RAM llama.cpp tiene il file mappato più una copia riorganizzata dei pesi
(circa 2 × 3,1 GB) su 5,4 GB disponibili.

## Batteria al 50% o sotto: pausa e ripresa

Dopo ogni esecuzione l'app controlla la batteria. Se è scesa al 50% o sotto, o
se si è attivato il risparmio energetico, la sessione si ferma in modo pulito
(`sessioni.jsonl`: `error: "battery_low"`, `paused.next_order`) e il registro
mostra da dove riprendere. Allora:

1. ricarica (meglio fino al 100%) e riavvia il telefono;
2. rimetti le condizioni del punto 3;
3. rilancia il comando del punto 4 aggiungendo `&from=<N>` (N = `next_order`),
   per esempio `...model=3b-q4-it&mode=full&from=51&autostart=1`.

La ripresa rifà il caricamento a freddo e le domande di riscaldamento, poi
continua dall'esecuzione N nello stesso ordine e con la stessa numerazione. La
nuova sessione riporta `resume_of` (la sessione interrotta) e `resume_from`.

## Se l'app o il telefono si spengono durante una sessione

Riapri l'app con il comando del punto 4 **senza** `&autostart=1`: all'avvio
registra l'esecuzione interrotta in `runs.jsonl` con il motivo:

- `OOM` se Android l'ha chiusa per memoria;
- `device_shutdown` se si è spento il telefono (in quel caso Android non
  registra nulla sulla chiusura dell'app);
- `crash` negli altri casi.

Poi riprendi con `&from=<N>`, dove N è l'esecuzione interrotta.

## Cosa controlla l'app prima di misurare

All'inizio di ogni sessione (sezione 0 delle istruzioni): istruzione di livello
in seconda posizione, mappa livello → istruzione, `n_ctx = 4096`, primo
documento del corpus, testo delle REGOLE identico ai record di addestramento,
template di chat del GGUF identico al riferimento e recupero BM25 identico
all'addestramento su tutte le 30 domande. Se un controllo fallisce la sessione
si ferma e `sessioni.jsonl` riporta `error: "checks_failed"` con il dettaglio.

Gli stessi controlli, tranne il template, si possono lanciare sul PC:

```
npm run benchmark:check
```
