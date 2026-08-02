import { stringify } from 'csv-stringify/sync';
import { parse } from 'csv-parse/sync';

export function fromCsv(csvText: string): Record<string, string>[] {
  return parse(csvText, {
    columns: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];
}

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: ImportRowError[];
}

export interface CsvColumn<T> {
  key: keyof T;
  header: string;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  return stringify(rows as unknown as Record<string, unknown>[], {
    header: true,
    columns: columns.map((c) => ({ key: String(c.key), header: c.header })),
  });
}
