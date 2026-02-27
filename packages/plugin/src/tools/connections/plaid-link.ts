import { Products, CountryCode } from 'plaid';
import type { Database } from '../../db/index.js';
import { setCredential } from '../../credentials/keychain.js';
import { getPlaidClient } from '../../providers/plaid/client.js';
import { syncConnection } from './index.js';
import type { ProviderRegistry } from '../../providers/registry.js';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000; // 30 seconds — user should already be done when this is called

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LinkPlaidInput {
  institution_name?: string;
}

export interface LinkPlaidStartResult {
  link_url: string;
  link_token: string;
}

export interface LinkPlaidCompleteInput {
  link_token: string;
  institution_name?: string;
}

export type LinkPlaidCompleteResult =
  | {
      status: 'complete';
      connection_id: string;
      institution_name: string;
      accounts_synced: number;
      transactions_added: number;
      holdings_synced: number;
    }
  | {
      status: 'duplicate';
      connection_id: string;
      institution_name: string;
    }
  | { status: 'waiting' };

/**
 * Step 1: Create a Plaid Hosted Link URL and return it immediately.
 */
export async function startPlaidLink(_db: Database, input: LinkPlaidInput): Promise<LinkPlaidStartResult> {
  const client = getPlaidClient();

  const linkTokenResponse = await client.linkTokenCreate({
    user: { client_user_id: 'budgetclaw-user' },
    client_name: 'BudgetClaw',
    products: [Products.Transactions],
    additional_consented_products: [Products.Investments],
    country_codes: [CountryCode.Us],
    language: 'en',
    hosted_link: {
      url_lifetime_seconds: 1800,
    },
  });

  const linkToken = linkTokenResponse.data.link_token;
  const hostedLinkUrl = linkTokenResponse.data.hosted_link_url;

  if (!hostedLinkUrl) {
    throw new Error(
      'Plaid did not return a hosted_link_url. ' +
      'Ensure Hosted Link is enabled in your Plaid dashboard (Settings → Link Customization).',
    );
  }

  return {
    link_url: hostedLinkUrl,
    link_token: linkToken,
  };
}

/**
 * Step 2: Poll until the user completes the Plaid Link session, then exchange
 * the token and store the connection.
 */
export async function completePlaidLink(db: Database, registry: ProviderRegistry, input: LinkPlaidCompleteInput): Promise<LinkPlaidCompleteResult> {
  const client = getPlaidClient();
  const { link_token: linkToken } = input;

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let publicToken: string | undefined;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const getResp = await client.linkTokenGet({ link_token: linkToken });
    const session = getResp.data.link_sessions?.[0];

    if (!session) continue;

    if (!session.finished_at) continue;

    const itemResult = session.results?.item_add_results?.[0];
    if (itemResult?.public_token) {
      publicToken = itemResult.public_token;
      break;
    }

    const exitReason = session.exit?.error?.display_message
      ?? session.exit?.error?.error_message
      ?? 'User exited Plaid Link without connecting a bank.';
    throw new Error(exitReason);
  }

  if (!publicToken) {
    return { status: 'waiting' as const };
  }

  // Exchange public token for access token
  const exchangeResponse = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });

  const accessToken = exchangeResponse.data.access_token;
  const itemId = exchangeResponse.data.item_id;

  // Duplicate detection: check if this item_id already exists
  const existingByItem = db.prepare(
    'SELECT id, institution_name FROM provider_connections WHERE item_id = ?'
  ).get(itemId) as { id: string; institution_name: string } | undefined;

  if (existingByItem) {
    // Remove the duplicate Plaid item so it doesn't linger
    try { await client.itemRemove({ access_token: accessToken }); } catch { /* best-effort */ }
    return {
      status: 'duplicate' as const,
      connection_id: existingByItem.id,
      institution_name: existingByItem.institution_name,
    };
  }

  // Fetch accounts to get institution info
  const accountsResponse = await client.accountsGet({ access_token: accessToken });
  const institutionId = accountsResponse.data.item.institution_id ?? null;
  const institutionName =
    input.institution_name ??
    (institutionId ? institutionId : 'Unknown Institution');

  let resolvedInstitutionName = institutionName;
  if (institutionId) {
    try {
      const instResponse = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      resolvedInstitutionName = instResponse.data.institution.name;
    } catch {
      // Non-fatal
    }
  }

  // Duplicate detection: check if this institution is already connected
  const existingByInstitution = institutionId
    ? db.prepare(
        'SELECT id, institution_name FROM provider_connections WHERE institution_id = ?'
      ).get(institutionId) as { id: string; institution_name: string } | undefined
    : undefined;

  if (existingByInstitution) {
    try { await client.itemRemove({ access_token: accessToken }); } catch { /* best-effort */ }
    return {
      status: 'duplicate' as const,
      connection_id: existingByInstitution.id,
      institution_name: existingByInstitution.institution_name,
    };
  }

  // Store access token
  const connectionId = crypto.randomUUID();
  const keychainKey = `plaid-${connectionId}`;
  await setCredential(keychainKey, accessToken);

  // Insert provider_connections row
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO provider_connections
      (id, provider, institution_id, institution_name, item_id, keychain_key, cursor, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(connectionId, 'plaid', institutionId, resolvedInstitutionName, itemId, keychainKey, now, now);

  // Auto-sync accounts, transactions, and holdings immediately
  const sync = await syncConnection(db, connectionId, registry);

  return {
    status: 'complete' as const,
    connection_id: connectionId,
    institution_name: resolvedInstitutionName,
    accounts_synced: sync.accounts_synced,
    transactions_added: sync.transactions_added,
    holdings_synced: sync.holdings_synced,
  };
}
