// The RAG system message, byte for byte the format the models were fine-tuned
// on (benchmark/RISPOSTA_AGENTE.md §2):
//
//   {PERSONA} {LEVEL}\n\n{RULES}\n\n{DOC_1}\n\n…\n\n{DOC_6}
//
// Every string was copied from the training records, imperfections included
// ("semplici e esempi"): the model has seen exactly these strings thousands of
// times, and a variant is a different prompt to it. Check with
// scripts/check-prompt.js after any change.

import type { Doc, Lang } from './retrieval';

export type ProficiencyLevel = 'base' | 'intermediate' | 'advanced';

/** Chat-template family of the GGUF, which decides the system-message marker. */
export type ModelFamily = 'gemma3' | 'smollm3';

export const PERSONA: Record<Lang, string> = {
  it: 'Sei un assistente di finanza personale.',
  en: 'You are a personal finance assistant.',
};

export const LEVEL_INSTRUCTIONS: Record<Lang, Record<ProficiencyLevel, string>> = {
  it: {
    base:         'L\'utente ha conoscenze base di finanza. Usa spiegazioni semplici e esempi pratici. Evita termini tecnici o complessi.',
    intermediate: 'L\'utente ha conoscenze di finanza intermedie. Puoi introdurre alcuni termini tecnici, ma sempre accompagnati da una spiegazione.',
    advanced:     'L\'utente ha conoscenze avanzate di finanza personale. Evita spiegazioni eccessivamente basilari, puoi usare termini tecnici e spiegazioni più approfondite.',
  },
  en: {
    base:         'The user has basic financial knowledge. Use simple explanations and practical examples. Avoid technical or complex terms.',
    intermediate: 'The user has intermediate financial knowledge. You may introduce some technical terms, but always with an explanation.',
    advanced:     'The user has advanced knowledge of personal finance. Avoid overly basic explanations; you may use technical terms and give more in-depth explanations.',
  },
};

export const RULES: Record<Lang, string> = {
  it: 'REGOLE: Rispondi SOLO usando i documenti seguenti. Non inventare. Non dare consigli specifici di investimento. Rispondi in italiano in modo conciso.',
  en: 'RULES: Answer ONLY using the documents below. Do not make things up. Do not give specific investment advice. Answer in English, concisely.',
};

const DOC_LABEL: Record<Lang, string> = { it: 'DOCUMENTO', en: 'DOCUMENT' };

// Without it SmolLM3's template prepends today's date and a metadata block the
// model never saw in training. Gemma has no system role: its template merges
// the system message into the first user turn, as it did in training.
const SMOLLM3_SYSTEM_OVERRIDE = '\n/system_override';

/** Unknown or missing levels fall back to intermediate, as the chat always did. */
export function normalizeLevel(level: string | null | undefined): ProficiencyLevel {
  return level === 'base' || level === 'advanced' ? level : 'intermediate';
}

/** PERSONA + LEVEL on the first line, RULES next, one block per document. */
export function buildRagSystemMessage(lang: Lang, level: ProficiencyLevel, docs: Doc[]): string {
  const documents = docs
    .map(doc => `${DOC_LABEL[lang]} [${doc.id}]:\n${doc.text}`)
    .join('\n\n');

  return `${PERSONA[lang]} ${LEVEL_INSTRUCTIONS[lang][level]}\n\n${RULES[lang]}\n\n${documents}`;
}

/** Applies the per-family marker to a finished system message. */
export function systemMessageForModel(systemMessage: string, family: ModelFamily): string {
  return family === 'smollm3'
    ? systemMessage.trimEnd() + SMOLLM3_SYSTEM_OVERRIDE
    : systemMessage;
}
