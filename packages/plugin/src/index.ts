/**
 * @budgetclaw/budgetclaw — OpenClaw plugin entry point.
 *
 * Call `register(api)` to wire up all BudgetClaw agent tools.
 * The plugin opens (or creates) the SQLite database at ~/.budgetclaw/budget.db
 * and runs any pending migrations automatically.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { getDb } from './db/index.js';

// Tool handlers
import { addAccount, getAccounts, updateAccountBalance, deleteAccount } from './tools/accounts/index.js';
import {
  addTransaction,
  getTransactions,
  updateTransaction,
  deleteTransaction,
  getSpendingSummary,
} from './tools/transactions/index.js';
import { setBudget, getBudgets, deleteBudget } from './tools/budgets/index.js';
import { upsertHolding, deleteHolding, getPortfolio, refreshPrices } from './tools/portfolio/index.js';
import { snapshotNetWorth, getNetWorthHistory } from './tools/net-worth/index.js';
import { getCategories, addCategory, deleteCategory } from './tools/categories/index.js';
import { importCsv, exportCsv } from './tools/import-export/index.js';
import { readStatement, importTransactions } from './tools/import-export/statements.js';
import { listConnections, syncConnection } from './tools/connections/index.js';
import { defaultRegistry } from './providers/registry.js';
import { PlaidDataProvider } from './providers/plaid/index.js';
import { CoinbaseDataProvider } from './providers/coinbase/index.js';
import { startPlaidLink, completePlaidLink } from './tools/connections/plaid-link.js';
import { linkCoinbase } from './tools/connections/coinbase-link.js';

// ─── Local helpers ────────────────────────────────────────────────────────────

interface ToolContent {
  type: 'text';
  text: string;
}

interface ToolResult {
  content: ToolContent[];
  details: unknown;      // required — matches AgentToolResult<unknown> from openclaw internals
  isError?: true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function err(e: unknown): ToolResult & { isError: true } {
  const message = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    details: null,
    isError: true,
  };
}

// JSON Schema object — plain objects work at runtime; OpenClaw uses TypeBox internally
// but accepts any object that satisfies the shape.
type JsonSchema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };

/**
 * Wraps a tool handler with error handling and result serialisation.
 * Returns an AnyAgentTool compatible with OpenClawPluginApi.registerTool().
 */
function tool(def: {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (params: unknown) => Promise<unknown> | unknown;
}) {
  // Derive display label from tool name: "budgetclaw_add_account" → "Add Account"
  const label = def.name
    .replace(/^budgetclaw_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    ...def,
    label,
    execute: async (_toolCallId: string, params: unknown) => {
      try {
        return ok(await def.execute(params));
      } catch (e) {
        return err(e);
      }
    },
  };
}

// ─── Register function ────────────────────────────────────────────────────────

export function register(api: OpenClawPluginApi, dbPath?: string): void {
  const db = getDb(dbPath);

  // Register providers with the registry
  defaultRegistry.register('plaid', (credential, meta) => new PlaidDataProvider(credential, meta));
  defaultRegistry.register('coinbase', (credential) => new CoinbaseDataProvider(credential));

  // ── Accounts ──────────────────────────────────────────────────────────────

  api.registerTool(tool({
    name: 'budgetclaw_add_account',
    description: 'Add a new financial account (checking, savings, credit, investment, crypto, loan, or other)',
    parameters: {
      type: 'object',
      properties: {
        name:        { type: 'string',  description: 'Account name (e.g. "Chase Checking")' },
        type:        { type: 'string',  enum: ['checking','savings','credit','investment','crypto','loan','other'], description: 'Account type' },
        institution: { type: 'string',  description: 'Bank or institution name' },
        balance:     { type: 'number',  description: 'Current balance (optional, can be set later)' },
        currency:    { type: 'string',  description: 'Currency code (default: USD)' },
      },
      required: ['name', 'type'],
    },
    execute: (p) => addAccount(db, p as Parameters<typeof addAccount>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_get_accounts',
    description: 'List all active financial accounts with their current balances',
    parameters: { type: 'object', properties: {} },
    execute: () => getAccounts(db),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_update_account_balance',
    description: 'Update the balance of an account manually',
    parameters: {
      type: 'object',
      properties: {
        id:      { type: 'string', description: 'Account ID' },
        balance: { type: 'number', description: 'New balance' },
      },
      required: ['id', 'balance'],
    },
    execute: (p) => updateAccountBalance(db, p as Parameters<typeof updateAccountBalance>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_delete_account',
    description: 'DESTRUCTIVE: Delete an account and all its data (transactions, holdings). For connected accounts, also disconnects the provider, deletes all sibling accounts from the same connection, and cleans up credentials. IMPORTANT: You MUST ask the user to confirm before calling this tool. Tell them exactly what will be deleted and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Account ID to delete' },
      },
      required: ['id'],
    },
    execute: (p) => deleteAccount(db, p as { id: string }, defaultRegistry),
  }));

  // ── Transactions ──────────────────────────────────────────────────────────

  api.registerTool(tool({
    name: 'budgetclaw_add_transaction',
    description: 'Add a transaction manually. Amount is positive for inflows (income) and negative for outflows (expenses).',
    parameters: {
      type: 'object',
      properties: {
        account_id:  { type: 'string',  description: 'Account ID to add transaction to' },
        date:        { type: 'string',  description: 'Transaction date (YYYY-MM-DD)' },
        amount:      { type: 'number',  description: 'Amount — positive = inflow/income, negative = outflow/expense' },
        description: { type: 'string',  description: 'Transaction description' },
        merchant:    { type: 'string',  description: 'Merchant name' },
        category:    { type: 'string',  description: 'Category (e.g. "Food & Dining", "Transport")' },
        subcategory: { type: 'string',  description: 'Subcategory (e.g. "Groceries", "Rideshare")' },
        type:        { type: 'string',  enum: ['debit','credit','transfer'], description: 'Transaction type' },
        pending:     { type: 'boolean', description: 'Whether transaction is pending' },
        notes:       { type: 'string',  description: 'Additional notes' },
      },
      required: ['account_id', 'date', 'amount'],
    },
    execute: (p) => addTransaction(db, p as Parameters<typeof addTransaction>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_get_transactions',
    description: 'Query transactions with optional filters',
    parameters: {
      type: 'object',
      properties: {
        account_id: { type: 'string',  description: 'Filter by account ID' },
        category:   { type: 'string',  description: 'Filter by category' },
        from_date:  { type: 'string',  description: 'Start date (YYYY-MM-DD)' },
        to_date:    { type: 'string',  description: 'End date (YYYY-MM-DD)' },
        search:     { type: 'string',  description: 'Search description, merchant, or notes' },
        limit:      { type: 'integer', description: 'Max results (default 100)' },
        offset:     { type: 'integer', description: 'Pagination offset' },
      },
    },
    execute: (p) => getTransactions(db, p as Parameters<typeof getTransactions>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_update_transaction',
    description: "Update a transaction's description, category, merchant, notes, date, or amount",
    parameters: {
      type: 'object',
      properties: {
        id:          { type: 'string', description: 'Transaction ID' },
        description: { type: 'string', description: 'New description' },
        merchant:    { type: 'string', description: 'New merchant name' },
        category:    { type: 'string', description: 'New category' },
        subcategory: { type: 'string', description: 'New subcategory' },
        notes:       { type: 'string', description: 'New notes' },
        date:        { type: 'string', description: 'New date (YYYY-MM-DD)' },
        amount:      { type: 'number', description: 'New amount' },
      },
      required: ['id'],
    },
    execute: (p) => updateTransaction(db, p as Parameters<typeof updateTransaction>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_delete_transaction',
    description: 'Delete a transaction by ID',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Transaction ID' } },
      required: ['id'],
    },
    execute: (p) => deleteTransaction(db, (p as {id:string}).id),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_get_spending_summary',
    description: 'Get spending totals grouped by category for a date range',
    parameters: {
      type: 'object',
      properties: {
        from_date:  { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        to_date:    { type: 'string', description: 'End date (YYYY-MM-DD)' },
        account_id: { type: 'string', description: 'Filter by account ID (optional)' },
      },
      required: ['from_date', 'to_date'],
    },
    execute: (p) => getSpendingSummary(db, p as Parameters<typeof getSpendingSummary>[1]),
  }));

  // ── Budgets ───────────────────────────────────────────────────────────────

  api.registerTool(tool({
    name: 'budgetclaw_set_budget',
    description: 'Set or update a spending budget for a category',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Category name' },
        amount:   { type: 'number', description: 'Budget amount' },
        period:   { type: 'string', enum: ['monthly','weekly','yearly'], description: 'Budget period (default: monthly)' },
      },
      required: ['category', 'amount'],
    },
    execute: (p) => setBudget(db, p as Parameters<typeof setBudget>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_get_budgets',
    description: 'List all budgets with actual spending vs. budgeted amounts for the current period',
    parameters: { type: 'object', properties: {} },
    execute: () => getBudgets(db),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_delete_budget',
    description: 'Delete a budget by ID',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Budget ID' } },
      required: ['id'],
    },
    execute: (p) => deleteBudget(db, (p as {id:string}).id),
  }));

  // ── Portfolio ─────────────────────────────────────────────────────────────

  api.registerTool(tool({
    name: 'budgetclaw_upsert_holding',
    description: 'Add or update a portfolio holding (stock, ETF, crypto, etc.)',
    parameters: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Investment account ID' },
        symbol:     { type: 'string', description: 'Ticker symbol (e.g. AAPL, BTC)' },
        name:       { type: 'string', description: 'Security name (optional)' },
        quantity:   { type: 'number', description: 'Number of shares/units' },
        price:      { type: 'number', description: 'Current price per unit (optional)' },
        asset_type: { type: 'string', enum: ['stock','etf','crypto','bond','other'], description: 'Asset type' },
      },
      required: ['account_id', 'symbol', 'quantity'],
    },
    execute: (p) => upsertHolding(db, p as Parameters<typeof upsertHolding>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_delete_holding',
    description: 'Remove a portfolio holding by ID',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Holding ID' } },
      required: ['id'],
    },
    execute: (p) => deleteHolding(db, (p as {id:string}).id),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_get_portfolio',
    description: 'Get all portfolio holdings with latest prices and total value',
    parameters: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Filter by account ID (optional)' },
      },
    },
    execute: (p) => getPortfolio(db, p as Parameters<typeof getPortfolio>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_refresh_prices',
    description: 'Fetch latest market prices for all portfolio holdings (uses Yahoo Finance for stocks/ETFs, CoinGecko for crypto)',
    parameters: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Refresh only holdings in this account (optional)' },
      },
    },
    execute: (p) => refreshPrices(db, (p as {account_id?:string}).account_id),
  }));

  // ── Net Worth ─────────────────────────────────────────────────────────────

  api.registerTool(tool({
    name: 'budgetclaw_snapshot_net_worth',
    description: 'Calculate current net worth from all account balances and portfolio values, and save a snapshot',
    parameters: {
      type: 'object',
      properties: {
        notes: { type: 'string', description: 'Optional notes for this snapshot' },
      },
    },
    execute: (p) => snapshotNetWorth(db, p as Parameters<typeof snapshotNetWorth>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_get_net_worth_history',
    description: 'Get net worth history over time',
    parameters: {
      type: 'object',
      properties: {
        from_date: { type: 'string',  description: 'Start date (YYYY-MM-DD)' },
        to_date:   { type: 'string',  description: 'End date (YYYY-MM-DD)' },
        limit:     { type: 'integer', description: 'Max snapshots to return (default 90)' },
      },
    },
    execute: (p) => getNetWorthHistory(db, p as Parameters<typeof getNetWorthHistory>[1]),
  }));

  // ── Categories ────────────────────────────────────────────────────────────

  api.registerTool(tool({
    name: 'budgetclaw_get_categories',
    description: 'List all categories (built-in and user-defined)',
    parameters: { type: 'object', properties: {} },
    execute: () => getCategories(db),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_add_category',
    description: 'Add a user-defined category',
    parameters: {
      type: 'object',
      properties: {
        name:   { type: 'string', description: 'Category name' },
        parent: { type: 'string', description: 'Parent category name (optional — for subcategories)' },
      },
      required: ['name'],
    },
    execute: (p) => addCategory(db, p as Parameters<typeof addCategory>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_delete_category',
    description: 'Delete a user-defined category (built-in categories cannot be deleted)',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Category ID' } },
      required: ['id'],
    },
    execute: (p) => deleteCategory(db, (p as {id:string}).id),
  }));

  // ── Import / Export ───────────────────────────────────────────────────────

  api.registerTool(tool({
    name: 'budgetclaw_import_csv',
    description: 'Import transactions from a CSV file. Automatically deduplicates using external_id.',
    parameters: {
      type: 'object',
      properties: {
        file_path:      { type: 'string',  description: 'Absolute path to the CSV file' },
        account_id:     { type: 'string',  description: 'Account ID to import transactions into' },
        date_format:    { type: 'string',  description: 'Date format hint: YYYY-MM-DD | MM/DD/YYYY | DD/MM/YYYY' },
        invert_amounts: { type: 'boolean', description: 'Invert amount signs (use when positive = expense in your CSV)' },
        mapping: {
          type: 'object',
          description: 'Custom column name mappings',
          properties: {
            date:        { type: 'string' },
            amount:      { type: 'string' },
            description: { type: 'string' },
            merchant:    { type: 'string' },
            category:    { type: 'string' },
            subcategory: { type: 'string' },
            type:        { type: 'string' },
            notes:       { type: 'string' },
            external_id: { type: 'string' },
          },
        },
      },
      required: ['file_path', 'account_id'],
    },
    execute: (p) => importCsv(db, p as Parameters<typeof importCsv>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_export_csv',
    description: 'Export transactions to a CSV file',
    parameters: {
      type: 'object',
      properties: {
        file_path:  { type: 'string', description: 'Output file path' },
        account_id: { type: 'string', description: 'Filter by account ID (optional)' },
        from_date:  { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        to_date:    { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['file_path'],
    },
    execute: (p) => exportCsv(db, p as Parameters<typeof exportCsv>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_read_statement',
    description: 'Extract text content from a bank statement file (PDF or plain text). Returns the full text from ALL pages so you can identify and extract transactions. Always call this before trying to parse a statement — PDF previews are truncated.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the statement file (PDF or plain text). Supports ~/.' },
      },
      required: ['file_path'],
    },
    execute: (p) => readStatement(p as Parameters<typeof readStatement>[0]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_import_transactions',
    description: 'Bulk import a list of pre-parsed transactions into an account in one call. Use this after reading a statement to store all identified transactions at once.',
    parameters: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Account ID to import transactions into' },
        transactions: {
          type: 'array',
          description: 'List of transactions to import',
          items: {
            type: 'object',
            properties: {
              date:        { type: 'string',  description: 'Transaction date (YYYY-MM-DD)' },
              amount:      { type: 'number',  description: 'Amount — negative = expense, positive = income' },
              description: { type: 'string',  description: 'Transaction description' },
              merchant:    { type: 'string',  description: 'Merchant name' },
              category:    { type: 'string',  description: 'Category' },
              subcategory: { type: 'string',  description: 'Subcategory' },
              type:        { type: 'string',  description: 'Transaction type (debit|credit|transfer)' },
              pending:     { type: 'boolean', description: 'Whether transaction is pending' },
              notes:       { type: 'string',  description: 'Additional notes' },
              external_id: { type: 'string',  description: 'Unique ID for deduplication on re-import' },
            },
            required: ['date', 'amount'],
          },
        },
      },
      required: ['account_id', 'transactions'],
    },
    execute: (p) => importTransactions(db, p as Parameters<typeof importTransactions>[1]),
  }));

  // ── Connections ───────────────────────────────────────────────────────────

  api.registerTool(tool({
    name: 'budgetclaw_list_connections',
    description: 'List all provider connections (e.g. Plaid-linked institutions)',
    parameters: { type: 'object', properties: {} },
    execute: () => listConnections(db),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_sync_connection',
    description: 'Sync transactions and balances from a connected provider (e.g. Plaid). Upserts accounts, applies added/modified/removed transactions, updates balances, and advances the cursor.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Connection ID to sync' },
      },
      required: ['id'],
    },
    execute: (p) => syncConnection(db, (p as {id:string}).id, defaultRegistry),
  }));

  // ── Plaid ─────────────────────────────────────────────────────────────────

  api.registerTool(tool({
    name: 'budgetclaw_plaid_link',
    description: 'Create a Plaid Hosted Link URL for connecting a bank account. Returns the URL immediately — send it to the user so they can open it. Then call budgetclaw_plaid_link_complete with the link_token to wait for them to finish. Requires PLAID_CLIENT_ID and PLAID_SECRET env vars.',
    parameters: {
      type: 'object',
      properties: {
        institution_name: { type: 'string', description: 'Optional name hint (e.g. "Chase")' },
      },
    },
    execute: (p) => startPlaidLink(db, p as Parameters<typeof startPlaidLink>[1]),
  }));

  api.registerTool(tool({
    name: 'budgetclaw_plaid_link_complete',
    description: 'Finish connecting a bank after the user completes Plaid Link. Only call this after the user confirms they finished linking. Checks Plaid for completion, detects duplicates, then automatically syncs accounts, transactions, and holdings. Returns {status:"complete"} with sync results, {status:"duplicate"} if the bank is already connected, or {status:"waiting"} if not yet finished.',
    parameters: {
      type: 'object',
      properties: {
        link_token: { type: 'string', description: 'The link_token returned by budgetclaw_plaid_link' },
        institution_name: { type: 'string', description: 'Optional institution name' },
      },
      required: ['link_token'],
    },
    execute: (p) => completePlaidLink(db, defaultRegistry, p as { link_token: string; institution_name?: string }),
  }));

  // ── Coinbase ───────────────────────────────────────────────────────────

  api.registerTool(tool({
    name: 'budgetclaw_coinbase_link',
    description: 'Connect a Coinbase account using API key authentication. Create a read-only API key at coinbase.com/settings/api and provide the key and secret. Validates credentials, then automatically syncs crypto wallets, fiat balances, and transaction history.',
    parameters: {
      type: 'object',
      properties: {
        api_key:    { type: 'string', description: 'Coinbase API key' },
        api_secret: { type: 'string', description: 'Coinbase API secret' },
      },
      required: ['api_key', 'api_secret'],
    },
    execute: (p) => linkCoinbase(db, defaultRegistry, p as { api_key: string; api_secret: string }),
  }));
}

export default { register };

// Re-export public types and interfaces for consumers
export { getDb, resetDb } from './db/index.js';
export type { AccountRow, TransactionRow, BudgetRow, PortfolioHoldingRow, NetWorthSnapshotRow } from './db/types.js';
export type { DataProvider, RawAccount, RawTransaction, RawBalance } from './providers/interface.js';
export type { PriceProvider, PriceResult, AssetType } from './prices/interface.js';
export { CsvDataProvider } from './providers/csv/index.js';
export { CoinbaseDataProvider } from './providers/coinbase/index.js';
export { defaultRegistry, ProviderRegistry } from './providers/registry.js';
export type { ProviderFactory, ProviderConnectionMeta } from './providers/registry.js';
export { priceRegistry } from './prices/registry.js';
