/**
 * coinbase-link — single-step Coinbase connection tool.
 *
 * 1. Validate credentials with a test API call
 * 2. Check for duplicate connection
 * 3. Store credential JSON in encrypted credential store
 * 4. Insert provider_connections row
 * 5. Auto-sync via syncConnection()
 */

import type { Database } from '../../db/index.js';
import { setCredential } from '../../credentials/keychain.js';
import { CoinbaseClient } from '../../providers/coinbase/client.js';
import { syncConnection } from './index.js';
import type { ProviderRegistry } from '../../providers/registry.js';

export interface LinkCoinbaseInput {
  api_key: string;
  api_secret: string;
}

export type LinkCoinbaseResult =
  | {
      status: 'complete';
      connection_id: string;
      accounts_synced: number;
      transactions_added: number;
      holdings_synced: number;
    }
  | {
      status: 'duplicate';
      connection_id: string;
    };

export async function linkCoinbase(
  db: Database,
  registry: ProviderRegistry,
  input: LinkCoinbaseInput,
): Promise<LinkCoinbaseResult> {
  const { api_key, api_secret } = input;

  // 1. Validate credentials by making a test API call
  const testClient = new CoinbaseClient(api_key, api_secret);
  try {
    await testClient.getAccounts();
  } catch (e) {
    throw new Error(
      `Failed to authenticate with Coinbase: ${e instanceof Error ? e.message : String(e)}. ` +
      'Check that your API key and secret are correct and have read permissions.',
    );
  }

  // 2. Check for duplicate connection
  const existing = db.prepare(
    'SELECT id FROM provider_connections WHERE provider = ?'
  ).get('coinbase') as { id: string } | undefined;

  if (existing) {
    return {
      status: 'duplicate' as const,
      connection_id: existing.id,
    };
  }

  // 3. Store credential
  const connectionId = crypto.randomUUID();
  const keychainKey = `coinbase-${connectionId}`;
  const credentialJson = JSON.stringify({ apiKey: api_key, apiSecret: api_secret });
  await setCredential(keychainKey, credentialJson);

  // 4. Insert provider_connections row
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO provider_connections
      (id, provider, institution_id, institution_name, item_id, keychain_key, cursor, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(connectionId, 'coinbase', null, 'Coinbase', null, keychainKey, now, now);

  // 5. Auto-sync
  const sync = await syncConnection(db, connectionId, registry);

  return {
    status: 'complete' as const,
    connection_id: connectionId,
    accounts_synced: sync.accounts_synced,
    transactions_added: sync.transactions_added,
    holdings_synced: sync.holdings_synced,
  };
}
