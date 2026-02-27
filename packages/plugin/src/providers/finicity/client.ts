/**
 * FinicityClient — HTTP client for Finicity (Mastercard Open Banking) API.
 *
 * Uses native `fetch` — no SDK dependency. Modeled after CoinbaseClient.
 *
 * Auth flow:
 *   1. Partner authenticates via POST /aggregation/v2/partners/authentication
 *   2. Returns a token valid for 90 minutes
 *   3. All subsequent requests include Finicity-App-Key + Finicity-App-Token headers
 *
 * Required env vars: FINICITY_PARTNER_ID, FINICITY_PARTNER_SECRET, FINICITY_APP_KEY
 */

const BASE_URL = 'https://api.finicity.com';
const TOKEN_LIFETIME_MS = 90 * 60 * 1000; // 90 minutes

// ─── Response types ──────────────────────────────────────────────────────────

export interface FinicityAccount {
  id: string;
  number: string;
  accountNumberDisplay: string;
  name: string;
  type: string;
  status: string;
  balance: number;
  customerId: string;
  institutionId: string;
  institutionLoginId: number;
  currency: string;
}

export interface FinicityTransaction {
  id: number;
  amount: number;
  accountId: string;
  customerId: number;
  status: string;            // 'active' | 'pending'
  description: string;
  memo: string;
  type: string;              // 'debit' | 'credit' | ...
  postedDate: number;        // epoch seconds
  transactionDate: number;   // epoch seconds
  categorization?: {
    normalizedPayeeName?: string;
    category?: string;
  };
}

export interface FinicityInstitution {
  id: number;
  name: string;
  urlHomeApp: string;
}

interface FinicityInstitutionsResponse {
  institutions: FinicityInstitution[];
}

interface FinicityTransactionsResponse {
  transactions: FinicityTransaction[];
  moreAvailable: string; // "true" | "false"
}

interface FinicityAccountsResponse {
  accounts: FinicityAccount[];
}

interface FinicityConnectResponse {
  link: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class FinicityClient {
  private readonly partnerId: string;
  private readonly partnerSecret: string;
  private readonly appKey: string;

  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    const partnerId = process.env['FINICITY_PARTNER_ID'];
    const partnerSecret = process.env['FINICITY_PARTNER_SECRET'];
    const appKey = process.env['FINICITY_APP_KEY'];

    if (!partnerId) {
      throw new Error(
        'Missing env var: FINICITY_PARTNER_ID\n' +
        'Get your credentials at https://developer.mastercard.com/open-banking-us/documentation/',
      );
    }
    if (!partnerSecret) {
      throw new Error(
        'Missing env var: FINICITY_PARTNER_SECRET\n' +
        'Get your credentials at https://developer.mastercard.com/open-banking-us/documentation/',
      );
    }
    if (!appKey) {
      throw new Error(
        'Missing env var: FINICITY_APP_KEY\n' +
        'Get your credentials at https://developer.mastercard.com/open-banking-us/documentation/',
      );
    }

    this.partnerId = partnerId;
    this.partnerSecret = partnerSecret;
    this.appKey = appKey;
  }

  /**
   * Authenticate with the Finicity partner API. Caches the token for 90 minutes.
   */
  async authenticate(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    const response = await fetch(`${BASE_URL}/aggregation/v2/partners/authentication`, {
      method: 'POST',
      headers: {
        'Finicity-App-Key': this.appKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        partnerId: this.partnerId,
        partnerSecret: this.partnerSecret,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Finicity authentication failed (${response.status}): ${text}`);
    }

    const data = await response.json() as { token: string };
    this.token = data.token;
    this.tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
    return this.token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.authenticate();

    const headers: Record<string, string> = {
      'Finicity-App-Key': this.appKey,
      'Finicity-App-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      let message = `Finicity API error ${response.status}`;
      try {
        const parsed = JSON.parse(text);
        message = parsed.message ?? parsed.error ?? message;
      } catch { /* use default */ }
      throw new Error(message);
    }

    // Some endpoints (DELETE) return no body
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  /**
   * Create an active customer (required before generating Connect URLs).
   */
  async createCustomer(username: string): Promise<{ id: string; createdDate: string }> {
    return this.request('POST', '/aggregation/v2/customers/active', {
      username,
      firstName: 'BudgetClaw',
      lastName: 'User',
    });
  }

  /**
   * Fetch all accounts for a customer.
   */
  async getCustomerAccounts(customerId: string): Promise<FinicityAccount[]> {
    const resp = await this.request<FinicityAccountsResponse>(
      'GET',
      `/aggregation/v1/customers/${customerId}/accounts`,
    );
    return resp.accounts ?? [];
  }

  /**
   * Fetch transactions for a customer within a date range, with auto-pagination.
   */
  async getCustomerTransactions(
    customerId: string,
    fromDate: number,
    toDate: number,
  ): Promise<FinicityTransaction[]> {
    const all: FinicityTransaction[] = [];
    const limit = 1000;
    let offset = 1; // Finicity uses 1-based offset

    while (true) {
      const resp = await this.request<FinicityTransactionsResponse>(
        'GET',
        `/aggregation/v3/customers/${customerId}/transactions` +
        `?fromDate=${fromDate}&toDate=${toDate}&start=${offset}&limit=${limit}`,
      );

      all.push(...(resp.transactions ?? []));

      if (resp.moreAvailable === 'true') {
        offset += limit;
      } else {
        break;
      }
    }

    return all;
  }

  /**
   * Generate a Finicity Connect URL for the user to link accounts.
   */
  async generateConnectUrl(customerId: string): Promise<string> {
    const resp = await this.request<FinicityConnectResponse>(
      'POST',
      '/connect/v2/generate',
      { partnerId: this.partnerId, customerId },
    );
    return resp.link;
  }

  /**
   * Search for institutions by name.
   */
  async searchInstitutions(query: string): Promise<FinicityInstitution[]> {
    const encoded = encodeURIComponent(query);
    const resp = await this.request<FinicityInstitutionsResponse>(
      'GET',
      `/institution/v2/institutions?search=${encoded}&start=1&limit=10`,
    );
    return resp.institutions ?? [];
  }

  /**
   * Delete an institution login (used for disconnect).
   */
  async deleteInstitutionLogin(customerId: string, institutionLoginId: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/aggregation/v1/customers/${customerId}/institutionLogins/${institutionLoginId}`,
    );
  }
}
