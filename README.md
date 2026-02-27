# BudgetClaw

A personal finance tracker plugin for [OpenClaw](https://github.com/openclaw/openclaw) — stores all data locally in SQLite with no mandatory cloud dependencies.

## Features

- **Transactions** — manual entry, CSV import, deduplication
- **Accounts** — checking, savings, credit, investment, crypto
- **Budgets** — set category budgets and track actuals vs. targets
- **Portfolio** — holdings with live prices (Yahoo Finance for stocks/ETFs, CoinGecko for crypto)
- **Net Worth** — snapshots and trend history
- **Provider-agnostic** — pluggable `DataProvider` interface for future integrations

## Installation

```
openclaw plugins install @budgetclaw/budgetclaw
```

### Development

**Requirements**: Node.js ≥ 22.5 and pnpm

```bash
git clone https://github.com/safaiyeh/budgetclaw
cd budgetclaw
pnpm install
pnpm build
pnpm test
```

## Data Storage

All financial data is stored locally at `~/.budgetclaw/budget.db` (SQLite).

- Directory: `~/.budgetclaw/` (permissions: `700`)
- Database: `~/.budgetclaw/budget.db` (permissions: `600`)
- Provider credentials (if any): stored in an encrypted file at `~/.budgetclaw/credentials.enc`

## Tools

### Transactions
- `budgetclaw_add_transaction` — add a transaction manually
- `budgetclaw_get_transactions` — query with filters
- `budgetclaw_update_transaction` — edit description, category, notes
- `budgetclaw_delete_transaction`
- `budgetclaw_get_spending_summary` — totals by category for a period

### Accounts
- `budgetclaw_add_account`
- `budgetclaw_get_accounts`
- `budgetclaw_update_account_balance`

### Budgets
- `budgetclaw_set_budget`
- `budgetclaw_get_budgets`
- `budgetclaw_delete_budget`

### Portfolio
- `budgetclaw_get_portfolio`
- `budgetclaw_upsert_holding`
- `budgetclaw_delete_holding`
- `budgetclaw_refresh_prices`

### Net Worth
- `budgetclaw_snapshot_net_worth`
- `budgetclaw_get_net_worth_history`

### Categories
- `budgetclaw_get_categories`
- `budgetclaw_add_category`
- `budgetclaw_delete_category`

### Import / Export
- `budgetclaw_import_csv`
- `budgetclaw_export_csv`

### Connections
- `budgetclaw_list_connections`
- `budgetclaw_sync_connection`
- `budgetclaw_remove_connection`

## CSV Import Format

The CSV importer accepts flexible column mappings. At minimum, your CSV should have columns for:
- `date` (YYYY-MM-DD or MM/DD/YYYY)
- `amount` (positive = inflow, negative = outflow)
- `description` or `memo`

Optional columns: `merchant`, `category`, `account`, `type`, `notes`

## License

MIT — see [LICENSE](LICENSE)
