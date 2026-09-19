import locales from '../locales/locales.json';
import { aggregateExpensesByCategory } from './expenses';
import { supabase } from './supabase';

type LocaleKey = 'en' | 'it';

// Tipo per una transazione dal DB
export interface DBTransaction {
  id: string;
  user_id: string;
  name: string;
  category: string;
  amount: number;
  date: string;
  created_at: string;
  updated_at: string;
}

// Tipo per una transazione locale (con icon e color)
export interface LocalTransaction extends DBTransaction {
  icon: string;
  color: string;
}

/**
 * Fetch le ultime 30 transazioni dell'utente dal DB
 * Ordinate per data decrescente (più recenti prima)
 */
export const fetchUserTransactions = async (userId: string): Promise<DBTransaction[]> => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(30);

    if (error) {
      console.error('Errore nel fetch transazioni:', error.message);
      return [];
    }

    console.log('✓ Fetched user transactions:', data);
    return data || [];
  } catch (err) {
    console.error('Errore inaspettato nel fetch transazioni:', err);
    return [];
  }
};

/**
 * Inserisce una nuova transazione nel DB
 */
export const createTransaction = async (
  userId: string,
  name: string,
  category: string,
  amount: number,
  date: Date
): Promise<DBTransaction | null> => {
  try {
    // When only a date (no time) is selected, avoid timezone shifts by
    // storing the date at local midday (12:00). This prevents ISO string
    // conversion from moving the date to the previous day in UTC.
    const storeDate = new Date(date.getTime());
    storeDate.setHours(12, 0, 0, 0);

    const { data, error } = await supabase
      .from('transactions')
      .insert([
        {
          user_id: userId,
          name,
          category,
          amount,
          date: storeDate.toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      console.error('Errore nel create transazione:', error.message);
      return null;
    }

    console.log('✓ Created transaction:', data);
    return data;
  } catch (err) {
    console.error('Errore inaspettato nel create transazione:', err);
    return null;
  }
};

/**
 * Aggiorna una transazione nel DB
 */
export const updateTransaction = async (
  transactionId: string,
  updates: {
    name?: string;
    category?: string;
    amount?: number;
    date?: Date;
  }
): Promise<DBTransaction | null> => {
  try {
    const updateData: any = { ...updates };
      if (updates.date !== undefined && updates.date !== null) {
      // Accept Date, ISO string, or timestamp
      let iso: string | null = null;
      if (updates.date instanceof Date) {
        // Normalize to local midday to avoid timezone shifting to previous day
        const dCopy = new Date(updates.date.getTime());
        dCopy.setHours(12, 0, 0, 0);
        iso = dCopy.toISOString();
      } else if (typeof updates.date === 'string' || typeof updates.date === 'number') {
        const d = new Date(updates.date as any);
        if (!isNaN(d.getTime())) {
          d.setHours(12, 0, 0, 0);
          iso = d.toISOString();
        }
      }
      if (iso) {
        updateData.date = iso;
      } else {
        console.warn('updateTransaction: invalid date provided, ignoring date update', updates.date);
        delete updateData.date;
      }
    }

    const { data, error } = await supabase
      .from('transactions')
      .update(updateData)
      .eq('id', transactionId)
      .select()
      .single();

    if (error) {
      console.error("Errore nell'update transazione:", error.message || error);
      return null;
    }

    console.log('✓ Updated transaction:', data);
    return data;
  } catch (err) {
    console.error("Errore inaspettato nell'update transazione:", err);
    return null;
  }
};

/**
 * Cancella una transazione dal DB
 */
export const deleteTransaction = async (transactionId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', transactionId);

    if (error) {
      console.error('Errore nella delete transazione:', error.message);
      return false;
    }

    console.log('✓ Deleted transaction:', transactionId);
    return true;
  } catch (err) {
    console.error('Errore inaspettato nella delete transazione:', err);
    return false;
  }
};

/**
 * Raggruppa transazioni per giorno e aggiunge icon/color
 * Distingue tra income (amount > 0) e expense (amount < 0)
 */
export const groupTransactionsByDay = (
  transactions: DBTransaction[],
  categoryIcons: Record<string, string>,
  categoryColors: Record<string, string>,
  incomeCategoryIcons?: Record<string, string>,
  incomeCategoryColors?: Record<string, string>
) => {
  const grouped: Record<number, LocalTransaction[]> = {};

  transactions.forEach((transaction) => {
    const date = new Date(transaction.date);
    date.setHours(0, 0, 0, 0);
    const dayId = date.getTime();

    if (!grouped[dayId]) {
      grouped[dayId] = [];
    }

    // Scegli le mappe corrette in base al segno dell'amount
    const isIncome = transaction.amount > 0;
    const icons = isIncome && incomeCategoryIcons ? incomeCategoryIcons : categoryIcons;
    const colors = isIncome && incomeCategoryColors ? incomeCategoryColors : categoryColors;

    grouped[dayId].push({
      ...transaction,
      icon: icons[transaction.category] || '💰',
      color: colors[transaction.category] || '#999999',
    });
  });

  // Converti in array e ordina per giorno decrescente
  return Object.entries(grouped)
    .map(([dayId, transactionsList]) => ({
      id: Number(dayId),
      // Ordina transazioni dentro il giorno per created_at decrescente (più recenti prima)
      transactions: transactionsList.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    }))
    .sort((a, b) => b.id - a.id);
};

/**
 * Calcola le spese aggregate per mese degli ultimi 5 mesi
 * Restituisce array ordinato da più vecchio a più recente
 */
export const fetchExpensesByMonth = async (userId: string, locale: LocaleKey = 'en', numberOfMonths: number = 5) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('amount, date')
      .eq('user_id', userId)
      .lt('amount', 0); // Solo expense (amount negativo)

    if (error) {
      console.error('Errore nel fetch spese per mese:', error.message);
      return [];
    }

    console.log('✓ Fetched expenses data:', data);
    // Calcola ultimi N mesi
    const monthsData: Record<string, number> = {};
    const today = new Date();
    
    for (let i = numberOfMonths - 1; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthsData[monthKey] = 0;
    }

    // Aggrega le spese per mese
    (data || []).forEach((transaction) => {
      const txDate = new Date(transaction.date);
      const monthKey = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`;
      
      if (monthsData.hasOwnProperty(monthKey)) {
        monthsData[monthKey] += Math.abs(transaction.amount); // Converti a positivo
      }
    });

    // Converti in array con label mese
    const monthLabels = ((locales as any)[locale]?.home?.months as string[]) || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Object.entries(monthsData).map(([monthKey, total]) => {
      const [year, month] = monthKey.split('-');
      const monthIndex = parseInt(month) - 1;
      return {
        value: Math.round(total),
        label: monthLabels[monthIndex],
        monthIndex,
      };
    });
  } catch (err) {
    console.error('Errore inaspettato nel fetch spese per mese:', err);
    return [];
  }
};

/**
 * Calcola gli income aggregati per mese degli ultimi 5 mesi
 * Restituisce array ordinato da più vecchio a più recente
 */
export const fetchIncomeByMonth = async (userId: string, locale: LocaleKey = 'en', numberOfMonths: number = 5) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('amount, date')
      .eq('user_id', userId)
      .gt('amount', 0); // Solo income (amount positivo)

    if (error) {
      console.error('Errore nel fetch income per mese:', error.message);
      return [];
    }

    console.log('✓ Fetched income data:', data);
    // Calcola ultimi N mesi
    const monthsData: Record<string, number> = {};
    const today = new Date();
    
    for (let i = numberOfMonths - 1; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthsData[monthKey] = 0;
    }

    // Aggrega gli income per mese
    (data || []).forEach((transaction) => {
      const txDate = new Date(transaction.date);
      const monthKey = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`;
      
      if (monthsData.hasOwnProperty(monthKey)) {
        monthsData[monthKey] += transaction.amount; // Già positivo
      }
    });

    // Converti in array con label mese
    const monthLabels = ((locales as any)[locale]?.home?.months as string[]) || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Object.entries(monthsData).map(([monthKey, total]) => {
      const [year, month] = monthKey.split('-');
      const monthIndex = parseInt(month) - 1;
      return {
        value: Math.round(total),
        label: monthLabels[monthIndex],
        monthIndex,
      };
    });
  } catch (err) {
    console.error('Errore inaspettato nel fetch income per mese:', err);
    return [];
  }
};

/**
 * Fetch total expenses for the current calendar month grouped by category
 * Returns array of { category, total } ordered by total desc
 */
export const fetchExpensesByCategoryLastMonth = async (userId: string) => {
  try {
    const today = new Date();
    const startOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    const { data, error } = await supabase
      .from('transactions')
      .select('category, amount, date')
      .eq('user_id', userId)
      .gte('date', startOfCurrentMonth.toISOString())
      .lt('date', startOfNextMonth.toISOString())
      .lt('amount', 0);

    if (error) {
      console.error('Errore nel fetch spese per categoria ultimo mese:', error.message);
      return [];
    }

    return aggregateExpensesByCategory(data || []);
  } catch (err) {
    console.error('Errore inaspettato nel fetch spese per categoria:', err);
    return [];
  }
};

/**
 * Fetch total expenses for the last 3 full months including the current month grouped by category
 * Returns array of { category, total } ordered by total desc
 */
export const fetchExpensesByCategoryLast3Months = async (userId: string) => {
  try {
    // Range: from the same day 3 months ago up to now (inclusive)
    const today = new Date();
    const end = new Date(today.getTime());
    const start = new Date(today.getTime());
    start.setMonth(start.getMonth() - 3);

    const { data, error } = await supabase
      .from('transactions')
      .select('category, amount, date')
      .eq('user_id', userId)
      .gte('date', start.toISOString())
      .lte('date', end.toISOString())
      .lt('amount', 0);

    if (error) {
      console.error('Errore nel fetch spese per categoria ultimi 3 mesi:', error.message);
      return [];
    }

    return aggregateExpensesByCategory(data || []);
  } catch (err) {
    console.error('Errore inaspettato nel fetch spese per categoria ultimi 3 mesi:', err);
    return [];
  }
};

/**
 * Fetch total expenses for the last 12 months including the current month grouped by category
 * Returns array of { category, total } ordered by total desc
 */
export const fetchExpensesByCategoryLastYear = async (userId: string) => {
  try {
    // Range: from the same day 12 months ago up to now (inclusive)
    const today = new Date();
    const end = new Date(today.getTime());
    const start = new Date(today.getTime());
    start.setFullYear(start.getFullYear() - 1);

    const { data, error } = await supabase
      .from('transactions')
      .select('category, amount, date')
      .eq('user_id', userId)
      .gte('date', start.toISOString())
      .lte('date', end.toISOString())
      .lt('amount', 0);

    if (error) {
      console.error('Errore nel fetch spese per categoria ultimo anno:', error.message);
      return [];
    }

    return aggregateExpensesByCategory(data || []);
  } catch (err) {
    console.error('Errore inaspettato nel fetch spese per categoria ultimo anno:', err);
    return [];
  }
};
