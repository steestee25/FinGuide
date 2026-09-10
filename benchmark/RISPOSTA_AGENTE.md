# Risposte: testo delle REGOLE e prompt inglese

Tutti i testi qui sotto sono estratti dai **record di addestramento reali**
(`records.jsonl`, `records_en.jsonl`), non riscritti a mano. Vanno copiati
**carattere per carattere**, compresi gli spazi, i due a capo e le imperfezioni
(per esempio "semplici **e** esempi", non "ed esempi"): il modello ha visto
esattamente queste stringhe migliaia di volte, e una variante è per lui un
prompt diverso.

---

## 1. Testo delle REGOLE

**Italiano**
```
REGOLE: Rispondi SOLO usando i documenti seguenti. Non inventare. Non dare consigli specifici di investimento. Rispondi in italiano in modo conciso.
```

**Inglese**
```
RULES: Answer ONLY using the documents below. Do not make things up. Do not give specific investment advice. Answer in English, concisely.
```

---

## 2. Il prompt completo

Sempre **due messaggi**: `system` e `user`. Nel benchmark nessuno storico di
conversazione.

### Messaggio `system`

```
{PERSONA} {LIVELLO}\n\n{REGOLE}\n\n{DOC_1}\n\n{DOC_2}\n\n{DOC_3}\n\n{DOC_4}\n\n{DOC_5}\n\n{DOC_6}
```

dove `\n\n` sono due a capo veri, e ogni documento è:

- italiano: `DOCUMENTO [{passage_id}]:\n{text}`
- inglese: `DOCUMENT [{passage_id}]:\n{text}`

| | italiano | inglese |
|---|---|---|
| `PERSONA` | `Sei un assistente di finanza personale.` | `You are a personal finance assistant.` |
| `LIVELLO` base | `L'utente ha conoscenze base di finanza. Usa spiegazioni semplici e esempi pratici. Evita termini tecnici o complessi.` | `The user has basic financial knowledge. Use simple explanations and practical examples. Avoid technical or complex terms.` |
| `LIVELLO` intermediate | `L'utente ha conoscenze di finanza intermedie. Puoi introdurre alcuni termini tecnici, ma sempre accompagnati da una spiegazione.` | `The user has intermediate financial knowledge. You may introduce some technical terms, but always with an explanation.` |
| `LIVELLO` advanced | `L'utente ha conoscenze avanzate di finanza personale. Evita spiegazioni eccessivamente basilari, puoi usare termini tecnici e spiegazioni più approfondite.` | `The user has advanced knowledge of personal finance. Avoid overly basic explanations; you may use technical terms and give more in-depth explanations.` |

### Esempio reale, inglese, livello base (inizio del messaggio `system`)

```
You are a personal finance assistant. The user has basic financial knowledge. Use simple explanations and practical examples. Avoid technical or complex terms.

RULES: Answer ONLY using the documents below. Do not make things up. Do not give specific investment advice. Answer in English, concisely.

DOCUMENT [boe/explainers/can-you-stop-a-bank-from-going-bust#p001]:
Things have changed. The Bank of England has a set of tools that allow it to step in quickly where needed.
...
```

### Messaggio `user`

**Solo la domanda**, senza prefissi, senza "Domanda:", senza riformulazioni.

---

## 3. Come passarlo al modello

- Usa l'**API a messaggi** di `llama.rn`, che applica il template di chat
  contenuto nel file GGUF. **Non concatenare le stringhe a mano** con
  `<start_of_turn>` o `<|im_start|>`: il template è già dentro il GGUF
  (verificato su entrambi i modelli).
- **Gemma3** (270M e 1B): nient'altro. Gemma non ha un ruolo `system`; il
  template lo fonde da solo nel primo turno utente, ed è ciò che è successo in
  addestramento.
- **SmolLM3-3B**: aggiungi `\n/system_override` in fondo al messaggio
  `system` (dopo aver tolto eventuali spazi finali). Senza il marcatore il
  template inserisce la data del giorno ("Today Date: …") e un blocco di
  metadati che il modello non ha mai visto. **Non** impostare
  `enable_thinking: false`: lascia il default. Verificato: con marcatore e
  default il prompt non contiene né data né `<think>`, identico a quello di
  addestramento.

### Verifica byte per byte

Allegati tre coppie di file di riferimento, prodotti con i tokenizer originali
dagli stessi record di addestramento:

| file | modello | token del prompt |
|---|---|---|
| `riferimento_gemma3_it_messaggi.json` → `riferimento_gemma3_it_prompt.txt` | Gemma3, italiano | 2360 |
| `riferimento_gemma3_en_messaggi.json` → `riferimento_gemma3_en_prompt.txt` | Gemma3, inglese | 1600 |
| `riferimento_smollm3_it_messaggi.json` → `riferimento_smollm3_it_prompt.txt` | SmolLM3, italiano | 2742 |

Passa i messaggi del `.json` alla funzione di `llama.rn` che restituisce il
prompt formattato (per esempio `getFormattedChat`, oppure registra il prompt
che il runtime tokenizza davvero) e confrontalo con il `.txt`. Devono
coincidere; l'unica differenza ammessa è `<bos>` scritto come testo invece che
aggiunto come token. Il `.json` di SmolLM3 contiene già il marcatore, così
vedi dove va.

I conteggi dei token spiegano anche perché serve `n_ctx = 4096`: con 2048 i
prompt venivano tagliati.

---

## 4. Corpus e recupero

Allegati i due corpus, identici a quelli dell'addestramento (verificato con
md5):

| file | paragrafi | lingua |
|---|---|---|
| `passages_it.jsonl` | 522 | italiano (CONSOB) |
| `passages_en.jsonl` | 455 | inglese (FCA, Bank of England) |

Ogni riga ha, fra gli altri, `passage_id`, `concept` (il titolo della pagina)
e `text` (il corpo del paragrafo).

**Nel prompt** vanno `passage_id` fra le quadre e `text`. Il titolo **non**
va nel prompt.

**Nell'indice** va `concept + " " + text`: il titolo serve solo al recupero.

### BM25, esattamente

1. **Tokenizzazione**: minuscolo; ogni sequenza di caratteri che non sono
   lettere o cifre (compreso `_`) diventa uno spazio; si tengono i token di
   **più di 2 caratteri** che non sono nella lista di stop-word. Le lettere
   accentate sono lettere. In JS: `text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')`.
2. **Stop-word**: `stopwords_it.txt` (117) e `stopwords_en.txt` (142),
   allegati, una per riga.
3. **Punteggio** (Okapi, `k1 = 1.5`, `b = 0.75`):
   - `idf(t) = ln(1 + (N − n_t + 0.5) / (n_t + 0.5))`, dove `N` è il numero di
     paragrafi e `n_t` quanti contengono `t`
   - `score(d) = Σ idf(t) · tf(t,d) · (k1 + 1) / (tf(t,d) + k1 · (1 − b + b · |d| / avgdl))`
   - i termini della domanda si contano **una volta sola** anche se ripetuti
   - `|d|` è il numero di token del paragrafo **dopo** la tokenizzazione
     (quindi senza stop-word)
4. **Scelta**: si scartano i paragrafi con punteggio 0, si ordina per
   punteggio decrescente e si prendono i primi **6**, in quell'ordine.
   **A pari punteggio vince il paragrafo che sta più in basso nel file**
   (indice di riga maggiore). Sembra un dettaglio, ma cambia l'ordine dei
   documenti nel prompt.

### Controllo domanda per domanda

I file `domande_it.jsonl` e `domande_en.jsonl` allegati sono stati aggiornati:
ogni riga ha ora `expected_passage_ids`, i sei paragrafi **nell'ordine** in cui
li restituisce il BM25 dell'addestramento. Questa replica riproduce i record di
addestramento in 100 casi su 100, in entrambe le lingue.

Il BM25 del mobile deve dare **la stessa lista, nello stesso ordine, per tutte
le 60 domande**. Se anche una differisce, il recupero del mobile non è quello
dell'articolo: correggilo prima di misurare. Atteso anche
`expected_gold_in_prompt`: vero per 28 domande italiane su 30 e 26 inglesi su
30.

---

## 5. Lingua della sessione

Non mescolare mai le due lingue:

| sessione | modello | prompt | corpus | stop-word |
|---|---|---|---|---|
| italiana | GGUF con `-ita-` | italiano | `passages_it.jsonl` | `stopwords_it.txt` |
| inglese | GGUF con `-ing-` | inglese | `passages_en.jsonl` | `stopwords_en.txt` |

---

## 6. Parametri di generazione

L'articolo riporta la qualità delle risposte ottenute con **decodifica greedy
(nessun campionamento), `max_new_tokens = 512`, nessuna penalità di
ripetizione**. Usa questi valori nel benchmark, così i tempi si riferiscono
alle stesse risposte di cui l'articolo misura la qualità. Se in produzione
l'app usa valori diversi, scrivilo nel rapporto.

---

## File allegati

- `RISPOSTA_AGENTE.md` (questo)
- `passages_it.jsonl`, `passages_en.jsonl`
- `stopwords_it.txt`, `stopwords_en.txt`
- `domande_it.jsonl`, `domande_en.jsonl` (aggiornati con `expected_passage_ids`)
- `riferimento_gemma3_it_messaggi.json`, `riferimento_gemma3_it_prompt.txt`
- `riferimento_gemma3_en_messaggi.json`, `riferimento_gemma3_en_prompt.txt`
- `riferimento_smollm3_it_messaggi.json`, `riferimento_smollm3_it_prompt.txt`
