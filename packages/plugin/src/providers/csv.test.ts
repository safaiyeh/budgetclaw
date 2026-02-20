import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CsvDataProvider } from './csv.js';

describe('CsvDataProvider', () => {
  const tmpFile = join(tmpdir(), `budgetclaw-test-${Date.now()}.csv`);

  afterEach(() => {
    try { unlinkSync(tmpFile); } catch { /* ok */ }
  });

  it('parses a simple CSV with standard columns', async () => {
    writeFileSync(tmpFile, [
      'date,amount,description,category',
      '2026-02-01,-45.50,Whole Foods,Groceries',
      '2026-02-02,-6.50,Starbucks,Coffee',
      '2026-02-03,3200,Paycheck,Salary',
    ].join('\n'));

    const provider = new CsvDataProvider({
      filePath: tmpFile,
      accountExternalId: 'acc-1',
    });

    const { added } = await provider.getTransactions();
    expect(added).toHaveLength(3);
    expect(added[0]?.amount).toBe(-45.5);
    expect(added[0]?.description).toBe('Whole Foods');
    expect(added[1]?.amount).toBe(-6.5);
    expect(added[2]?.amount).toBe(3200);
  });

  it('parses MM/DD/YYYY dates', async () => {
    writeFileSync(tmpFile, [
      'date,amount,description',
      '02/15/2026,-100,Test',
    ].join('\n'));

    const provider = new CsvDataProvider({
      filePath: tmpFile,
      accountExternalId: 'acc-1',
    });

    const { added } = await provider.getTransactions();
    expect(added[0]?.date).toBe('2026-02-15');
  });

  it('uses custom column mapping', async () => {
    writeFileSync(tmpFile, [
      'Transaction Date,Debit Amount,Memo',
      '2026-02-01,50.00,Rent payment',
    ].join('\n'));

    const provider = new CsvDataProvider({
      filePath: tmpFile,
      accountExternalId: 'acc-1',
      mapping: {
        date: 'Transaction Date',
        amount: 'Debit Amount',
        description: 'Memo',
      },
      invertAmounts: true,
    });

    const { added } = await provider.getTransactions();
    expect(added[0]?.amount).toBe(-50);
    expect(added[0]?.description).toBe('Rent payment');
  });

  it('generates stable external_ids for deduplication', async () => {
    writeFileSync(tmpFile, [
      'date,amount,description',
      '2026-02-01,-45,Groceries',
      '2026-02-01,-45,Groceries',
    ].join('\n'));

    const provider = new CsvDataProvider({
      filePath: tmpFile,
      accountExternalId: 'acc-1',
    });

    const { added } = await provider.getTransactions();
    // Both rows get external_ids; they differ by row index
    expect(added).toHaveLength(2);
    expect(added[0]?.external_id).not.toBe(added[1]?.external_id);
  });

  it('uses explicit external_id column if present', async () => {
    writeFileSync(tmpFile, [
      'date,amount,description,id',
      '2026-02-01,-45,Test,TXN-001',
    ].join('\n'));

    const provider = new CsvDataProvider({
      filePath: tmpFile,
      accountExternalId: 'acc-1',
    });

    const { added } = await provider.getTransactions();
    expect(added[0]?.external_id).toBe('TXN-001');
  });

  it('strips currency symbols from amounts', async () => {
    writeFileSync(tmpFile, [
      'date,amount,description',
      '2026-02-01,"$1,234.56",Big purchase',
    ].join('\n'));

    const provider = new CsvDataProvider({
      filePath: tmpFile,
      accountExternalId: 'acc-1',
    });

    const { added } = await provider.getTransactions();
    expect(added[0]?.amount).toBe(1234.56);
  });
});
