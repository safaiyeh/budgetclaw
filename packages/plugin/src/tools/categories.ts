import type { Database } from 'bun:sqlite';
import type { CategoryRow } from '../db/types.js';

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export interface AddCategoryInput {
  name: string;
  parent?: string;
}

export function getCategories(db: Database): CategoryRow[] {
  return db
    .query('SELECT * FROM categories ORDER BY parent NULLS FIRST, name')
    .all() as CategoryRow[];
}

export function addCategory(db: Database, input: AddCategoryInput): CategoryRow {
  const { name, parent } = input;

  const existing = db.query('SELECT id FROM categories WHERE name = ?').get(name);
  if (existing) {
    throw new Error(`Category "${name}" already exists`);
  }

  if (parent) {
    const parentRow = db.query('SELECT id FROM categories WHERE name = ?').get(parent);
    if (!parentRow) {
      throw new Error(`Parent category "${parent}" not found`);
    }
  }

  const id = uuid();
  const ts = now();

  db.run(
    'INSERT INTO categories (id, name, parent, is_builtin, created_at) VALUES (?, ?, ?, 0, ?)',
    [id, name, parent ?? null, ts]
  );

  return db.query('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow;
}

export function deleteCategory(db: Database, id: string): { deleted: boolean } {
  const row = db.query('SELECT is_builtin FROM categories WHERE id = ?').get(id) as
    | { is_builtin: number }
    | null;

  if (!row) {
    throw new Error(`Category "${id}" not found`);
  }
  if (row.is_builtin === 1) {
    throw new Error('Built-in categories cannot be deleted');
  }

  const result = db.run('DELETE FROM categories WHERE id = ? AND is_builtin = 0', [id]);
  return { deleted: result.changes > 0 };
}
