// Okapi BM25 over an inverted index: term → [{docIdx, tf}]
//
// Replicates the retrieval that built the training records
// (benchmark/RISPOSTA_AGENTE.md §4): same tokeniser, stop-words, k1/b, idf and
// tie-break. The six documents in the prompt — and their order — must match what
// the model was fine-tuned on, so none of these details is cosmetic.

const K1 = 1.5;
const B  = 0.75;

type Posting = { docIdx: number; tf: number };

export type BM25Index = {
  invertedIndex: Record<string, Posting[]>;
  idf:           Record<string, number>;
  docLengths:    number[];
  avgDocLength:  number;
  numDocs:       number;
};

// ─── Tokeniser ────────────────────────────────────────────────────────────────

/**
 * Lowercase; every run of characters that are not letters or digits (`_`
 * included) becomes a space; keep tokens longer than 2 characters that are not
 * stop-words. Accented letters are letters, hence the Unicode classes.
 */
export function tokenize(text: string, stopWords: ReadonlySet<string>): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(t => t.length > 2 && !stopWords.has(t));
}

// ─── Build inverted index ─────────────────────────────────────────────────────

export function buildIndex(docs: string[], stopWords: ReadonlySet<string>): BM25Index {
  const N = docs.length;
  const docLengths: number[] = [];
  const postingMap: Record<string, Map<number, number>> = {};

  for (let docIdx = 0; docIdx < docs.length; docIdx++) {
    // |d| is the token count after stop-word removal.
    const terms = tokenize(docs[docIdx], stopWords);
    docLengths.push(terms.length);

    for (const term of terms) {
      if (!postingMap[term]) postingMap[term] = new Map();
      postingMap[term].set(docIdx, (postingMap[term].get(docIdx) ?? 0) + 1);
    }
  }

  const avgDocLength = docLengths.reduce((s, l) => s + l, 0) / (N || 1);

  const invertedIndex: Record<string, Posting[]> = {};
  const idf: Record<string, number> = {};

  for (const [term, map] of Object.entries(postingMap)) {
    const df = map.size;
    idf[term] = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    invertedIndex[term] = Array.from(map.entries()).map(([docIdx, tf]) => ({ docIdx, tf }));
  }

  return { invertedIndex, idf, docLengths, avgDocLength, numDocs: N };
}

// ─── Score ────────────────────────────────────────────────────────────────────

/**
 * Returns BM25 scores for ALL documents that match at least one query term.
 * A term repeated in the query counts once.
 */
export function scoreAll(index: BM25Index, queryTerms: string[]): Map<number, number> {
  const scores = new Map<number, number>();

  for (const term of new Set(queryTerms)) {
    const postings = index.invertedIndex[term];
    if (!postings) continue;

    const termIdf = index.idf[term];

    for (const { docIdx, tf } of postings) {
      const dl  = index.docLengths[docIdx];
      const bm25 = termIdf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (dl / index.avgDocLength)));
      scores.set(docIdx, (scores.get(docIdx) ?? 0) + bm25);
    }
  }

  return scores;
}

/**
 * The k best documents: zero scores dropped, score descending, and on equal
 * score the document further down the corpus wins (it changes the order of the
 * documents in the prompt, so it has to match the training pipeline).
 */
export function topK(scores: Map<number, number>, k: number): { docIdx: number; score: number }[] {
  return Array.from(scores, ([docIdx, score]) => ({ docIdx, score }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || b.docIdx - a.docIdx)
    .slice(0, k);
}

export function isReady(index: BM25Index | null | undefined): index is BM25Index {
  return !!index && index.numDocs > 0 && Object.keys(index.invertedIndex).length > 0;
}
