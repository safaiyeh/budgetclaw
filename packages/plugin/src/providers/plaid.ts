import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import type { AccountType, AccountSubtype, Transaction, RemovedTransaction } from 'plaid';
import type { DataProvider, RawAccount, RawTransaction, RawBalance } from './interface.js';
import type { ProviderConnectionMeta } from './registry.js';

export class PlaidDataProvider implements DataProvider {
  readonly name = 'plaid';

  constructor(
    private readonly accessToken: string,
    private readonly _meta: ProviderConnectionMeta,
  ) {}

  private getClient(): PlaidApi {
    const clientId = process.env['PLAID_CLIENT_ID'];
    const secret = process.env['PLAID_SECRET'];
    const envName = (process.env['PLAID_ENV'] ?? 'sandbox') as keyof typeof PlaidEnvironments;

    if (!clientId) throw new Error('Missing env var: PLAID_CLIENT_ID');
    if (!secret) throw new Error('Missing env var: PLAID_SECRET');

    const baseURL = PlaidEnvironments[envName];
    if (!baseURL) {
      throw new Error(
        `Invalid PLAID_ENV "${envName}". Valid values: ${Object.keys(PlaidEnvironments).join(', ')}`,
      );
    }

    const config = new Configuration({
      basePath: baseURL,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
        },
      },
    });

    return new PlaidApi(config);
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
    const client = this.getClient();
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
    const client = this.getClient();

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
    const client = this.getClient();
    const response = await client.accountsBalanceGet({ access_token: this.accessToken });

    return response.data.accounts.map((a) => ({
      account_external_id: a.account_id,
      balance: a.balances.current ?? 0,
      currency: a.balances.iso_currency_code ?? 'USD',
    }));
  }
}
