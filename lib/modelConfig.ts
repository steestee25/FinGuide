// Registry of the GGUF models that can run on-device via llama.rn.
//
// Three sizes × two languages. The header selector offers the three models of
// the app language (see modelsForLang); each model owns a distinct `cacheName`,
// so several of them can coexist on disk without colliding.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { ModelFamily } from './chatPrompt';
import { removeModel } from './modelStorage';
import type { Lang } from './retrieval';

let RNFS: any = null;
if (Platform.OS !== 'web') {
  RNFS = require('react-native-fs');
}

export type LocalModel = {
  id:         string;
  label:      string;   // full name, shown on the loading screen
  shortLabel: string;   // fits the compact header selector
  repo:       string;   // Hugging Face repo
  filename:   string;   // file name inside the repo
  cacheName:  string;   // file name in DocumentDirectoryPath
  sizeBytes:  number;   // expected size: progress + corruption check
  lang:       Lang;     // fine-tuning language: prompt, corpus and stop-words
  family:     ModelFamily;
};

/**
 * The three sizes offered in the chat header, in selector order. Quantisation
 * follows the benchmark matrix: Q8_0 up to 1B, Q4_K_M for the 3B (a Q8_0
 * SmolLM3 is 3.3 GB, too much to ask of a phone).
 */
const SIZES = [
  { size: '1b',   family: 'gemma3',  shortLabel: 'Gemma 1B',    name: 'Gemma 3 1B',   quant: 'Q8_0',   sizeBytes: 1_069_306_144 },
  { size: '270m', family: 'gemma3',  shortLabel: 'Gemma 270M',  name: 'Gemma 3 270M', quant: 'Q8_0',   sizeBytes:   291_545_312 },
  { size: '3b',   family: 'smollm3', shortLabel: 'SmolLM3 3B',  name: 'SmolLM3 3B',   quant: 'Q4_K_M', sizeBytes: 1_915_305_472 },
] as const;

/**
 * One entry per (size, language). The GGUFs are the very files the benchmark
 * measures — same repos, same file names — so a model downloaded by either the
 * app or the benchmark serves both.
 */
const buildModel = (spec: typeof SIZES[number], lang: Lang): LocalModel => {
  const base = `lira-${spec.family}-${spec.size}-${lang === 'it' ? 'ita' : 'ing'}-sipar-3reg`;
  const filename = `${base}-${spec.quant}.gguf`;
  return {
    id:         `${spec.family}-${spec.size}-${lang}`,
    label:      `${spec.name} — ${lang === 'it' ? 'Finance IT' : 'Finance EN'}`,
    shortLabel: spec.shortLabel,
    repo:       `Stee201/${base}`,
    filename,
    cacheName:  filename,
    sizeBytes:  spec.sizeBytes,
    lang,
    family:     spec.family,
  };
};

export const LOCAL_MODELS: Record<string, LocalModel> = Object.fromEntries(
  (['it', 'en'] as Lang[]).flatMap(lang =>
    SIZES.map(spec => {
      const model = buildModel(spec, lang);
      return [model.id, model] as const;
    }),
  ),
);

/** The models selectable in `lang`, in selector order. */
export const modelsForLang = (lang: Lang): LocalModel[] =>
  SIZES.map(spec => LOCAL_MODELS[`${spec.family}-${spec.size}-${lang}`]);

/** Default for a language: the 1B, the size the app has always shipped. */
export const defaultModelId = (lang: Lang): string => `gemma3-1b-${lang}`;

export const DEFAULT_LOCAL_MODEL_ID = defaultModelId('it');

/**
 * The model behind the Advices tab: stock Gemma 3 1B instruct, not a LIRA
 * fine-tune. The spending prompt asks for JSON, which the base model follows
 * more reliably than a model fine-tuned on prose answers.
 *
 * It is a model of its own, so opening Advices after Chat (or the other way
 * round) unloads one GGUF and loads the other — about a gigabyte each way.
 */
export const ADVICES_MODEL: LocalModel = {
  id:         'gemma3-1b-base-q8',
  label:      'Gemma 3 1B (base) Q8_0',
  shortLabel: 'Gemma 1B base',
  repo:       'unsloth/gemma-3-1b-it-GGUF',
  filename:   'gemma-3-1b-it-Q8_0.gguf',
  cacheName:  'gemma-3-1b-it-Q8_0.gguf',
  sizeBytes:  1_069_306_400,
  lang:       'it',
  family:     'gemma3',
};

/**
 * The model a screen should use: the one picked in the header when it exists and
 * matches the app language, otherwise that language's default. Selecting a model
 * and then switching language must not leave the other language's model loaded.
 */
export const resolveModel = (id: string | undefined, lang: Lang): LocalModel => {
  const picked = id ? LOCAL_MODELS[id] : undefined;
  return picked && picked.lang === lang ? picked : LOCAL_MODELS[defaultModelId(lang)];
};

/**
 * Load-time parameters for the shared llama context (see lib/llamaContext.ts).
 * N_CTX matches the model's training length (--max-len 4096).
 */
export const N_CTX = 4096;
export const N_GPU_LAYERS = 1;
export const N_THREADS = 4;

export const getModel = (id: string = DEFAULT_LOCAL_MODEL_ID): LocalModel => {
  const model = LOCAL_MODELS[id] ?? LOCAL_MODELS[DEFAULT_LOCAL_MODEL_ID];
  if (!model) throw new Error(`Unknown local model: ${id}`);
  return model;
};

export const downloadUrl = (m: LocalModel): string =>
  `https://huggingface.co/${m.repo}/resolve/main/${m.filename}`;

export const modelPath = (m: LocalModel): string => {
  if (!RNFS) throw new Error('Local models are not available on this platform');
  return `${RNFS.DocumentDirectoryPath}/${m.cacheName}`;
};

// A partial download is still large, so a fixed floor (e.g. 100 KB) never
// catches it. Derive the threshold from the expected size instead.
export const minValidSize = (m: LocalModel): number => Math.floor(m.sizeBytes * 0.9);

// ─── Migration ────────────────────────────────────────────────────────────────

/**
 * Model files an earlier version downloaded under a different name, byte for
 * byte identical to a current one (verified by sha256). Renaming beats deleting
 * and downloading the same gigabyte again.
 */
const RENAMED_MODEL_FILES: Record<string, string> = {
  // was: Stee201/gemma3-1b-finance-it — a copy of the Italian 1B Q8_0.
  'gemma3-1b-finance-it.q8_0.gguf': 'lira-gemma3-1b-ita-sipar-3reg-Q8_0.gguf',
};

/** Renames the files above when present. Cheap enough to run at every startup. */
export const migrateRenamedModels = async (): Promise<void> => {
  if (!RNFS) return;

  for (const [from, to] of Object.entries(RENAMED_MODEL_FILES)) {
    const fromPath = `${RNFS.DocumentDirectoryPath}/${from}`;
    const toPath = `${RNFS.DocumentDirectoryPath}/${to}`;
    try {
      if (!(await RNFS.exists(fromPath))) continue;
      if (await RNFS.exists(toPath)) {
        // Both present: the new name wins, the old copy is dead weight.
        await RNFS.unlink(fromPath);
      } else {
        await RNFS.moveFile(fromPath, toPath);
        console.log(`[Migration] Renamed model file: ${from} -> ${to}`);
      }
      await removeModel(from, false);
    } catch (e) {
      console.warn(`[Migration] Could not rename legacy model ${from}:`, e);
    }
  }
};

// ─── Legacy cleanup ───────────────────────────────────────────────────────────

/** Model files shipped by earlier versions, superseded by LOCAL_MODELS. */
export const LEGACY_MODEL_FILES = [
  'Gemma3-1B-Mine.gguf',  // was: Stee201/gguf-server-q (chat)
  // gemma-3-1b-it-Q8_0.gguf is NOT listed here: Advices uses it again
  // (ADVICES_MODEL), so deleting it would cost a 1 GB download.
];

const LEGACY_CLEANUP_FLAG = 'legacy_models_cleaned_v1';

/**
 * Deletes the model files left behind by previous versions (~2 GB) and drops
 * their entries from models_metadata.json. Runs at most once per install.
 */
export const cleanupLegacyModels = async (): Promise<void> => {
  if (!RNFS) return;

  await migrateRenamedModels();

  try {
    if (await AsyncStorage.getItem(LEGACY_CLEANUP_FLAG)) return;
  } catch {
    // AsyncStorage unavailable — fall through and just do the check.
  }

  for (const fileName of LEGACY_MODEL_FILES) {
    const path = `${RNFS.DocumentDirectoryPath}/${fileName}`;
    try {
      if (await RNFS.exists(path)) {
        await RNFS.unlink(path);
        console.log(`[Cleanup] Removed legacy model file: ${fileName}`);
      }
      // Drop the metadata entry too (file already gone, so deleteFile: false).
      await removeModel(fileName, false);
    } catch (e) {
      console.warn(`[Cleanup] Could not remove legacy model ${fileName}:`, e);
    }
  }

  try {
    await AsyncStorage.setItem(LEGACY_CLEANUP_FLAG, '1');
  } catch {
    // Not fatal: worst case the (cheap) check runs again next launch.
  }
};
