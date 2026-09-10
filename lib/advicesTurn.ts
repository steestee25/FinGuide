// Spending advice: summary → prompt → completion → parsed advices.
//
// Shared by the Advices tab and the benchmark screen, so the benchmark times the
// production flow. The model is the chat's shared context (lib/llamaContext.ts),
// i.e. the fine-tuned Gemma3-1B, not a base model.

import type { SpendingSummary } from './expenses';
import { getLlamaContext } from './llamaContext';

export type Advice = {
  text: string
  category: string
}

/** Production settings of the Advices tab. */
export const ADVICES_GENERATION = {
  n_predict: 800,
  temperature: 0.3,
  top_p: 0.9,
  // llama.rn reads `penalty_repeat`: this key is ignored (runtime default 1.0).
  repeat_penalty: 1.1,
  stop: ['<end_of_turn>', '<start_of_turn>', '</s>'],
};

/**
 * Raw Gemma-format prompt, no chat template. The line break and six spaces after
 * "per le " are part of the production prompt (a template literal once split
 * across two source lines) and are kept as they are.
 */
export function buildAdvicesPrompt(summary: SpendingSummary): string {
  const cats = summary.topCategories
    .map((c: any) => `${c.category} €${c.total} (${c.pct}%)`)
    .join(', ')

  return (
    `<start_of_turn>user\n` +
    'Sei un consulente finanziario personale. Analizza le spese e genera 3 consigli pratici in italiano per le \n      diverse categorie.\n' +
    `Categorie: ${cats}\n` +
    `Genera un unico file JSON per le categorie elencate.\n` +
    `Esempio formato della risposta: {"category": "Electronics", "advices": [{"text": "Il 65% delle spese è destinato all'acquisto di elettronica, stabilisci un budget massimo per gli acquisti di elettronica."}, {"text": "Considera l'usato o il ricondizionamento per risparmiare.  Fai attenzione alle offerte e agli sconti"}, {"text": "Valuta se puoi dispositivi nuovi o ricondizionati per spendere meno"}]}, "category": "Car", "advices": [{"text": "Le spese per "Car" rappresentano il 13% delle tue spese.  È consigliabile monitorare l'utilizzo del veicolo e valutare se è necessario un nuovo modello o se puoi ottimizzare i consumi per ridurre i costi.  Considera l'acquisto di un'auto usata per risparmiare."}, {"text": "Considera l'usato o il ricondizionamento per risparmiare.  Fai attenzione alle offerte e agli sconti"}, {"text": "Valuta se puoi dispositivi nuovi o ricondizionati per spendere meno"}]}\n` +
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

export async function runAdvicesTurn(o: {
  summary: SpendingSummary
  onText?: (text: string) => void
  /** performance.now() timestamps of each step, filled in when passed. */
  marks?: AdvicesMarks
}): Promise<{ prompt: string; completion: any; text: string; advices: Advice[] }> {
  const mark = (key: keyof AdvicesMarks) => {
    if (o.marks) o.marks[key] = performance.now()
  }

  const prompt = buildAdvicesPrompt(o.summary)
  console.log('[Inference] prompt length:', prompt.length)

  let fullResponse = ''
  const llamaContext = await getLlamaContext()
  mark('completion_start')
  const completion = await llamaContext.completion(
    { prompt, ...ADVICES_GENERATION },
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
