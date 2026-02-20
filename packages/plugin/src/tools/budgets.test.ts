import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, resetDb } from '../db/index.js';
import { addAccount } from './accounts.js';
import { addTransaction } from './transactions.js';
import { setBudget, getBudgets, deleteBudget } from './budgets.js';

describe('Budgets', () => {
  beforeEach(() => { resetDb(); });
  afterEach(() => { resetDb(); });

  it('sets a monthly budget', () => {
    const db = getDb(':memory:');
    const budget = setBudget(db, { category: 'Food & Dining', amount: 500 });
    expect(budget.category).toBe('Food & Dining');
    expect(budget.amount).toBe(500);
    expect(budget.period).toBe('monthly');
  });

  it('updates an existing budget (upsert)', () => {
    const db = getDb(':memory:');
    setBudget(db, { category: 'Food & Dining', amount: 500 });
    const updated = setBudget(db, { category: 'Food & Dining', amount: 600 });
    expect(updated.amount).toBe(600);

    // Should still be 1 budget
    const budgets = getBudgets(db);
    expect(budgets).toHaveLength(1);
  });

  it('throws for invalid period', () => {
    const db = getDb(':memory:');
    expect(() =>
      setBudget(db, { category: 'Food & Dining', amount: 500, period: 'daily' as 'monthly' })
    ).toThrow('Invalid period');
  });

  it('throws for non-positive amount', () => {
    const db = getDb(':memory:');
    expect(() =>
      setBudget(db, { category: 'Food & Dining', amount: -100 })
    ).toThrow('greater than 0');
  });

  it('includes actual spending in budget results', () => {
    const db = getDb(':memory:');
    const account = addAccount(db, { name: 'Checking', type: 'checking' });

    // Add expense in current month
    const today = new Date().toISOString().slice(0, 10);
    addTransaction(db, { account_id: account.id, date: today, amount: -150, category: 'Food & Dining' });
    addTransaction(db, { account_id: account.id, date: today, amount: -50, category: 'Food & Dining' });

    setBudget(db, { category: 'Food & Dining', amount: 500 });
    const budgets = getBudgets(db);
    const foodBudget = budgets.find((b) => b.category === 'Food & Dining');

    expect(foodBudget?.actual).toBe(200);
    expect(foodBudget?.remaining).toBe(300);
    expect(foodBudget?.percent_used).toBe(40);
  });

  it('deletes a budget', () => {
    const db = getDb(':memory:');
    const budget = setBudget(db, { category: 'Transport', amount: 200 });
    const result = deleteBudget(db, budget.id);
    expect(result.deleted).toBe(true);
    expect(getBudgets(db)).toHaveLength(0);
  });
});
