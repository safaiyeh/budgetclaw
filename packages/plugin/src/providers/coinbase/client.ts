/**
 * CoinbaseClient — HTTP client for Coinbase v2 API with HMAC-SHA256 signing.
 *
 * Uses native `fetch` and `node:crypto` — no additional npm dependencies.
 *
 * Auth headers:
 *   CB-ACCESS-KEY       — API key
 *   CB-ACCESS-SIGN      — HMAC-SHA256(secret, timestamp + method + path + body)
 *   CB-ACCESS-TIMESTAMP — Unix epoch seconds
 *   CB-VERSION           — API version date
 */

import { createHmac } from 'node:crypto';

const BASE_URL = 'https://api.coinbase.com';
const API_VERSION = '2023-01-01';

// ─── Response types ──────────────────────────────────────────────────────────

export interface CoinbaseMoneyAmount {
  amount: string;
  currency: string;
}

export interface CoinbaseAccount {
  id: string;
  name: string;
  type: string;              // 'wallet' | 'fiat' | 'vault'
  currency: {
    code: string;
    name: string;
    type: string;            // 'crypto' | 'fiat'
  };
  balance: CoinbaseMoneyAmount;
  native_balance: CoinbaseMoneyAmount;
  created_at: string;
  updated_at: string;
}

export interface CoinbaseTransaction {
  id: string;
  type: string;              // 'send' | 'receive' | 'buy' | 'sell' | 'trade' | 'transfer' | ...
  status: string;            // 'completed' | 'pending' | 'failed' | 'canceled'
  amount: CoinbaseMoneyAmount;
  native_amount: CoinbaseMoneyAmount;
  description: string | null;
  created_at: string;
  updated_at: string;
  details: {
    title?: string;
    subtitle?: string;
  };
}

interface CoinbasePagination {
  ending_before: string | null;
  starting_after: string | null;
  limit: number;
  order: string;
  previous_uri: string | null;
  next_uri: string | null;
}

interface CoinbaseListResponse<T> {
  pagination: CoinbasePagination;
  data: T[];
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class CoinbaseClient {
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  private sign(timestamp: string, method: string, path: string, body: string): string {
    const message = timestamp + method.toUpperCase() + path + body;
    return createHmac('sha256', this.apiSecret).update(message).digest('hex');
  }

  private async request<T>(method: string, path: string): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.sign(timestamp, method, path, '');

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'CB-ACCESS-KEY': this.apiKey,
        'CB-ACCESS-SIGN': signature,
        'CB-ACCESS-TIMESTAMP': timestamp,
        'CB-VERSION': API_VERSION,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      let message = `Coinbase API error ${response.status}`;
      try {
        const parsed = JSON.parse(text);
        message = parsed.errors?.[0]?.message ?? message;
      } catch { /* use default */ }
      throw new Error(message);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch all Coinbase accounts (wallets), auto-paginating.
   */
  async getAccounts(): Promise<CoinbaseAccount[]> {
    const all: CoinbaseAccount[] = [];
    let path = '/v2/accounts?limit=100';

    while (path) {
      const resp = await this.request<CoinbaseListResponse<CoinbaseAccount>>('GET', path);
      all.push(...resp.data);
      path = resp.pagination.next_uri ?? '';
    }

    return all;
  }

  /**
   * Fetch transactions for a specific Coinbase account, auto-paginating.
   */
  async getTransactions(accountId: string, startingAfter?: string): Promise<CoinbaseTransaction[]> {
    const all: CoinbaseTransaction[] = [];
    let path = `/v2/accounts/${accountId}/transactions?limit=100`;
    if (startingAfter) path += `&starting_after=${startingAfter}`;

    while (path) {
      const resp = await this.request<CoinbaseListResponse<CoinbaseTransaction>>('GET', path);
      all.push(...resp.data);
      path = resp.pagination.next_uri ?? '';
    }

    return all;
  }
}
