# BudgetClaw — Usage Examples

## Example 1: Monthly Budget Review

```
User: "How did I do on my budget this month?"

Agent steps:
1. budgetclaw_get_budgets → shows budgets with actual vs. budgeted
2. budgetclaw_get_spending_summary {
     from_date: "2026-02-01",
     to_date: "2026-02-28"
   } → category totals
3. Present a summary comparing actual to budget
```

---

## Example 2: Adding a Week of Transactions

```
User: "I went to Whole Foods for $87, filled up gas for $52, and Netflix charged $15.99"

Agent steps:
1. budgetclaw_get_accounts → find the checking account ID
2. budgetclaw_add_transaction {
     account_id: "...",
     date: "2026-02-20",
     amount: -87,
     merchant: "Whole Foods",
     category: "Food & Dining",
     subcategory: "Groceries"
   }
3. budgetclaw_add_transaction {
     account_id: "...",
     date: "2026-02-20",
     amount: -52,
     description: "Gas fill-up",
     category: "Transport",
     subcategory: "Gas"
   }
4. budgetclaw_add_transaction {
     account_id: "...",
     date: "2026-02-20",
     amount: -15.99,
     merchant: "Netflix",
     category: "Entertainment",
     subcategory: "Streaming"
   }
```

---

## Example 3: Portfolio Snapshot

```
User: "I have 50 shares of AAPL, 10 shares of MSFT, and 0.5 BTC. What's my portfolio worth?"

Agent steps:
1. budgetclaw_get_accounts → find investment account ID
2. budgetclaw_upsert_holding { account_id: "...", symbol: "AAPL", quantity: 50, asset_type: "stock" }
3. budgetclaw_upsert_holding { account_id: "...", symbol: "MSFT", quantity: 10, asset_type: "stock" }
4. budgetclaw_upsert_holding { account_id: "...", symbol: "BTC", quantity: 0.5, asset_type: "crypto" }
5. budgetclaw_refresh_prices → fetches live prices from Yahoo Finance + CoinGecko
6. budgetclaw_get_portfolio → shows holdings with current values and total
```

---

## Example 4: Net Worth Tracking

```
User: "What's my net worth today?"

Agent steps:
1. budgetclaw_refresh_prices → ensure portfolio values are current
2. budgetclaw_snapshot_net_worth → calculates assets - liabilities, saves snapshot
3. budgetclaw_get_net_worth_history { limit: 12 } → trend over time
4. Present current net worth + change from last snapshot
```

---

## Example 5: CSV Import

```
User: "Import my Chase transactions from ~/Downloads/chase_feb.csv"

Agent steps:
1. budgetclaw_get_accounts → find Chase checking account ID
2. budgetclaw_import_csv {
     file_path: "~/Downloads/chase_feb.csv",
     account_id: "...",
     date_format: "MM/DD/YYYY"
   }
3. Report: "Imported 47 transactions, skipped 3 duplicates"
```

---

## Example 6: Setting Up Budgets

```
User: "Set monthly budgets: $600 groceries, $200 restaurants, $100 coffee"

Agent steps:
1. budgetclaw_set_budget { category: "Groceries", amount: 600, period: "monthly" }
2. budgetclaw_set_budget { category: "Restaurants", amount: 200, period: "monthly" }
3. budgetclaw_set_budget { category: "Coffee", amount: 100, period: "monthly" }
4. budgetclaw_get_budgets → confirm all budgets are set
```

---

## Example 7: Year-End Summary

```
User: "How much did I spend in 2025?"

Agent steps:
1. budgetclaw_get_spending_summary {
     from_date: "2025-01-01",
     to_date: "2025-12-31"
   }
2. Present breakdown by category with totals
3. Compare to budget targets if set

Optional: Export for records
4. budgetclaw_export_csv {
     file_path: "~/Documents/spending_2025.csv",
     from_date: "2025-01-01",
     to_date: "2025-12-31"
   }
```
