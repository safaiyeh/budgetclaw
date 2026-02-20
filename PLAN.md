# BudgetClaw — Implementation Plan

## What We're Building

A **personal finance tracker** for OpenClaw — the self-hosted AI assistant framework.
BudgetClaw will let users store transactions, accounts, portfolio holdings, and net worth
locally in a SQLite database, with support for manual entry, Plaid sync, and CSV import.

---

## Key Research Findings

- OpenClaw is a TypeScript/Node.js self-hosted AI assistant (191k+ GitHub stars, MIT)
- It has two extension mechanisms: **Skills** (SKILL.md, instructions-only) and **Plugins** (TypeScript npm packages, run in-process with the gateway)
- For a full finance tracker with SQLite + background sync, a **Plugin** is the right choice
- SQLite is already OpenClaw's native storage format (`better-sqlite3` is in-tree)
- An optional **companion Skill** provides natural language UX and user documentation
- Plaid already has an official OpenClaw skill; we'll integrate at the plugin level for richer access

---

## Architecture Decision: Plugin + Companion Skill

| Layer | Purpose |
|-------|---------|
| `packages/plugin` | TypeScript npm plugin — SQLite DB, agent tools, importers, sync jobs |
| `packages/skill` | SKILL.md companion — NL instructions, slash command UX, ClawHub distribution |

---

## Repository Structure

```
budgetclaw/
├── packages/
│   ├── plugin/                        # @budgetclaw/plugin
│   │   ├── src/
│   │   │   ├── index.ts               # Plugin entry: register(api)
│   │   │   ├── db/
│   │   │   │   ├── index.ts           # DB connection singleton
│   │   │   │   ├── migrations.ts      # PRAGMA user_version migrations
│   │   │   │   └── types.ts           # TypeScript row types
│   │   │   ├── tools/
│   │   │   │   ├── transactions.ts    # add/query/update/delete transactions
│   │   │   │   ├── accounts.ts        # add/list accounts & balances
│   │   │   │   ├── budgets.ts         # set/get budgets + status
│   │   │   │   ├── portfolio.ts       # holdings, update prices
│   │   │   │   └── net-worth.ts       # snapshot + history
│   │   │   ├── importers/
│   │   │   │   ├── plaid.ts           # Plaid Node SDK integration
│   │   │   │   ├── csv.ts             # CSV/OFX/QFX import
│   │   │   │   └── manual.ts          # manual entry helpers
│   │   │   └── sync/
│   │   │       └── scheduler.ts       # background Plaid sync loop
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── skill/                         # Companion skill (ClawHub publishable)
│       ├── SKILL.md
│       └── examples.md
├── package.json                       # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── LICENSE                            # MIT
└── README.md
```

---

## SQLite Schema (v1)

Database stored at: `~/.budgetclaw/budget.db`

```sql
-- Schema version tracking
PRAGMA user_version = 1;

CREATE TABLE accounts (
  id           TEXT PRIMARY KEY,         -- UUID
  name         TEXT NOT NULL,
  institution  TEXT,
  type         TEXT NOT NULL,            -- checking|savings|credit|investment|crypto|loan|other
  currency     TEXT NOT NULL DEFAULT 'USD',
  balance      REAL,                     -- cached balance
  source       TEXT NOT NULL DEFAULT 'manual', -- manual|plaid
  external_id  TEXT,                     -- plaid account_id etc.
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,         -- UUID
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  date         TEXT NOT NULL,            -- ISO 8601 YYYY-MM-DD
  amount       REAL NOT NULL,            -- positive = income, negative = expense
  currency     TEXT NOT NULL DEFAULT 'USD',
  description  TEXT,
  merchant     TEXT,
  category     TEXT,                     -- Food, Transport, Housing, etc.
  subcategory  TEXT,
  type         TEXT,                     -- debit|credit|transfer
  source       TEXT NOT NULL DEFAULT 'manual',
  external_id  TEXT,                     -- plaid transaction_id etc.
  pending      INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_account ON transactions(account_id);
CREATE INDEX idx_transactions_category ON transactions(category);

CREATE TABLE budgets (
  id           TEXT PRIMARY KEY,
  category     TEXT NOT NULL,
  amount       REAL NOT NULL,
  period       TEXT NOT NULL DEFAULT 'monthly', -- monthly|weekly|yearly
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(category, period)
);

CREATE TABLE portfolio_holdings (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  symbol       TEXT NOT NULL,
  name         TEXT,
  quantity     REAL NOT NULL,
  price        REAL,
  value        REAL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  asset_type   TEXT,                     -- stock|etf|crypto|bond|other
  as_of        TEXT,                     -- ISO 8601 date of last price update
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(account_id, symbol)
);

CREATE TABLE net_worth_snapshots (
  id             TEXT PRIMARY KEY,
  date           TEXT NOT NULL,          -- ISO 8601 date
  total_assets   REAL NOT NULL,
  total_liabilities REAL NOT NULL,
  net_worth      REAL NOT NULL,
  notes          TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_nw_date ON net_worth_snapshots(date);

CREATE TABLE plaid_connections (
  id               TEXT PRIMARY KEY,
  institution_id   TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  access_token     TEXT NOT NULL,        -- stored locally, never logged
  item_id          TEXT NOT NULL,
  cursor           TEXT,                 -- Plaid transactions sync cursor
  last_synced_at   TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
```

---

## Agent Tools (Plugin API)

Tools registered with `api.registerTool(...)` in the plugin:

### Transactions
- `budgetclaw_add_transaction` — add a transaction manually
- `budgetclaw_get_transactions` — query with filters (date range, account, category, search)
- `budgetclaw_update_transaction` — edit description, category, notes
- `budgetclaw_delete_transaction` — remove a transaction
- `budgetclaw_get_spending_summary` — totals by category for a period

### Accounts
- `budgetclaw_add_account` — add a manual account
- `budgetclaw_get_accounts` — list all accounts with current balances
- `budgetclaw_update_account_balance` — update a manual account balance

### Budgets
- `budgetclaw_set_budget` — set/update a category budget
- `budgetclaw_get_budgets` — list budgets with actual vs. budgeted amounts
- `budgetclaw_delete_budget` — remove a budget

### Portfolio
- `budgetclaw_get_portfolio` — list all holdings with current values
- `budgetclaw_upsert_holding` — add or update a portfolio holding
- `budgetclaw_delete_holding` — remove a holding

### Net Worth
- `budgetclaw_snapshot_net_worth` — calculate and save a net worth snapshot
- `budgetclaw_get_net_worth_history` — trend over time

### Plaid
- `budgetclaw_plaid_link` — initiate Plaid Link (returns link_token)
- `budgetclaw_plaid_exchange` — exchange public_token for access_token
- `budgetclaw_plaid_sync` — sync transactions and balances from Plaid
- `budgetclaw_plaid_list_connections` — list connected institutions

### Import/Export
- `budgetclaw_import_csv` — import transactions from CSV file
- `budgetclaw_export_csv` — export transactions to CSV

---

## Companion Skill (SKILL.md)

```yaml
---
name: budgetclaw
description: Personal finance tracker — track transactions, budgets, portfolio, and net worth locally
version: 0.1.0
user-invocable: true
emoji: 💰
metadata:
  openclaw:
    requires:
      bins: [node]
    always: false
---
```

The skill provides:
- Natural language instructions: "spent $45 on groceries" → `budgetclaw_add_transaction`
- Slash command: `/budgetclaw` → opens summary dashboard
- Usage examples and onboarding guide

---

## Tech Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Language | TypeScript | Required by OpenClaw plugin system |
| Runtime | Node.js 22+ | OpenClaw requirement |
| Package manager | pnpm | OpenClaw uses pnpm workspaces |
| SQLite driver | `better-sqlite3` | Synchronous, zero-config, matches OpenClaw internals |
| Plaid | `plaid` (official Node SDK) | First-class types, maintained by Plaid |
| CSV parsing | `papaparse` | Zero-dep, browser+node, widely used |
| UUID | `crypto.randomUUID()` | Built into Node.js 22, no extra dep |
| Testing | Vitest | OpenClaw uses Vitest |
| Build | tsdown | OpenClaw uses tsdown |
| License | MIT | Open source friendly, matches OpenClaw |

---

## Implementation Phases

### Phase 1 — Scaffolding
1. Initialize pnpm workspace with `package.json` and `pnpm-workspace.yaml`
2. Set up `packages/plugin` with `tsconfig.json`, `package.json`
3. Set up `packages/skill` with initial `SKILL.md`
4. Add `tsconfig.base.json`, `LICENSE` (MIT), `README.md`
5. Configure Vitest

### Phase 2 — Database Layer
1. DB connection singleton with configurable path (`~/.budgetclaw/budget.db`)
2. Migration runner using `PRAGMA user_version`
3. v1 schema (all tables above)
4. TypeScript row types

### Phase 3 — Core Tools
1. Transactions CRUD tools
2. Accounts tools
3. Budget tools with actual vs. budgeted calculation
4. Net worth snapshot + history

### Phase 4 — Portfolio
1. Holdings CRUD
2. Portfolio summary with total value

### Phase 5 — Importers
1. Manual entry helpers
2. CSV import (flexible column mapping)
3. CSV export

### Phase 6 — Plaid Integration
1. Plaid Link token flow
2. Access token exchange + storage
3. Transaction sync (incremental via cursor)
4. Balance sync
5. Background scheduler (optional auto-sync)

### Phase 7 — Companion Skill
1. Full SKILL.md with NL instructions
2. Examples doc
3. ClawHub publishing config

### Phase 8 — Polish
1. Full Vitest test suite
2. README with setup guide
3. GitHub Actions CI

---

## Open Source Considerations

- MIT license throughout
- No Anthropic or OpenClaw trademarks in package names
- No hardcoded API keys anywhere
- Plaid credentials stored only in `~/.budgetclaw/` with 600 permissions
- `.gitignore` excludes `*.db`, `.env`, `auth-profiles.json`
- Contributions welcome — standard GitHub flow (issues, PRs)
- All dependencies are MIT/Apache-2.0/ISC compatible

---

## Questions to Resolve Before Starting

1. **Plugin name**: `@budgetclaw/plugin` (scoped npm) or `openclaw-budgetclaw`?
2. **Start with Phase 1-5 first** (core with no Plaid) and add Plaid later?
3. **Portfolio price updates**: manual only for v1, or integrate a free quotes API (e.g., Yahoo Finance unofficial, Alpha Vantage free tier)?
4. **Encryption for Plaid tokens**: v1 plaintext with 600 permissions, or use OS keychain via `keytar`?
