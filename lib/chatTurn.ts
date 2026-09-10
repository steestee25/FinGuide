// One chat turn: retrieval → prompt → streamed completion.
//
// Shared by the chat screen and the benchmark screen, so the benchmark times the
// very code path users go through (same retrieval, same prompt, same llama.rn
// call). Screens own their UI state and receive progress through callbacks.

import {
  buildRagSystemMessage,
  ModelFamily,
  ProficiencyLevel,
  systemMessageForModel,
} from './chatPrompt';
import { getLlamaContext } from './llamaContext';
import { Doc, Lang, retrieveRelevant } from './retrieval';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Sampling and stopping parameters, passed to llama.rn's completion() as-is. */
export type GenerationParams = { n_predict: number; [key: string]: unknown };

export const STOP_WORDS = [
  '</s>',
  '<|end|>',
  '<|im_end|>',
  '<|eot_id|>',
];

/** Production chat settings. */
export const CHAT_GENERATION: GenerationParams = {
  // Leaves ~3.3k of the 4096-token window for the prompt, enough for six
  // documents even at the corpus p90.
  n_predict: 768,
  stop: STOP_WORDS,
  temperature: 0.3,
  top_p: 0.95,
  // llama.rn reads `penalty_repeat` / `penalty_last_n`: these two keys are
  // ignored, so no repetition penalty is applied (runtime default 1.0).
  repeat_penalty: 1.2,
  repeat_last_n: 128,
};

export type TurnPhase = 'fetching' | 'reasoning' | 'generating';

/** performance.now() timestamps of each step, filled in when `marks` is passed. */
export type TurnMarks = Partial<Record<
  | 'retrieval_start' | 'retrieval_end' | 'prompt_end'
  | 'completion_start' | 'first_token' | 'last_token' | 'completion_end',
  number
>>;

export type ChatTurnOptions = {
  question:       string;
  /** Earlier user/assistant turns, oldest first, without the system message. */
  history:        ChatMessage[];
  level:          ProficiencyLevel;
  lang:           Lang;
  family:         ModelFamily;
  ragEnabled:     boolean;
  /** System message when RAG is off or retrieves nothing. */
  fallbackSystem: string;
  generation:     GenerationParams;
  onPhase?:       (phase: TurnPhase) => void;
  onDocs?:        (docs: Doc[]) => void;
  /** Called on every streamed token with the whole text so far. */
  onText:         (text: string) => void;
  marks?:         TurnMarks;
};

export type ChatTurnResult = {
  docs:          Doc[];
  systemMessage: string;
  messages:      ChatMessage[];
  /** llama.rn's NativeCompletionResult (text, timings, token counts…). */
  completion:    any;
};

export async function runChatTurn(o: ChatTurnOptions): Promise<ChatTurnResult> {
  const mark = (key: keyof TurnMarks) => {
    if (o.marks) o.marks[key] = performance.now();
  };

  let docs: Doc[] = [];

  if (o.ragEnabled) {
    o.onPhase?.('fetching');
    mark('retrieval_start');
    try {
      docs = await retrieveRelevant(o.question, { k: 6, lang: o.lang });
      o.onDocs?.(docs);
    } catch (error) {
      console.warn('Retrieval failed:', error);
    }
    mark('retrieval_end');
  }
  o.onPhase?.('reasoning');

  const systemMessage = systemMessageForModel(
    o.ragEnabled && docs.length ? buildRagSystemMessage(o.lang, o.level, docs) : o.fallbackSystem,
    o.family,
  );

  const turns: ChatMessage[] = [...o.history, { role: 'user', content: o.question }];
  const recent = turns.slice(-6);
  if (recent.length > 0 && recent[0].role === 'assistant') {
    recent.shift();
  }

  const messages: ChatMessage[] = [{ role: 'system', content: systemMessage }, ...recent];
  mark('prompt_end');

  console.log('===== FULL PROMPT SENT TO MODEL =====');
  console.log('Proficiency Level:', o.level);
  console.log('System Message:', systemMessage);
  console.log('Full Messages Array:', JSON.stringify(messages, null, 2));
  console.log('===== END PROMPT =====');

  o.onPhase?.('generating');

  let fullResponse = '';
  const llamaContext = await getLlamaContext();
  mark('completion_start');
  const completion = await llamaContext.completion(
    { messages, ...o.generation },
    (data: { token: string }) => {
      const { token } = data;
      if (token) {
        if (!fullResponse) mark('first_token');
        fullResponse += token;
        mark('last_token');
        o.onText(fullResponse);
        console.log('Streaming token:', token);
      }
    },
  );
  mark('completion_end');
  console.log('Full generated response:', fullResponse);

  // Where the wall-clock actually goes: prefill of the six documents vs
  // generating the answer. The two need opposite fixes, so measure first.
  const tm = completion?.timings;
  if (tm) {
    console.log(
      `[Perf] prefill ${Math.round(tm.prompt_ms)}ms per ${completion.tokens_evaluated} token ` +
      `(${tm.prompt_per_second?.toFixed(1)} tok/s) | ` +
      `generazione ${Math.round(tm.predicted_ms)}ms per ${completion.tokens_predicted} token ` +
      `(${tm.predicted_per_second?.toFixed(1)} tok/s) | ` +
      `totale ${Math.round((tm.prompt_ms + tm.predicted_ms) / 1000)}s | ` +
      `truncated=${completion.truncated} context_full=${completion.context_full} ` +
      `cached=${completion.tokens_cached}`,
    );
  }

  return { docs, systemMessage, messages, completion };
}
