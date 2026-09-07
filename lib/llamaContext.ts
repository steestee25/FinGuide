// Single shared llama.rn context.
//
// Chat and Advices both run the same model. expo-router keeps tabs mounted, so
// when each screen created its own context the ~1 GB model was pinned in RAM
// twice (use_mlock), and `releaseAllLlama()` — which is global, not per
// context — let one screen destroy the other's context while that screen still
// held a handle to it.
//
// Screens must not cache the context: call getLlamaContext() at the point of
// use, so a released context can never be used through a stale handle.

import { Platform } from 'react-native';
import { getModel, LocalModel, modelPath, N_CTX, N_GPU_LAYERS, N_THREADS } from './modelConfig';

let initLlama: any = null;
let releaseAllLlama: any = null;

if (Platform.OS !== 'web') {
  const llamaModule = require('llama.rn');
  initLlama = llamaModule.initLlama;
  releaseAllLlama = llamaModule.releaseAllLlama;
}

type LlamaContext = any;

let context: LlamaContext | null = null;
let loading: Promise<LlamaContext> | null = null;

/**
 * Returns the shared context, loading it on first use. Concurrent callers share
 * one load instead of racing into two initLlama calls.
 */
export async function getLlamaContext(model: LocalModel = getModel()): Promise<LlamaContext> {
  if (context) return context;

  if (!loading) {
    loading = (async () => {
      console.log('[Llama] initLlama on shared context:', model.cacheName);
      const ctx = await initLlama({
        model: modelPath(model),
        use_mlock: true,
        n_ctx: N_CTX,
        n_gpu_layers: N_GPU_LAYERS,
        n_threads: N_THREADS,
      });
      console.log('[Llama] shared context ready');
      return ctx;
    })().catch(e => {
      loading = null;
      throw e;
    });
  }

  context = await loading;
  return context;
}

/** True once the shared context exists, for UI gating without holding a handle. */
export const isLlamaReady = (): boolean => context !== null;

/**
 * Frees the shared context. Only for error recovery — reloading costs a full
 * model load. Safe to call when nothing is loaded.
 */
export async function releaseLlamaContext(): Promise<void> {
  if (!context && !loading) return;
  try {
    await releaseAllLlama();
  } catch (e) {
    console.warn('[Llama] release failed:', e);
  } finally {
    context = null;
    loading = null;
    console.log('[Llama] shared context released');
  }
}
