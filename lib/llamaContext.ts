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

if (Platform.OS !== 'web') {
  const llamaModule = require('llama.rn');
  initLlama = llamaModule.initLlama;
}

type LlamaContext = any;

let context: LlamaContext | null = null;
/** Which model the current context holds. */
let activeModel: LocalModel | null = null;

/**
 * Loads and releases run one at a time.
 *
 * Chat and Advices are both mounted, so a model change — the header selector or
 * a language switch — reaches both at once. Unserialised, each one saw the old
 * activeModel, each one released the same native context, and llama.rn crashed
 * in releaseContext -> stopCompletion on the second free.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(op: () => Promise<T>): Promise<T> {
  const run = queue.then(op, op);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

/** Load-time parameters of every model (the benchmark records them). */
export const contextParams = (model: LocalModel) => ({
  model: modelPath(model),
  use_mlock: true,
  n_ctx: N_CTX,
  n_gpu_layers: N_GPU_LAYERS,
  n_threads: N_THREADS,
});

/** The model held by the shared context, or null when nothing is loaded. */
export const getActiveModel = (): LocalModel | null => activeModel;

/** Frees the context without taking the queue: callers below already hold it. */
async function releaseInternal(): Promise<void> {
  if (!context) return;
  const ctx = context;
  // Cleared first, so a caller that runs after an await can never see a context
  // that is on its way out.
  context = null;
  activeModel = null;
  try {
    await ctx.release();
  } catch (e) {
    console.warn('[Llama] release failed:', e);
  }
  console.log('[Llama] shared context released');
}

/**
 * Returns the shared context, loading it on first use. Concurrent callers queue
 * behind one load instead of racing into two initLlama calls.
 *
 * Called without a model it returns whatever is loaded (turn helpers do this),
 * falling back to the default model only when nothing is. Called with a
 * different model than the one loaded — the header selector switched, or the
 * app language changed — the old context is released first: llama.rn holds the
 * weights with use_mlock, so two contexts would pin both models in RAM.
 */
export async function getLlamaContext(model?: LocalModel): Promise<LlamaContext> {
  return serialize(async () => {
    // Resolved inside the queue: a no-argument caller behind a pending switch
    // must get the model that switch installed, not the one it replaced.
    const target = model ?? activeModel ?? getModel();

    if (context && activeModel?.id === target.id) return context;

    if (context) {
      console.log(`[Llama] switching model: ${activeModel?.cacheName} -> ${target.cacheName}`);
      await releaseInternal();
    }

    console.log('[Llama] initLlama on shared context:', target.cacheName);
    const ctx = await initLlama(contextParams(target));
    context = ctx;
    activeModel = target;
    console.log('[Llama] shared context ready');
    return ctx;
  });
}

/** True once the shared context exists, for UI gating without holding a handle. */
export const isLlamaReady = (): boolean => context !== null;

/**
 * Frees the shared context. Only for error recovery — reloading costs a full
 * model load. Safe to call when nothing is loaded.
 *
 * Releases this context only: on Android releaseAllLlama() never resolves
 * (llama.rn 0.9.5), so a recovery through it would hang for good.
 */
export async function releaseLlamaContext(): Promise<void> {
  return serialize(releaseInternal);
}
