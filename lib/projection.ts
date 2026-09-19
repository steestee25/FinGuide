// Illustrative savings projection (port of revision/proiezione.py).
// Numbers are computed here, never by the model; always shown as a range with the disclaimer.
import tabella from '../revision/rendimenti.json';

export type Livello = 'base' | 'intermediate' | 'advanced';
export type Lingua = 'it' | 'en';
export type Periodo = 'month' | '3months' | 'year';

export interface Suggerimento {
  messaggio: string;
  collegamento: string;
  domanda_chat: string;
  avvertenza: string;
  fonte: string;
  url_fonte: string;
}


export function valoreFinale(mensile: number, tassoAnnuoPct: number, anni: number): number {
  const r = tassoAnnuoPct / 100 / 12, n = 12 * anni;
  return r === 0 ? mensile * n : (mensile * ((1 + r) ** n - 1)) / r;
}

const formato = (x: number, lingua: Lingua) =>
  Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, lingua === 'it' ? '.' : ',');

export function suggerimento(
  risparmioMensile: number,
  livello: Livello,
  lingua: Lingua = 'it',
  anni = 10,
  spesa?: { categoria: string; media: number; periodo: Periodo },
): Suggerimento | null {
  if (risparmioMensile <= 0) return null;
  // English "base" used to fall back to "intermediate" while its passages were
  // missing from the corpus. They are there now (fca/news/corporate-bond-funds),
  // so each of the six language × level combinations uses its own row.
  const t = tabella as any;
  const riga = t[lingua].livelli[livello];
  const f = (x: number) => formato(x, lingua);
  const versato = risparmioMensile * 12 * anni;
  const vmin = valoreFinale(risparmioMensile, riga.rendimento_min, anni);
  const vmax = valoreFinale(risparmioMensile, riga.rendimento_max, anni);
  const pct = (x: number) => `${x}%`.replace('.', lingua === 'it' ? ',' : '.');
  const stesso = riga.rendimento_min === riga.rendimento_max;
  const importi = Math.round(vmin) === Math.round(vmax) ? f(vmin) : `${f(vmin)} - ${f(vmax)}`;

  let messaggio: string, collegamento: string;
  if (lingua === 'it') {
    const tassi = stesso ? `pari a ${pct(riga.rendimento_min)}` : `compreso tra ${pct(riga.rendimento_min)} e ${pct(riga.rendimento_max)}`;
    messaggio = (spesa
      ? `${{
          month: `Nell'ultimo mese hai speso ${f(spesa.media)} €`,
          '3months': `Negli ultimi 3 mesi hai speso in media ${f(spesa.media)} € al mese`,
          year: `Nell'ultimo anno hai speso in media ${f(spesa.media)} € al mese`,
        }[spesa.periodo]} in ${spesa.categoria}. Se ne risparmi il 20% (${f(risparmioMensile)} € al mese), in`
      : `Se risparmi ${f(risparmioMensile)} € al mese, in`) + ` ${anni} anni metti da parte ${f(versato)} €. ` +
      `Investiti in ${riga.strumento}, con un rendimento medio annuo passato ${tassi}, potrebbero diventare circa ${importi} €.`;
    collegamento = `Per approfondire: ${riga.domanda_chat}`;
  } else {
    const tassi = stesso ? pct(riga.rendimento_min) : `${pct(riga.rendimento_min)}-${pct(riga.rendimento_max)}`;
    messaggio = (spesa
      ? `${{
          month: `In the last month you spent €${f(spesa.media)}`,
          '3months': `Over the last 3 months you spent on average €${f(spesa.media)} a month`,
          year: `Over the last year you spent on average €${f(spesa.media)} a month`,
        }[spesa.periodo]} on ${spesa.categoria}. If you save 20% of it (€${f(risparmioMensile)} a month), in`
      : `If you save €${f(risparmioMensile)} a month, in`) + ` ${anni} years you will have put aside €${f(versato)}. ` +
      `Invested in ${riga.strumento}, at an assumed ${tassi} a year, it could grow to about €${importi}.`;
    collegamento = `Find out more: ${riga.domanda_chat}`;
  }
  return {
    messaggio,
    collegamento,
    domanda_chat: riga.domanda_chat,
    avvertenza: t.avvertenza[lingua],
    fonte: t[lingua].fonte,
    url_fonte: t[lingua].url,
  };
}

// Non-essential categories the card may suggest cutting (subscriptions, restaurants,
// shopping, entertainment, extras). Rent, bills, groceries, transport and health are never used.
const NON_ESSENTIAL = ['Entertainment', 'Restaurant', 'Shopping', 'Extras'];
const QUOTA_RISPARMIO = 0.2;
const RISPARMIO_MINIMO = 10;

/** Card built from the user's spending: largest non-essential monthly average, 20% of it rounded to 5. */
export function suggerimentoDaSpese(
  righe: { category: string; total: number; months?: number }[],
  livello: Livello,
  lingua: Lingua,
  etichetta: (categoria: string) => string,
  periodo: Periodo = 'month',
): Suggerimento | null {
  const top = righe
    .filter((r) => NON_ESSENTIAL.includes(r.category))
    .map((r) => ({ categoria: r.category, media: r.total / Math.max(1, r.months ?? 1) }))
    .sort((a, b) => b.media - a.media)[0];
  if (!top) return null;
  const risparmio = Math.round((top.media * QUOTA_RISPARMIO) / 5) * 5;
  if (risparmio < RISPARMIO_MINIMO) return null;
  return suggerimento(risparmio, livello, lingua, 10, { categoria: etichetta(top.categoria).toLowerCase(), media: top.media, periodo });
}
