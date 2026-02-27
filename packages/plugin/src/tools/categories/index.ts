import type { Database } from '../../db/index.js';
import { toRow } from '../../db/types.js';
import type { CategoryRow } from '../../db/types.js';

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
  return toRow<CategoryRow[]>(
    db.prepare('SELECT * FROM categories ORDER BY parent NULLS FIRST, name').all()
  );
}

export function addCategory(db: Database, input: AddCategoryInput): CategoryRow {
  const { name, parent } = input;

  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  if (existing) {
    throw new Error(`Category "${name}" already exists`);
  }

  if (parent) {
    const parentRow = db.prepare('SELECT id FROM categories WHERE name = ?').get(parent);
    if (!parentRow) {
      throw new Error(`Parent category "${parent}" not found`);
    }
  }

  const id = uuid();
  const ts = now();

  db.prepare(
    'INSERT INTO categories (id, name, parent, is_builtin, created_at) VALUES (?, ?, ?, 0, ?)'
  ).run(id, name, parent ?? null, ts);

  return toRow<CategoryRow>(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
}

export function deleteCategory(db: Database, id: string): { deleted: boolean } {
  const row = toRow<{ is_builtin: number } | undefined>(
    db.prepare('SELECT is_builtin FROM categories WHERE id = ?').get(id)
  );

  if (!row) {
    throw new Error(`Category "${id}" not found`);
  }
  if (row.is_builtin === 1) {
    throw new Error('Built-in categories cannot be deleted');
  }

  const result = db.prepare('DELETE FROM categories WHERE id = ? AND is_builtin = 0').run(id);
  return { deleted: result.changes > 0 };
}
