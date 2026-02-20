import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, resetDb } from '../db/index.js';
import { addAccount } from './accounts.js';
import {
  addTransaction,
  getTransactions,
  updateTransaction,
  deleteTransaction,
  getSpendingSummary,
} from './transactions.js';

describe('Transactions', () => {
  beforeEach(() => { resetDb(); });
  afterEach(() => { resetDb(); });

  function setup() {
    const db = getDb(':memory:');
    const account = addAccount(db, { name: 'Checking', type: 'checking' });
    return { db, account };
  }

  it('adds a transaction', () => {
    const { db, account } = setup();
    const tx = addTransaction(db, {
      account_id: account.id,
      date: '2026-02-01',
      amount: -45.50,
      description: 'Whole Foods',
      category: 'Food & Dining',
      subcategory: 'Groceries',
    });
    expect(tx.amount).toBe(-45.5);
    expect(tx.category).toBe('Food & Dining');
    expect(tx.account_id).toBe(account.id);
    expect(tx.source).toBe('manual');
  });

  it('throws for invalid date format', () => {
    const { db, account } = setup();
    expect(() =>
      addTransaction(db, { account_id: account.id, date: '02/01/2026', amount: -10 })
    ).toThrow('Invalid date');
  });

  it('throws for non-existent account', () => {
    const { db } = setup();
    expect(() =>
      addTransaction(db, { account_id: 'bad-id', date: '2026-02-01', amount: -10 })
    ).toThrow('not found');
  });

  it('queries transactions with filters', () => {
    const { db, account } = setup();
    addTransaction(db, { account_id: account.id, date: '2026-02-01', amount: -10, category: 'Food & Dining' });
    addTransaction(db, { account_id: account.id, date: '2026-02-05', amount: -50, category: 'Transport' });
    addTransaction(db, { account_id: account.id, date: '2026-03-01', amount: -20, category: 'Food & Dining' });

    const foodFeb = getTransactions(db, {
      category: 'Food & Dining',
      from_date: '2026-02-01',
      to_date: '2026-02-28',
    });
    expect(foodFeb).toHaveLength(1);
    expect(foodFeb[0]?.amount).toBe(-10);
  });

  it('searches transactions by description', () => {
    const { db, account } = setup();
    addTransaction(db, { account_id: account.id, date: '2026-02-01', amount: -6.50, description: 'Starbucks coffee' });
    addTransaction(db, { account_id: account.id, date: '2026-02-01', amount: -30, description: 'Shell gas station' });

    const results = getTransactions(db, { search: 'Starbucks' });
    expect(results).toHaveLength(1);
    expect(results[0]?.description).toBe('Starbucks coffee');
  });

  it('updates a transaction', () => {
    const { db, account } = setup();
    const tx = addTransaction(db, { account_id: account.id, date: '2026-02-01', amount: -10 });
    const updated = updateTransaction(db, { id: tx.id, category: 'Food & Dining', notes: 'lunch' });
    expect(updated.category).toBe('Food & Dining');
    expect(updated.notes).toBe('lunch');
  });

  it('deletes a transaction', () => {
    const { db, account } = setup();
    const tx = addTransaction(db, { account_id: account.id, date: '2026-02-01', amount: -10 });
    const result = deleteTransaction(db, tx.id);
    expect(result.deleted).toBe(true);

    const remaining = getTransactions(db, {});
    expect(remaining).toHaveLength(0);
  });

  it('returns false when deleting non-existent transaction', () => {
    const { db } = setup();
    const result = deleteTransaction(db, 'non-existent');
    expect(result.deleted).toBe(false);
  });

  it('calculates spending summary', () => {
    const { db, account } = setup();
    addTransaction(db, { account_id: account.id, date: '2026-02-01', amount: -45, category: 'Food & Dining' });
    addTransaction(db, { account_id: account.id, date: '2026-02-05', amount: -55, category: 'Food & Dining' });
    addTransaction(db, { account_id: account.id, date: '2026-02-03', amount: -30, category: 'Transport' });
    // Income should not appear in spending summary
    addTransaction(db, { account_id: account.id, date: '2026-02-01', amount: 3000, category: 'Income' });

    const summary = getSpendingSummary(db, { from_date: '2026-02-01', to_date: '2026-02-28' });
    const foodRow = summary.find((r) => r.category === 'Food & Dining');
    expect(foodRow?.total).toBe(100);
    expect(foodRow?.count).toBe(2);

    const transportRow = summary.find((r) => r.category === 'Transport');
    expect(transportRow?.total).toBe(30);

    // Income should not appear
    const incomeRow = summary.find((r) => r.category === 'Income');
    expect(incomeRow).toBeUndefined();
  });

  it('deduplicates transactions with same external_id', () => {
    const { db, account } = setup();
    addTransaction(db, { account_id: account.id, date: '2026-02-01', amount: -10, external_id: 'ext-123' });

    // Second insert with same external_id should fail (UNIQUE constraint)
    expect(() =>
      addTransaction(db, { account_id: account.id, date: '2026-02-01', amount: -10, external_id: 'ext-123' })
    ).toThrow();
  });
});
