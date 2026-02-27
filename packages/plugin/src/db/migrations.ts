import type { Database } from './index.js';
import { BUILTIN_CATEGORIES } from '../categories/taxonomy.js';

/**
 * Each migration is keyed by its target user_version.
 * Migrations run in order from current+1 up to the latest version.
 */
const MIGRATIONS: Record<number, (db: Database) => void> = {
  1: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        institution  TEXT,
        type         TEXT NOT NULL,
        currency     TEXT NOT NULL DEFAULT 'USD',
        balance      REAL,
        source       TEXT NOT NULL DEFAULT 'manual',
        external_id  TEXT,
        is_active    INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id           TEXT PRIMARY KEY,
        account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        date         TEXT NOT NULL,
        amount       REAL NOT NULL,
        currency     TEXT NOT NULL DEFAULT 'USD',
        description  TEXT,
        merchant     TEXT,
        category     TEXT,
        subcategory  TEXT,
        type         TEXT,
        source       TEXT NOT NULL DEFAULT 'manual',
        external_id  TEXT,
        pending      INTEGER NOT NULL DEFAULT 0,
        notes        TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        UNIQUE(account_id, external_id)
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_date     ON transactions(date)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_account  ON transactions(account_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        parent     TEXT,
        is_builtin INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS budgets (
        id         TEXT PRIMARY KEY,
        category   TEXT NOT NULL,
        amount     REAL NOT NULL,
        period     TEXT NOT NULL DEFAULT 'monthly',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(category, period)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS portfolio_holdings (
        id           TEXT PRIMARY KEY,
        account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        symbol       TEXT NOT NULL,
        name         TEXT,
        quantity     REAL NOT NULL,
        price        REAL,
        value        REAL,
        currency     TEXT NOT NULL DEFAULT 'USD',
        asset_type   TEXT,
        price_source TEXT,
        price_as_of  TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        UNIQUE(account_id, symbol)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS net_worth_snapshots (
        id                TEXT PRIMARY KEY,
        date              TEXT NOT NULL,
        total_assets      REAL NOT NULL,
        total_liabilities REAL NOT NULL,
        net_worth         REAL NOT NULL,
        breakdown         TEXT,
        notes             TEXT,
        created_at        TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_nw_date ON net_worth_snapshots(date)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS provider_connections (
        id               TEXT PRIMARY KEY,
        provider         TEXT NOT NULL,
        institution_id   TEXT,
        institution_name TEXT,
        keychain_key     TEXT NOT NULL,
        item_id          TEXT,
        cursor           TEXT,
        last_synced_at   TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      )
    `);

    // Seed built-in categories
    const now = new Date().toISOString();
    const insertCategory = db.prepare(
      `INSERT OR IGNORE INTO categories (id, name, parent, is_builtin, created_at)
       VALUES (?, ?, ?, 1, ?)`
    );
    for (const { id, name, parent } of BUILTIN_CATEGORIES) {
      insertCategory.run(id, name, parent ?? null, now);
    }
  },

  2: (db) => {
    // Add connection_id FK from accounts → provider_connections
    db.exec(`ALTER TABLE accounts ADD COLUMN connection_id TEXT REFERENCES provider_connections(id) ON DELETE SET NULL`);

    // Backfill Plaid accounts: match (source, institution) → (provider, institution_name)
    db.exec(`
      UPDATE accounts SET connection_id = (
        SELECT pc.id FROM provider_connections pc
        WHERE pc.provider = accounts.source
          AND pc.institution_name = accounts.institution
      )
      WHERE accounts.source = 'plaid'
    `);

    // Backfill Coinbase accounts: match source='coinbase' → provider='coinbase'
    db.exec(`
      UPDATE accounts SET connection_id = (
        SELECT pc.id FROM provider_connections pc
        WHERE pc.provider = 'coinbase'
      )
      WHERE accounts.source = 'coinbase'
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_connection ON accounts(connection_id)`);
  },
};

export const LATEST_VERSION = Math.max(...Object.keys(MIGRATIONS).map(Number));

export function runMigrations(db: Database): void {
  // Enable foreign keys
  db.exec('PRAGMA foreign_keys = ON');

  const currentVersion = (
    db.prepare('PRAGMA user_version').get() as { user_version: number }
  ).user_version;

  if (currentVersion >= LATEST_VERSION) {
    return;
  }

  for (let v = currentVersion + 1; v <= LATEST_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (!migration) continue;

    db.exec('BEGIN');
    try {
      migration(db);
      db.exec(`PRAGMA user_version = ${v}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
