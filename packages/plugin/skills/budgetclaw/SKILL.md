---
name: budgetclaw
description: Personal finance tracker — track transactions, budgets, portfolio, and net worth locally in SQLite
version: 0.1.0
user-invocable: true
emoji: 💰
metadata:
  openclaw:
    requires:
      bins: [bun]
    always: false
---

# BudgetClaw — Personal Finance Tracker

BudgetClaw stores all your financial data locally in a SQLite database at `~/.budgetclaw/budget.db`. No cloud required.

## Quick Start

When the user mentions anything related to personal finance, spending, budgets, investments, or net worth, use the BudgetClaw tools. Here are the natural language patterns to watch for:

### Adding Transactions
- "I spent $45 on groceries" → `budgetclaw_add_transaction` with amount=-45, category="Food & Dining", subcategory="Groceries"
- "Got paid $3200 salary" → `budgetclaw_add_transaction` with amount=3200, category="Income", subcategory="Salary"
- "Paid $1500 rent" → `budgetclaw_add_transaction` with amount=-1500, category="Housing", subcategory="Rent/Mortgage"
- "Coffee at Starbucks $6.50" → `budgetclaw_add_transaction` with amount=-6.50, merchant="Starbucks", category="Food & Dining", subcategory="Coffee"

### Viewing Spending
- "How much did I spend this month?" → `budgetclaw_get_spending_summary` with current month dates
- "Show my transactions" → `budgetclaw_get_transactions`
- "What did I spend on food last week?" → `budgetclaw_get_transactions` filtered by category="Food & Dining"

### Budgets
- "Set a $500 grocery budget" → `budgetclaw_set_budget` with category="Groceries", amount=500
- "How am I doing on my budget?" → `budgetclaw_get_budgets`

### Portfolio
- "I have 10 shares of AAPL" → `budgetclaw_upsert_holding` with symbol="AAPL", quantity=10, asset_type="stock"
- "Show my portfolio" → `budgetclaw_get_portfolio`
- "Update stock prices" → `budgetclaw_refresh_prices`

### Net Worth
- "What's my net worth?" → `budgetclaw_snapshot_net_worth` then display the result
- "Show my net worth history" → `budgetclaw_get_net_worth_history`

---

## Workflow: First Time Setup

1. Create accounts with `budgetclaw_add_account`:
   - Checking account
   - Savings account
   - Credit card(s)
   - Investment accounts

2. Set initial balances with `budgetclaw_update_account_balance`

3. Add recent transactions manually or import via `budgetclaw_import_csv`

4. Set monthly budgets with `budgetclaw_set_budget`

5. Take your first net worth snapshot with `budgetclaw_snapshot_net_worth`

---

## Categories Reference

Built-in top-level categories:
- **Food & Dining** — Groceries, Restaurants, Coffee
- **Transport** — Gas, Parking, Public Transit, Rideshare
- **Housing** — Rent/Mortgage, Utilities, Internet, Insurance
- **Health** — Medical, Pharmacy, Fitness
- **Entertainment** — Streaming, Games, Movies
- **Shopping** — Clothing, Electronics, Home Goods
- **Personal Care** — Haircut, Beauty
- **Education** — Tuition, Books, Courses
- **Income** — Salary, Freelance, Investment Income, Gifts
- **Savings & Investments** — Savings Transfer, Brokerage Deposit
- **Transfers** — Between Own Accounts
- **Other**

Use `budgetclaw_get_categories` to see the full list including user-defined categories.

---

## CSV Import

To import bank transactions from a CSV:

```
budgetclaw_import_csv {
  "file_path": "/path/to/transactions.csv",
  "account_id": "<your-account-id>"
}
```

The importer auto-detects common column names (date, amount, description, merchant, category).
For custom column names, pass a `mapping` object:

```
{
  "mapping": {
    "date": "Transaction Date",
    "amount": "Debit Amount",
    "description": "Memo"
  }
}
```

Re-importing the same CSV is safe — duplicate transactions are automatically skipped.

---

## Amount Convention

- **Positive amounts** = money coming in (income, deposits)
- **Negative amounts** = money going out (expenses, withdrawals)

Examples:
- Grocery purchase: `-45.00`
- Paycheck: `+3200.00`
- Credit card payment: `-500.00` (if tracking from checking) or `+500.00` (if tracking as payment to credit card)

---

## Tips

- Always use YYYY-MM-DD format for dates
- Use `budgetclaw_get_accounts` to find account IDs before adding transactions
- Run `budgetclaw_refresh_prices` before `budgetclaw_snapshot_net_worth` for accurate investment values
- The `budgetclaw_get_spending_summary` tool is great for monthly reviews — shows spending by category with totals
