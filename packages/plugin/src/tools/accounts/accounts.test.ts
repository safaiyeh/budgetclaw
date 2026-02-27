import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, resetDb } from '../../db/index.js';
import { addAccount, getAccounts, updateAccountBalance, deleteAccount } from './index.js';
import { ProviderRegistry } from '../../providers/registry.js';

describe('Accounts', () => {
  beforeEach(() => { resetDb(); });
  afterEach(() => { resetDb(); });

  it('adds a checking account', () => {
    const db = getDb(':memory:');
    const account = addAccount(db, { name: 'Chase Checking', type: 'checking' });
    expect(account.name).toBe('Chase Checking');
    expect(account.type).toBe('checking');
    expect(account.currency).toBe('USD');
    expect(account.is_active).toBe(1);
    expect(account.id).toBeDefined();
  });

  it('adds an account with balance', () => {
    const db = getDb(':memory:');
    const account = addAccount(db, { name: 'Savings', type: 'savings', balance: 5000 });
    expect(account.balance).toBe(5000);
  });

  it('throws for invalid account type', () => {
    const db = getDb(':memory:');
    expect(() =>
      addAccount(db, { name: 'Bad', type: 'invalid' as 'checking' })
    ).toThrow('Invalid account type');
  });

  it('lists active accounts', () => {
    const db = getDb(':memory:');
    addAccount(db, { name: 'Checking', type: 'checking' });
    addAccount(db, { name: 'Savings', type: 'savings' });
    const accounts = getAccounts(db);
    expect(accounts).toHaveLength(2);
  });

  it('updates account balance', () => {
    const db = getDb(':memory:');
    const account = addAccount(db, { name: 'Checking', type: 'checking', balance: 1000 });
    const updated = updateAccountBalance(db, { id: account.id, balance: 2500 });
    expect(updated.balance).toBe(2500);
  });

  it('throws when updating non-existent account', () => {
    const db = getDb(':memory:');
    expect(() =>
      updateAccountBalance(db, { id: 'non-existent', balance: 100 })
    ).toThrow('not found');
  });

  it('deletes a manual account and its transactions', async () => {
    const db = getDb(':memory:');
    const registry = new ProviderRegistry();
    const account = addAccount(db, { name: 'Checking', type: 'checking' });

    // Add a transaction
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO transactions (id, account_id, date, amount, currency, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USD', 'manual', ?, ?)`
    ).run(crypto.randomUUID(), account.id, '2025-01-01', -50, ts, ts);

    const result = await deleteAccount(db, { id: account.id }, registry);
    expect(result.deleted_accounts).toBe(1);
    expect(result.deleted_transactions).toBe(1);
    expect(result.connection_removed).toBe(false);

    const accounts = getAccounts(db);
    expect(accounts).toHaveLength(0);
  });

  it('throws when deleting non-existent account', async () => {
    const db = getDb(':memory:');
    const registry = new ProviderRegistry();
    await expect(
      deleteAccount(db, { id: 'non-existent' }, registry)
    ).rejects.toThrow('not found');
  });
});
