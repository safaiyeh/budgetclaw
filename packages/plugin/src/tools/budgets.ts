import type { Database } from '../db/index.js';
import { toRow } from '../db/types.js';
import type { BudgetRow } from '../db/types.js';

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

const PERIODS = ['monthly', 'weekly', 'yearly'] as const;
type Period = (typeof PERIODS)[number];

export interface SetBudgetInput {
  category: string;
  amount: number;
  period?: Period;
}

export interface BudgetWithActual extends BudgetRow {
  actual: number;
  remaining: number;
  percent_used: number;
  transaction_count: number;
}

function currentPeriodRange(period: Period): { from: string; to: string } {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();

  if (period === 'monthly') {
    const from = new Date(y, m, 1);
    const to = new Date(y, m + 1, 0);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }

  if (period === 'weekly') {
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
  }

  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export function setBudget(db: Database, input: SetBudgetInput): BudgetRow {
  const { category, amount, period = 'monthly' } = input;

  if (!PERIODS.includes(period)) {
    throw new Error(`Invalid period "${period}". Must be one of: ${PERIODS.join(', ')}`);
  }
  if (amount <= 0) {
    throw new Error('Budget amount must be greater than 0');
  }

  const ts = now();

  const existing = toRow<{ id: string } | undefined>(
    db.prepare('SELECT id FROM budgets WHERE category = ? AND period = ?').get(category, period)
  );

  if (existing) {
    db.prepare('UPDATE budgets SET amount = ?, updated_at = ? WHERE id = ?').run(amount, ts, existing.id);
    return toRow<BudgetRow>(db.prepare('SELECT * FROM budgets WHERE id = ?').get(existing.id));
  }

  const id = uuid();
  db.prepare(
    'INSERT INTO budgets (id, category, amount, period, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, category, amount, period, ts, ts);
  return toRow<BudgetRow>(db.prepare('SELECT * FROM budgets WHERE id = ?').get(id));
}

export function getBudgets(db: Database): BudgetWithActual[] {
  const budgets = toRow<BudgetRow[]>(
    db.prepare('SELECT * FROM budgets ORDER BY period, category').all()
  );

  return budgets.map((budget) => {
    const { from, to } = currentPeriodRange(budget.period as Period);

    const actuals = toRow<{ total: number | null; cnt: number }>(
      db.prepare(
        `SELECT ABS(SUM(amount)) AS total, COUNT(*) AS cnt
         FROM transactions
         WHERE category = ? AND date >= ? AND date <= ? AND amount < 0`
      ).get(budget.category, from, to)
    );

    const actual = actuals.total ?? 0;
    const remaining = Math.max(0, budget.amount - actual);
    const percent_used = budget.amount > 0 ? Math.round((actual / budget.amount) * 100) : 0;

    return {
      ...budget,
      actual: Math.round(actual * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      percent_used,
      transaction_count: actuals.cnt,
    };
  });
}

export function deleteBudget(db: Database, id: string): { deleted: boolean } {
  const result = db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
  return { deleted: result.changes > 0 };
}
