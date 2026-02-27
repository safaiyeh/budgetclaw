import type { Database } from '../../db/index.js';
import { toRow } from '../../db/types.js';
import type { AccountRow, ProviderConnectionRow } from '../../db/types.js';
import { getCredential, deleteCredential } from '../../credentials/keychain.js';
import type { ProviderRegistry } from '../../providers/registry.js';

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

export interface DeleteAccountResult {
  deleted_accounts: number;
  deleted_transactions: number;
  deleted_holdings: number;
  connection_removed: boolean;
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

export async function deleteAccount(
  db: Database,
  input: { id: string },
  registry: ProviderRegistry,
): Promise<DeleteAccountResult> {
  const account = toRow<AccountRow | undefined>(
    db.prepare('SELECT * FROM accounts WHERE id = ?').get(input.id)
  );
  if (!account) throw new Error(`Account "${input.id}" not found`);

  let totalTx = 0;
  let totalHoldings = 0;
  let deletedAccounts = 0;
  let connectionRemoved = false;

  // If the account belongs to a provider connection, remove the entire connection
  if (account.connection_id) {
    const conn = toRow<ProviderConnectionRow | undefined>(
      db.prepare('SELECT * FROM provider_connections WHERE id = ?').get(account.connection_id)
    );

    if (conn) {
      // 1. Server-side cleanup via provider.disconnect() (e.g. Plaid itemRemove)
      try {
        const credential = await getCredential(conn.keychain_key);
        if (credential) {
          const provider = registry.create(conn.provider, credential, {
            item_id: conn.item_id,
            institution_id: conn.institution_id,
            institution_name: conn.institution_name,
          });
          if (provider.disconnect) {
            await provider.disconnect();
          }
        }
      } catch { /* best-effort — item may already be removed */ }

      // 2. Delete all accounts from this connection (transactions + holdings cascade via FK)
      const connAccounts = toRow<{ id: string }[]>(
        db.prepare('SELECT id FROM accounts WHERE connection_id = ?').all(conn.id)
      );

      for (const ca of connAccounts) {
        totalTx += (db.prepare('SELECT COUNT(*) as c FROM transactions WHERE account_id = ?').get(ca.id) as { c: number }).c;
        totalHoldings += (db.prepare('SELECT COUNT(*) as c FROM portfolio_holdings WHERE account_id = ?').get(ca.id) as { c: number }).c;
        db.prepare('DELETE FROM accounts WHERE id = ?').run(ca.id);
        deletedAccounts++;
      }

      // 3. Delete credential and connection row
      try { await deleteCredential(conn.keychain_key); } catch { /* best-effort */ }
      db.prepare('DELETE FROM provider_connections WHERE id = ?').run(conn.id);
      connectionRemoved = true;
    }
  }

  // For manual accounts, or if no provider connection was found
  if (deletedAccounts === 0) {
    totalTx = (db.prepare('SELECT COUNT(*) as c FROM transactions WHERE account_id = ?').get(input.id) as { c: number }).c;
    totalHoldings = (db.prepare('SELECT COUNT(*) as c FROM portfolio_holdings WHERE account_id = ?').get(input.id) as { c: number }).c;
    db.prepare('DELETE FROM accounts WHERE id = ?').run(input.id);
    deletedAccounts = 1;
  }

  return {
    deleted_accounts: deletedAccounts,
    deleted_transactions: totalTx,
    deleted_holdings: totalHoldings,
    connection_removed: connectionRemoved,
  };
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
