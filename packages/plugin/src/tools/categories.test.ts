import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getDb, resetDb } from '../db/index.js';
import { getCategories, addCategory, deleteCategory } from './categories.js';

describe('Categories', () => {
  beforeEach(() => { resetDb(); });
  afterEach(() => { resetDb(); });

  it('returns built-in categories after migration', () => {
    const db = getDb(':memory:');
    const cats = getCategories(db);
    expect(cats.length).toBeGreaterThan(10);
    const names = cats.map((c) => c.name);
    expect(names).toContain('Food & Dining');
    expect(names).toContain('Transport');
    expect(names).toContain('Income');
  });

  it('adds a user-defined category', () => {
    const db = getDb(':memory:');
    const cat = addCategory(db, { name: 'Pets' });
    expect(cat.name).toBe('Pets');
    expect(cat.is_builtin).toBe(0);
    expect(cat.parent).toBeNull();
  });

  it('adds a user-defined subcategory', () => {
    const db = getDb(':memory:');
    // Use an existing built-in parent
    const cat = addCategory(db, { name: 'Vet', parent: 'Health' });
    expect(cat.parent).toBe('Health');
  });

  it('throws when adding duplicate category', () => {
    const db = getDb(':memory:');
    addCategory(db, { name: 'Pets' });
    expect(() => addCategory(db, { name: 'Pets' })).toThrow('already exists');
  });

  it('throws when adding subcategory with non-existent parent', () => {
    const db = getDb(':memory:');
    expect(() =>
      addCategory(db, { name: 'Vet', parent: 'Animals' })
    ).toThrow('not found');
  });

  it('deletes a user-defined category', () => {
    const db = getDb(':memory:');
    const cat = addCategory(db, { name: 'Pets' });
    const result = deleteCategory(db, cat.id);
    expect(result.deleted).toBe(true);
  });

  it('throws when deleting a built-in category', () => {
    const db = getDb(':memory:');
    const cats = getCategories(db);
    const builtin = cats.find((c) => c.is_builtin === 1);
    expect(builtin).toBeDefined();
    expect(() => deleteCategory(db, builtin!.id)).toThrow('Built-in categories cannot be deleted');
  });
});
