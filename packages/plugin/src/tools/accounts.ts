import type { Database } from 'bun:sqlite';
import type { AccountRow } from '../db/types.js';

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'investment', 'crypto', 'loan', 'other'] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

// ─── Tool handler types ───────────────────────────────────────────────────────

export interface AddAccountInput {
  name: string;
  type: AccountType;
  institution?: string;
  balance?: number;
  currency?: string;
  source?: string;
  external_id?: string;
}

export interface UpdateAccountBalanceInput {
  id: string;
  balance: number;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export function addAccount(db: Database, input: AddAccountInput): AccountRow {
  const { name, type, institution, balance, currency = 'USD', source = 'manual', external_id } = input;

  if (!ACCOUNT_TYPES.includes(type)) {
    throw new Error(`Invalid account type "${type}". Must be one of: ${ACCOUNT_TYPES.join(', ')}`);
  }

  const id = uuid();
  const ts = now();

  db.run(
    `INSERT INTO accounts (id, name, institution, type, currency, balance, source, external_id, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, name, institution ?? null, type, currency, balance ?? null, source, external_id ?? null, ts, ts]
  );

  return db.query('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow;
}

export function getAccounts(db: Database): AccountRow[] {
  return db.query('SELECT * FROM accounts WHERE is_active = 1 ORDER BY name').all() as AccountRow[];
}

export function updateAccountBalance(db: Database, input: UpdateAccountBalanceInput): AccountRow {
  const { id, balance } = input;
  const ts = now();

  const result = db.run('UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?', [balance, ts, id]);
  if (result.changes === 0) {
    throw new Error(`Account "${id}" not found`);
  }

  return db.query('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow;
}
