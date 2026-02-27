/**
 * CoinbaseDataProvider — DataProvider implementation for Coinbase.
 *
 * Account modeling:
 *   - All crypto wallets → one aggregated "Coinbase Crypto" account (type: crypto)
 *   - Fiat wallets (e.g. USD Wallet) → separate `checking` accounts
 *
 * Holdings:
 *   - Each non-zero crypto wallet maps to a RawHolding
 *
 * Transactions:
 *   - Fetched from all wallets; cursor is an ISO timestamp
 *   - All returned as `added` (Coinbase txns are immutable)
 */

import type { DataProvider, RawAccount, RawTransaction, RawBalance, RawHolding } from './interface.js';
import { CoinbaseClient, type CoinbaseAccount, type CoinbaseTransaction } from './coinbase-client.js';

const CRYPTO_ACCOUNT_EXTERNAL_ID = 'coinbase-crypto-aggregate';

export class CoinbaseDataProvider implements DataProvider {
  readonly name = 'coinbase';
  private readonly client: CoinbaseClient;

  constructor(credential: string) {
    const { apiKey, apiSecret } = JSON.parse(credential) as { apiKey: string; apiSecret: string };
    this.client = new CoinbaseClient(apiKey, apiSecret);
  }

  private isCrypto(account: CoinbaseAccount): boolean {
    return account.currency.type === 'crypto';
  }

  private isFiat(account: CoinbaseAccount): boolean {
    return account.currency.type === 'fiat';
  }

  private hasBalance(account: CoinbaseAccount): boolean {
    return parseFloat(account.balance.amount) !== 0;
  }

  async getAccounts(): Promise<RawAccount[]> {
    const cbAccounts = await this.client.getAccounts();
    const result: RawAccount[] = [];

    // Aggregate all crypto wallets into one "Coinbase Crypto" account
    const cryptoWallets = cbAccounts.filter((a) => this.isCrypto(a));
    if (cryptoWallets.length > 0) {
      const totalUsd = cryptoWallets.reduce(
        (sum, a) => sum + parseFloat(a.native_balance.amount),
        0,
      );
      result.push({
        external_id: CRYPTO_ACCOUNT_EXTERNAL_ID,
        name: 'Coinbase Crypto',
        institution: 'Coinbase',
        type: 'crypto',
        currency: 'USD',
        balance: Math.round(totalUsd * 100) / 100,
      });
    }

    // Each fiat wallet becomes a separate checking account
    for (const a of cbAccounts) {
      if (this.isFiat(a) && this.hasBalance(a)) {
        result.push({
          external_id: a.id,
          name: `Coinbase ${a.currency.code} Wallet`,
          institution: 'Coinbase',
          type: 'checking',
          currency: a.currency.code,
          balance: parseFloat(a.balance.amount),
        });
      }
    }

    return result;
  }

  async getHoldings(): Promise<RawHolding[]> {
    const cbAccounts = await this.client.getAccounts();
    const holdings: RawHolding[] = [];

    for (const a of cbAccounts) {
      if (!this.isCrypto(a)) continue;
      const quantity = parseFloat(a.balance.amount);
      if (quantity === 0) continue;

      const nativeValue = parseFloat(a.native_balance.amount);
      const price = quantity !== 0 ? Math.round((nativeValue / quantity) * 100) / 100 : undefined;

      holdings.push({
        account_external_id: CRYPTO_ACCOUNT_EXTERNAL_ID,
        symbol: a.currency.code,
        name: a.currency.name,
        quantity,
        price,
        value: Math.round(nativeValue * 100) / 100,
        currency: 'USD',
        asset_type: 'crypto',
      });
    }

    return holdings;
  }

  async getTransactions(cursor?: string): Promise<{
    added: RawTransaction[];
    modified: RawTransaction[];
    removed: string[];
    nextCursor: string;
  }> {
    const cbAccounts = await this.client.getAccounts();
    const cursorDate = cursor ? new Date(cursor) : null;
    const added: RawTransaction[] = [];
    let latestDate = cursorDate ? cursorDate.getTime() : 0;

    for (const acct of cbAccounts) {
      let txns: CoinbaseTransaction[];
      try {
        txns = await this.client.getTransactions(acct.id);
      } catch {
        continue; // skip accounts that error (e.g. no permissions)
      }

      const accountExternalId = this.isCrypto(acct) ? CRYPTO_ACCOUNT_EXTERNAL_ID : acct.id;

      for (const tx of txns) {
        if (tx.status !== 'completed') continue;

        const txDate = new Date(tx.created_at);
        if (cursorDate && txDate <= cursorDate) continue;

        if (txDate.getTime() > latestDate) latestDate = txDate.getTime();

        added.push({
          external_id: tx.id,
          account_external_id: accountExternalId,
          date: tx.created_at.slice(0, 10), // YYYY-MM-DD
          amount: parseFloat(tx.native_amount.amount), // already signed by Coinbase
          currency: tx.native_amount.currency,
          description: tx.details.title ?? tx.type,
          merchant: 'Coinbase',
          type: tx.type,
          notes: tx.details.subtitle ?? undefined,
        });
      }
    }

    const nextCursor = latestDate > 0 ? new Date(latestDate).toISOString() : cursor ?? '';

    return {
      added,
      modified: [],
      removed: [],
      nextCursor,
    };
  }

  async getBalances(): Promise<RawBalance[]> {
    const cbAccounts = await this.client.getAccounts();
    const balances: RawBalance[] = [];

    // Crypto aggregate balance
    const cryptoWallets = cbAccounts.filter((a) => this.isCrypto(a));
    if (cryptoWallets.length > 0) {
      const totalUsd = cryptoWallets.reduce(
        (sum, a) => sum + parseFloat(a.native_balance.amount),
        0,
      );
      balances.push({
        account_external_id: CRYPTO_ACCOUNT_EXTERNAL_ID,
        balance: Math.round(totalUsd * 100) / 100,
        currency: 'USD',
      });
    }

    // Individual fiat balances
    for (const a of cbAccounts) {
      if (this.isFiat(a) && this.hasBalance(a)) {
        balances.push({
          account_external_id: a.id,
          balance: parseFloat(a.balance.amount),
          currency: a.currency.code,
        });
      }
    }

    return balances;
  }
}
