import type { Database } from '../db/index.js';
import { toRow } from '../db/types.js';
import type { AccountRow } from '../db/types.js';

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'investment', 'crypto', 'loan', 'other'] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

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

export function addAccount(db: Database, input: AddAccountInput): AccountRow {
  const { name, type, institution, balance, currency = 'USD', source = 'manual', external_id } = input;

  if (!ACCOUNT_TYPES.includes(type)) {
    throw new Error(`Invalid account type "${type}". Must be one of: ${ACCOUNT_TYPES.join(', ')}`);
  }

  const id = uuid();
  const ts = now();

  db.prepare(
    `INSERT INTO accounts (id, name, institution, type, currency, balance, source, external_id, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, name, institution ?? null, type, currency, balance ?? null, source, external_id ?? null, ts, ts);

  return toRow<AccountRow>(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
}

export function getAccounts(db: Database): AccountRow[] {
  return toRow<AccountRow[]>(db.prepare('SELECT * FROM accounts WHERE is_active = 1 ORDER BY name').all());
}

export function updateAccountBalance(db: Database, input: UpdateAccountBalanceInput): AccountRow {
  const { id, balance } = input;
  const ts = now();

  const result = db.prepare('UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?').run(balance, ts, id);
  if (result.changes === 0) {
    throw new Error(`Account "${id}" not found`);
  }

  return toRow<AccountRow>(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
}
