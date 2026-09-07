// Registry of the GGUF models that can run on-device via llama.rn.
//
// Adding a model = one entry in LOCAL_MODELS. Each model owns a distinct
// `cacheName`, so several models can coexist on disk without colliding.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { removeModel } from './modelStorage';

let RNFS: any = null;
if (Platform.OS !== 'web') {
  RNFS = require('react-native-fs');
}

export type LocalModel = {
  id:        string;
  label:     string;
  repo:      string;   // Hugging Face repo
  filename:  string;   // file name inside the repo
  cacheName: string;   // file name in DocumentDirectoryPath
  sizeBytes: number;   // expected size: progress + corruption check
};

export const LOCAL_MODELS: Record<string, LocalModel> = {
  'gemma3-1b-finance-it': {
    id:        'gemma3-1b-finance-it',
    label:     'Gemma 3 1B — Finance IT',
    repo:      'Stee201/gemma3-1b-finance-it',
    filename:  'gemma3-1b.q8_0.gguf',
    cacheName: 'gemma3-1b-finance-it.q8_0.gguf',
    sizeBytes: 1_069_306_144,
  },
};

export const DEFAULT_LOCAL_MODEL_ID = 'gemma3-1b-finance-it';

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

// ─── Legacy cleanup ───────────────────────────────────────────────────────────

/** Model files shipped by earlier versions, superseded by LOCAL_MODELS. */
export const LEGACY_MODEL_FILES = [
  'Gemma3-1B-Mine.gguf',      // was: Stee201/gguf-server-q (chat)
  'gemma-3-1b-it-Q8_0.gguf',  // was: unsloth/gemma-3-1b-it-GGUF (advices)
];

const LEGACY_CLEANUP_FLAG = 'legacy_models_cleaned_v1';

/**
 * Deletes the model files left behind by previous versions (~2 GB) and drops
 * their entries from models_metadata.json. Runs at most once per install.
 */
export const cleanupLegacyModels = async (): Promise<void> => {
  if (!RNFS) return;

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
