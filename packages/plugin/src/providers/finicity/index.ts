/**
 * FinicityDataProvider — DataProvider implementation for Finicity (Mastercard Open Banking).
 *
 * Credential model:
 *   - credential = customerId (string)
 *   - meta.item_id = institutionLoginId (groups accounts from one bank)
 *   - meta.institution_id = institutionId (as string)
 *
 * Transaction sync: date-range based (like Coinbase). Cursor = ISO timestamp.
 * All returned as `added`; dedup via existing `INSERT OR IGNORE`.
 *
 * Holdings: No dedicated endpoint — getHoldings() is not implemented.
 */

import type { DataProvider, RawAccount, RawTransaction, RawBalance } from '../interface.js';
import type { ProviderConnectionMeta } from '../registry.js';
import { FinicityClient, type FinicityAccount } from './client.js';

const DEFAULT_LOOKBACK_DAYS = 180;

export function mapFinicityAccountType(finicityType: string): RawAccount['type'] {
  switch (finicityType) {
    case 'checking':
      return 'checking';
    case 'savings':
    case 'moneyMarket':
    case 'cd':
      return 'savings';
    case 'creditCard':
    case 'lineOfCredit':
      return 'credit';
    case 'investment':
    case 'brokerageAccount':
    case '401k':
    case 'ira':
    case 'roth':
    case '403b':
      return 'investment';
    case 'mortgage':
    case 'loan':
    case 'studentLoan':
    case 'autoLoan':
      return 'loan';
    default:
      return 'other';
  }
}

function epochToDate(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

export class FinicityDataProvider implements DataProvider {
  readonly name = 'finicity';
  private readonly client: FinicityClient;
  private readonly customerId: string;
  private readonly institutionLoginId: string | null;

  constructor(credential: string, meta: ProviderConnectionMeta) {
    this.customerId = credential;
    this.institutionLoginId = meta.item_id;
    this.client = new FinicityClient();
  }

  private filterByLogin(accounts: FinicityAccount[]): FinicityAccount[] {
    if (!this.institutionLoginId) return accounts;
    const loginId = Number(this.institutionLoginId);
    return accounts.filter((a) => a.institutionLoginId === loginId);
  }

  async getAccounts(): Promise<RawAccount[]> {
    const allAccounts = await this.client.getCustomerAccounts(this.customerId);
    const accounts = this.filterByLogin(allAccounts);

    return accounts.map((a) => ({
      external_id: String(a.id),
      name: a.name,
      type: mapFinicityAccountType(a.type),
      balance: a.balance,
      currency: a.currency ?? 'USD',
    }));
  }

  async getTransactions(cursor?: string): Promise<{
    added: RawTransaction[];
    modified: RawTransaction[];
    removed: string[];
    nextCursor: string;
  }> {
    const now = Math.floor(Date.now() / 1000);
    let fromDate: number;

    if (cursor) {
      // cursor is an ISO timestamp — convert to epoch seconds
      fromDate = Math.floor(new Date(cursor).getTime() / 1000);
    } else {
      fromDate = now - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60;
    }

    const allTxns = await this.client.getCustomerTransactions(
      this.customerId,
      fromDate,
      now,
    );

    // Filter transactions to only those belonging to accounts in this login
    const allAccounts = await this.client.getCustomerAccounts(this.customerId);
    const loginAccounts = this.filterByLogin(allAccounts);
    const loginAccountIds = new Set(loginAccounts.map((a) => String(a.id)));

    const added: RawTransaction[] = [];
    let latestEpoch = 0;

    for (const tx of allTxns) {
      if (!loginAccountIds.has(String(tx.accountId))) continue;

      const txEpoch = tx.transactionDate ?? tx.postedDate;
      if (txEpoch > latestEpoch) latestEpoch = txEpoch;

      // Finicity: positive amounts = money out (debits), negative = money in (credits)
      // BudgetClaw: positive = inflow, negative = outflow — so invert
      const amount = -tx.amount;

      added.push({
        external_id: String(tx.id),
        account_external_id: String(tx.accountId),
        date: epochToDate(txEpoch),
        amount,
        currency: 'USD',
        description: tx.description,
        merchant: tx.categorization?.normalizedPayeeName ?? undefined,
        category: tx.categorization?.category ?? undefined,
        type: tx.type,
        pending: tx.status === 'pending',
      });
    }

    const nextCursor = latestEpoch > 0
      ? new Date(latestEpoch * 1000).toISOString()
      : cursor ?? new Date(fromDate * 1000).toISOString();

    return {
      added,
      modified: [],
      removed: [],
      nextCursor,
    };
  }

  async getBalances(): Promise<RawBalance[]> {
    const allAccounts = await this.client.getCustomerAccounts(this.customerId);
    const accounts = this.filterByLogin(allAccounts);

    return accounts.map((a) => ({
      account_external_id: String(a.id),
      balance: a.balance,
      currency: a.currency ?? 'USD',
    }));
  }

  async disconnect(): Promise<void> {
    if (this.institutionLoginId) {
      await this.client.deleteInstitutionLogin(this.customerId, this.institutionLoginId);
    }
  }
}
