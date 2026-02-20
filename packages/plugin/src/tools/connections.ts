import type { Database } from '../db/index.js';
import { toRow } from '../db/types.js';
import type { ProviderConnectionRow } from '../db/types.js';
import { getCredential, deleteCredential } from '../credentials/keychain.js';
import type { ProviderRegistry } from '../providers/registry.js';

function now(): string {
  return new Date().toISOString();
}

export interface ListConnectionsResult {
  connections: Omit<ProviderConnectionRow, 'keychain_key'>[];
}

export function listConnections(db: Database): ListConnectionsResult {
  const rows = toRow<Omit<ProviderConnectionRow, 'keychain_key'>[]>(
    db.prepare(
      `SELECT id, provider, institution_id, institution_name, item_id,
              cursor, last_synced_at, created_at, updated_at
       FROM provider_connections
       ORDER BY created_at DESC`
    ).all()
  );
  return { connections: rows };
}

export async function removeConnection(db: Database, id: string): Promise<{ removed: boolean }> {
  const row = toRow<{ keychain_key: string } | undefined>(
    db.prepare('SELECT keychain_key FROM provider_connections WHERE id = ?').get(id)
  );

  if (!row) {
    throw new Error(`Connection "${id}" not found`);
  }

  try {
    await deleteCredential(row.keychain_key);
  } catch {
    // Non-fatal — credential may have been manually removed
  }

  const result = db.prepare('DELETE FROM provider_connections WHERE id = ?').run(id);
  return { removed: result.changes > 0 };
}

export interface SyncConnectionResult {
  provider: string;
  institution_name: string | null;
  accounts_synced: number;
  transactions_added: number;
  transactions_modified: number;
  transactions_removed: number;
  last_synced_at: string;
}

export async function syncConnection(
  db: Database,
  id: string,
  registry: ProviderRegistry,
): Promise<SyncConnectionResult> {
  // 1. Load connection row
  const conn = toRow<ProviderConnectionRow | undefined>(
    db.prepare('SELECT * FROM provider_connections WHERE id = ?').get(id)
  );
  if (!conn) throw new Error(`Connection "${id}" not found`);

  // 2. Load credential from OS keychain
  const credential = await getCredential(conn.keychain_key);
  if (!credential) {
    throw new Error(
      `No credential found in keychain for connection "${id}". Re-link the account.`
    );
  }

  // 3. Instantiate provider via registry
  const provider = registry.create(conn.provider, credential, {
    item_id: conn.item_id,
    institution_id: conn.institution_id,
    institution_name: conn.institution_name,
  });

  const ts = now();
  let accounts_synced = 0;
  let transactions_added = 0;
  let transactions_modified = 0;
  let transactions_removed = 0;

  // 4. Sync accounts — upsert by (source, external_id)
  const rawAccounts = await provider.getAccounts();
  const accountIdMap = new Map<string, string>(); // external_id → DB account id

  const findAccountStmt = db.prepare(
    'SELECT id FROM accounts WHERE source = ? AND external_id = ?'
  );
  const insertAccountStmt = db.prepare(`
    INSERT INTO accounts
      (id, name, institution, type, currency, balance, source, external_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const updateAccountStmt = db.prepare(`
    UPDATE accounts
    SET name = ?, institution = ?, type = ?, currency = ?, balance = ?, updated_at = ?
    WHERE id = ?
  `);

  for (const raw of rawAccounts) {
    const existing = toRow<{ id: string } | undefined>(
      findAccountStmt.get(conn.provider, raw.external_id)
    );

    if (existing) {
      updateAccountStmt.run(
        raw.name,
        raw.institution ?? null,
        raw.type,
        raw.currency ?? 'USD',
        raw.balance ?? null,
        ts,
        existing.id,
      );
      accountIdMap.set(raw.external_id, existing.id);
    } else {
      const accountId = crypto.randomUUID();
      insertAccountStmt.run(
        accountId, raw.name, raw.institution ?? null, raw.type,
        raw.currency ?? 'USD', raw.balance ?? null,
        conn.provider, raw.external_id, ts, ts,
      );
      accountIdMap.set(raw.external_id, accountId);
    }
    accounts_synced++;
  }

  // 5. Sync transactions — incremental via cursor
  const { added, modified, removed, nextCursor } =
    await provider.getTransactions(conn.cursor ?? undefined);

  const insertTxStmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (id, account_id, date, amount, currency, description, merchant, category, subcategory,
       type, source, external_id, pending, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateTxStmt = db.prepare(`
    UPDATE transactions
    SET date = ?, amount = ?, description = ?, merchant = ?, category = ?,
        subcategory = ?, type = ?, pending = ?, notes = ?, updated_at = ?
    WHERE account_id = ? AND external_id = ?
  `);

  // Delete by (source, external_id) — no need to know the account for removals
  const deleteTxStmt = db.prepare(
    'DELETE FROM transactions WHERE source = ? AND external_id = ?'
  );

  for (const tx of added) {
    const accountId = tx.account_external_id
      ? accountIdMap.get(tx.account_external_id)
      : undefined;
    if (!accountId) continue;

    const result = insertTxStmt.run(
      crypto.randomUUID(), accountId, tx.date, tx.amount,
      tx.currency ?? 'USD', tx.description ?? null, tx.merchant ?? null,
      tx.category ?? null, tx.subcategory ?? null, tx.type ?? null,
      conn.provider, tx.external_id, tx.pending ? 1 : 0, tx.notes ?? null,
      ts, ts,
    );
    if (result.changes > 0) transactions_added++;
  }

  for (const tx of modified) {
    const accountId = tx.account_external_id
      ? accountIdMap.get(tx.account_external_id)
      : undefined;
    if (!accountId) continue;

    const result = updateTxStmt.run(
      tx.date, tx.amount, tx.description ?? null, tx.merchant ?? null,
      tx.category ?? null, tx.subcategory ?? null, tx.type ?? null,
      tx.pending ? 1 : 0, tx.notes ?? null, ts,
      accountId, tx.external_id,
    );
    if (result.changes > 0) transactions_modified++;
  }

  for (const externalId of removed) {
    const result = deleteTxStmt.run(conn.provider, externalId);
    if (result.changes > 0) transactions_removed++;
  }

  // 6. Sync balances — update cached balance on account rows
  const balances = await provider.getBalances();
  const updateBalanceStmt = db.prepare(
    'UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?'
  );

  for (const bal of balances) {
    const accountId = accountIdMap.get(bal.account_external_id);
    if (accountId) {
      updateBalanceStmt.run(bal.balance, ts, accountId);
    }
  }

  // 7. Persist cursor + last_synced_at
  db.prepare(
    'UPDATE provider_connections SET cursor = ?, last_synced_at = ?, updated_at = ? WHERE id = ?'
  ).run(nextCursor, ts, ts, id);

  return {
    provider: conn.provider,
    institution_name: conn.institution_name,
    accounts_synced,
    transactions_added,
    transactions_modified,
    transactions_removed,
    last_synced_at: ts,
  };
}
