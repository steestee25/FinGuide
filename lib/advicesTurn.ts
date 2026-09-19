// Spending advice: summary → prompt → completion → parsed advices.
//
// Shared by the Advices tab and the benchmark screen, so the benchmark times the
// production flow. Whichever model the shared context holds is the one that
// answers (lib/llamaContext.ts); the Advices tab claims it for ADVICES_MODEL,
// stock Gemma 3 1B instruct, before every generation.

import { normalizeLevel, type ProficiencyLevel } from './chatPrompt';
import { freshGeneration } from './chatTurn';
import type { SpendingSummary } from './expenses';
import { getLlamaContext } from './llamaContext';
import type { Lang } from './retrieval';

export type Advice = {
  text: string
  category: string
}

/** Production settings of the Advices tab. */
export const ADVICES_GENERATION = {
  // Room for ADVICES_CATEGORIES × advicesPerCategory() advices plus the JSON
  // scaffolding; below this the last category came back truncated.
  n_predict: 1200,
  temperature: 0.3,
  top_p: 0.9,
  // llama.rn reads `penalty_repeat`: this key is ignored (runtime default 1.0).
  repeat_penalty: 1.1,
  stop: ['<end_of_turn>', '<start_of_turn>', '</s>'],
};

/** Categories the prompt asks about, most expensive first. */
export const ADVICES_CATEGORIES = 3

/**
 * Advices requested per category.
 *
 * Fewer at advanced: that level's instruction asks for longer, quantified
 * advice, and on a 1B at ~8 tok/s nine of them overran n_predict — the answer
 * came back cut mid-sentence after 151s on a Galaxy A52. Two per category keeps
 * the register and fits the budget.
 */
export const advicesPerCategory = (level: ProficiencyLevel): number =>
  level === 'advanced' ? 2 : 3

/** The server's system message for advices (main.py:614). */
const ADVICES_SYSTEM: Record<Lang, string> = {
  it: 'Sei un esperto di finanza personale. Analizza le spese e fornisci consigli utili e specifici. Rispondi SEMPRE in italiano.',
  en: 'You are a personal finance expert. Analyse the spending and give useful, specific advice. ALWAYS answer in English.',
}

const PERIOD_LABEL: Record<Lang, Record<string, string>> = {
  it: { month: "dell'ultimo mese", '3months': 'degli ultimi 3 mesi', year: "dell'ultimo anno" },
  en: { month: 'last month', '3months': 'last 3 months', year: 'last year' },
}

/**
 * Level wording of the server's advice prompt (main.py:426). It is more
 * specific than the chat's LEVEL_INSTRUCTIONS: it asks for a different kind of
 * advice per level, not just a different register. The server only inserts it
 * when LIRA_ADVICE_MODE=personalizzato, which is its default; the app always
 * knows the level, so it always includes it.
 */
const ADVICES_LEVEL: Record<Lang, Record<ProficiencyLevel, string>> = {
  it: {
    base:         "L'utente ha conoscenze base di finanza. Usa parole di tutti i giorni e suggerisci azioni concrete e immediate, senza nominare strumenti finanziari o termini tecnici.",
    intermediate: "L'utente ha conoscenze di finanza intermedie. Puoi citare strumenti comuni come un conto di risparmio o un fondo di emergenza, spiegandoli in poche parole quando li nomini. Allunga un po' la risposta.",
    advanced:     "L'utente ha conoscenze avanzate di finanza. Dai consigli specifici e quantificati: soglie percentuali, orizzonti temporali, confronti tra alternative. Puoi nominare strumenti e schemi senza spiegarli, ed evita i suggerimenti generici che già conosce. Rendi la risposta più lunga e approfondita.",
  },
  en: {
    base:         'The user has basic financial knowledge. Use everyday words and suggest concrete, immediate actions, without naming financial instruments or technical terms.',
    intermediate: 'The user has intermediate financial knowledge. You may mention common instruments such as a savings account or an emergency fund, explaining them in a few words when you name them. Make answer a little longer',
    advanced:     'The user has advanced financial knowledge. Give specific, quantified advice: percentage thresholds, time horizons, comparisons between alternatives. You may name instruments and schemes without explaining them, and avoid the generic suggestions they already know. Make answer longer and more in-depth',
  },
}

const ADVICES_TASK: Record<Lang, (period: string, n: number) => string> = {
  it: (period, n) =>
    `Sei un consulente finanziario personale. Analizza le spese ${period} e fornisci ${n} consigli pratici in italiano per le diverse categorie.`,
  en: (period, n) =>
    `You are a personal financial adviser. Analyse the spending over the ${period} and give ${n} practical tips in English for the different categories.`,
}

const SPENDING_HEADER: Record<Lang, (total: number) => string> = {
  it: total => `SPESE RICEVUTE (totale: €${total}):`,
  en: total => `SPENDING RECEIVED (total: €${total}):`,
}

const SHARE_OF_TOTAL: Record<Lang, string> = { it: 'del totale', en: 'of the total' }

/**
 * The example is a JSON array. The server's version (main.py:465) shows two
 * "category" blocks with no array around them, which is not valid JSON; the
 * model resolves that by answering about one category only, so it is worth
 * fixing there too.
 */
const JSON_INSTRUCTION: Record<Lang, (n: number) => string> = {
  it: n => `Genera un unico file JSON per le categorie elencate: un array con un oggetto per ognuna delle ${n} categorie.`,
  en: n => `Generate a single JSON file for the listed categories: an array with one object per each of the ${n} categories.`,
}

const JSON_EXAMPLE: Record<Lang, string> = {
  it: 'Esempio formato della risposta: [{"category": "Electronics", "advices": [{"text": "Il 65% delle spese è destinato all\'elettronica: stabilisci un budget massimo per questi acquisti."}, {"text": "Considera l\'usato o il ricondizionato per risparmiare."}, {"text": "Aspetta i periodi di saldo per gli acquisti non urgenti."}]}, {"category": "Car", "advices": [{"text": "Le spese per l\'auto sono il 13% del totale: monitora i consumi e valuta se tutti gli spostamenti sono necessari."}, {"text": "Confronta le offerte di assicurazione alla scadenza della polizza."}, {"text": "Valuta un\'auto usata o il car sharing per i tragitti brevi."}]}]',
  en: 'Example of the response format: [{"category": "Electronics", "advices": [{"text": "65% of your spending goes on electronics: set a maximum budget for these purchases."}, {"text": "Consider second-hand or refurbished devices to save."}, {"text": "Wait for the sales for purchases that are not urgent."}]}, {"category": "Car", "advices": [{"text": "The car is 13% of your total: track fuel use and check whether every trip is needed."}, {"text": "Compare insurance quotes when your policy comes up for renewal."}, {"text": "Consider a used car or car sharing for short trips."}]}]',
}

const NO_TEXT_OUTSIDE: Record<Lang, string> = {
  it: 'NON AGGIUNGERE NESSUN TESTO FUORI DAL JSON',
  en: 'DO NOT ADD ANY TEXT OUTSIDE THE JSON',
}

export type AdvicesPromptOptions = {
  lang?: Lang
  level?: ProficiencyLevel
  /** Overrides summary.period when the caller tracks it separately. */
  period?: string
}

/**
 * Raw Gemma-format prompt, no chat template: Gemma has no system role, its
 * template merges the system message into the first user turn (chatPrompt.ts),
 * which is what this builds by hand.
 *
 * Structure and wording follow the server's advice prompt, so the on-device
 * answer is the same kind of answer the server would give.
 */
export function buildAdvicesPrompt(summary: SpendingSummary, o: AdvicesPromptOptions = {}): string {
  const lang: Lang = o.lang === 'en' ? 'en' : 'it'
  const level: ProficiencyLevel = normalizeLevel(o.level)
  const periodKey = o.period ?? summary.period
  const period = PERIOD_LABEL[lang][periodKey] ?? PERIOD_LABEL[lang].month

  const top = summary.topCategories.slice(0, ADVICES_CATEGORIES)
  const lines = top
    .map((c: any) => `- ${c.category}: €${c.total} (${c.pct}% ${SHARE_OF_TOTAL[lang]})`)
    .join('\n')

  return (
    `<start_of_turn>user\n` +
    `${ADVICES_SYSTEM[lang]}\n\n` +
    `${ADVICES_TASK[lang](period, advicesPerCategory(level))}\n` +
    `${ADVICES_LEVEL[lang][level]}\n` +
    `${SPENDING_HEADER[lang](summary.total)}\n` +
    `${lines}\n\n` +
    `${JSON_INSTRUCTION[lang](top.length)}\n` +
    `${JSON_EXAMPLE[lang]}\n` +
    `${NO_TEXT_OUTSIDE[lang]}\n` +
    `<end_of_turn>\n` +
    `<start_of_turn>model\n`
  )
}

/**
 * Strip markdown code fences (```json ... ``` or ``` ... ```) from model output.
 */
function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()
}

/**
 * The advice strings inside one category entry. The prompt's example wraps each
 * advice in {"text": "..."}, but the model usually simplifies that to a plain
 * array of strings — accept both, at any nesting.
 */
function adviceTexts(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? [text] : []
  }
  if (Array.isArray(value)) return value.flatMap(adviceTexts)
  if (value && typeof value === 'object') {
    const inner = (value as any).text ?? (value as any).advice
    return typeof inner === 'string' ? adviceTexts(inner) : []
  }
  return []
}

/** Reads well-formed output ({...} or [...]), the common case. */
function parseAdvicesJson(cleaned: string): Advice[] {
  let data: unknown
  try {
    data = JSON.parse(cleaned)
  } catch {
    return []
  }

  const results: Advice[] = []
  for (const entry of Array.isArray(data) ? data : [data]) {
    if (!entry || typeof entry !== 'object') continue
    const rawCategory = (entry as any).category
    const category = typeof rawCategory === 'string' ? rawCategory : ''
    for (const text of adviceTexts((entry as any).advices ?? (entry as any).advice)) {
      results.push({ category, text })
    }
  }
  return results
}

/**
 * Try to extract an array of Advice from whatever the model returned.
 * Handles:
 *   - {"advices": [...]}
 *   - {"advice": [...]}
 *   - [...]  (bare array)
 *   - Output wrapped in ```json ... ```
 *   - Malformed output with duplicate "category"/"advice" keys
 */
export function tryParseAdvices(raw: string): Advice[] {
  const cleaned = stripCodeFences(raw)

  // Valid JSON is the normal case; the regex strategies below are for output
  // the model truncated or malformed.
  const parsed = parseAdvicesJson(cleaned)
  if (parsed.length) {
    console.log('[Parse] extracted:', parsed.length, 'advices from JSON')
    return parsed
  }

  const results: Advice[] = []

  // 1. Strategy: detect all categories
  const categoryRegex = /"category"\s*:\s*"([^"]+)"/g
  const categories: string[] = []
  let match

  while ((match = categoryRegex.exec(cleaned)) !== null) {
    categories.push(match[1])
  }

  if (!categories.length) {
    console.warn('[Parse] no categories found')
  }

  // 2. Strategy: extract all advice texts globally
  // works even if duplicated keys or broken JSON
  const adviceRegex = /"text"\s*:\s*"([\s\S]*?)"|"advice"\s*:\s*"([\s\S]*?)"/g

  const texts: string[] = []
  while ((match = adviceRegex.exec(cleaned)) !== null) {
    const value = match[1] || match[2]
    if (value?.trim()) texts.push(value.trim())
  }

  // fallback for your old "advice": ...
  const looseAdviceRegex = /"advice"\s*:\s*"([\s\S]*?)"/g
  while ((match = looseAdviceRegex.exec(cleaned)) !== null) {
    const value = match[1]
    if (value?.trim()) texts.push(value.trim())
  }

  // Same shape, but as a bare array of strings: "advices": ["…", "…"]. Reached
  // when the JSON is truncated mid-object and JSON.parse gave up on it.
  if (!texts.length) {
    const arrayRegex = /"advices?"\s*:\s*\[([\s\S]*?)(?:\]|$)/g
    while ((match = arrayRegex.exec(cleaned)) !== null) {
      const stringRegex = /"([^"]+)"/g
      let item
      while ((item = stringRegex.exec(match[1])) !== null) {
        if (item[1].trim()) texts.push(item[1].trim())
      }
    }
  }

  if (!texts.length) {
    console.warn('[Parse] no advice texts found')
    return []
  }

  // 3. Map: distribute advices across categories
  // assumption: 3 advices per category (your requirement)
  const perCategory = 3

  let textIndex = 0

  for (const cat of categories) {
    for (let i = 0; i < perCategory; i++) {
      if (!texts[textIndex]) break

      results.push({
        category: cat,
        text: texts[textIndex],
      })

      textIndex++
    }
  }

  console.log(
    '[Parse] extracted:',
    results.length,
    'advices for',
    categories.length,
    'categories'
  )

  return results
}

export type AdvicesMarks = Partial<Record<
  'completion_start' | 'first_token' | 'last_token' | 'completion_end' | 'parsed',
  number
>>

export async function runAdvicesTurn(o: AdvicesPromptOptions & {
  summary: SpendingSummary
  onText?: (text: string) => void
  /** performance.now() timestamps of each step, filled in when passed. */
  marks?: AdvicesMarks
}): Promise<{ prompt: string; completion: any; text: string; advices: Advice[] }> {
  const mark = (key: keyof AdvicesMarks) => {
    if (o.marks) o.marks[key] = performance.now()
  }

  const prompt = buildAdvicesPrompt(o.summary, { lang: o.lang, level: o.level, period: o.period })
  console.log('[Inference] prompt length:', prompt.length)

  let fullResponse = ''
  const llamaContext = await getLlamaContext()
  // Empty KV cache per turn: prefix reuse leaks sliding-window cache cells
  // until decode fails (see lib/chatTurn.ts).
  await llamaContext.clearCache(false)
  mark('completion_start')
  const completion = await llamaContext.completion(
    { prompt, ...freshGeneration(ADVICES_GENERATION) },
    (data: { token: string }) => {
      if (data.token) {
        if (!fullResponse) mark('first_token')
        fullResponse += data.token
        mark('last_token')
        o.onText?.(fullResponse)
      }
    },
  )
  mark('completion_end')

  const text = (completion?.text ?? fullResponse).trim()
  console.log('[Inference] raw output:', text)

  const advices = tryParseAdvices(text)
  console.log('[Inference] parsed advices:', advices.length)
  mark('parsed')

  return { prompt, completion, text, advices }
}
