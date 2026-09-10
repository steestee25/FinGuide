// Runs the measurement protocol of benchmark/ISTRUZIONI_AGENTE_APP.md on the
// phone and appends raw rows to runs.jsonl / sessioni.jsonl. Nothing is
// aggregated: the article's tables are built from the raw rows.
//
// Chat turns go through the benchmark screen (app/benchmark.tsx), which runs
// them with the chat's runChatTurn() and renders them with the chat's
// ChatScreen; this module orchestrates, probes and records.

import { Platform } from 'react-native';
import { ADVICES_GENERATION, AdvicesMarks, runAdvicesTurn } from '../advicesTurn';
import {
  buildRagSystemMessage,
  LEVEL_INSTRUCTIONS,
  PERSONA,
  ProficiencyLevel,
  RULES,
  systemMessageForModel,
} from '../chatPrompt';
import { GenerationParams, STOP_WORDS, TurnMarks } from '../chatTurn';
import { aggregateExpensesByCategory, summarizeExpenses } from '../expenses';
import { contextParams, getLlamaContext, isLlamaReady, releaseLlamaContext } from '../llamaContext';
import { downloadUrl, LocalModel, modelPath, N_CTX } from '../modelConfig';
import { Doc, ensureIndexed, Lang, retrieveRelevant } from '../retrieval';
import BUILD_INFO from './data/build-info.json';
import DOMANDE_EN from './data/domande_en.json';
import DOMANDE_IT from './data/domande_it.json';
import RIFERIMENTI from './data/riferimenti.json';
import FIXTURE from './data/transazioni_fixture.json';
import { Conditions, DeviceInfo, ExitReason, installNetworkCounter, probe, startPeakSampler } from './probe';

const RNFS: any = Platform.OS === 'web' ? null : require('react-native-fs');

// ─── Inputs ───────────────────────────────────────────────────────────────────

export type Question = {
  n:                       number;
  lingua:                  Lang;
  pair_id:                 string | number;
  question:                string;
  gold_passage_id:         string;
  expected_passage_ids:    string[];
  expected_gold_in_prompt: boolean;
};

export const QUESTIONS: Record<Lang, Question[]> = {
  it: DOMANDE_IT as Question[],
  en: DOMANDE_EN as Question[],
};

type Reference = { name: string; messages: { role: string; content: string }[]; prompt: string };

export const LEVELS: ProficiencyLevel[] = ['base', 'intermediate', 'advanced'];

/**
 * The decoding the article reports quality for (RISPOSTA_AGENTE.md §6): greedy
 * (temperature 0 keeps only the most likely token), 512 new tokens, no
 * repetition penalty. The seed is recorded; greedy decoding does not use it.
 * Production chat settings differ (lib/chatTurn.ts CHAT_GENERATION).
 */
export const PAPER_GENERATION: GenerationParams = {
  n_predict:      512,
  stop:           STOP_WORDS,
  temperature:    0,
  top_p:          1.0,
  min_p:          0,
  penalty_repeat: 1.0,
  seed:           42,
};

/**
 * full    = 3 warm-up + 30 questions × 3 levels (ISTRUZIONI §3)
 * repeat  = 3 warm-up + 5 questions × intermediate × 5 repetitions
 * advices = spending advice on fixed transactions × 10 (§5)
 * prova   = 1 warm-up + 2 runs, written apart: a check of the setup, not data.
 *           With `items` ("26a,27b,27i": question n + b/i/a) it replays exactly
 *           those runs, to reproduce a problem seen in a session.
 */
export type SessionMode = 'full' | 'repeat' | 'advices' | 'prova';

const RUN_TIMEOUT_MS = 20 * 60 * 1000;
const ADVICES_RUNS   = 10;

// ─── Output files ─────────────────────────────────────────────────────────────

// App-specific external storage: readable with `adb pull` on a release build,
// where `run-as` (needed for the internal files dir) is not available.
export const OUTPUT_DIR = RNFS?.ExternalDirectoryPath ? `${RNFS.ExternalDirectoryPath}/benchmark` : '';

/** 'prova' sessions write here, so test rows never mix with measurements. */
export const PROVA_DIR = `${OUTPUT_DIR}/prova`;

let outputDir = OUTPUT_DIR;

const files = () => ({
  runs:      `${outputDir}/runs.jsonl`,
  sessions:  `${outputDir}/sessioni.jsonl`,
  log:       `${outputDir}/log.txt`,
  // Shared by all sessions.
  downloads: `${OUTPUT_DIR}/download.jsonl`,
  pending:   `${OUTPUT_DIR}/in_corso.json`,
});

async function ensureOutputDir(): Promise<void> {
  // mkdir creates missing parents, so this also creates OUTPUT_DIR.
  if (!(await RNFS.exists(outputDir))) await RNFS.mkdir(outputDir);
}

async function appendRow(file: string, row: object): Promise<void> {
  await ensureOutputDir();
  await RNFS.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
}

async function readRows(file: string): Promise<any[]> {
  if (!(await RNFS.exists(file))) return [];
  return (await RNFS.readFile(file, 'utf8'))
    .split('\n')
    .filter((l: string) => l.trim())
    .map((l: string) => JSON.parse(l));
}

/** The run in flight, so that a process killed mid-run still leaves a row. */
async function writePending(pending: object): Promise<void> {
  await ensureOutputDir();
  await RNFS.writeFile(files().pending, JSON.stringify({ ...pending, output_dir: outputDir }), 'utf8');
}

async function clearPending(): Promise<void> {
  await RNFS.unlink(files().pending).catch(() => {});
}

export async function appendLog(line: string): Promise<void> {
  try {
    await ensureOutputDir();
    await RNFS.appendFile(files().log, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    // The on-screen log still has it.
  }
}

// ─── Screen interface ─────────────────────────────────────────────────────────

export type UiTurnRequest = {
  question:   string;
  level:      ProficiencyLevel;
  model:      LocalModel;
  generation: GenerationParams;
};

export type UiTurnOutcome = {
  /** performance.now() when "send" was pressed. */
  tSend:         number;
  marks:         TurnMarks;
  /** Streaming text first laid out on screen. */
  firstVisible:  number | null;
  /** Final answer laid out on screen. */
  finalVisible:  number | null;
  docs:          Doc[];
  systemMessage: string;
  completion:    any;
};

export type BenchUI = {
  /** One chat turn on a fresh conversation, rendered like the chat tab. */
  turn(req: UiTurnRequest): Promise<UiTurnOutcome>;
  /** Shows parsed advices; resolves with performance.now() once laid out. */
  showAdvices(advices: { text: string; category: string }[]): Promise<number>;
  log(line: string): void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const now    = () => performance.now();
const round1 = (x: number) => Math.round(x * 10) / 10;
const span   = (from?: number | null, to?: number | null) =>
  from != null && to != null ? round1(to - from) : null;
const MB     = 1024 * 1024;
const slug   = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const pad    = (n: number) => String(n).padStart(4, '0');
const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

class TimeoutError extends Error {}

/** Rejects with TimeoutError after `ms`, calling `onTimeout` to stop the work. */
function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Promise<void>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout().catch(() => {});
      reject(new TimeoutError(`timeout after ${ms} ms`));
    }, ms);
    work.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

const stopGeneration = async () => {
  if (isLlamaReady()) await (await getLlamaContext()).stopCompletion();
};

const looksLikeOom = (e: unknown) => /memory|alloc|oom|mmap|mlock/i.test(String(e));

/**
 * llama.rn ends a turn without EOS, a stop word or the length limit only when a
 * decode fails, and it reports no error: the answer is cut short.
 */
const generationAborted = (completion: any) =>
  !!completion &&
  !completion.stopped_eos &&
  !completion.stopped_word &&
  !completion.stopped_limit &&
  !completion.interrupted;

/** The completion's own stop flags, recorded as they come. */
const stopFlags = (completion: any) => ({
  stopped_eos:   completion?.stopped_eos ?? null,
  stopped_word:  completion?.stopped_word ?? null,
  stopped_limit: completion?.stopped_limit ?? null,
  interrupted:   completion?.interrupted ?? null,
  context_full:  completion?.context_full ?? null,
  truncated:     completion?.truncated ?? null,
});

function deviceRecord(d: DeviceInfo) {
  return {
    model:           `${d.manufacturer} ${d.model}`,
    soc:             [d.socManufacturer, d.socModel].filter(Boolean).join(' ') || d.hardware,
    ram_gb:          round1(d.ramTotalMb / 1024),
    android:         d.android,
    free_storage_gb: round1(d.freeStorageMb / 1024),
  };
}

const appRecord = () => ({
  version:      probe.versionName,
  build:        probe.buildType,
  commit:       BUILD_INFO.commit,
  commit_dirty: BUILD_INFO.dirty,
});

function runtimeRecord(model: LocalModel, ctx: any) {
  const p = contextParams(model);
  return {
    name:          'llama.rn',
    version:       BUILD_INFO.llamaRnVersion,
    backend:       ctx?.gpu ? `GPU (${(ctx.devices ?? []).join(', ') || 'n/d'})` : 'CPU',
    gpu:           !!ctx?.gpu,
    devices:       ctx?.devices ?? [],
    reason_no_gpu: ctx?.reasonNoGPU ?? null,
    android_lib:   ctx?.androidLib ?? null,
    system_info:   ctx?.systemInfo ?? null,
    n_gpu_layers:  p.n_gpu_layers,
    n_threads:     p.n_threads,
    n_ctx:         p.n_ctx,
    use_mlock:     p.use_mlock,
    // Not set by the app: llama.rn only forwards these when given, so they are
    // the llama.cpp defaults (common/common.h).
    n_batch:          2048,
    n_ubatch:         512,
    flash_attn:       'auto',
    use_mmap:         true,
    defaults_not_set: ['n_batch', 'n_ubatch', 'flash_attn', 'use_mmap'],
  };
}

function generationRecord(g: Record<string, unknown>) {
  return {
    max_new_tokens: g.n_predict,
    temperature:    g.temperature ?? null,
    top_p:          g.top_p ?? null,
    seed:           g.seed ?? null,
    params:         g,
  };
}

// ─── Downloads ────────────────────────────────────────────────────────────────

/** Downloads a GGUF from Hugging Face like the app does, timing it. */
export async function downloadModelFile(
  model: LocalModel,
  onProgress: (pct: number) => void,
): Promise<'present' | 'downloaded'> {
  const path = modelPath(model);
  if (await RNFS.exists(path)) {
    const stat = await RNFS.stat(path);
    if (Number(stat.size) === model.sizeBytes) return 'present';
    await RNFS.unlink(path);
  }

  const conditions = await probe.conditions();
  const startedAt = new Date().toISOString();
  const t0 = now();
  const result = await RNFS.downloadFile({
    fromUrl: downloadUrl(model),
    toFile: path,
    progressDivider: 2,
    progress: (r: { bytesWritten: number; contentLength: number }) =>
      onProgress(r.contentLength > 0 ? Math.round((r.bytesWritten / r.contentLength) * 100) : 0),
  }).promise;
  const downloadMs = round1(now() - t0);
  const bytes = Number((await RNFS.stat(path)).size);
  const ok = result.statusCode === 200 && bytes === model.sizeBytes;

  await appendRow(files().downloads, {
    model_file:     model.filename,
    url:            downloadUrl(model),
    status:         result.statusCode,
    bytes,
    expected_bytes: model.sizeBytes,
    ok,
    download_ms:    downloadMs,
    started_at:     startedAt,
    wifi:           conditions.wifiOn,
  });

  if (!ok) {
    await RNFS.unlink(path).catch(() => {});
    throw new Error(`download of ${model.filename} failed: status ${result.statusCode}, ${bytes} bytes`);
  }
  return 'downloaded';
}

async function lastDownload(model: LocalModel) {
  const rows = (await readRows(files().downloads)).filter(r => r.model_file === model.filename && r.ok);
  const last = rows[rows.length - 1];
  return last ? { download_ms: last.download_ms, bytes: last.bytes, at: last.started_at } : null;
}

// ─── Section 0 checks ─────────────────────────────────────────────────────────

const expectedHead = (lang: Lang, level: ProficiencyLevel) =>
  `${PERSONA[lang]} ${LEVEL_INSTRUCTIONS[lang][level]}\n\n${RULES[lang]}\n\n`;

function firstDifference(got: string, expected: string) {
  let i = 0;
  while (i < got.length && got[i] === expected[i]) i++;
  return { index: i, got: got.slice(i, i + 80), expected: expected.slice(i, i + 80) };
}

/** Same six paragraphs, same order as the training pipeline, for all questions. */
async function retrievalCheck(lang: Lang) {
  let identical = 0;
  let gold = 0;
  const mismatches: number[] = [];
  for (const q of QUESTIONS[lang]) {
    const ids = (await retrieveRelevant(q.question, { k: 6, lang })).map(d => d.id);
    if (sameList(ids, q.expected_passage_ids)) identical++;
    else mismatches.push(q.n);
    if (ids.includes(q.gold_passage_id)) gold++;
  }
  return {
    identical,
    of: QUESTIONS[lang].length,
    gold_in_prompt: gold,
    expected_gold_in_prompt: QUESTIONS[lang].filter(q => q.expected_gold_in_prompt).length,
    mismatches,
  };
}

async function runChecks(model: LocalModel, ctx: any) {
  const lang = model.lang;
  const docs = await retrieveRelevant(QUESTIONS[lang][0].question, { k: 6, lang });

  const levelSecond = Object.fromEntries(
    LEVELS.map(level => [level, buildRagSystemMessage(lang, level, docs).startsWith(expectedHead(lang, level))]),
  ) as Record<ProficiencyLevel, boolean>;

  const baseMessage = buildRagSystemMessage(lang, 'base', docs);
  const baseMapsToBase =
    baseMessage.includes(LEVEL_INSTRUCTIONS[lang].base) &&
    !baseMessage.includes(LEVEL_INSTRUCTIONS[lang].intermediate) &&
    !baseMessage.includes(LEVEL_INSTRUCTIONS[lang].advanced);

  // REGOLE: rebuild each reference system message from its document ids.
  const { docs: corpus } = await ensureIndexed(lang);
  const byId = new Map(corpus.map(d => [d.id, d]));
  const references = (RIFERIMENTI as Reference[]).filter(r => r.name.endsWith(`_${lang}`));
  const rulesText = references.map(ref => {
    const family = ref.name.startsWith('smollm3') ? 'smollm3' : 'gemma3';
    const expected = ref.messages.find(m => m.role === 'system')!.content;
    const ids = [...expected.matchAll(/^DOCUMENT[O]? \[(.+?)\]:$/gm)].map(m => m[1]);
    const rebuilt = systemMessageForModel(
      buildRagSystemMessage(lang, 'base', ids.map(id => byId.get(id) ?? { id, text: '' })),
      family,
    );
    return { reference: ref.name, identical: rebuilt === expected };
  });

  // Chat template inside the loaded GGUF vs the reference rendered with the
  // original tokenizer. `<bos>` written as text is the only allowed difference.
  let chatTemplate: object | null = null;
  const reference = references.find(r => r.name.startsWith(model.family));
  if (reference && ctx) {
    try {
      const formatted = await ctx.getFormattedChat(reference.messages, null, {});
      const prompt: string = typeof formatted === 'string' ? formatted : formatted.prompt;
      const identical = prompt === reference.prompt || `<bos>${prompt}` === reference.prompt;
      let tokens: number | null = null;
      try {
        tokens = (await ctx.tokenize(prompt)).tokens.length;
      } catch {
        // Recorded as null.
      }
      chatTemplate = {
        reference: reference.name,
        identical,
        prompt_tokens: tokens,
        first_difference: identical ? null : firstDifference(prompt, reference.prompt),
      };
    } catch (e) {
      chatTemplate = { reference: reference.name, identical: false, error: String(e) };
    }
  }

  const retrieval = await retrievalCheck(lang);
  const nCtx = contextParams(model).n_ctx;

  const checks = {
    level_second_position:  levelSecond,
    base_maps_to_base:      baseMapsToBase,
    n_ctx:                  nCtx,
    corpus_first_doc:       docs[0]?.id ?? null,
    corpus_is_paragraph:    /#p\d{3}$/.test(docs[0]?.id ?? ''),
    rules_text:             rulesText,
    chat_template:          chatTemplate,
    retrieval,
  };

  const allOk =
    Object.values(levelSecond).every(Boolean) &&
    baseMapsToBase &&
    nCtx === 4096 &&
    checks.corpus_is_paragraph &&
    rulesText.length > 0 && rulesText.every(r => r.identical) &&
    (chatTemplate === null || (chatTemplate as any).identical === true) &&
    retrieval.identical === retrieval.of;

  return { ...checks, all_ok: allOk };
}

// ─── Crash / OOM recovery ─────────────────────────────────────────────────────

function classifyExit(exit: ExitReason | null): string {
  if (!exit) return 'crash';
  if (exit.reason === 'LOW_MEMORY' || /low.?mem|lmk|oom/i.test(exit.description)) return 'OOM';
  if (exit.reason === 'USER_REQUESTED' || exit.reason === 'USER_STOPPED') return 'interrupted';
  return 'crash';
}

/**
 * If the previous process died during a run or a model load, records that run
 * (and its session) with the reason Android gives for the death.
 * Call once at start-up, before anything else.
 */
export async function recoverInterrupted(): Promise<string | null> {
  if (!RNFS || !OUTPUT_DIR || !(await RNFS.exists(files().pending))) return null;

  let pending: any;
  try {
    pending = JSON.parse(await RNFS.readFile(files().pending, 'utf8'));
  } catch {
    await clearPending();
    return null;
  }

  const exits = await probe.exitReasons().catch(() => [] as ExitReason[]);
  const exit = exits.find(e => e.timestamp >= pending.started_wall_ms) ?? null;
  const error = classifyExit(exit);
  const { phase, started_wall_ms, session_row, output_dir, ...row } = pending;
  const endedAt = new Date(exit?.timestamp ?? Date.now()).toISOString();

  // Back into the directory of the interrupted session (measurements or prova).
  outputDir = output_dir ?? OUTPUT_DIR;
  try {
    await appendRow(files().runs, { ...row, error, exit_reason: exit, recovered_after_restart: true, output_text: '' });
    if (session_row) {
      await appendRow(files().sessions, {
        ...session_row,
        session_end: endedAt,
        completed: false,
        error: phase === 'load' ? error : `${error} during run ${row.run_id}`,
      });
    }
    await clearPending();
  } finally {
    outputDir = OUTPUT_DIR;
  }
  return `${row.run_id}: ${error}${exit ? ` (${exit.reason})` : ''}`;
}

// ─── Session ──────────────────────────────────────────────────────────────────

// The first load of a process is the cold one (ISTRUZIONI §1b: force-stop, reopen).
let loadsInThisProcess = 0;
let sessionRunning = false;

type PlanItem = { q: Question; level: ProficiencyLevel; warmup: boolean; repeat: number | null };

const LEVEL_CODES: Record<string, ProficiencyLevel> = { b: 'base', i: 'intermediate', a: 'advanced' };

/** "26a,27b" → question 26 advanced, question 27 base. */
function parseItems(items: string, questions: Question[]): PlanItem[] {
  return items.split(',').map(code => {
    const m = code.trim().match(/^(\d+)([bia])$/);
    const q = m ? questions.find(x => x.n === Number(m[1])) : undefined;
    if (!m || !q) throw new Error(`invalid item "${code}" (expected e.g. 26a)`);
    return { q, level: LEVEL_CODES[m[2]], warmup: false, repeat: null };
  });
}

/** Warm-up (first questions, intermediate), then the fixed order of §3. */
function plan(mode: 'full' | 'repeat' | 'prova', lang: Lang, items?: string): PlanItem[] {
  const questions = QUESTIONS[lang];
  const warmup = (count: number): PlanItem[] => questions.slice(0, count)
    .map(q => ({ q, level: 'intermediate', warmup: true, repeat: null }));

  if (mode === 'prova') {
    if (items) return parseItems(items, questions);
    return [
      ...warmup(1),
      { q: questions[0], level: 'base', warmup: false, repeat: null },
      { q: questions[0], level: 'advanced', warmup: false, repeat: null },
    ];
  }
  if (mode === 'full') {
    return [
      ...warmup(3),
      ...questions.flatMap(q => LEVELS.map(level => ({ q, level, warmup: false, repeat: null }))),
    ];
  }
  // Repeatability: 5 questions × intermediate × 5 repetitions.
  return [
    ...warmup(3),
    ...[1, 2, 3, 4, 5].flatMap(repeat =>
      questions.slice(0, 5).map(q => ({ q, level: 'intermediate' as ProficiencyLevel, warmup: false, repeat })),
    ),
  ];
}

export type SessionOptions = {
  model:                LocalModel;
  mode:                 SessionMode;
  ui:                   BenchUI;
  /** Conditions read when the session was allowed to start. */
  conditions:           Conditions;
  conditionsOverridden: boolean;
  /** Measure even if a section 0 check fails (the session row says so). */
  ignoreFailedChecks?:  boolean;
  /** 'prova' only: the runs to replay, e.g. "26a,27b,27i". */
  items?:               string;
};

export async function runSession(o: SessionOptions): Promise<void> {
  if (sessionRunning) throw new Error('a session is already running in this process');
  sessionRunning = true;

  const { model, mode, ui } = o;
  const say = (line: string) => { ui.log(line); void appendLog(line); };

  outputDir = mode === 'prova' ? PROVA_DIR : OUTPUT_DIR;
  probe.keepScreenOn(true);
  const network = installNetworkCounter();

  try {
    const started = new Date();
    const device = await probe.deviceInfo();
    const deviceSlug = slug(device.model);
    const sessionId = `${deviceSlug}_${model.id}_${mode}_${started.toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
    const stat = await RNFS.stat(modelPath(model)).catch(() => null);
    const generation = mode === 'advices' ? ADVICES_GENERATION : PAPER_GENERATION;
    // Parse before loading: a typo in `items` should not cost a model load.
    const items = mode === 'advices' ? [] : plan(mode, model.lang, o.items);

    const sessionRow: Record<string, any> = {
      session_id:             sessionId,
      mode,
      items:                  o.items ?? null,
      device:                 deviceRecord(device),
      device_full:            device,
      app:                    appRecord(),
      model_file:             model.cacheName,
      model_repo:             model.repo,
      model_file_mb:          stat ? round1(Number(stat.size) / MB) : null,
      lingua:                 model.lang,
      download:               await lastDownload(model),
      free_storage_before_mb: round1(device.freeStorageMb),
      session_start:          started.toISOString(),
      conditions_start:       o.conditions,
      conditions_overridden:  o.conditionsOverridden,
      generation:             generationRecord(generation),
    };

    const rowBase = (runId: string) => ({
      run_id:        runId,
      session_id:    sessionId,
      timestamp:     new Date().toISOString(),
      device:        sessionRow.device,
      build:         probe.buildType,
      app:           sessionRow.app,
      runtime:       sessionRow.runtime ?? null,
      generation:    sessionRow.generation,
      model_file:    model.cacheName,
      model_file_mb: sessionRow.model_file_mb,
      lingua:        model.lang,
      mode,
    });

    // Load: cold (first load of a fresh process), then warm.
    say(`[${sessionId}] caricamento ${model.cacheName}`);
    const loadRunId = `${deviceSlug}_${model.id}_load`;
    await writePending({
      ...rowBase(loadRunId), workflow: 'load', phase: 'load',
      started_wall_ms: Date.now(), session_row: sessionRow,
    });

    let ctx: any;
    try {
      const coldValid = loadsInThisProcess === 0 && !isLlamaReady();
      await releaseLlamaContext();
      let t = now();
      ctx = await getLlamaContext(model);
      sessionRow.load_cold_ms = round1(now() - t);
      sessionRow.load_cold_valid = coldValid;
      loadsInThisProcess++;

      await releaseLlamaContext();
      t = now();
      ctx = await getLlamaContext(model);
      sessionRow.load_warm_ms = round1(now() - t);
    } catch (e) {
      const error = looksLikeOom(e) ? 'OOM' : 'load_failed';
      say(`caricamento fallito: ${error} — ${String(e)}`);
      await appendRow(files().runs, {
        ...rowBase(loadRunId), workflow: 'load', error, error_message: String(e), output_text: '',
      });
      await appendRow(files().sessions, {
        ...sessionRow, error, error_message: String(e), completed: false, session_end: new Date().toISOString(),
      });
      await clearPending();
      await releaseLlamaContext();
      return;
    }
    await clearPending();
    sessionRow.runtime = runtimeRecord(model, ctx);
    say(`caricato: cold ${sessionRow.load_cold_ms} ms, warm ${sessionRow.load_warm_ms} ms, backend ${sessionRow.runtime.backend}`);

    // Section 0: stop if anything differs from the article's system.
    sessionRow.checks = await runChecks(model, ctx);
    say(`controlli sezione 0: ${sessionRow.checks.all_ok ? 'tutti OK' : 'FALLITI'} — ${JSON.stringify(sessionRow.checks)}`);
    if (!sessionRow.checks.all_ok && !o.ignoreFailedChecks) {
      await appendRow(files().sessions, {
        ...sessionRow, error: 'checks_failed', completed: false, session_end: new Date().toISOString(),
      });
      return;
    }

    const counts = { total: 0, failed: 0 };
    const context = { ui, model, sessionRow, rowBase, network, deviceSlug, counts, say };

    if (mode === 'advices') await runAdvices(context);
    else await runChat(context, items);

    const end = await probe.conditions();
    const deviceEnd = await probe.deviceInfo();
    await appendRow(files().sessions, {
      ...sessionRow,
      conditions_end:        end,
      free_storage_after_mb: round1(deviceEnd.freeStorageMb),
      session_end:           new Date().toISOString(),
      runs_total:            counts.total,
      runs_failed:           counts.failed,
      completed:             true,
      error:                 null,
    });
    say(`[${sessionId}] fine: ${counts.total} esecuzioni, ${counts.failed} fallite`);
  } finally {
    network.uninstall();
    probe.keepScreenOn(false);
    outputDir = OUTPUT_DIR;
    sessionRunning = false;
  }
}

type RunContext = {
  ui:         BenchUI;
  model:      LocalModel;
  sessionRow: Record<string, any>;
  rowBase:    (runId: string) => Record<string, any>;
  network:    ReturnType<typeof installNetworkCounter>;
  deviceSlug: string;
  counts:     { total: number; failed: number };
  say:        (line: string) => void;
};

/** Probes around one run: pending marker, memory, thermal, battery, network. */
async function probed<T>(
  c: RunContext,
  row: Record<string, any>,
  work: () => Promise<T>,
): Promise<{ value: T | null; error: string | null; errorMessage: string | null; probes: Record<string, any> }> {
  await writePending({ ...row, phase: 'run', started_wall_ms: Date.now(), session_row: c.sessionRow });

  const before = await probe.conditions();
  const memBefore = await probe.pssMb();
  const sampler = startPeakSampler(250);
  const t0 = now();

  let value: T | null = null;
  let error: string | null = null;
  let errorMessage: string | null = null;
  const pendingWork = work();
  try {
    value = await withTimeout(pendingWork, RUN_TIMEOUT_MS, stopGeneration);
  } catch (e) {
    error = e instanceof TimeoutError ? 'timeout' : looksLikeOom(e) ? 'OOM' : 'crash';
    errorMessage = String(e);
    await pendingWork.catch(() => {}); // let a stopped generation unwind first
  }

  const { peakMb, samples } = await sampler.stop();
  const after = await probe.conditions();
  const requests = c.network.since(t0);

  return {
    value,
    error,
    errorMessage,
    probes: {
      mem_before_mb:     round1(memBefore),
      peak_mem_mb:       round1(Math.max(peakMb, memBefore)),
      mem_samples:       samples,
      thermal_before:    before.thermal,
      thermal_after:     after.thermal,
      battery_before:    before.battery,
      battery_after:     after.battery,
      charging:          before.charging || after.charging,
      airplane_mode:     before.airplaneMode && after.airplaneMode,
      network_requests:  requests.length,
      network_urls:      requests.map(r => `${r.kind} ${r.url}`),
    },
  };
}

async function runChat(c: RunContext, items: PlanItem[]): Promise<void> {
  const lang = c.model.lang;
  let order = 0;

  for (const item of items) {
    order++;
    const row = {
      ...c.rowBase(`${c.deviceSlug}_${c.model.id}_${pad(order)}`),
      workflow:         'chat',
      n:                item.q.n,
      pair_id:          item.q.pair_id,
      livello:          item.level,
      order_in_session: order,
      warmup:           item.warmup,
      repeat_index:     item.repeat,
    };
    c.say(`${order}/${items.length} n=${item.q.n} ${item.level}${item.warmup ? ' (riscaldamento)' : ''}`);

    const { value: out, error: probeError, errorMessage, probes } = await probed(c, row, () =>
      c.ui.turn({ question: item.q.question, level: item.level, model: c.model, generation: PAPER_GENERATION }),
    );

    const m = out?.marks ?? {};
    const completion = out?.completion;
    const timings = completion?.timings ?? null;
    const promptTokens: number | null = completion?.tokens_evaluated ?? null;
    const outputTokens: number | null = completion?.tokens_predicted ?? timings?.predicted_n ?? null;
    const ids = (out?.docs ?? []).map(d => d.id);
    const error = probeError ?? (generationAborted(completion) ? 'generation_aborted' : null);

    const result = {
      ...row,
      retrieval_ms:            span(m.retrieval_start, m.retrieval_end),
      prompt_build_ms:         span(m.retrieval_end, m.prompt_end),
      prompt_tokens:           promptTokens,
      // llama.rn does not report when prompt processing ends; this is the
      // runtime's own measure (runtime_timings.prompt_ms).
      prefill_ms:              timings?.prompt_ms ?? null,
      ttft_engine_ms:          span(m.completion_start, m.first_token),
      ttft_ui_ms:              span(out?.tSend, out?.firstVisible),
      decode_ms:               span(m.first_token, m.last_token),
      output_tokens:           outputTokens,
      e2e_ms:                  span(out?.tSend, out?.finalVisible),
      completion_wall_ms:      span(m.completion_start, m.completion_end),
      runtime_timings:         timings,
      // Prompt tokens whose KV entries were reused from the previous run (the
      // shared prompt prefix); the runtime evaluated only the rest (prompt_n).
      // Meaningless when the generation aborted (the runtime's counters stop).
      prompt_reused_tokens:    promptTokens != null && timings?.prompt_n != null ? promptTokens - timings.prompt_n : null,
      // llama.rn's `tokens_cached`: positions in the KV cache after generation.
      n_past_after:            completion?.tokens_cached ?? null,
      ...stopFlags(completion),
      // The runtime counts the last sampled token in predicted_n; the text holds
      // one token less (tokens_predicted), so the limit shows up as predicted_n.
      truncated_by_max_tokens: !!completion?.stopped_limit || (timings?.predicted_n ?? 0) >= PAPER_GENERATION.n_predict,
      ...probes,
      prompt_tokens_lt_n_ctx:  promptTokens != null && promptTokens < N_CTX && !completion?.truncated,
      level_ok:                !!out && out.systemMessage.startsWith(expectedHead(lang, item.level)),
      passage_ids:             ids,
      expected_passage_ids_ok: sameList(ids, item.q.expected_passage_ids),
      gold_in_prompt:          ids.includes(item.q.gold_passage_id),
      error,
      error_message:           errorMessage,
      output_text:             completion?.text ?? '',
    };
    await appendRow(files().runs, result);
    await clearPending();

    c.say(
      error
        ? `  errore ${error}: ${errorMessage ?? `n_past ${result.n_past_after}, ${outputTokens} tok`}`
        : `  prompt ${promptTokens} tok, ttft_ui ${result.ttft_ui_ms} ms, ${outputTokens} tok in ${result.decode_ms} ms, e2e ${result.e2e_ms} ms, picco ${probes.peak_mem_mb} MB`,
    );

    c.counts.total++;
    if (error) c.counts.failed++;
    if (error === 'OOM') {
      c.say('OOM: sessione interrotta');
      return;
    }
  }
}

/** ISTRUZIONI §5: advices on fixed transactions, 10 times, production path. */
async function runAdvices(c: RunContext): Promise<void> {
  // Mirrors the Supabase queries: expenses only (amount < 0), totals per category.
  const expenses = (FIXTURE as { category: string; amount: number }[]).filter(t => t.amount < 0);
  const summary = summarizeExpenses(aggregateExpensesByCategory(expenses), 'month');
  c.sessionRow.advices_summary = summary;

  for (let order = 1; order <= ADVICES_RUNS; order++) {
    const row = {
      ...c.rowBase(`${c.deviceSlug}_${c.model.id}_advices_${pad(order)}`),
      workflow:            'advices',
      livello:             'intermediate',
      // The Advices tab has no proficiency level: the same prompt serves all.
      level_supported:     false,
      order_in_session:    order,
      warmup:              false,
      transactions_source: 'fixture (in produzione: Supabase)',
      model_kind:          'fine-tuned (stesso file GGUF della chat)',
    };
    c.say(`consigli ${order}/${ADVICES_RUNS}`);

    const marks: AdvicesMarks = {};
    let tStart = 0;
    const { value: out, error: probeError, errorMessage, probes } = await probed(c, row, async () => {
      tStart = now();
      const result = await runAdvicesTurn({ summary, marks });
      const visible = await c.ui.showAdvices(result.advices);
      return { ...result, visible };
    });

    const completion = out?.completion;
    const timings = completion?.timings ?? null;
    const error = probeError ?? (generationAborted(completion) ? 'generation_aborted' : null);
    await appendRow(files().runs, {
      ...row,
      prompt_tokens:   completion?.tokens_evaluated ?? null,
      prefill_ms:      timings?.prompt_ms ?? null,
      ttft_engine_ms:  span(marks.completion_start, marks.first_token),
      decode_ms:       span(marks.first_token, marks.last_token),
      output_tokens:   completion?.tokens_predicted ?? timings?.predicted_n ?? null,
      e2e_ms:          span(tStart || null, out?.visible ?? null),
      runtime_timings: timings,
      ...stopFlags(completion),
      truncated_by_max_tokens:
        !!completion?.stopped_limit || (timings?.predicted_n ?? 0) >= ADVICES_GENERATION.n_predict,
      ...probes,
      parsed_advices:  out?.advices.length ?? 0,
      // With no parsable advice the tab shows rule-based fallback text instead.
      tab_would_use_fallback: !!out && out.advices.length === 0,
      error,
      error_message:   errorMessage,
      output_text:     completion?.text ?? '',
    });
    await clearPending();

    c.counts.total++;
    if (error) c.counts.failed++;
    if (error === 'OOM') return;
  }
}
