import * as XLSX from 'xlsx';
import { inflateRawSync } from 'node:zlib';
import { csvMaxBytes, csvMaxRows, parseCsv, writeCsv } from '../lib/csv.ts';
export { writeSpreadsheet } from '../lib/spreadsheet-export.ts';
import { UserError } from '../lib/errors.ts';

// Bound expanded XLSX data before handing the archive to the workbook parser.
function checkArchive(data: Buffer) {
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--)
    if (data.readUInt32LE(end) === 0x06054b50) break;
  if (end < 0 || data.readUInt32LE(end) !== 0x06054b50)
    throw new UserError('Archive Excel invalide.');
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16),
    total = 0;
  if (
    count > 500 ||
    count === 0 ||
    data.readUInt16LE(end + 8) !== count ||
    data.readUInt32LE(end + 4) !== 0
  )
    throw new UserError('Classeur trop complexe.');
  const checkExtra = (start: number, length: number) => {
    const limit = start + length;
    if (limit > data.length) throw new UserError('Archive Excel invalide.');
    while (start < limit) {
      if (start + 4 > limit || data.readUInt16LE(start) === 1)
        throw new UserError('Archive Excel invalide ou ZIP64 non pris en charge.');
      start += 4 + data.readUInt16LE(start + 2);
    }
    if (start !== limit) throw new UserError('Archive Excel invalide.');
  };
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50)
      throw new UserError('Archive Excel invalide.');
    total += data.readUInt32LE(offset + 24);
    if (total > 8 * csvMaxBytes || data.readUInt16LE(offset + 8) & 1)
      throw new UserError('Classeur trop volumineux après décompression ou chiffré.');
    const local = data.readUInt32LE(offset + 42),
      size = data.readUInt32LE(offset + 20);
    if (local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50)
      throw new UserError('Archive Excel invalide.');
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const method = data.readUInt16LE(offset + 10);
    checkExtra(offset + 46 + data.readUInt16LE(offset + 28), data.readUInt16LE(offset + 30));
    checkExtra(local + 30 + data.readUInt16LE(local + 26), data.readUInt16LE(local + 28));
    const localSize = data.readUInt32LE(local + 18),
      localExpanded = data.readUInt32LE(local + 22);
    if (
      start + size > data.length ||
      ![0, 8].includes(method) ||
      data.readUInt16LE(local + 8) !== method ||
      data.readUInt16LE(local + 6) & 0x2041 ||
      (localSize !== 0 && localSize !== size) ||
      (localExpanded !== 0 && localExpanded !== data.readUInt32LE(offset + 24))
    )
      throw new UserError('Compression Excel non prise en charge.');
    try {
      const compressed = data.subarray(start, start + size);
      const expanded =
        method === 8
          ? inflateRawSync(compressed, { maxOutputLength: 8 * csvMaxBytes })
          : compressed;
      if (expanded.length !== data.readUInt32LE(offset + 24)) throw new Error('size');
    } catch {
      throw new UserError('Archive Excel invalide ou trop volumineuse après décompression.');
    }
    offset +=
      46 +
      data.readUInt16LE(offset + 28) +
      data.readUInt16LE(offset + 30) +
      data.readUInt16LE(offset + 32);
  }
}

export function readSpreadsheet(base64: string) {
  const data = Buffer.from(base64, 'base64');
  if (!data.length || data.length > csvMaxBytes || data.toString('base64') !== base64)
    throw new UserError('Fichier Excel invalide ou supérieur à 1 Mio.');
  const zip = data.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'));
  const xls = data.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  if (!zip && !xls) throw new UserError('Le fichier doit être un vrai classeur XLS ou XLSX.');
  if (zip) checkArchive(data);
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(data, {
      type: 'buffer',
      sheets: 0,
      sheetRows: csvMaxRows + 2,
      cellFormula: true,
      cellDates: true,
    });
  } catch {
    throw new UserError('Classeur illisible, endommagé ou protégé par un mot de passe.');
  }
  const sheetName = book.SheetNames[0],
    sheet = book.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) throw new UserError('La première feuille est vide.');
  const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
  if (range.e.c >= 100 || range.e.r > csvMaxRows)
    throw new UserError('Maximum 100 colonnes et 5 000 lignes de données par feuille.');
  for (const [key, cell] of Object.entries(sheet)) {
    if (key.startsWith('!')) continue;
    if (cell.f || cell.t === 'e')
      throw new UserError(
        'Les formules et cellules en erreur sont refusées. Remplacez-les par leurs valeurs.',
      );
    if (cell.t === 'd') {
      throw new UserError(
        'Saisissez les dates en texte ISO, avec le fuseau pour les heures (ex. 2026-11-10T09:00:00+01:00).',
      );
    }
  }
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });
  const width = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? '')));
  const csv = writeCsv(normalized[0], normalized.slice(1));
  parseCsv(csv);
  return { csv, sheetName, sheetCount: book.SheetNames.length };
}
