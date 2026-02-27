import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import type { DataProvider, RawAccount, RawTransaction, RawBalance } from '../interface.js';

export interface CsvColumnMapping {
  /** Column name that maps to transaction date */
  date?: string;
  /** Column name that maps to amount */
  amount?: string;
  /** Column name that maps to description/memo */
  description?: string;
  /** Column name that maps to merchant */
  merchant?: string;
  /** Column name that maps to category */
  category?: string;
  /** Column name that maps to subcategory */
  subcategory?: string;
  /** Column name that maps to transaction type */
  type?: string;
  /** Column name that maps to notes */
  notes?: string;
  /** Column name that maps to external_id (for deduplication) */
  external_id?: string;
}

export interface CsvImportOptions {
  filePath: string;
  accountExternalId: string;
  mapping?: CsvColumnMapping;
  /** Date format hint: 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY' */
  dateFormat?: string;
  /** If positive amounts are outflows (some bank exports) */
  invertAmounts?: boolean;
}

/**
 * Attempt to parse a date string into YYYY-MM-DD.
 */
function normaliseDate(raw: string, format?: string): string {
  raw = raw.trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // MM/DD/YYYY
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;

  // DD/MM/YYYY
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) ;
  if (dmy && format === 'DD/MM/YYYY')
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

  // Try native Date parsing as last resort
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  throw new Error(`Cannot parse date: "${raw}"`);
}

/**
 * CsvDataProvider implements DataProvider for CSV files.
 * Column mapping is flexible — pass a `mapping` object to override defaults.
 */
export class CsvDataProvider implements DataProvider {
  readonly name = 'csv';

  private options: CsvImportOptions;

  constructor(options: CsvImportOptions) {
    this.options = options;
  }

  async getAccounts(): Promise<RawAccount[]> {
    // CSV provides no account metadata — the caller supplies account info
    return [];
  }

  async getTransactions(_cursor?: string): Promise<{
    added: RawTransaction[];
    modified: RawTransaction[];
    removed: string[];
    nextCursor: string;
  }> {
    const { filePath, accountExternalId, mapping = {}, dateFormat, invertAmounts } = this.options;

    const content = readFileSync(filePath, 'utf-8');
    const result = Papa.parse<Record<string, string>>(content, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });

    if (result.errors.length > 0) {
      const firstError = result.errors[0];
      throw new Error(`CSV parse error: ${firstError?.message ?? 'unknown'}`);
    }

    const rows = result.data;
    const added: RawTransaction[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      // Resolve column names using mapping or common defaults
      const dateCol = mapping.date ?? this.detectColumn(row, ['date', 'Date', 'DATE', 'Transaction Date', 'Posted Date']);
      const amountCol = mapping.amount ?? this.detectColumn(row, ['amount', 'Amount', 'AMOUNT', 'Debit', 'Credit']);
      const descCol = mapping.description ?? this.detectColumn(row, ['description', 'Description', 'memo', 'Memo', 'MEMO', 'Details']);
      const merchantCol = mapping.merchant ?? this.detectColumn(row, ['merchant', 'Merchant', 'Payee', 'payee']);
      const categoryCol = mapping.category ?? this.detectColumn(row, ['category', 'Category', 'CATEGORY']);
      const subcategoryCol = mapping.subcategory ?? this.detectColumn(row, ['subcategory', 'Subcategory']);
      const typeCol = mapping.type ?? this.detectColumn(row, ['type', 'Type', 'Transaction Type']);
      const notesCol = mapping.notes ?? this.detectColumn(row, ['notes', 'Notes', 'note', 'Note']);
      const extIdCol = mapping.external_id ?? this.detectColumn(row, ['id', 'ID', 'transaction_id', 'Transaction ID', 'Reference']);

      if (!dateCol || !amountCol) {
        throw new Error(
          `CSV row ${i + 1}: Could not find required "date" or "amount" columns. ` +
          `Available columns: ${Object.keys(row).join(', ')}. ` +
          `Use the 'mapping' option to specify column names explicitly.`
        );
      }

      const rawDate = row[dateCol] ?? '';
      const rawAmount = row[amountCol] ?? '0';

      let date: string;
      try {
        date = normaliseDate(rawDate, dateFormat);
      } catch {
        // Skip rows with unparseable dates (e.g., header rows in some exports)
        continue;
      }

      let amount = parseFloat(rawAmount.replace(/[,$\s]/g, ''));
      if (isNaN(amount)) continue;

      if (invertAmounts) amount = -amount;

      const external_id = extIdCol && row[extIdCol]
        ? row[extIdCol]!
        : `csv-${accountExternalId}-${date}-${amount}-${i}`;

      added.push({
        external_id,
        account_external_id: accountExternalId,
        date,
        amount,
        description: descCol ? (row[descCol] ?? undefined) : undefined,
        merchant: merchantCol ? (row[merchantCol] ?? undefined) : undefined,
        category: categoryCol ? (row[categoryCol] ?? undefined) : undefined,
        subcategory: subcategoryCol ? (row[subcategoryCol] ?? undefined) : undefined,
        type: typeCol ? (row[typeCol] ?? undefined) : undefined,
        notes: notesCol ? (row[notesCol] ?? undefined) : undefined,
      });
    }

    return { added, modified: [], removed: [], nextCursor: '' };
  }

  async getBalances(): Promise<RawBalance[]> {
    return [];
  }

  private detectColumn(row: Record<string, string>, candidates: string[]): string | undefined {
    for (const candidate of candidates) {
      if (candidate in row) return candidate;
    }
    return undefined;
  }
}
