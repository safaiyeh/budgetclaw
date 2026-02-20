---
name: budgetclaw
description: Personal finance tracker — track transactions, budgets, portfolio, and net worth locally in SQLite
version: 0.1.0
user-invocable: true
emoji: 💰
metadata:
  openclaw:
    always: false
---

# BudgetClaw — Personal Finance Tracker

BudgetClaw stores all financial data locally in a SQLite database at `~/.budgetclaw/budget.db`. No cloud, no accounts, no syncing required.

---

## When to Use BudgetClaw

Activate BudgetClaw tools whenever the user mentions:
- Spending, purchases, or expenses ("I spent...", "paid for...", "bought...")
- Income or deposits ("got paid", "received", "salary hit")
- Budgets ("how am I doing on budget?", "set a budget for...")
- Investments or portfolio ("I own shares of...", "what's my portfolio worth?")
- Net worth ("what am I worth?", "show my assets and liabilities")
- Bank or financial data ("import my CSV", "export my transactions")

---

## Natural Language Patterns

### Recording Transactions

| User says | Action |
|-----------|--------|
| "I spent $45 at Whole Foods" | `budgetclaw_add_transaction` amount=-45, merchant="Whole Foods", category="Food & Dining", subcategory="Groceries" |
| "Got paid $3,200 salary today" | `budgetclaw_add_transaction` amount=3200, category="Income", subcategory="Salary" |
| "Paid $1,500 rent" | `budgetclaw_add_transaction` amount=-1500, category="Housing", subcategory="Rent/Mortgage" |
| "Coffee at Starbucks, $6.50" | `budgetclaw_add_transaction` amount=-6.50, merchant="Starbucks", category="Food & Dining", subcategory="Coffee" |
| "Netflix charged me $15.99" | `budgetclaw_add_transaction` amount=-15.99, merchant="Netflix", category="Entertainment", subcategory="Streaming" |
| "Transferred $500 to savings" | `budgetclaw_add_transaction` amount=-500, category="Transfers" (in checking), amount=+500, category="Transfers" (in savings) |

**Amount convention:** negative = money out (expenses), positive = money in (income/deposits).

Always use today's date (`YYYY-MM-DD`) unless the user specifies otherwise. If no account is mentioned, call `budgetclaw_get_accounts` and use the most appropriate one (e.g., default to checking for everyday purchases).

### Querying Spending

| User says | Action |
|-----------|--------|
| "How much did I spend this month?" | `budgetclaw_get_spending_summary` with current month date range |
| "Show my recent transactions" | `budgetclaw_get_transactions` with default limit |
| "What did I spend on food in January?" | `budgetclaw_get_transactions` category="Food & Dining", from_date/to_date set to January |
| "Find my Uber charges" | `budgetclaw_get_transactions` search="Uber" |
| "How much did I spend on subscriptions?" | `budgetclaw_get_transactions` category="Entertainment", subcategory="Streaming" |

### Budgets

| User says | Action |
|-----------|--------|
| "Set a $500 grocery budget" | `budgetclaw_set_budget` category="Food & Dining", amount=500 |
| "How am I doing on my budget?" | `budgetclaw_get_budgets` — shows actual vs. budgeted with % used |
| "Remove my transport budget" | `budgetclaw_delete_budget` with the budget's ID |

After setting a budget, immediately call `budgetclaw_get_budgets` and show the user their budget with actuals.

### Portfolio

| User says | Action |
|-----------|--------|
| "I have 10 shares of AAPL" | `budgetclaw_upsert_holding` symbol="AAPL", quantity=10, asset_type="stock" |
| "I bought 0.5 BTC" | `budgetclaw_upsert_holding` symbol="BTC", quantity=0.5, asset_type="crypto" |
| "Show my portfolio" | `budgetclaw_refresh_prices` then `budgetclaw_get_portfolio` |
| "Update my stock prices" | `budgetclaw_refresh_prices` |
| "I sold all my MSFT" | `budgetclaw_delete_holding` with the holding's ID |

Always refresh prices before showing portfolio value or net worth.

### Net Worth

| User says | Action |
|-----------|--------|
| "What's my net worth?" | `budgetclaw_refresh_prices` → `budgetclaw_snapshot_net_worth` → display result |
| "How has my net worth changed?" | `budgetclaw_get_net_worth_history` limit=12 — show trend |
| "Take a net worth snapshot" | `budgetclaw_snapshot_net_worth` with optional notes |

---

## First-Time Setup Workflow

When a user is new to BudgetClaw (no accounts exist), walk them through setup:

1. **Create accounts** — call `budgetclaw_add_account` for each:
   - Checking account (type: `checking`)
   - Savings account (type: `savings`)
   - Credit cards (type: `credit`)
   - Investment/brokerage (type: `investment`)
   - Crypto wallets (type: `crypto`)

2. **Set opening balances** — `budgetclaw_update_account_balance` for each account

3. **Import past transactions** — `budgetclaw_import_csv` if the user has a CSV export from their bank, or enter manually

4. **Set monthly budgets** — `budgetclaw_set_budget` for the categories they care about

5. **First net worth snapshot** — `budgetclaw_refresh_prices` then `budgetclaw_snapshot_net_worth`

---

## Response Style

- **Be concise.** After adding a single transaction, confirm with one line: "Added: -$45.00 · Whole Foods · Food & Dining"
- **Summarize batches.** When adding multiple transactions at once, confirm them in a table.
- **Show context.** After adding an expense in a budgeted category, show how much of the budget remains.
- **Use today's date** for all transactions unless the user says otherwise.
- **Never ask for an account ID.** Call `budgetclaw_get_accounts` silently and pick the right one.

---

## Disambiguation

**"I paid my credit card"** — this is a transfer, not spending:
- Debit from checking: `amount=-500, category="Transfers"`
- Credit to credit card account: `amount=500, category="Transfers"`

**"I deposited a check"** — income or transfer depending on context:
- Paycheck → `category="Income", subcategory="Salary"`
- Selling something → `category="Income", subcategory="Freelance"`
- Moving from another account → `category="Transfers"`

**"I refunded X"** — a positive transaction in the same category as the original purchase.

---

## Categories Reference

Built-in categories (use `budgetclaw_get_categories` for the full list):

| Category | Subcategories |
|----------|--------------|
| Food & Dining | Groceries, Restaurants, Coffee |
| Transport | Gas, Parking, Public Transit, Rideshare |
| Housing | Rent/Mortgage, Utilities, Internet, Insurance |
| Health | Medical, Pharmacy, Fitness |
| Entertainment | Streaming, Games, Movies |
| Shopping | Clothing, Electronics, Home Goods |
| Personal Care | Haircut, Beauty |
| Education | Tuition, Books, Courses |
| Income | Salary, Freelance, Investment Income, Gifts |
| Savings & Investments | Savings Transfer, Brokerage Deposit |
| Transfers | Between Own Accounts |
| Other | — |

For uncategorized transactions, use `"Other"`. Suggest `budgetclaw_add_category` if a user repeatedly uses a category that doesn't exist.

---

## CSV Import

```json
{
  "file_path": "/path/to/transactions.csv",
  "account_id": "<account-id>"
}
```

The importer auto-detects common column names (`date`, `amount`, `description`, `merchant`, `category`). For custom columns:

```json
{
  "mapping": {
    "date": "Transaction Date",
    "amount": "Debit Amount",
    "description": "Memo"
  }
}
```

Re-importing is safe — duplicates are automatically skipped.

---

## Key Rules

- Dates must be `YYYY-MM-DD`
- Expenses are **negative**, income is **positive**
- Run `budgetclaw_refresh_prices` before any net worth snapshot
- `budgetclaw_get_spending_summary` only counts negative amounts (expenses), income is excluded
- Accounts must exist before adding transactions — create them first if needed
