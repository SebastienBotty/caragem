import * as XLSX from 'xlsx';
import { csvCell, parseCsv } from './csv.ts';

export function writeSpreadsheet(csv: string, format: 'xls' | 'xlsx'): string {
  const { headers, rows } = parseCsv(csv);
  // Explicit string cells preserve phone numbers, identifiers and literal formula-like text.
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows.map((r) => r.map(csvCell))]);
  sheet['!cols'] = headers.map(() => ({ wch: 24 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Données');
  return XLSX.write(book, { type: 'base64', bookType: format, compression: true });
}
