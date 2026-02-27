/**
 * finicity-link — two-step Finicity connection tool.
 *
 * Step 1 (startFinicityLink):
 *   - Auth with Finicity partner API
 *   - Reuse existing customerId if one exists, else create new customer
 *   - Generate Connect URL
 *   - Return { connect_url, customer_id }
 *
 * Step 2 (completeFinicityLink):
 *   - Fetch all customer accounts, group by institutionLoginId
 *   - Diff against existing finicity connections to find new logins
 *   - For each new login: check duplicate, store customerId, insert row, auto-sync
 */

import type { Database } from '../../db/index.js';
import { setCredential } from '../../credentials/keychain.js';
import { FinicityClient } from '../../providers/finicity/client.js';
import { syncConnection } from './index.js';
import type { ProviderRegistry } from '../../providers/registry.js';

export interface FinicityLinkStartResult {
  connect_url: string;
  customer_id: string;
}

export interface FinicityLinkCompleteInput {
  customer_id: string;
}

export type FinicityLinkCompleteResult =
  | {
      status: 'complete';
      connections: Array<{
        connection_id: string;
        institution_name: string;
        accounts_synced: number;
        transactions_added: number;
      }>;
    }
  | {
      status: 'duplicate';
      connection_id: string;
      institution_name: string;
    }
  | { status: 'waiting' };

/**
 * Step 1: Generate a Finicity Connect URL for linking accounts.
 */
export async function startFinicityLink(
  db: Database,
  _input: Record<string, unknown>,
): Promise<FinicityLinkStartResult> {
  const client = new FinicityClient();

  // Reuse existing Finicity customerId if one exists
  const existingConn = db.prepare(
    "SELECT keychain_key FROM provider_connections WHERE provider = 'finicity' LIMIT 1"
  ).get() as { keychain_key: string } | undefined;

  let customerId: string;

  if (existingConn) {
    // Load customerId from keychain (credential = customerId for finicity)
    const { getCredential } = await import('../../credentials/keychain.js');
    const stored = await getCredential(existingConn.keychain_key);
    if (stored) {
      customerId = stored;
    } else {
      // Credential lost — create new customer
      const username = `budgetclaw-${Date.now()}`;
      const customer = await client.createCustomer(username);
      customerId = String(customer.id);
    }
  } else {
    const username = `budgetclaw-${Date.now()}`;
    const customer = await client.createCustomer(username);
    customerId = String(customer.id);
  }

  const connectUrl = await client.generateConnectUrl(customerId);

  return {
    connect_url: connectUrl,
    customer_id: customerId,
  };
}

/**
 * Step 2: Complete the Finicity link by discovering newly connected institution logins.
 */
export async function completeFinicityLink(
  db: Database,
  registry: ProviderRegistry,
  input: FinicityLinkCompleteInput,
): Promise<FinicityLinkCompleteResult> {
  const { customer_id: customerId } = input;
  const client = new FinicityClient();

  // Fetch all accounts for this customer
  const accounts = await client.getCustomerAccounts(customerId);

  if (accounts.length === 0) {
    return { status: 'waiting' as const };
  }

  // Group accounts by institutionLoginId
  const loginGroups = new Map<number, typeof accounts>();
  for (const acct of accounts) {
    const loginId = acct.institutionLoginId;
    const group = loginGroups.get(loginId) ?? [];
    group.push(acct);
    loginGroups.set(loginId, group);
  }

  // Find existing finicity connections to detect new logins
  const existingLogins = new Set<string>();
  const existingRows = db.prepare(
    "SELECT item_id FROM provider_connections WHERE provider = 'finicity'"
  ).all() as Array<{ item_id: string | null }>;
  for (const row of existingRows) {
    if (row.item_id) existingLogins.add(row.item_id);
  }

  const newConnections: Array<{
    connection_id: string;
    institution_name: string;
    accounts_synced: number;
    transactions_added: number;
  }> = [];

  for (const [loginId, loginAccounts] of loginGroups) {
    const loginIdStr = String(loginId);

    // Skip already-connected logins
    if (existingLogins.has(loginIdStr)) continue;

    // Use the first account's institutionId for duplicate check
    const institutionId = String(loginAccounts[0]!.institutionId);

    // Check for duplicate by institutionId
    const existingByInstitution = db.prepare(
      'SELECT id, institution_name FROM provider_connections WHERE institution_id = ?'
    ).get(institutionId) as { id: string; institution_name: string } | undefined;

    if (existingByInstitution) {
      return {
        status: 'duplicate' as const,
        connection_id: existingByInstitution.id,
        institution_name: existingByInstitution.institution_name,
      };
    }

    // Resolve institution name
    let institutionName = 'Unknown Institution';
    try {
      const institutions = await client.searchInstitutions(institutionId);
      if (institutions.length > 0) {
        institutionName = institutions[0]!.name;
      }
    } catch {
      // Use account name as fallback
      institutionName = loginAccounts[0]!.name.split(' ')[0] ?? 'Unknown Institution';
    }

    // Store customerId as the credential
    const connectionId = crypto.randomUUID();
    const keychainKey = `finicity-${connectionId}`;
    await setCredential(keychainKey, customerId);

    // Insert provider_connections row
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO provider_connections
        (id, provider, institution_id, institution_name, item_id, keychain_key, cursor, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(connectionId, 'finicity', institutionId, institutionName, loginIdStr, keychainKey, now, now);

    // Auto-sync
    const sync = await syncConnection(db, connectionId, registry);

    newConnections.push({
      connection_id: connectionId,
      institution_name: institutionName,
      accounts_synced: sync.accounts_synced,
      transactions_added: sync.transactions_added,
    });
  }

  if (newConnections.length === 0) {
    return { status: 'waiting' as const };
  }

  return {
    status: 'complete' as const,
    connections: newConnections,
  };
}
