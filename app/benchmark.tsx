// Hidden benchmark screen (benchmark/ISTRUZIONI_AGENTE_APP.md §7).
//
// Exists only in APKs built with scripts/build-benchmark-apk.js
// (-PliraBenchmark=true); elsewhere it redirects home. Opened by deep link, e.g.
//
//   adb shell "am start -a android.intent.action.VIEW \
//     -d 'com.stefano10.yourmoney://benchmark?model=1b-q4-it&mode=full&autostart=1'"
//
// Params: model (a BENCH_MODELS id, or "app" for the model the app ships),
// mode (full | repeat | advices | prova), autostart=1, action=download,
// ignoreChecks=1. See benchmark/PROCEDURA.md.
//
// Chat turns run through the chat's runChatTurn() and are rendered by the
// chat's ChatScreen, so ttft_ui_ms and e2e_ms cover the user's code path.

import type { AnimationPhase } from '@/components/AnswerAnimation';
import ChatScreen from '@/components/ChatScreen';
import { BENCHMARK_ENABLED } from '@/lib/benchmark/flag';
import { BENCH_MODELS, findBenchModel } from '@/lib/benchmark/models';
import { Conditions, probe } from '@/lib/benchmark/probe';
import {
  BenchUI,
  downloadModelFile,
  OUTPUT_DIR,
  recoverInterrupted,
  runSession,
  SessionMode,
  UiTurnOutcome,
  UiTurnRequest,
} from '@/lib/benchmark/runner';
import { ChatMessage, runChatTurn, TurnMarks } from '@/lib/chatTurn';
import { getModel, LocalModel, modelPath } from '@/lib/modelConfig';
import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const RNFS: any = Platform.OS === 'web' ? null : require('react-native-fs');

type Message = ChatMessage & { sources?: any[] };

// ChatScreen never renders the system message; it only keeps the chat's shape.
const INITIAL_CONVERSATION: Message[] = [{ role: 'system', content: '' }];

/** The model the app itself downloads (byte-identical to 1b-q8-it). */
const APP_MODEL_ID = 'app';

const MODEL_CHOICES = [
  ...BENCH_MODELS.map(m => ({ id: m.id, model: m as LocalModel })),
  { id: APP_MODEL_ID, model: getModel() },
];

const findModel = (id: string): LocalModel | undefined =>
  id === APP_MODEL_ID ? getModel() : findBenchModel(id);

const MODES: { key: SessionMode; label: string }[] = [
  { key: 'full', label: 'Sessione completa (3 + 90)' },
  { key: 'repeat', label: 'Ripetibilità (5 × 5)' },
  { key: 'advices', label: 'Consigli spese (10)' },
  { key: 'prova', label: 'Prova (3, non sono dati)' },
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// expo-router can mount this screen twice while it resolves the deep link (the
// first copy unmounts at once). Start-up work runs once per process, from the
// copy that stays mounted.
let startedUp = false;

/** What keeps the phone from the protocol's conditions (ISTRUZIONI §3). */
function conditionProblems(c: Conditions): string[] {
  const problems: string[] = [];
  if (c.charging) problems.push('cavo collegato / in carica');
  if (!c.airplaneMode) problems.push('modalità aereo spenta');
  if (c.wifiOn) problems.push('Wi-Fi acceso');
  if (c.bluetoothOn) problems.push('Bluetooth acceso');
  if (c.powerSave) problems.push('risparmio energetico attivo');
  if (c.battery <= 50) problems.push(`batteria ${c.battery}% (serve > 50%)`);
  if (c.thermal !== 'THERMAL_STATUS_NONE') problems.push(`stato termico ${c.thermal}`);
  return problems;
}

export default function Benchmark() {
  if (!BENCHMARK_ENABLED || Platform.OS !== 'android') return <Redirect href="/" />;
  return <BenchmarkScreen />;
}

function BenchmarkScreen() {
  const params = useLocalSearchParams<{
    model?: string; mode?: string; autostart?: string; action?: string; ignoreChecks?: string;
  }>();

  const [selectedModel, setSelectedModel] = useState<string>(params.model ?? BENCH_MODELS[0].id);
  const [selectedMode, setSelectedMode] = useState<SessionMode>((params.mode as SessionMode) ?? 'full');
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [download, setDownload] = useState<string | null>(null);
  const [gate, setGate] = useState<{ conditions: Conditions | null; problems: string[] } | null>(null);
  const overrideRef = useRef(false);
  const busyRef = useRef(false);

  // Chat state, as in app/(tabs)/chat.tsx.
  const [conversation, setConversation] = useState<Message[]>(INITIAL_CONVERSATION);
  const [streamingText, setStreamingText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [ragPhase, setRagPhase] = useState<AnimationPhase>('idle');

  // Advices shown by the advices session.
  const [advices, setAdvices] = useState<{ text: string; category: string }[]>([]);
  const [advicesKey, setAdvicesKey] = useState(0);
  const advicesShown = useRef<((t: number) => void) | null>(null);

  // Timestamps of the turn in flight, written by ChatScreen's layout callbacks.
  const turnState = useRef<{
    firstVisible: number | null;
    awaitingFinal: boolean;
    finalShown: ((t: number) => void) | null;
  }>({ firstVisible: null, awaitingFinal: false, finalShown: null });

  const log = useCallback((line: string) => {
    console.log('[Benchmark]', line);
    setLines(prev => [...prev.slice(-30), line]);
  }, []);

  const refreshPresence = useCallback(async () => {
    const next: Record<string, boolean> = {};
    for (const { id, model } of MODEL_CHOICES) {
      const path = modelPath(model);
      next[id] = (await RNFS.exists(path)) && Number((await RNFS.stat(path)).size) === model.sizeBytes;
    }
    setPresent(next);
  }, []);

  const onStreamingTextLayout = useCallback(() => {
    if (turnState.current.firstVisible == null) turnState.current.firstVisible = performance.now();
  }, []);

  const onLastAssistantLayout = useCallback(() => {
    const s = turnState.current;
    if (s.awaitingFinal) {
      s.awaitingFinal = false;
      s.finalShown?.(performance.now());
    }
  }, []);

  const turn = useCallback(async (req: UiTurnRequest): Promise<UiTurnOutcome> => {
    const s = turnState.current;
    s.firstVisible = null;
    s.awaitingFinal = false;

    // A fresh conversation per question (no history, ISTRUZIONI: two messages),
    // then the same state updates the chat makes on "send".
    const tSend = performance.now();
    setConversation([...INITIAL_CONVERSATION, { role: 'user', content: req.question }]);
    setIsGenerating(true);
    setStreamingText('');

    const marks: TurnMarks = {};
    try {
      const { docs, completion, systemMessage } = await runChatTurn({
        question: req.question,
        history: [],
        level: req.level,
        lang: req.model.lang,
        family: req.model.family,
        ragEnabled: true,
        fallbackSystem: 'You are a helpful assistant.',
        generation: req.generation,
        onPhase: setRagPhase,
        onText: setStreamingText,
        marks,
      });

      let finalVisible: number | null = null;
      const text = (completion?.text ?? '').trim();
      if (text) {
        const shown = new Promise<number>(resolve => { s.finalShown = resolve; });
        s.awaitingFinal = true;
        setConversation(prev => [...prev, { role: 'assistant', content: text, sources: docs.length ? docs : undefined }]);
        setStreamingText('');
        setRagPhase('complete');
        setIsGenerating(false);
        // A layout that never comes (screen off) must not hang the session.
        finalVisible = await Promise.race([shown, sleep(10_000).then(() => null)]);
      }

      return { tSend, marks, firstVisible: s.firstVisible, finalVisible, docs, systemMessage, completion };
    } finally {
      s.awaitingFinal = false;
      setIsGenerating(false);
    }
  }, []);

  const showAdvices = useCallback((list: { text: string; category: string }[]) =>
    new Promise<number>(resolve => {
      advicesShown.current = resolve;
      setAdvices(list.length ? list : [{ text: '(nessun consiglio interpretabile: la scheda mostrerebbe il fallback)', category: '' }]);
      setAdvicesKey(k => k + 1);
    }), []);

  const ui: BenchUI = { turn, showAdvices, log };

  /** Waits until the phone meets the protocol, unless overridden from the screen. */
  const waitForConditions = async () => {
    overrideRef.current = false;
    setGate({ conditions: null, problems: [] });
    try {
      for (;;) {
        const conditions = await probe.conditions();
        const problems = conditionProblems(conditions);
        setGate({ conditions, problems });
        if (!problems.length) return { conditions, overridden: false };
        if (overrideRef.current) return { conditions, overridden: true };
        await sleep(2000);
      }
    } finally {
      setGate(null);
    }
  };

  /** One task at a time: sessions and downloads share the model files. */
  const exclusive = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRunning(true);
    try {
      await task();
    } catch (e) {
      log(`errore: ${String(e)}`);
    } finally {
      busyRef.current = false;
      setRunning(false);
    }
  };

  const start = (modelId: string, mode: SessionMode) => exclusive(async () => {
    const model = mode === 'advices' ? getModel() : findModel(modelId);
    if (!model) {
      log(`modello sconosciuto: ${modelId}`);
      return;
    }
    if (!(await RNFS.exists(modelPath(model)))) {
      log(`${model.cacheName} non è sul telefono: scaricalo prima (serve la rete)`);
      return;
    }
    log(`in attesa delle condizioni del protocollo per ${model.cacheName} (${mode})`);
    const { conditions, overridden } = await waitForConditions();
    if (overridden) log('ATTENZIONE: avviata senza le condizioni del protocollo (registrato)');
    await runSession({
      model,
      mode,
      ui,
      conditions,
      conditionsOverridden: overridden,
      ignoreFailedChecks: params.ignoreChecks === '1',
    });
  });

  const downloadAll = () => exclusive(async () => {
    try {
      for (const m of BENCH_MODELS) {
        setDownload(`${m.filename}: 0%`);
        const result = await downloadModelFile(m, pct => setDownload(`${m.filename}: ${pct}%`));
        log(`${m.filename}: ${result === 'present' ? 'già presente' : 'scaricato'}`);
      }
      log('download completati');
    } finally {
      setDownload(null);
      await refreshPresence();
    }
  });

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || startedUp) return;
      startedUp = true;

      const recovered = await recoverInterrupted();
      if (recovered) log(`esecuzione interrotta registrata: ${recovered}`);
      await refreshPresence();
      log(`build ${probe.buildType}, output in ${OUTPUT_DIR}`);

      if (params.action === 'download') await downloadAll();
      if (params.autostart === '1') {
        await start(params.model ?? selectedModel, (params.mode as SessionMode) ?? 'full');
      }
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Once per process: the parameters come from the launching deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.panel}>
        <Text style={styles.title}>Benchmark LIRA — {probe.buildType}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {MODEL_CHOICES.map(({ id }) => (
            <TouchableOpacity
              key={id}
              disabled={running}
              onPress={() => setSelectedModel(id)}
              style={[styles.chip, selectedModel === id && styles.chipActive]}
            >
              <Text style={styles.chipText}>{id}{present[id] ? '' : ' ⬇'}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {MODES.map(m => (
            <TouchableOpacity
              key={m.key}
              disabled={running}
              onPress={() => setSelectedMode(m.key)}
              style={[styles.chip, selectedMode === m.key && styles.chipActive]}
            >
              <Text style={styles.chipText}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.row}>
          <TouchableOpacity disabled={running} onPress={() => start(selectedModel, selectedMode)} style={styles.button}>
            <Text style={styles.buttonText}>Avvia</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={running} onPress={downloadAll} style={styles.button}>
            <Text style={styles.buttonText}>Scarica modelli</Text>
          </TouchableOpacity>
        </View>

        {download ? <Text style={styles.status}>{download}</Text> : null}

        {gate ? (
          <View style={styles.gate}>
            <Text style={styles.gateTitle}>In attesa delle condizioni del protocollo</Text>
            {gate.problems.map(p => <Text key={p} style={styles.gateItem}>✗ {p}</Text>)}
            <TouchableOpacity onPress={() => { overrideRef.current = true; }} style={styles.override}>
              <Text style={styles.buttonText}>Avvia comunque (viene registrato)</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <ScrollView style={styles.log}>
          {lines.map((l, i) => <Text key={i} style={styles.logLine}>{l}</Text>)}
        </ScrollView>
      </View>

      {selectedMode === 'advices' ? (
        <ScrollView style={styles.chat}>
          <View
            key={advicesKey}
            onLayout={() => {
              advicesShown.current?.(performance.now());
              advicesShown.current = null;
            }}
          >
            {advices.map((a, i) => (
              <Text key={i} style={styles.advice}>{a.category ? `[${a.category}] ` : ''}{a.text}</Text>
            ))}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.chat}>
          <ChatScreen
            conversation={conversation}
            userInput=""
            onUserInputChange={() => {}}
            onSendMessage={() => {}}
            isGenerating={isGenerating}
            streamingText={streamingText}
            answerPhase={ragPhase}
            isFirstQuestion={conversation.length === 1}
            onStreamingTextLayout={onStreamingTextLayout}
            onLastAssistantLayout={onLastAssistantLayout}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  panel: { padding: 12, maxHeight: '45%', borderBottomWidth: 1, borderColor: '#E2E8F0' },
  title: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#E2E8F0', marginRight: 6, marginBottom: 6 },
  chipActive: { backgroundColor: '#93C5FD' },
  chipText: { fontSize: 12, color: '#0F172A' },
  button: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1E293B' },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
  status: { fontSize: 12, color: '#334155' },
  gate: { padding: 8, borderRadius: 8, backgroundColor: '#FEF3C7', marginBottom: 8 },
  gateTitle: { fontWeight: '700', color: '#92400E' },
  gateItem: { color: '#92400E', fontSize: 12 },
  override: { marginTop: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#B45309' },
  log: { maxHeight: 140 },
  logLine: { fontSize: 11, color: '#475569', fontFamily: Platform.OS === 'android' ? 'monospace' : undefined },
  chat: { flex: 1 },
  advice: { fontSize: 14, color: '#334155', padding: 8 },
});
