import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getDb, resetDb } from '../db/index.js';
import { addAccount, updateAccountBalance } from './accounts.js';
import { upsertHolding } from './portfolio.js';
import { snapshotNetWorth, getNetWorthHistory } from './net-worth.js';

describe('Net Worth', () => {
  beforeEach(() => { resetDb(); });
  afterEach(() => { resetDb(); });

  it('calculates net worth from account balances', () => {
    const db = getDb(':memory:');
    const checking = addAccount(db, { name: 'Checking', type: 'checking', balance: 5000 });
    const savings = addAccount(db, { name: 'Savings', type: 'savings', balance: 10000 });
    const credit = addAccount(db, { name: 'Credit Card', type: 'credit', balance: 2000 });

    const snapshot = snapshotNetWorth(db);
    expect(snapshot.total_assets).toBe(15000);
    expect(snapshot.total_liabilities).toBe(2000);
    expect(snapshot.net_worth).toBe(13000);
  });

  it('uses portfolio value for investment accounts', () => {
    const db = getDb(':memory:');
    const investAccount = addAccount(db, { name: 'Brokerage', type: 'investment', balance: 0 });
    upsertHolding(db, { account_id: investAccount.id, symbol: 'AAPL', quantity: 10, price: 200 });
    upsertHolding(db, { account_id: investAccount.id, symbol: 'MSFT', quantity: 5, price: 400 });

    const snapshot = snapshotNetWorth(db);
    expect(snapshot.total_assets).toBe(4000); // 2000 + 2000
    expect(snapshot.net_worth).toBe(4000);
  });

  it('saves and retrieves net worth history', () => {
    const db = getDb(':memory:');
    addAccount(db, { name: 'Checking', type: 'checking', balance: 5000 });

    snapshotNetWorth(db, { notes: 'Month 1' });
    snapshotNetWorth(db, { notes: 'Month 2' });

    const history = getNetWorthHistory(db);
    expect(history).toHaveLength(2);
    expect(history[0]?.notes).toBe('Month 2'); // Ordered desc
  });

  it('filters history by date range', () => {
    const db = getDb(':memory:');
    addAccount(db, { name: 'Checking', type: 'checking', balance: 1000 });

    snapshotNetWorth(db);

    const today = new Date().toISOString().slice(0, 10);
    const history = getNetWorthHistory(db, { from_date: today, to_date: today });
    expect(history).toHaveLength(1);
  });

  it('includes breakdown in snapshot', () => {
    const db = getDb(':memory:');
    const account = addAccount(db, { name: 'Checking', type: 'checking', balance: 3000 });

    const snapshot = snapshotNetWorth(db);
    expect(snapshot.breakdown_parsed).toBeDefined();
    expect(snapshot.breakdown_parsed[account.id]).toBe(3000);
  });
});
