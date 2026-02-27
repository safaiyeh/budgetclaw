import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { getDb, resetDb } from '../../db/index.js';
import { addAccount } from '../accounts/index.js';
import { readStatement, importTransactions } from './statements.js';

// Mock pdf-parse so tests don't need a real PDF file
vi.mock('pdf-parse', () => ({
  default: async (_buffer: Buffer) => ({
    numpages: 3,
    text: 'Page 1: OPENING BALANCE $1,000.00\nPage 2: 2026-01-15 Starbucks -$6.50\nPage 3: CLOSING BALANCE $993.50',
  }),
}));

// ─── readStatement ────────────────────────────────────────────────────────────

describe('readStatement', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `budgetclaw-test-${Date.now()}.txt`);
  });

  afterEach(() => {
    try { unlinkSync(tmpFile); } catch { /* already removed */ }
  });

  it('reads a plain text file', async () => {
    writeFileSync(tmpFile, 'DATE,AMOUNT,DESCRIPTION\n2026-01-15,-6.50,Starbucks', 'utf-8');
    const result = await readStatement({ file_path: tmpFile });
    expect(result.format).toBe('text');
    expect(result.text).toContain('Starbucks');
    expect(result.character_count).toBe(result.text.length);
    expect(result.pages).toBeUndefined();
    expect(result.file_path).toBe(tmpFile);
  });

  it('returns correct character_count', async () => {
    const content = 'hello world';
    writeFileSync(tmpFile, content, 'utf-8');
    const result = await readStatement({ file_path: tmpFile });
    expect(result.character_count).toBe(11);
  });

  it('expands ~/ in file path', async () => {
    const filename = `budgetclaw-tilde-test-${Date.now()}.txt`;
    const fullPath = join(homedir(), filename);
    writeFileSync(fullPath, 'tilde test', 'utf-8');
    try {
      const result = await readStatement({ file_path: `~/${filename}` });
      expect(result.file_path).toBe(fullPath);
      expect(result.text).toBe('tilde test');
    } finally {
      unlinkSync(fullPath);
    }
  });

  it('reads a PDF file via pdf-parse (all pages)', async () => {
    const pdfFile = join(tmpdir(), `budgetclaw-test-${Date.now()}.pdf`);
    writeFileSync(pdfFile, Buffer.from('%PDF-1.4 placeholder'));
    try {
      const result = await readStatement({ file_path: pdfFile });
      expect(result.format).toBe('pdf');
      expect(result.pages).toBe(3);
      expect(result.text).toContain('Page 1');
      expect(result.text).toContain('Page 3');
      expect(result.character_count).toBe(result.text.length);
    } finally {
      unlinkSync(pdfFile);
    }
  });

  it('throws when file does not exist', async () => {
    await expect(readStatement({ file_path: '/tmp/does-not-exist-budgetclaw.txt' }))
      .rejects.toThrow();
  });
});

// ─── importTransactions ───────────────────────────────────────────────────────

describe('importTransactions', () => {
  beforeEach(() => { resetDb(); });
  afterEach(() => { resetDb(); });

  function setup() {
    const db = getDb(':memory:');
    const account = addAccount(db, { name: 'Chase Checking', type: 'checking' });
    return { db, account };
  }

  it('bulk imports transactions and returns correct counts', () => {
    const { db, account } = setup();
    const result = importTransactions(db, {
      account_id: account.id,
      transactions: [
        { date: '2026-01-15', amount: -6.50, merchant: 'Starbucks', category: 'Food & Dining' },
        { date: '2026-01-16', amount: -45.00, merchant: 'Whole Foods', category: 'Food & Dining' },
        { date: '2026-01-17', amount: 3200.00, description: 'Salary', category: 'Income' },
      ],
    });
    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('sets source to "statement"', () => {
    const { db, account } = setup();
    importTransactions(db, {
      account_id: account.id,
      transactions: [{ date: '2026-01-15', amount: -6.50 }],
    });
    const row = db.prepare('SELECT source FROM transactions WHERE account_id = ?').get(account.id) as { source: string } | undefined;
    expect(row?.source).toBe('statement');
  });

  it('deduplicates on re-import using provided external_id', () => {
    const { db, account } = setup();
    const transactions = [
      { date: '2026-01-15', amount: -6.50, external_id: 'stmt-abc-001' },
      { date: '2026-01-16', amount: -45.00, external_id: 'stmt-abc-002' },
    ];

    const first = importTransactions(db, { account_id: account.id, transactions });
    expect(first.imported).toBe(2);
    expect(first.skipped).toBe(0);

    const second = importTransactions(db, { account_id: account.id, transactions });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it('auto-generates external_id and deduplicates on re-import', () => {
    const { db, account } = setup();
    const transactions = [
      { date: '2026-01-15', amount: -6.50, merchant: 'Starbucks' },
    ];

    const first = importTransactions(db, { account_id: account.id, transactions });
    expect(first.imported).toBe(1);

    const second = importTransactions(db, { account_id: account.id, transactions });
    expect(second.skipped).toBe(1);
  });

  it('throws when account does not exist', () => {
    const { db } = setup();
    expect(() =>
      importTransactions(db, {
        account_id: 'non-existent',
        transactions: [{ date: '2026-01-15', amount: -10 }],
      })
    ).toThrow('not found');
  });

  it('stores all optional fields', () => {
    const { db, account } = setup();
    importTransactions(db, {
      account_id: account.id,
      transactions: [{
        date: '2026-01-15',
        amount: -6.50,
        description: 'Morning coffee',
        merchant: 'Starbucks',
        category: 'Food & Dining',
        subcategory: 'Coffee',
        type: 'debit',
        pending: true,
        notes: 'with tip',
        external_id: 'test-ext-001',
      }],
    });
    const row = db.prepare('SELECT * FROM transactions WHERE account_id = ?').get(account.id) as Record<string, unknown> | undefined;
    expect(row?.description).toBe('Morning coffee');
    expect(row?.merchant).toBe('Starbucks');
    expect(row?.category).toBe('Food & Dining');
    expect(row?.subcategory).toBe('Coffee');
    expect(row?.type).toBe('debit');
    expect(row?.pending).toBe(1);
    expect(row?.notes).toBe('with tip');
    expect(row?.external_id).toBe('test-ext-001');
  });

  it('handles empty transaction list', () => {
    const { db, account } = setup();
    const result = importTransactions(db, { account_id: account.id, transactions: [] });
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
