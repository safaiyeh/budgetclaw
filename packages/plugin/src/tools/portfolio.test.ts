import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, resetDb } from '../db/index.js';
import { addAccount } from './accounts.js';
import { upsertHolding, deleteHolding, getPortfolio } from './portfolio.js';

describe('Portfolio', () => {
  beforeEach(() => { resetDb(); });
  afterEach(() => { resetDb(); });

  function setup() {
    const db = getDb(':memory:');
    const account = addAccount(db, { name: 'Brokerage', type: 'investment' });
    return { db, account };
  }

  it('adds a stock holding with price', () => {
    const { db, account } = setup();
    const holding = upsertHolding(db, {
      account_id: account.id,
      symbol: 'AAPL',
      quantity: 10,
      price: 200,
      asset_type: 'stock',
    });
    expect(holding.symbol).toBe('AAPL');
    expect(holding.quantity).toBe(10);
    expect(holding.price).toBe(200);
    expect(holding.value).toBe(2000);
  });

  it('upserts existing holding (updates quantity)', () => {
    const { db, account } = setup();
    upsertHolding(db, { account_id: account.id, symbol: 'MSFT', quantity: 5, price: 400 });
    upsertHolding(db, { account_id: account.id, symbol: 'MSFT', quantity: 8, price: 410 });

    const portfolio = getPortfolio(db);
    const msft = portfolio.holdings.find((h) => h.symbol === 'MSFT');
    expect(msft?.quantity).toBe(8);
    expect(portfolio.holdings).toHaveLength(1);
  });

  it('calculates portfolio total value', () => {
    const { db, account } = setup();
    upsertHolding(db, { account_id: account.id, symbol: 'AAPL', quantity: 10, price: 200 });
    upsertHolding(db, { account_id: account.id, symbol: 'MSFT', quantity: 5, price: 400 });

    const portfolio = getPortfolio(db);
    expect(portfolio.total_value).toBe(4000); // 2000 + 2000
  });

  it('deletes a holding', () => {
    const { db, account } = setup();
    const holding = upsertHolding(db, { account_id: account.id, symbol: 'BTC', quantity: 1, asset_type: 'crypto' });
    const result = deleteHolding(db, holding.id);
    expect(result.deleted).toBe(true);
    expect(getPortfolio(db).holdings).toHaveLength(0);
  });

  it('throws for non-existent account', () => {
    const db = getDb(':memory:');
    expect(() =>
      upsertHolding(db, { account_id: 'bad-id', symbol: 'AAPL', quantity: 10 })
    ).toThrow('not found');
  });

  it('filters portfolio by account', () => {
    const db = getDb(':memory:');
    const acct1 = addAccount(db, { name: 'IRA', type: 'investment' });
    const acct2 = addAccount(db, { name: 'Taxable', type: 'investment' });

    upsertHolding(db, { account_id: acct1.id, symbol: 'AAPL', quantity: 10, price: 200 });
    upsertHolding(db, { account_id: acct2.id, symbol: 'MSFT', quantity: 5, price: 400 });

    const ira = getPortfolio(db, { account_id: acct1.id });
    expect(ira.holdings).toHaveLength(1);
    expect(ira.holdings[0]?.symbol).toBe('AAPL');
  });
});
