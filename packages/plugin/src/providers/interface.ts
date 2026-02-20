/**
 * DataProvider — the shared interface that any data source must implement.
 * Implementations: CsvDataProvider (v1), PlaidDataProvider (Phase 8), etc.
 */

export interface RawAccount {
  external_id: string;
  name: string;
  institution?: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'crypto' | 'loan' | 'other';
  currency?: string;
  balance?: number;
}

export interface RawTransaction {
  external_id: string;
  account_external_id?: string; // links to RawAccount.external_id
  date: string;                 // YYYY-MM-DD
  amount: number;               // positive = inflow, negative = outflow
  currency?: string;
  description?: string;
  merchant?: string;
  category?: string;
  subcategory?: string;
  type?: string;
  pending?: boolean;
  notes?: string;
}

export interface RawBalance {
  account_external_id: string;
  balance: number;
  currency?: string;
}

export interface DataProvider {
  readonly name: string;

  getAccounts(): Promise<RawAccount[]>;

  getTransactions(cursor?: string): Promise<{
    added: RawTransaction[];
    modified: RawTransaction[];
    removed: string[];     // external_ids to mark deleted
    nextCursor: string;
  }>;

  getBalances(): Promise<RawBalance[]>;
}
