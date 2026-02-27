import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, resetDb } from './index.js';

describe('Database', () => {
  beforeEach(() => {
    resetDb();
  });

  afterEach(() => {
    resetDb();
  });

  it('opens an in-memory database', () => {
    const db = getDb(':memory:');
    expect(db).toBeDefined();
  });

  it('returns the same singleton on repeated calls', () => {
    const db1 = getDb(':memory:');
    const db2 = getDb(':memory:');
    expect(db1).toBe(db2);
  });

  it('runs migrations and creates all tables', () => {
    const db = getDb(':memory:');
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('accounts');
    expect(tableNames).toContain('transactions');
    expect(tableNames).toContain('categories');
    expect(tableNames).toContain('budgets');
    expect(tableNames).toContain('portfolio_holdings');
    expect(tableNames).toContain('net_worth_snapshots');
    expect(tableNames).toContain('provider_connections');
  });

  it('sets PRAGMA user_version = 2 after migration', () => {
    const db = getDb(':memory:');
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(2);
  });

  it('adds connection_id column to accounts table', () => {
    const db = getDb(':memory:');
    const columns = db
      .prepare(`PRAGMA table_info(accounts)`)
      .all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain('connection_id');
  });

  it('seeds built-in categories', () => {
    const db = getDb(':memory:');
    const count = db
      .prepare('SELECT COUNT(*) AS cnt FROM categories WHERE is_builtin = 1')
      .get() as { cnt: number };
    expect(count.cnt).toBeGreaterThan(0);
  });
});
