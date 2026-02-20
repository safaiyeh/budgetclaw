import type { Database } from '../db/index.js';
import { toRow } from '../db/types.js';
import type { PortfolioHoldingRow } from '../db/types.js';
import type { AssetType } from '../prices/interface.js';
import { priceRegistry } from '../prices/registry.js';

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export interface UpsertHoldingInput {
  account_id: string;
  symbol: string;
  name?: string;
  quantity: number;
  price?: number;
  asset_type?: AssetType;
  currency?: string;
}

export interface GetPortfolioInput {
  account_id?: string;
}

export interface PortfolioSummary {
  holdings: PortfolioHoldingRow[];
  total_value: number;
  as_of: string;
}

export function upsertHolding(db: Database, input: UpsertHoldingInput): PortfolioHoldingRow {
  const { account_id, symbol, name, quantity, price, asset_type, currency = 'USD' } = input;

  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(account_id);
  if (!account) {
    throw new Error(`Account "${account_id}" not found`);
  }

  const ts = now();
  const value = price != null ? Math.round(quantity * price * 100) / 100 : null;

  const existing = toRow<{ id: string } | undefined>(
    db.prepare('SELECT id FROM portfolio_holdings WHERE account_id = ? AND symbol = ?').get(account_id, symbol)
  );

  if (existing) {
    db.prepare(
      `UPDATE portfolio_holdings
       SET name = COALESCE(?, name),
           quantity = ?,
           price = COALESCE(?, price),
           value = ?,
           currency = ?,
           asset_type = COALESCE(?, asset_type),
           updated_at = ?
       WHERE id = ?`
    ).run(name ?? null, quantity, price ?? null, value, currency, asset_type ?? null, ts, existing.id);
    return toRow<PortfolioHoldingRow>(
      db.prepare('SELECT * FROM portfolio_holdings WHERE id = ?').get(existing.id)
    );
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO portfolio_holdings
     (id, account_id, symbol, name, quantity, price, value, currency, asset_type, price_source, price_as_of, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, account_id, symbol.toUpperCase(), name ?? null, quantity,
    price ?? null, value, currency,
    asset_type ?? null, price != null ? 'manual' : null,
    price != null ? ts : null, ts, ts,
  );

  return toRow<PortfolioHoldingRow>(
    db.prepare('SELECT * FROM portfolio_holdings WHERE id = ?').get(id)
  );
}

export function deleteHolding(db: Database, id: string): { deleted: boolean } {
  const result = db.prepare('DELETE FROM portfolio_holdings WHERE id = ?').run(id);
  return { deleted: result.changes > 0 };
}

export function getPortfolio(db: Database, input: GetPortfolioInput = {}): PortfolioSummary {
  const { account_id } = input;

  const conditions: string[] = [];
  const params: string[] = [];

  if (account_id) { conditions.push('account_id = ?'); params.push(account_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const holdings = toRow<PortfolioHoldingRow[]>(
    db.prepare(`SELECT * FROM portfolio_holdings ${where} ORDER BY value DESC NULLS LAST`).all(...params)
  );

  const total_value = holdings.reduce((sum, h) => sum + (h.value ?? 0), 0);

  return {
    holdings,
    total_value: Math.round(total_value * 100) / 100,
    as_of: now(),
  };
}

export async function refreshPrices(db: Database, account_id?: string): Promise<PortfolioSummary> {
  const conditions: string[] = [];
  const params: string[] = [];

  if (account_id) { conditions.push('account_id = ?'); params.push(account_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const holdings = toRow<PortfolioHoldingRow[]>(
    db.prepare(`SELECT * FROM portfolio_holdings ${where}`).all(...params)
  );

  const ts = now();

  for (const holding of holdings) {
    const assetType = (holding.asset_type as AssetType) ?? 'other';
    try {
      const result = await priceRegistry.getPrice(holding.symbol, assetType, holding.price ?? undefined);
      const newPrice = result.price;
      const newValue = Math.round(holding.quantity * newPrice * 100) / 100;
      db.prepare(
        `UPDATE portfolio_holdings
         SET price = ?, value = ?, price_source = ?, price_as_of = ?, updated_at = ?
         WHERE id = ?`
      ).run(newPrice, newValue, result.source, result.asOf.toISOString(), ts, holding.id);
    } catch {
      // Skip holdings where price fetch fails — leave existing price intact
    }
  }

  return getPortfolio(db, { account_id });
}
