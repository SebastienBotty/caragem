import { UserError } from './errors.ts';

export const csvMaxBytes = 1024 * 1024;
export const csvMaxRows = 5000;
const formula = /^[\s]*[=+\-@]|^[\t\r\n\0]/u;

export function csvCell(value: string): string {
  return value.startsWith("'") && (value.startsWith("''") || formula.test(value.slice(1)))
    ? value.slice(1)
    : value;
}

export function writeCsv(
  headers: readonly string[],
  rows: (string | number | boolean | undefined)[][],
): string {
  const encode = (value: string | number | boolean | undefined) => {
    let text = String(value ?? '');
    // ASVS 1.2.10: escape CSV syntax and spreadsheet formulas at export, not in stored data.
    if (typeof value === 'string' && (formula.test(text) || text.startsWith("'")))
      text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    '\ufeff' + [headers, ...rows].map((row) => row.map(encode).join(';')).join('\r\n') + '\r\n'
  );
}

export function parseCsv(input: string): {
  headers: string[];
  rows: string[][];
  rowNumbers: number[];
} {
  if (new TextEncoder().encode(input).length > csvMaxBytes)
    throw new UserError('Fichier CSV trop volumineux (limite : 1 Mio).');
  const text = input.replace(/^\ufeff/, '');
  const counts = new Map([
    [';', 0],
    [',', 0],
    ['\t', 0],
  ]);
  let inside = false,
    hasHeader = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (!/\s/u.test(char)) hasHeader = true;
    if (char === '"') {
      if (inside && text[i + 1] === '"') i++;
      else inside = !inside;
    } else if (!inside) {
      if (char === '\n' || char === '\r') {
        if (hasHeader) break;
        counts.forEach((_, key) => counts.set(key, 0));
        continue;
      }
      if (counts.has(char)) counts.set(char, counts.get(char)! + 1);
    }
  }
  const delimiter = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const records: string[][] = [];
  const rowNumbers: number[] = [];
  let physicalLine = 1,
    recordLine = 1;
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const cell = () => {
    row.push(field);
    field = '';
    closed = false;
    if (row.length > 100) throw new UserError('Limite de 100 colonnes CSV dépassée.');
  };
  const record = () => {
    cell();
    if (row.some((v) => v.trim() !== '')) {
      records.push(row);
      rowNumbers.push(recordLine);
    }
    row = [];
    if (records.length > csvMaxRows + 1)
      throw new UserError('Limite de 5 000 lignes CSV dépassée.');
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\0') throw new UserError('Caractère nul interdit dans un CSV.');
    if (quoted) {
      if (char === '\n' || (char === '\r' && text[i + 1] !== '\n')) physicalLine++;
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === delimiter) cell();
    else if (char === '\r' || char === '\n') {
      record();
      if (char === '\r' && text[i + 1] === '\n') i++;
      physicalLine++;
      recordLine = physicalLine;
    } else if (char === '"' && field.length === 0 && !closed) quoted = true;
    else {
      if (char === '"' || (closed && !/\s/u.test(char)))
        throw new UserError('Guillemets CSV incorrects.');
      if (!closed) field += char;
    }
  }
  if (quoted) throw new UserError('Guillemet CSV non fermé.');
  if (field.length || row.length || closed) record();
  if (!records.length) throw new UserError('Le fichier CSV est vide.');
  const headers = records.shift()!.map((value) => value.trim());
  rowNumbers.shift();
  if (
    headers.some((h) => !h) ||
    new Set(headers.map((h) => h.toLowerCase())).size !== headers.length
  )
    throw new UserError('Chaque colonne doit avoir un nom unique et non vide.');
  if (records.some((r) => r.length !== headers.length))
    throw new UserError('Une ligne CSV ne contient pas le même nombre de colonnes que l’en-tête.');
  return { headers, rows: records, rowNumbers };
}
