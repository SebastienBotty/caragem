import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { readSpreadsheet, writeSpreadsheet } from '../src/server/spreadsheet-transfer.ts';
import { csvCell, parseCsv, writeCsv } from '../src/lib/csv.ts';
import { createSeed } from '../src/lib/domain.ts';
import {
  exampleDataCsv,
  prepareCsvImport,
  suggestMapping,
  type TransferKind,
} from '../src/lib/data-transfer.ts';

test('real XLS and XLSX preserve strings and all linked example datasets can be imported', () => {
  for (const format of ['xls', 'xlsx'] as const) {
    let state = createSeed('excel', false);
    for (const kind of [
      'customers',
      'stock',
      'vehicles',
      'reservations',
      'appointments',
      'orders',
      'documents',
    ] as TransferKind[]) {
      const file = writeSpreadsheet(exampleDataCsv(kind), format);
      const { csv } = readSpreadsheet(file);
      const result = prepareCsvImport(
        state,
        kind,
        csv,
        suggestMapping(kind, parseCsv(csv).headers),
      );
      assert.deepEqual(result.report.errors, [], `${format} ${kind}`);
      assert.equal(result.report.added, 1);
      state = result.state;
    }
    assert.equal(state.customers[0].phone, '+32412345678');
    assert.equal(state.parts[0].price, 1500);
    const csv = writeCsv(
      ['name', 'phone'],
      [
        ['=1+1', '00123'],
        ["'literal", '+324'],
      ],
    );
    const binary = writeSpreadsheet(csv, format);
    const sheet = XLSX.read(binary, { type: 'base64' }).Sheets['Données'];
    assert.equal(sheet.A2.t, 's');
    assert.equal(sheet.A2.f, undefined);
    assert.equal(sheet.A2.v, '=1+1');
    assert.deepEqual(
      parseCsv(readSpreadsheet(binary).csv).rows.map((r) => r.map(csvCell)),
      [
        ['=1+1', '00123'],
        ["'literal", '+324'],
      ],
    );
    assert.equal(
      parseCsv(readSpreadsheet(writeSpreadsheet(writeCsv(['name'], []), format)).csv).rows.length,
      0,
    );
  }
});

test('Excel import rejects bad formats, formulas, excessive dimensions and expanded archives; first sheet is explicit', () => {
  function encode(sheet: XLSX.WorkSheet, format: 'xls' | 'xlsx' = 'xlsx') {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Clients');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['unused']]), 'Autres');
    return XLSX.write(book, { type: 'base64', bookType: format });
  }
  for (const format of ['xls', 'xlsx'] as const) {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['name', 'at'],
      ['Camille', '2026-11-10T09:00:00+01:00'],
    ]);
    const result = readSpreadsheet(encode(sheet, format));
    assert.equal(result.sheetCount, 2);
    assert.equal(result.sheetName, 'Clients');
    assert.equal(parseCsv(result.csv).rows[0][1], '2026-11-10T09:00:00+01:00');
    sheet.B2 = { t: 'd', v: new Date('2026-11-10T09:00:00Z'), z: 'yyyy-mm-dd hh:mm:ss' };
    assert.throws(() => readSpreadsheet(encode(sheet, format)), /texte ISO/);
    sheet.B2 = { t: 's', v: '2026-11-10' };
    sheet.A2 = { t: 'n', f: '1+1', v: 2 };
    // SheetJS does not write BIFF formula tokens when generating legacy XLS fixtures.
    if (format === 'xlsx') assert.throws(() => readSpreadsheet(encode(sheet, format)), /formules/);
    sheet.A2 = { t: 'e', v: 7 };
    assert.throws(() => readSpreadsheet(encode(sheet, format)), /erreur/);
    sheet['!ref'] = 'A1:CW5002';
    assert.throws(() => readSpreadsheet(encode(sheet, format)), /colonnes/);
  }
  for (const input of [
    '',
    'bad!',
    Buffer.from('name;phone\na;1').toString('base64'),
    Buffer.from('504b0304', 'hex').toString('base64'),
    Buffer.from('d0cf11e0a1b11ae1', 'hex').toString('base64'),
  ])
    assert.throws(() => readSpreadsheet(input));
  const archive = Buffer.from(encode(XLSX.utils.aoa_to_sheet([['name'], ['Camille']])), 'base64');
  const central = archive.indexOf(Buffer.from('504b0102', 'hex'));
  archive.writeUInt32LE(9 * 1024 * 1024, central + 24);
  assert.throws(() => readSpreadsheet(archive.toString('base64')), /décompression/);
});
