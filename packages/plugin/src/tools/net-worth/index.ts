import type { Database } from '../../db/index.js';
import { toRow } from '../../db/types.js';
import type { NetWorthSnapshotRow, AccountRow } from '../../db/types.js';

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export interface SnapshotNetWorthInput {
  notes?: string;
}

export interface GetNetWorthHistoryInput {
  from_date?: string;
  to_date?: string;
  limit?: number;
}

export interface NetWorthResult extends NetWorthSnapshotRow {
  breakdown_parsed: Record<string, number>;
}

export function snapshotNetWorth(db: Database, input: SnapshotNetWorthInput = {}): NetWorthResult {
  const accounts = toRow<AccountRow[]>(
    db.prepare('SELECT * FROM accounts WHERE is_active = 1').all()
  );

  const breakdown: Record<string, number> = {};
  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const account of accounts) {
    let balance = account.balance ?? 0;

    if (account.type === 'investment' || account.type === 'crypto') {
      const portfolioValue = toRow<{ total: number | null }>(
        db.prepare('SELECT SUM(value) AS total FROM portfolio_holdings WHERE account_id = ?').get(account.id)
      );
      if (portfolioValue.total !== null) {
        balance = portfolioValue.total;
      }
    }

    breakdown[account.id] = balance;

    const LIABILITY_TYPES = ['credit', 'loan'];
    if (LIABILITY_TYPES.includes(account.type)) {
      totalLiabilities += Math.abs(balance);
    } else {
      totalAssets += balance;
    }
  }

  const netWorth = totalAssets - totalLiabilities;
  const dateStr = now().slice(0, 10);
  const id = uuid();
  const ts = now();

  db.prepare(
    `INSERT INTO net_worth_snapshots (id, date, total_assets, total_liabilities, net_worth, breakdown, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    dateStr,
    Math.round(totalAssets * 100) / 100,
    Math.round(totalLiabilities * 100) / 100,
    Math.round(netWorth * 100) / 100,
    JSON.stringify(breakdown),
    input.notes ?? null,
    ts,
  );

  const row = toRow<NetWorthSnapshotRow>(
    db.prepare('SELECT * FROM net_worth_snapshots WHERE id = ?').get(id)
  );

  return { ...row, breakdown_parsed: breakdown };
}

export function getNetWorthHistory(
  db: Database,
  input: GetNetWorthHistoryInput = {}
): NetWorthResult[] {
  const { from_date, to_date, limit = 90 } = input;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (from_date) { conditions.push('date >= ?'); params.push(from_date); }
  if (to_date)   { conditions.push('date <= ?'); params.push(to_date); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM net_worth_snapshots ${where} ORDER BY date DESC LIMIT ?`;
  params.push(limit);

  const rows = toRow<NetWorthSnapshotRow[]>(db.prepare(sql).all(...params));

  return rows.map((row) => ({
    ...row,
    breakdown_parsed: row.breakdown ? JSON.parse(row.breakdown) : {},
  }));
}
