# BudgetClaw

Personal finance tracker plugin for OpenClaw. SQLite-backed, provider-agnostic.

## Project Structure

- `packages/plugin/` — the npm package (`@budgetclaw/budgetclaw`)
  - `src/providers/<name>/` — data providers (plaid, coinbase, csv), shared `interface.ts` and `registry.ts` at root
  - `src/tools/<name>/` — tool modules (accounts, transactions, budgets, portfolio, net-worth, categories, import-export, connections)
  - `src/db/` — SQLite database, migrations, types
  - `src/prices/` — price providers (Yahoo, CoinGecko)
  - `src/credentials/` — encrypted credential storage
  - `skills/budgetclaw/` — SKILL.md and examples

## Commands

- `pnpm build` — TypeScript compile (from repo root)
- `pnpm test` — run vitest (from repo root)

## Deploying

Deploy means **publish to npm**. Do NOT use Railway, Fly.io, or any other hosting service.

```bash
# 1. Bump version in packages/plugin/package.json
# 2. Commit and push to main
# 3. Publish
cd packages/plugin && npm publish --access public
```

npm will prompt for an OTP code — ask the user for it.

## Conventions

- Node ESM with explicit `.js` extensions in imports
- Tests colocated with source in the same directory (e.g. `accounts/accounts.test.ts`)
- Provider interface pattern: shared `DataProvider` interface, each provider in its own subdirectory
- Migrations are numbered in `src/db/migrations.ts` — current version: 2
