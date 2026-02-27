/**
 * connect-bank — unified smart provider routing tool.
 *
 * Searches both Plaid and Finicity in parallel for a given institution name,
 * then picks the best provider (preferring Plaid — free Development tier).
 */

import type { Database } from '../../db/index.js';
import type { ProviderRegistry } from '../../providers/registry.js';
import { startPlaidLink, completePlaidLink } from './plaid-link.js';
import { startFinicityLink, completeFinicityLink } from './finicity-link.js';

export interface ConnectBankInput {
  institution_name: string;
}

export interface ConnectBankStartResult {
  provider: 'plaid' | 'finicity';
  institution_name: string;
  link_url: string;
  /** link_token for Plaid, customer_id for Finicity — needed for completion */
  completion_token: string;
  plaid_match: string | null;
  finicity_match: string | null;
}

export interface ConnectBankCompleteInput {
  provider: 'plaid' | 'finicity';
  completion_token: string;
  institution_name?: string;
}

interface PlaidInstitution {
  institution_id: string;
  name: string;
}

interface FinicityInstitution {
  id: number;
  name: string;
}

/**
 * Search Plaid institutions via POST /institutions/search.
 * Returns null if Plaid credentials are not configured or no results found.
 */
async function searchPlaid(query: string): Promise<PlaidInstitution | null> {
  try {
    const { getPlaidClient } = await import('../../providers/plaid/client.js');
    const { CountryCode, Products } = await import('plaid');
    const client = getPlaidClient();
    const response = await client.institutionsSearch({
      query,
      country_codes: [CountryCode.Us],
      products: [Products.Transactions],
    });
    const institutions = response.data.institutions;
    if (institutions.length === 0) return null;
    return {
      institution_id: institutions[0]!.institution_id,
      name: institutions[0]!.name,
    };
  } catch {
    // Plaid not configured or search failed
    return null;
  }
}

/**
 * Search Finicity institutions.
 * Returns null if Finicity credentials are not configured or no results found.
 */
async function searchFinicity(query: string): Promise<FinicityInstitution | null> {
  try {
    const { FinicityClient } = await import('../../providers/finicity/client.js');
    const client = new FinicityClient();
    const institutions = await client.searchInstitutions(query);
    if (institutions.length === 0) return null;
    return { id: institutions[0]!.id, name: institutions[0]!.name };
  } catch {
    // Finicity not configured or search failed
    return null;
  }
}

/**
 * Step 1: Search both providers and start the link flow with the best one.
 */
export async function connectBank(
  db: Database,
  _registry: ProviderRegistry,
  input: ConnectBankInput,
): Promise<ConnectBankStartResult> {
  const { institution_name } = input;

  // Search both providers in parallel
  const [plaidResult, finicityResult] = await Promise.all([
    searchPlaid(institution_name),
    searchFinicity(institution_name),
  ]);

  const plaidMatch = plaidResult?.name ?? null;
  const finicityMatch = finicityResult?.name ?? null;

  // Decision: prefer Plaid (cheaper — free Development tier)
  if (plaidResult) {
    const linkResult = await startPlaidLink(db, { institution_name: plaidResult.name });
    return {
      provider: 'plaid',
      institution_name: plaidResult.name,
      link_url: linkResult.link_url,
      completion_token: linkResult.link_token,
      plaid_match: plaidMatch,
      finicity_match: finicityMatch,
    };
  }

  if (finicityResult) {
    const linkResult = await startFinicityLink(db, {});
    return {
      provider: 'finicity',
      institution_name: finicityResult.name,
      link_url: linkResult.connect_url,
      completion_token: linkResult.customer_id,
      plaid_match: plaidMatch,
      finicity_match: finicityMatch,
    };
  }

  throw new Error(
    `Could not find "${institution_name}" on any supported provider (Plaid or Finicity). ` +
    'Try a different name or spelling, or use budgetclaw_plaid_link / budgetclaw_finicity_link directly.',
  );
}

/**
 * Step 2: Complete the link flow by routing to the correct provider.
 */
export async function completeConnectBank(
  db: Database,
  registry: ProviderRegistry,
  input: ConnectBankCompleteInput,
): Promise<unknown> {
  const { provider, completion_token, institution_name } = input;

  if (provider === 'plaid') {
    return completePlaidLink(db, registry, {
      link_token: completion_token,
      institution_name,
    });
  }

  if (provider === 'finicity') {
    return completeFinicityLink(db, registry, {
      customer_id: completion_token,
    });
  }

  throw new Error(`Unknown provider: ${provider}`);
}
