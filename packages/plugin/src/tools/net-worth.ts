import type { Database } from 'bun:sqlite';
import type { NetWorthSnapshotRow, AccountRow } from '../db/types.js';

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

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * Calculate current net worth from account balances + portfolio holdings,
 * then save a snapshot.
 */
export function snapshotNetWorth(db: Database, input: SnapshotNetWorthInput = {}): NetWorthResult {
  const accounts = db
    .query('SELECT * FROM accounts WHERE is_active = 1')
    .all() as AccountRow[];

  const breakdown: Record<string, number> = {};
  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const account of accounts) {
    let balance = account.balance ?? 0;

    // For investment/crypto accounts, use portfolio value if available
    if (account.type === 'investment' || account.type === 'crypto') {
      const portfolioValue = db
        .query('SELECT SUM(value) AS total FROM portfolio_holdings WHERE account_id = ?')
        .get(account.id) as { total: number | null };
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

  db.run(
    `INSERT INTO net_worth_snapshots (id, date, total_assets, total_liabilities, net_worth, breakdown, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      dateStr,
      Math.round(totalAssets * 100) / 100,
      Math.round(totalLiabilities * 100) / 100,
      Math.round(netWorth * 100) / 100,
      JSON.stringify(breakdown),
      input.notes ?? null,
      ts,
    ]
  );

  const row = db
    .query('SELECT * FROM net_worth_snapshots WHERE id = ?')
    .get(id) as NetWorthSnapshotRow;

  return {
    ...row,
    breakdown_parsed: breakdown,
  };
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

  const rows = db.query(sql).all(...params) as NetWorthSnapshotRow[];

  return rows.map((row) => ({
    ...row,
    breakdown_parsed: row.breakdown ? JSON.parse(row.breakdown) : {},
  }));
}
