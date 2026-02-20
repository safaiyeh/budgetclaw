# BudgetClaw — Usage Examples

## Example 1: Recording a Day of Spending

```
User: "I went to Whole Foods for $87, filled up gas for $52, and Netflix charged $15.99"

Agent steps:
1. budgetclaw_get_accounts → find default checking account ID
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

Agent response:
Added 3 transactions:
| Date       | Description | Category        | Amount   |
|------------|-------------|-----------------|----------|
| 2026-02-20 | Whole Foods | Food & Dining   | -$87.00  |
| 2026-02-20 | Gas fill-up | Transport       | -$52.00  |
| 2026-02-20 | Netflix     | Entertainment   | -$15.99  |
Total: -$154.99
```

---

## Example 2: Monthly Budget Review

```
User: "How did I do on my budget this month?"

Agent steps:
1. budgetclaw_get_budgets → shows each budget with actual vs. budgeted + % used
2. budgetclaw_get_spending_summary {
     from_date: "2026-02-01",
     to_date: "2026-02-28"
   } → full category breakdown including unbudgeted categories

Agent response:
February Budget Summary:
| Category       | Budget  | Spent   | Remaining | % Used |
|----------------|---------|---------|-----------|--------|
| Food & Dining  | $500    | $312    | $188      | 62%    |
| Transport      | $150    | $187    | over by $37 | 125% ⚠️ |
| Entertainment  | $100    | $46     | $54       | 46%    |

Unbudgeted spending: Housing $1,500, Health $80
```

---

## Example 3: First-Time Setup

```
User: "Help me set up BudgetClaw"

Agent steps:
1. budgetclaw_add_account { name: "Chase Checking", type: "checking" }
2. budgetclaw_add_account { name: "Chase Savings", type: "savings" }
3. budgetclaw_add_account { name: "Chase Sapphire (credit)", type: "credit" }
4. budgetclaw_update_account_balance { id: "<checking-id>", balance: 3240.50 }
5. budgetclaw_update_account_balance { id: "<savings-id>", balance: 12000 }
6. budgetclaw_update_account_balance { id: "<credit-id>", balance: -847.20 }
7. budgetclaw_snapshot_net_worth → first snapshot

Agent response:
Accounts created! Your starting position:
- Chase Checking: $3,240.50
- Chase Savings: $12,000.00
- Chase Sapphire: -$847.20
Net worth: $14,393.30
```

---

## Example 4: Portfolio Snapshot

```
User: "I have 50 shares of AAPL, 10 of MSFT, and 0.5 BTC. What's my portfolio worth?"

Agent steps:
1. budgetclaw_get_accounts → find investment/brokerage account
   (create one if none exists: budgetclaw_add_account { name: "Brokerage", type: "investment" })
2. budgetclaw_upsert_holding { account_id: "...", symbol: "AAPL", quantity: 50, asset_type: "stock" }
3. budgetclaw_upsert_holding { account_id: "...", symbol: "MSFT", quantity: 10, asset_type: "stock" }
4. budgetclaw_upsert_holding { account_id: "...", symbol: "BTC", quantity: 0.5, asset_type: "crypto" }
5. budgetclaw_refresh_prices → fetches live prices from Yahoo Finance + CoinGecko
6. budgetclaw_get_portfolio → shows holdings with current values and total

Agent response:
Portfolio (as of 12:34 PM):
| Symbol | Qty  | Price    | Value     |
|--------|------|----------|-----------|
| AAPL   | 50   | $213.50  | $10,675   |
| MSFT   | 10   | $415.20  | $4,152    |
| BTC    | 0.5  | $94,200  | $47,100   |
Total: $61,927
```

---

## Example 5: Net Worth Tracking

```
User: "What's my net worth today, and how has it changed?"

Agent steps:
1. budgetclaw_refresh_prices → ensure portfolio values are current
2. budgetclaw_snapshot_net_worth → saves today's snapshot
3. budgetclaw_get_net_worth_history { limit: 6 } → recent trend

Agent response:
Net Worth: $76,320 (↑ $2,140 from last week)

Recent trend:
| Date       | Net Worth | Change    |
|------------|-----------|-----------|
| 2026-02-20 | $76,320   | +$2,140   |
| 2026-02-13 | $74,180   | +$890     |
| 2026-02-06 | $73,290   | -$430     |
```

---

## Example 6: CSV Import from Bank

```
User: "Import my Chase transactions from ~/Downloads/chase_feb.csv"

Agent steps:
1. budgetclaw_get_accounts → find Chase checking account ID
2. budgetclaw_import_csv {
     file_path: "~/Downloads/chase_feb.csv",
     account_id: "...",
     date_format: "MM/DD/YYYY"
   }

Agent response:
Imported 47 transactions, skipped 3 duplicates.
Top categories this period:
- Food & Dining: $312.40 (14 transactions)
- Transport: $187.20 (8 transactions)
- Shopping: $143.00 (5 transactions)
```

---

## Example 7: Searching Transactions

```
User: "Find all my Uber charges this year"

Agent steps:
1. budgetclaw_get_transactions {
     search: "Uber",
     from_date: "2026-01-01",
     to_date: "2026-12-31"
   }

Agent response:
Found 12 Uber charges in 2026 — total: $284.50
Most recent: $18.20 on 2026-02-18
```

---

## Example 8: Year-End Summary

```
User: "How much did I spend in 2025, and export it for my records"

Agent steps:
1. budgetclaw_get_spending_summary {
     from_date: "2025-01-01",
     to_date: "2025-12-31"
   }
2. budgetclaw_export_csv {
     file_path: "~/Documents/spending_2025.csv",
     from_date: "2025-01-01",
     to_date: "2025-12-31"
   }

Agent response:
2025 Spending: $38,420 across 8 categories
Top categories: Housing $18,000 · Food $6,200 · Transport $3,100
Exported to ~/Documents/spending_2025.csv (342 transactions)
```
