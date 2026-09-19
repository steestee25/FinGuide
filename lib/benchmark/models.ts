// The GGUF files measured by the benchmark (ISTRUZIONI_AGENTE_APP.md §2).
// Public on Hugging Face under Stee201; every repo holds a Q8_0 and a Q4_K_M.
// Sizes are the exact byte counts of the files on the Hub.

import type { ModelFamily } from '../chatPrompt';
import type { LocalModel } from '../modelConfig';
import type { Lang } from '../retrieval';

export type Quant = 'Q8_0' | 'Q4_K_M';

export type BenchModel = LocalModel & { size: '270m' | '1b' | '3b'; quant: Quant };

function benchModel(
  size: BenchModel['size'],
  lang: Lang,
  quant: Quant,
  sizeBytes: number,
): BenchModel {
  const family: ModelFamily = size === '3b' ? 'smollm3' : 'gemma3';
  const base = `lira-${family}-${size}-${lang === 'it' ? 'ita' : 'ing'}-sipar-3reg`;
  const filename = `${base}-${quant}.gguf`;
  return {
    id:         `${size}-${quant === 'Q8_0' ? 'q8' : 'q4'}-${lang}`,
    label:      `${family === 'smollm3' ? 'SmolLM3' : 'Gemma3'}-${size.toUpperCase()} ${quant} (${lang})`,
    shortLabel: `${family === 'smollm3' ? 'SmolLM3' : 'Gemma3'}-${size.toUpperCase()}`,
    repo:       `Stee201/${base}`,
    filename,
    cacheName:  filename,
    sizeBytes,
    lang,
    family,
    size,
    quant,
  };
}

/** In matrix order: the six Italian configurations, then the English one. */
export const BENCH_MODELS: BenchModel[] = [
  benchModel('270m', 'it', 'Q8_0',     291_545_312),
  benchModel('270m', 'it', 'Q4_K_M',   253_114_656),
  benchModel('1b',   'it', 'Q8_0',   1_069_306_144),
  benchModel('1b',   'it', 'Q4_K_M',   806_058_080),
  benchModel('3b',   'it', 'Q4_K_M', 1_915_305_472),
  benchModel('3b',   'it', 'Q8_0',   3_275_574_752),
  benchModel('1b',   'en', 'Q4_K_M',   806_058_080),
];

export const findBenchModel = (id: string): BenchModel | undefined =>
  BENCH_MODELS.find(m => m.id === id);
