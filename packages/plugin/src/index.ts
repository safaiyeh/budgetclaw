/**
 * @budgetclaw/plugin — OpenClaw plugin entry point.
 *
 * Call `register(api)` to wire up all BudgetClaw agent tools.
 * The plugin opens (or creates) the SQLite database at ~/.budgetclaw/budget.db
 * and runs any pending migrations automatically.
 */

import { getDb } from './db/index.js';

// Tool handlers
import { addAccount, getAccounts, updateAccountBalance } from './tools/accounts.js';
import {
  addTransaction,
  getTransactions,
  updateTransaction,
  deleteTransaction,
  getSpendingSummary,
} from './tools/transactions.js';
import { setBudget, getBudgets, deleteBudget } from './tools/budgets.js';
import { upsertHolding, deleteHolding, getPortfolio, refreshPrices } from './tools/portfolio.js';
import { snapshotNetWorth, getNetWorthHistory } from './tools/net-worth.js';
import { getCategories, addCategory, deleteCategory } from './tools/categories.js';
import { importCsv, exportCsv } from './tools/import-export.js';
import { listConnections, removeConnection } from './tools/connections.js';

// ─── OpenClaw plugin API interface ───────────────────────────────────────────
// The actual types come from @openclaw/sdk — typed loosely here so the plugin
// compiles without requiring the SDK as a hard dep.

type ToolHandler = (input: unknown) => Promise<unknown> | unknown;

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: ToolHandler;
}

interface PluginApi {
  registerTool(tool: ToolDefinition): void;
}

// ─── Register function ────────────────────────────────────────────────────────

export function register(api: PluginApi, dbPath?: string): void {
  const db = getDb(dbPath);

  // ── Accounts ──────────────────────────────────────────────────────────────

  api.registerTool({
    name: 'budgetclaw_add_account',
    description: 'Add a new financial account (checking, savings, credit, investment, crypto, loan, or other)',
    inputSchema: {
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
    handler: (input) => addAccount(db, input as Parameters<typeof addAccount>[1]),
  });

  api.registerTool({
    name: 'budgetclaw_get_accounts',
    description: 'List all active financial accounts with their current balances',
    inputSchema: { type: 'object', properties: {} },
    handler: () => getAccounts(db),
  });

  api.registerTool({
    name: 'budgetclaw_update_account_balance',
    description: 'Update the balance of an account manually',
    inputSchema: {
      type: 'object',
      properties: {
        id:      { type: 'string', description: 'Account ID' },
        balance: { type: 'number', description: 'New balance' },
      },
      required: ['id', 'balance'],
    },
    handler: (input) => updateAccountBalance(db, input as Parameters<typeof updateAccountBalance>[1]),
  });

  // ── Transactions ──────────────────────────────────────────────────────────

  api.registerTool({
    name: 'budgetclaw_add_transaction',
    description: 'Add a transaction manually. Amount is positive for inflows (income) and negative for outflows (expenses).',
    inputSchema: {
      type: 'object',
      properties: {
        account_id:   { type: 'string', description: 'Account ID to add transaction to' },
        date:         { type: 'string', description: 'Transaction date (YYYY-MM-DD)' },
        amount:       { type: 'number', description: 'Amount — positive = inflow/income, negative = outflow/expense' },
        description:  { type: 'string', description: 'Transaction description' },
        merchant:     { type: 'string', description: 'Merchant name' },
        category:     { type: 'string', description: 'Category (e.g. "Food & Dining", "Transport")' },
        subcategory:  { type: 'string', description: 'Subcategory (e.g. "Groceries", "Rideshare")' },
        type:         { type: 'string', enum: ['debit','credit','transfer'], description: 'Transaction type' },
        pending:      { type: 'boolean', description: 'Whether transaction is pending' },
        notes:        { type: 'string', description: 'Additional notes' },
      },
      required: ['account_id', 'date', 'amount'],
    },
    handler: (input) => addTransaction(db, input as Parameters<typeof addTransaction>[1]),
  });

  api.registerTool({
    name: 'budgetclaw_get_transactions',
    description: 'Query transactions with optional filters',
    inputSchema: {
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
    handler: (input) => getTransactions(db, input as Parameters<typeof getTransactions>[1]),
  });

  api.registerTool({
    name: 'budgetclaw_update_transaction',
    description: 'Update a transaction\'s description, category, merchant, notes, date, or amount',
    inputSchema: {
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
    handler: (input) => updateTransaction(db, input as Parameters<typeof updateTransaction>[1]),
  });

  api.registerTool({
    name: 'budgetclaw_delete_transaction',
    description: 'Delete a transaction by ID',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Transaction ID' } },
      required: ['id'],
    },
    handler: (input) => deleteTransaction(db, (input as { id: string }).id),
  });

  api.registerTool({
    name: 'budgetclaw_get_spending_summary',
    description: 'Get spending totals grouped by category for a date range',
    inputSchema: {
      type: 'object',
      properties: {
        from_date:  { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        to_date:    { type: 'string', description: 'End date (YYYY-MM-DD)' },
        account_id: { type: 'string', description: 'Filter by account ID (optional)' },
      },
      required: ['from_date', 'to_date'],
    },
    handler: (input) => getSpendingSummary(db, input as Parameters<typeof getSpendingSummary>[1]),
  });

  // ── Budgets ───────────────────────────────────────────────────────────────

  api.registerTool({
    name: 'budgetclaw_set_budget',
    description: 'Set or update a spending budget for a category',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Category name (must match a category)' },
        amount:   { type: 'number', description: 'Budget amount' },
        period:   { type: 'string', enum: ['monthly','weekly','yearly'], description: 'Budget period (default: monthly)' },
      },
      required: ['category', 'amount'],
    },
    handler: (input) => setBudget(db, input as Parameters<typeof setBudget>[1]),
  });

  api.registerTool({
    name: 'budgetclaw_get_budgets',
    description: 'List all budgets with actual spending vs. budgeted amounts for the current period',
    inputSchema: { type: 'object', properties: {} },
    handler: () => getBudgets(db),
  });

  api.registerTool({
    name: 'budgetclaw_delete_budget',
    description: 'Delete a budget by ID',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Budget ID' } },
      required: ['id'],
    },
    handler: (input) => deleteBudget(db, (input as { id: string }).id),
  });

  // ── Portfolio ─────────────────────────────────────────────────────────────

  api.registerTool({
    name: 'budgetclaw_upsert_holding',
    description: 'Add or update a portfolio holding (stock, ETF, crypto, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Investment account ID' },
        symbol:     { type: 'string', description: 'Ticker symbol (e.g. AAPL, BTC)' },
        name:       { type: 'string', description: 'Security name (optional)' },
        quantity:   { type: 'number', description: 'Number of shares/units' },
        price:      { type: 'number', description: 'Current price per unit (optional — will be fetched if omitted)' },
        asset_type: { type: 'string', enum: ['stock','etf','crypto','bond','other'], description: 'Asset type' },
      },
      required: ['account_id', 'symbol', 'quantity'],
    },
    handler: (input) => upsertHolding(db, input as Parameters<typeof upsertHolding>[1]),
  });

  api.registerTool({
    name: 'budgetclaw_delete_holding',
    description: 'Remove a portfolio holding by ID',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Holding ID' } },
      required: ['id'],
    },
    handler: (input) => deleteHolding(db, (input as { id: string }).id),
  });

  api.registerTool({
    name: 'budgetclaw_get_portfolio',
    description: 'Get all portfolio holdings with latest prices and total value',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Filter by account ID (optional)' },
      },
    },
    handler: (input) => getPortfolio(db, input as Parameters<typeof getPortfolio>[1]),
  });

  api.registerTool({
    name: 'budgetclaw_refresh_prices',
    description: 'Fetch latest market prices for all portfolio holdings (uses Yahoo Finance for stocks/ETFs, CoinGecko for crypto)',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Refresh only holdings in this account (optional)' },
      },
    },
    handler: (input) => refreshPrices(db, (input as { account_id?: string }).account_id),
  });

  // ── Net Worth ─────────────────────────────────────────────────────────────

  api.registerTool({
    name: 'budgetclaw_snapshot_net_worth',
    description: 'Calculate current net worth from all account balances and portfolio values, and save a snapshot',
    inputSchema: {
      type: 'object',
      properties: {
        notes: { type: 'string', description: 'Optional notes for this snapshot' },
      },
    },
    handler: (input) => snapshotNetWorth(db, input as Parameters<typeof snapshotNetWorth>[1]),
  });

  api.registerTool({
    name: 'budgetclaw_get_net_worth_history',
    description: 'Get net worth history over time',
    inputSchema: {
      type: 'object',
      properties: {
        from_date: { type: 'string',  description: 'Start date (YYYY-MM-DD)' },
        to_date:   { type: 'string',  description: 'End date (YYYY-MM-DD)' },
        limit:     { type: 'integer', description: 'Max snapshots to return (default 90)' },
      },
    },
    handler: (input) => getNetWorthHistory(db, input as Parameters<typeof getNetWorthHistory>[1]),
  });

  // ── Categories ────────────────────────────────────────────────────────────

  api.registerTool({
    name: 'budgetclaw_get_categories',
    description: 'List all categories (built-in and user-defined)',
    inputSchema: { type: 'object', properties: {} },
    handler: () => getCategories(db),
  });

  api.registerTool({
    name: 'budgetclaw_add_category',
    description: 'Add a user-defined category',
    inputSchema: {
      type: 'object',
      properties: {
        name:   { type: 'string', description: 'Category name' },
        parent: { type: 'string', description: 'Parent category name (optional — for subcategories)' },
      },
      required: ['name'],
    },
    handler: (input) => addCategory(db, input as Parameters<typeof addCategory>[1]),
  });

  api.registerTool({
    name: 'budgetclaw_delete_category',
    description: 'Delete a user-defined category (built-in categories cannot be deleted)',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Category ID' } },
      required: ['id'],
    },
    handler: (input) => deleteCategory(db, (input as { id: string }).id),
  });

  // ── Import / Export ───────────────────────────────────────────────────────

  api.registerTool({
    name: 'budgetclaw_import_csv',
    description: 'Import transactions from a CSV file. Automatically deduplicates using external_id.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path:      { type: 'string', description: 'Absolute path to the CSV file' },
        account_id:     { type: 'string', description: 'Account ID to import transactions into' },
        date_format:    { type: 'string', description: 'Date format hint: YYYY-MM-DD | MM/DD/YYYY | DD/MM/YYYY' },
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
    handler: (input) => importCsv(db, input as Parameters<typeof importCsv>[1]),
  });

  api.registerTool({
    name: 'budgetclaw_export_csv',
    description: 'Export transactions to a CSV file',
    inputSchema: {
      type: 'object',
      properties: {
        file_path:  { type: 'string', description: 'Output file path' },
        account_id: { type: 'string', description: 'Filter by account ID (optional)' },
        from_date:  { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        to_date:    { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['file_path'],
    },
    handler: (input) => exportCsv(db, input as Parameters<typeof exportCsv>[1]),
  });

  // ── Connections ───────────────────────────────────────────────────────────

  api.registerTool({
    name: 'budgetclaw_list_connections',
    description: 'List all provider connections (e.g. Plaid-linked institutions)',
    inputSchema: { type: 'object', properties: {} },
    handler: () => listConnections(db),
  });

  api.registerTool({
    name: 'budgetclaw_remove_connection',
    description: 'Remove a provider connection and delete its credential from the OS keychain',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Connection ID' } },
      required: ['id'],
    },
    handler: (input) => removeConnection(db, (input as { id: string }).id),
  });
}

export default { register };

// Re-export public types and interfaces for consumers
export type { PluginApi };
export { getDb, resetDb } from './db/index.js';
export type { AccountRow, TransactionRow, BudgetRow, PortfolioHoldingRow, NetWorthSnapshotRow } from './db/types.js';
export type { DataProvider, RawAccount, RawTransaction, RawBalance } from './providers/interface.js';
export type { PriceProvider, PriceResult, AssetType } from './prices/interface.js';
export { CsvDataProvider } from './providers/csv.js';
export { priceRegistry } from './prices/registry.js';
