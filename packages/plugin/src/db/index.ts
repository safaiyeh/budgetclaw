import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from './migrations.js';

export type Database = DatabaseSync;

const DEFAULT_DIR = join(homedir(), '.budgetclaw');
const DEFAULT_DB_PATH = join(DEFAULT_DIR, 'budget.db');

let _db: Database | null = null;

/**
 * Returns the singleton Database instance, creating and migrating it on first call.
 * Pass `:memory:` as dbPath for in-memory testing.
 */
export function getDb(dbPath?: string): Database {
  if (_db) return _db;

  const resolvedPath = dbPath ?? DEFAULT_DB_PATH;
  const isMemory = resolvedPath === ':memory:';

  if (!isMemory) {
    const dir = DEFAULT_DIR;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // Enforce directory permissions: 700
    try {
      chmodSync(dir, 0o700);
    } catch {
      // May fail on some systems (e.g., Windows) — non-fatal
    }
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  if (!isMemory) {
    // Enforce file permissions: 600
    try {
      chmodSync(resolvedPath, 0o600);
    } catch {
      // Non-fatal
    }
  }

  runMigrations(db);
  _db = db;
  return db;
}

/**
 * Reset the singleton — used in tests to get a fresh DB.
 */
export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
