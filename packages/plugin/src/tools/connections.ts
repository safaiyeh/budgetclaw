import type { Database } from '../db/index.js';
import { toRow } from '../db/types.js';
import type { ProviderConnectionRow } from '../db/types.js';
import { deleteCredential } from '../credentials/keychain.js';

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

export function updateConnectionCursor(db: Database, id: string, cursor: string): void {
  const ts = now();
  db.prepare(
    'UPDATE provider_connections SET cursor = ?, last_synced_at = ?, updated_at = ? WHERE id = ?'
  ).run(cursor, ts, ts, id);
}
