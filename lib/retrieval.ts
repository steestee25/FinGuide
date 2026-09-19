// Retrieves relevant documents from the knowledge base using BM25.
//
// One corpus per language, the same ones the models were fine-tuned on:
// 522 CONSOB paragraphs (it) and 449 FCA / Bank of England paragraphs (en).
// Regenerate lib/corpus/ with scripts/build-benchmark-data.js.

import * as bm25 from './bm25Index';
import PASSAGES_EN from './corpus/passages_en.json';
import PASSAGES_IT from './corpus/passages_it.json';
import STOPWORDS_EN from './corpus/stopwords_en.json';
import STOPWORDS_IT from './corpus/stopwords_it.json';

export type Lang = 'it' | 'en';

/** A paragraph as exported by the server corpus (passages_*.jsonl). */
type Passage = {
  passage_id: string;
  concept:    string;
  text:       string;
  source_url: string;
};

let RNFS: any = null;
try { RNFS = require('react-native-fs'); } catch { /* not available on web */ }


export type Doc = {
  id:       string;
  text:     string;
  metadata?: {
    source_title?: string;
    source_url?:   string;
    answer?:       string;
  };
};

type Corpus = {
  passages:    Passage[];
  stopWords:   ReadonlySet<string>;
  sourceTitle: (passageId: string) => string;
};

const CORPORA: Record<Lang, Corpus> = {
  it: {
    passages:    PASSAGES_IT as Passage[],
    stopWords:   new Set(STOPWORDS_IT as string[]),
    // getDisplaySourceTitle() already appends the topic derived from the URL.
    sourceTitle: () => 'CONSOB',
  },
  en: {
    passages:    PASSAGES_EN as Passage[],
    stopWords:   new Set(STOPWORDS_EN as string[]),
    sourceTitle: id => (id.startsWith('boe/') ? 'Bank of England' : 'FCA'),
  },
};

type DiskCache = {
  version:     number;
  fingerprint: string;
  bm25Index:   bm25.BM25Index;
};

type Indexed = { docs: Doc[]; index: bm25.BM25Index; stopWords: ReadonlySet<string> };


// 2: corpus switched from ft.jsonl Q&A chunks to the 522 CONSOB paragraphs.
// 3: training-pipeline BM25 (Unicode tokeniser, stop-word files, concept + text).
const CACHE_VERSION   = 3;
const cacheFile       = (lang: Lang) =>
  RNFS ? `${RNFS.DocumentDirectoryPath}/bm25_index_${lang}.json` : null;
const LEGACY_CACHE    = RNFS ? `${RNFS.DocumentDirectoryPath}/bm25_index.json` : null;


const indexed: Partial<Record<Lang, Indexed>> = {};


/**
 * `metadata.answer` is deliberately left unset: SourcesDisplay falls back to
 * `item.text` (components/SourcesDisplay.tsx:98), which is the paragraph itself.
 */
function loadDocs(corpus: Corpus): Doc[] {
  return corpus.passages.map(p => ({
    id:   p.passage_id,
    text: p.text,
    metadata: {
      source_title: corpus.sourceTitle(p.passage_id),
      source_url:   p.source_url,
    },
  }));
}

/** The title only helps retrieval: it is indexed, but never put in the prompt. */
const indexText = (p: Passage) => `${p.concept} ${p.text}`;

// Changes whenever knowledge base content changes → cache invalidation.

function fingerprint(texts: string[], stopWords: ReadonlySet<string>): string {
  let h = 0;
  for (const s of [...texts, ...stopWords]) {
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  }
  return h.toString(36);
}

/**
 * Ensures the BM25 index for `lang` is ready.
 *
 * Load order:
 *   1. Already in memory this session → return immediately.
 *   2. On-disk cache valid (version + fingerprint match) → restore index, no rebuild.
 *   3. Build from scratch + write cache to disk.
 */
export async function ensureIndexed(lang: Lang = 'it'): Promise<Indexed> {
  const ready = indexed[lang];
  if (ready && bm25.isReady(ready.index)) return ready;

  const corpus = CORPORA[lang];
  const docs   = loadDocs(corpus);
  const texts  = corpus.passages.map(indexText);
  const fp     = fingerprint(texts, corpus.stopWords);
  const file   = cacheFile(lang);

  if (RNFS && LEGACY_CACHE) {
    await RNFS.unlink(LEGACY_CACHE).catch(() => {});
  }

  if (RNFS && file) {
    try {
      if (await RNFS.exists(file)) {
        const raw: DiskCache = JSON.parse(await RNFS.readFile(file, 'utf8'));

        if (raw.version === CACHE_VERSION && raw.fingerprint === fp && bm25.isReady(raw.bm25Index)) {
          console.log(`[BM25:${lang}] Index loaded from cache (${docs.length} docs)`);
          return (indexed[lang] = { docs, index: raw.bm25Index, stopWords: corpus.stopWords });
        }

        console.log(`[BM25:${lang}] Cache stale, rebuilding`);
        await RNFS.unlink(file).catch(() => {});
      }
    } catch (e) {
      console.warn(`[BM25:${lang}] Cache read failed, rebuilding:`, e);
    }
  }

  const index = bm25.buildIndex(texts, corpus.stopWords);
  console.log(`[BM25:${lang}] Index built for ${docs.length} documents`);

  if (RNFS && file) {
    try {
      const cache: DiskCache = { version: CACHE_VERSION, fingerprint: fp, bm25Index: index };
      await RNFS.writeFile(file, JSON.stringify(cache), 'utf8');
      console.log(`[BM25:${lang}] Cache written to disk`);
    } catch (e) {
      console.warn(`[BM25:${lang}] Failed to write cache:`, e);
    }
  }

  return (indexed[lang] = { docs, index, stopWords: corpus.stopWords });
}

/** The k best paragraphs for `query`, best first (see bm25.topK for the order). */
export async function retrieveRelevant(
  query:   string,
  options: { k?: number; lang?: Lang } = {},
): Promise<Doc[]> {
  const { k = 6, lang = 'it' } = options;

  const { docs, index, stopWords } = await ensureIndexed(lang);

  const queryTerms = bm25.tokenize(query, stopWords);
  const best = bm25.topK(bm25.scoreAll(index, queryTerms), k);

  console.log(`[BM25:${lang}] query="${query}" terms=[${queryTerms.join(', ')}]`);
  best.forEach(({ docIdx, score }, i) =>
    console.log(`  [${i+1}] score=${score.toFixed(3)} id=${docs[docIdx].id} "${docs[docIdx].text.slice(0,60).replace(/\n/g,' ')}…"`)
  );

  return best.map(({ docIdx }) => docs[docIdx]);
}

export default { ensureIndexed, retrieveRelevant };
