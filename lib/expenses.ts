// Spending aggregation shared by the Supabase queries (lib/transactions.tsx),
// the Advices tab and the benchmark's fixed transactions.

// months: distinct calendar months covered by the transactions (only when dates are passed).
export type CategoryTotal = { category: string; total: number; months?: number };

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
  rows: { category?: string | null; amount: number; date?: string }[],
): CategoryTotal[] {
  const totals: Record<string, number> = {};
  const months = new Set<string>();
  rows.forEach((tx: any) => {
    if (tx.date) {
      // Local calendar month: a UTC slice would put local midnight on the 1st in the previous month.
      const d = new Date(tx.date);
      months.add(`${d.getFullYear()}-${d.getMonth()}`);
    }
    const cat = tx.category || 'Other';
    totals[cat] = (totals[cat] || 0) + Math.abs(tx.amount);
  });

  return Object.entries(totals)
    .map(([category, total]) => ({
      category,
      total: Math.round(total),
      ...(months.size ? { months: months.size } : {}),
    }))
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
