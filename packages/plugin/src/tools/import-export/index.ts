import { writeFileSync } from 'node:fs';
import type { Database } from '../../db/index.js';
import { toRow } from '../../db/types.js';
import type { AccountRow } from '../../db/types.js';
import { CsvDataProvider, type CsvImportOptions } from '../../providers/csv/index.js';
import Papa from 'papaparse';

export interface ImportCsvInput {
  file_path: string;
  account_id: string;
  mapping?: CsvImportOptions['mapping'];
  date_format?: string;
  invert_amounts?: boolean;
}

export interface ImportCsvResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ExportCsvInput {
  file_path: string;
  account_id?: string;
  from_date?: string;
  to_date?: string;
}

export async function importCsv(db: Database, input: ImportCsvInput): Promise<ImportCsvResult> {
  const { file_path, account_id, mapping, date_format, invert_amounts } = input;

  const account = toRow<AccountRow | undefined>(
    db.prepare('SELECT * FROM accounts WHERE id = ?').get(account_id)
  );
  if (!account) {
    throw new Error(`Account "${account_id}" not found`);
  }

  const provider = new CsvDataProvider({
    filePath: file_path,
    accountExternalId: account_id,
    mapping,
    dateFormat: date_format,
    invertAmounts: invert_amounts,
  });

  const { added } = await provider.getTransactions();

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (id, account_id, date, amount, currency, description, merchant, category, subcategory,
       type, source, external_id, pending, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv', ?, 0, ?, ?, ?)
  `);

  for (const tx of added) {
    try {
      const id = crypto.randomUUID();
      const result = insertStmt.run(
        id, account_id, tx.date, tx.amount, tx.currency ?? 'USD',
        tx.description ?? null, tx.merchant ?? null, tx.category ?? null,
        tx.subcategory ?? null, tx.type ?? null, tx.external_id,
        tx.notes ?? null, now, now
      );
      if (result.changes > 0) { imported++; } else { skipped++; }
    } catch (err) {
      errors.push(`Row (external_id: ${tx.external_id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { imported, skipped, errors };
}

export function exportCsv(db: Database, input: ExportCsvInput): { exported: number; file_path: string } {
  const { file_path, account_id, from_date, to_date } = input;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (account_id) { conditions.push('t.account_id = ?'); params.push(account_id); }
  if (from_date)  { conditions.push('t.date >= ?');      params.push(from_date); }
  if (to_date)    { conditions.push('t.date <= ?');      params.push(to_date); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = toRow<Record<string, unknown>[]>(db.prepare(`
    SELECT
      t.id, a.name AS account_name, t.date, t.amount, t.currency,
      t.description, t.merchant, t.category, t.subcategory,
      t.type, t.source, t.external_id, t.pending, t.notes
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    ${where}
    ORDER BY t.date DESC, t.created_at DESC
  `).all(...params));

  const csv = Papa.unparse(rows, { header: true });
  writeFileSync(file_path, csv, 'utf-8');

  return { exported: rows.length, file_path };
}
