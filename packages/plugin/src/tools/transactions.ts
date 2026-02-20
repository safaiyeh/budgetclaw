import type { Database } from 'bun:sqlite';
import type { TransactionRow } from '../db/types.js';

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

// ─── Input types ─────────────────────────────────────────────────────────────

export interface AddTransactionInput {
  account_id: string;
  date: string;
  amount: number;
  description?: string;
  merchant?: string;
  category?: string;
  subcategory?: string;
  type?: string;
  currency?: string;
  source?: string;
  external_id?: string;
  pending?: boolean;
  notes?: string;
}

export interface GetTransactionsInput {
  account_id?: string;
  category?: string;
  from_date?: string;
  to_date?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateTransactionInput {
  id: string;
  description?: string;
  merchant?: string;
  category?: string;
  subcategory?: string;
  notes?: string;
  date?: string;
  amount?: number;
}

export interface SpendingSummaryInput {
  from_date: string;
  to_date: string;
  account_id?: string;
}

export interface SpendingSummaryRow {
  category: string;
  total: number;
  count: number;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export function addTransaction(db: Database, input: AddTransactionInput): TransactionRow {
  const {
    account_id,
    date,
    amount,
    description,
    merchant,
    category,
    subcategory,
    type,
    currency = 'USD',
    source = 'manual',
    external_id,
    pending = false,
    notes,
  } = input;

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date "${date}". Expected YYYY-MM-DD`);
  }

  const account = db.query('SELECT id FROM accounts WHERE id = ?').get(account_id);
  if (!account) {
    throw new Error(`Account "${account_id}" not found`);
  }

  const id = uuid();
  const ts = now();

  db.run(
    `INSERT INTO transactions
     (id, account_id, date, amount, currency, description, merchant, category, subcategory,
      type, source, external_id, pending, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, account_id, date, amount, currency, description ?? null, merchant ?? null,
      category ?? null, subcategory ?? null, type ?? null, source,
      external_id ?? null, pending ? 1 : 0, notes ?? null, ts, ts,
    ]
  );

  return db.query('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow;
}

export function getTransactions(db: Database, input: GetTransactionsInput): TransactionRow[] {
  const { account_id, category, from_date, to_date, search, limit = 100, offset = 0 } = input;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (account_id) {
    conditions.push('account_id = ?');
    params.push(account_id);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (from_date) {
    conditions.push('date >= ?');
    params.push(from_date);
  }
  if (to_date) {
    conditions.push('date <= ?');
    params.push(to_date);
  }
  if (search) {
    conditions.push('(description LIKE ? OR merchant LIKE ? OR notes LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM transactions ${where} ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.query(sql).all(...params) as TransactionRow[];
}

export function updateTransaction(db: Database, input: UpdateTransactionInput): TransactionRow {
  const { id, ...fields } = input;
  const ts = now();

  const setClauses: string[] = [];
  const params: (string | number | null)[] = [];

  if (fields.description !== undefined) { setClauses.push('description = ?'); params.push(fields.description); }
  if (fields.merchant !== undefined)    { setClauses.push('merchant = ?');    params.push(fields.merchant); }
  if (fields.category !== undefined)    { setClauses.push('category = ?');    params.push(fields.category); }
  if (fields.subcategory !== undefined) { setClauses.push('subcategory = ?'); params.push(fields.subcategory); }
  if (fields.notes !== undefined)       { setClauses.push('notes = ?');       params.push(fields.notes); }
  if (fields.date !== undefined)        { setClauses.push('date = ?');        params.push(fields.date); }
  if (fields.amount !== undefined)      { setClauses.push('amount = ?');      params.push(fields.amount); }

  if (setClauses.length === 0) {
    throw new Error('No fields to update');
  }

  setClauses.push('updated_at = ?');
  params.push(ts, id);

  const result = db.run(
    `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ?`,
    params
  );

  if (result.changes === 0) {
    throw new Error(`Transaction "${id}" not found`);
  }

  return db.query('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow;
}

export function deleteTransaction(db: Database, id: string): { deleted: boolean } {
  const result = db.run('DELETE FROM transactions WHERE id = ?', [id]);
  return { deleted: result.changes > 0 };
}

export function getSpendingSummary(db: Database, input: SpendingSummaryInput): SpendingSummaryRow[] {
  const { from_date, to_date, account_id } = input;

  const conditions = ['date >= ?', 'date <= ?', 'amount < 0'];
  const params: (string | number)[] = [from_date, to_date];

  if (account_id) {
    conditions.push('account_id = ?');
    params.push(account_id);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const sql = `
    SELECT
      COALESCE(category, 'Uncategorized') AS category,
      ROUND(ABS(SUM(amount)), 2)          AS total,
      COUNT(*)                            AS count
    FROM transactions
    ${where}
    GROUP BY category
    ORDER BY total DESC
  `;

  return db.query(sql).all(...params) as SpendingSummaryRow[];
}
