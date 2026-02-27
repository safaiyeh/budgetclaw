import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { Database } from '../../db/index.js';
import { toRow } from '../../db/types.js';
import type { AccountRow } from '../../db/types.js';

export interface ReadStatementInput {
  file_path: string;
}

export interface ReadStatementResult {
  file_path: string;
  format: 'pdf' | 'text';
  pages?: number;
  text: string;
  character_count: number;
}

export interface ImportTransactionItem {
  date: string;
  amount: number;
  description?: string;
  merchant?: string;
  category?: string;
  subcategory?: string;
  type?: string;
  pending?: boolean;
  notes?: string;
  external_id?: string;
}

export interface ImportTransactionsInput {
  account_id: string;
  transactions: ImportTransactionItem[];
}

export interface ImportTransactionsResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function readStatement(input: ReadStatementInput): Promise<ReadStatementResult> {
  const resolvedPath = input.file_path.replace(/^~(?=\/|$)/, homedir());

  if (resolvedPath.toLowerCase().endsWith('.pdf')) {
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = readFileSync(resolvedPath);
    const data = await pdfParse(buffer);
    return {
      file_path: resolvedPath,
      format: 'pdf',
      pages: data.numpages,
      text: data.text,
      character_count: data.text.length,
    };
  }

  const text = readFileSync(resolvedPath, 'utf-8');
  return {
    file_path: resolvedPath,
    format: 'text',
    text,
    character_count: text.length,
  };
}

export function importTransactions(
  db: Database,
  input: ImportTransactionsInput,
): ImportTransactionsResult {
  const { account_id, transactions } = input;

  const account = toRow<AccountRow | undefined>(
    db.prepare('SELECT id FROM accounts WHERE id = ?').get(account_id),
  );
  if (!account) {
    throw new Error(`Account "${account_id}" not found`);
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (id, account_id, date, amount, currency, description, merchant, category, subcategory,
       type, source, external_id, pending, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, 'statement', ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    try {
      const external_id =
        tx.external_id ?? `stmt-${account_id}-${tx.date}-${tx.amount}-${i}`;
      const id = crypto.randomUUID();
      const result = insertStmt.run(
        id, account_id, tx.date, tx.amount,
        tx.description ?? null, tx.merchant ?? null, tx.category ?? null,
        tx.subcategory ?? null, tx.type ?? null,
        external_id,
        tx.pending ? 1 : 0,
        tx.notes ?? null,
        now, now,
      );
      if (result.changes > 0) { imported++; } else { skipped++; }
    } catch (e) {
      errors.push(
        `Transaction ${i} (${tx.date}, ${tx.amount}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { imported, skipped, errors };
}
