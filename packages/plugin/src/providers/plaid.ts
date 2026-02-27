import type { AccountType, AccountSubtype, Transaction, RemovedTransaction, Holding, Security } from 'plaid';
import type { DataProvider, RawAccount, RawTransaction, RawBalance, RawHolding } from './interface.js';
import type { ProviderConnectionMeta } from './registry.js';
import { getPlaidClient } from './plaid-client.js';

export class PlaidDataProvider implements DataProvider {
  readonly name = 'plaid';

  constructor(
    private readonly accessToken: string,
    private readonly _meta: ProviderConnectionMeta,
  ) {}

  private mapSecurityType(type: string | null): string {
    switch (type) {
      case 'equity':         return 'stock';
      case 'etf':            return 'etf';
      case 'cryptocurrency': return 'crypto';
      case 'fixed income':   return 'bond';
      case 'mutual fund':    return 'etf';   // pooled fund; Yahoo Finance can price most by ticker
      default:               return 'other';
    }
  }

  private mapAccountType(
    type: AccountType | undefined,
    subtype: AccountSubtype | null | undefined,
  ): RawAccount['type'] {
    if (type === 'depository') {
      if (subtype === 'checking') return 'checking';
      if (subtype === 'savings') return 'savings';
      return 'checking';
    }
    if (type === 'credit') return 'credit';
    if (type === 'investment' || type === 'brokerage') return 'investment';
    if (type === 'loan') return 'loan';
    return 'other';
  }

  async getAccounts(): Promise<RawAccount[]> {
    const client = getPlaidClient();
    const response = await client.accountsGet({ access_token: this.accessToken });

    return response.data.accounts.map((a) => ({
      external_id: a.account_id,
      name: a.name,
      type: this.mapAccountType(a.type, a.subtype),
      balance: a.balances.current ?? undefined,
      currency: a.balances.iso_currency_code ?? 'USD',
    }));
  }

  async getTransactions(cursor?: string): Promise<{
    added: RawTransaction[];
    modified: RawTransaction[];
    removed: string[];
    nextCursor: string;
  }> {
    const client = getPlaidClient();

    const allAdded: RawTransaction[] = [];
    const allModified: RawTransaction[] = [];
    const allRemoved: string[] = [];
    let nextCursor = cursor ?? '';
    let hasMore = true;

    while (hasMore) {
      const response = await client.transactionsSync({
        access_token: this.accessToken,
        cursor: nextCursor || undefined,
        count: 500,
      });

      const data = response.data;

      for (const t of data.added as Transaction[]) {
        allAdded.push({
          external_id: t.transaction_id,
          account_external_id: t.account_id,
          date: t.date,
          amount: -t.amount,
          description: t.name,
          merchant: t.merchant_name ?? undefined,
          pending: t.pending,
          currency: t.iso_currency_code ?? 'USD',
        });
      }

      for (const t of data.modified as Transaction[]) {
        allModified.push({
          external_id: t.transaction_id,
          account_external_id: t.account_id,
          date: t.date,
          amount: -t.amount,
          description: t.name,
          merchant: t.merchant_name ?? undefined,
          pending: t.pending,
          currency: t.iso_currency_code ?? 'USD',
        });
      }

      for (const r of data.removed as RemovedTransaction[]) {
        if (r.transaction_id) allRemoved.push(r.transaction_id);
      }

      nextCursor = data.next_cursor;
      hasMore = data.has_more;
    }

    return { added: allAdded, modified: allModified, removed: allRemoved, nextCursor };
  }

  async getBalances(): Promise<RawBalance[]> {
    const client = getPlaidClient();
    // Use accountsGet (included with transactions) instead of accountsBalanceGet
    // (which requires the separate balance product)
    const response = await client.accountsGet({ access_token: this.accessToken });

    return response.data.accounts.map((a) => ({
      account_external_id: a.account_id,
      balance: a.balances.current ?? 0,
      currency: a.balances.iso_currency_code ?? 'USD',
    }));
  }

  async getHoldings(): Promise<RawHolding[]> {
    try {
      const client = getPlaidClient();
      const response = await client.investmentsHoldingsGet({ access_token: this.accessToken });
      const { holdings, securities } = response.data;

      const securityMap = new Map<string, Security>();
      for (const sec of securities) securityMap.set(sec.security_id, sec);

      const result: RawHolding[] = [];
      for (const holding of holdings as Holding[]) {
        const sec = securityMap.get(holding.security_id);
        const symbol = sec?.ticker_symbol ?? holding.security_id;
        if (!symbol) continue;

        result.push({
          account_external_id: holding.account_id,
          symbol,
          name: sec?.name ?? undefined,
          quantity: holding.quantity,
          price: holding.institution_price ?? undefined,
          price_as_of: holding.institution_price_as_of ?? undefined,
          value: holding.institution_value ?? undefined,
          currency: holding.iso_currency_code ?? holding.unofficial_currency_code ?? 'USD',
          asset_type: this.mapSecurityType(sec?.type ?? null),
        });
      }
      return result;
    } catch (e: unknown) {
      // Gracefully handle items linked before investments product was added
      const errCode = (e as { response?: { data?: { error_code?: string } } })
        ?.response?.data?.error_code;
      if (errCode === 'INVALID_PRODUCT' || errCode === 'PRODUCTS_NOT_SUPPORTED' || errCode === 'NO_INVESTMENT_ACCOUNTS') return [];
      throw e;
    }
  }
}
