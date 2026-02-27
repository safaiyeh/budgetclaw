// TypeScript row interfaces matching the SQLite schema

export interface AccountRow {
  id: string;
  name: string;
  institution: string | null;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'crypto' | 'loan' | 'other';
  currency: string;
  balance: number | null;
  source: string;
  external_id: string | null;
  connection_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface TransactionRow {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  currency: string;
  description: string | null;
  merchant: string | null;
  category: string | null;
  subcategory: string | null;
  type: string | null;
  source: string;
  external_id: string | null;
  pending: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  parent: string | null;
  is_builtin: number;
  created_at: string;
}

export interface BudgetRow {
  id: string;
  category: string;
  amount: number;
  period: 'monthly' | 'weekly' | 'yearly';
  created_at: string;
  updated_at: string;
}

export interface PortfolioHoldingRow {
  id: string;
  account_id: string;
  symbol: string;
  name: string | null;
  quantity: number;
  price: number | null;
  value: number | null;
  currency: string;
  asset_type: string | null;
  price_source: string | null;
  price_as_of: string | null;
  created_at: string;
  updated_at: string;
}

export interface NetWorthSnapshotRow {
  id: string;
  date: string;
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  breakdown: string | null;
  notes: string | null;
  created_at: string;
}

export interface ProviderConnectionRow {
  id: string;
  provider: string;
  institution_id: string | null;
  institution_name: string | null;
  keychain_key: string;
  item_id: string | null;
  cursor: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Cast a node:sqlite row result to a typed row interface.
 * node:sqlite returns Record<string, SqliteValue> at runtime; this bridges
 * that dynamically-typed boundary to our static TypeScript interfaces.
 */
export function toRow<T>(row: unknown): T {
  return row as T;
}
