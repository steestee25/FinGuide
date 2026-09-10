// Spending aggregation shared by the Supabase queries (lib/transactions.tsx),
// the Advices tab and the benchmark's fixed transactions.

export type CategoryTotal = { category: string; total: number };

export type SpendingSummary = {
  total:         number;
  topCategories: { category: string; total: number; pct: number }[];
  period:        string;
};

/**
 * Expense totals per category (absolute amounts, rounded), largest first.
 * Callers pass expenses only (amount < 0).
 */
export function aggregateExpensesByCategory(
  rows: { category?: string | null; amount: number }[],
): CategoryTotal[] {
  const totals: Record<string, number> = {};
  rows.forEach((tx: any) => {
    const cat = tx.category || 'Other';
    totals[cat] = (totals[cat] || 0) + Math.abs(tx.amount);
  });

  return Object.entries(totals)
    .map(([category, total]) => ({ category, total: Math.round(total) }))
    .sort((a, b) => b.total - a.total);
}

/** The compact summary the advice prompt is built from: top six categories and their share. */
export function summarizeExpenses(rows: CategoryTotal[], period: string): SpendingSummary {
  const total = rows.reduce((s: number, r: any) => s + (r.total ?? 0), 0);

  const topCategories = [...rows]
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)
    .map((r: any) => ({
      category: r.category,
      total: Math.round(r.total),
      pct: total ? Math.round((r.total / total) * 100) : 0,
    }));

  return { total: Math.round(total), topCategories, period };
}
