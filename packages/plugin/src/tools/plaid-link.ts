import { Products, CountryCode } from 'plaid';
import type { Database } from '../db/index.js';
import { setCredential } from '../credentials/keychain.js';
import { getPlaidClient } from '../providers/plaid-client.js';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1_000; // 30 minutes

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LinkPlaidInput {
  institution_name?: string;
}

export interface LinkPlaidResult {
  connection_id: string;
  institution_name: string;
  accounts_found: number;
  link_url: string;
}

export async function linkPlaid(db: Database, input: LinkPlaidInput): Promise<LinkPlaidResult> {
  const client = getPlaidClient();

  // 1. Create link token with hosted_link enabled
  const linkTokenResponse = await client.linkTokenCreate({
    user: { client_user_id: 'budgetclaw-user' },
    client_name: 'BudgetClaw',
    products: [Products.Transactions, Products.Investments],
    country_codes: [CountryCode.Us],
    language: 'en',
    hosted_link: {
      url_lifetime_seconds: 1800, // 30 minutes
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

  // Log URL to stderr so it's visible in terminal
  console.error(`\nPlaid Link URL: ${hostedLinkUrl}`);
  console.error('Open this URL in your browser to connect your bank account.\n');

  // 2. Poll linkTokenGet until the session completes
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let publicToken: string | undefined;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const getResp = await client.linkTokenGet({ link_token: linkToken });
    const session = getResp.data.link_sessions?.[0];

    if (!session) continue;

    // Session started but not finished yet
    if (!session.finished_at) continue;

    // Check if user successfully linked an item
    const itemResult = session.results?.item_add_results?.[0];
    if (itemResult?.public_token) {
      publicToken = itemResult.public_token;
      break;
    }

    // Session finished but no item — user exited/abandoned
    const exitReason = session.exit?.error?.display_message
      ?? session.exit?.error?.error_message
      ?? 'User exited Plaid Link without connecting a bank.';
    throw new Error(exitReason);
  }

  if (!publicToken) {
    throw new Error('Plaid Link timed out after 30 minutes. Run budgetclaw_plaid_link again.');
  }

  // 3. Exchange public token for access token
  const exchangeResponse = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });

  const accessToken = exchangeResponse.data.access_token;
  const itemId = exchangeResponse.data.item_id;

  // 4. Fetch accounts to get institution info
  const accountsResponse = await client.accountsGet({ access_token: accessToken });
  const institutionId = accountsResponse.data.item.institution_id ?? null;
  const institutionName =
    input.institution_name ??
    (institutionId ? institutionId : 'Unknown Institution');

  // Try to get the institution name from Plaid if we have an institution_id
  let resolvedInstitutionName = institutionName;
  if (institutionId) {
    try {
      const instResponse = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      resolvedInstitutionName = instResponse.data.institution.name;
    } catch {
      // Non-fatal — use what we have
    }
  }

  const accountCount = accountsResponse.data.accounts.length;

  // 5. Store access token in credential store
  const connectionId = crypto.randomUUID();
  const keychainKey = `plaid-${connectionId}`;
  await setCredential(keychainKey, accessToken);

  // 6. Insert provider_connections row
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO provider_connections
      (id, provider, institution_id, institution_name, item_id, keychain_key, cursor, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(connectionId, 'plaid', institutionId, resolvedInstitutionName, itemId, keychainKey, now, now);

  return {
    connection_id: connectionId,
    institution_name: resolvedInstitutionName,
    accounts_found: accountCount,
    link_url: hostedLinkUrl,
  };
}
