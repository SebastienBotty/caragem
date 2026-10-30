import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/lib/domain.ts';
import { parseCsv, writeCsv } from '../src/lib/csv.ts';
import { prepareCsvImport, suggestMapping, type TransferKind } from '../src/lib/data-transfer.ts';
import { readSpreadsheet, writeSpreadsheet } from '../src/server/spreadsheet-transfer.ts';

test('imports reject invalid cell values with French field labels, including invalid duplicates', () => {
  const state = createSeed('validation', true),
    before = JSON.stringify(state);
  function check(kind: TransferKind, row: Record<string, string>, field: RegExp) {
    const csv = writeCsv(Object.keys(row), [Object.values(row)]);
    for (const format of ['csv', 'xls', 'xlsx'] as const) {
      const content = format === 'csv' ? csv : readSpreadsheet(writeSpreadsheet(csv, format)).csv;
      const result = prepareCsvImport(
        state,
        kind,
        content,
        suggestMapping(kind, parseCsv(content).headers),
      );
      assert.equal(result.report.added, 0, `${kind} ${format}`);
      assert.ok(
        result.report.errors.some((e) => field.test(e.message)),
        JSON.stringify(result.report),
      );
      assert.ok(result.report.errors.every((e) => e.row === 2));
    }
  }
  check('customers', { name: 'Alice', email: 'bad-email', phone: 'bonjour' }, /Téléphone/);
  check(
    'customers',
    { name: state.customers[0].name, email: state.customers[0].email, phone: '123' },
    /Téléphone/,
  );
  check('customers', { name: 'Invisible\u0001' }, /Nom/);
  check('stock', { reference: 'BAD', name: 'Filtre', stock: '1 23' }, /Quantité en stock/);
  check('stock', { reference: 'BAD', name: 'Filtre', stock: '1.5' }, /entier/);
  check('stock', { reference: 'BAD', name: 'Filtre', price: '-10' }, /Prix HT/);
  check('stock', { reference: 'BAD', name: 'Filtre', price: '8.005' }, /décimales/);
  const vehicle = { customer_id: state.customers[0].id, model: 'Audi A3', plate: 'ABC-123' };
  check('vehicles', { ...vehicle, plate: '???' }, /Immatriculation/);
  check('vehicles', { ...vehicle, mileage: '-1' }, /Kilométrage/);
  check('vehicles', { ...vehicle, stage: 'inconnu' }, /Étape/);
  check('vehicles', { ...vehicle, due: '2026-02-30' }, /Date ISO/);
  check('vehicles', { ...vehicle, priority: 'peut-être' }, /Prioritaire/);
  check('appointments', { ...vehicle, reason: 'Entretien', at: '2026-11-10' }, /Date et heure/);
  assert.equal(JSON.stringify(state), before);
});

test('identifiers must exist and agree with other reference fields; conflicting repeated rows and mappings are blocked', () => {
  const state = createSeed('references', true);
  const importRow = (kind: TransferKind, row: Record<string, string>) => {
    const csv = writeCsv(Object.keys(row), [Object.values(row)]);
    return prepareCsvImport(state, kind, csv, suggestMapping(kind, Object.keys(row))).report;
  };
  const vehicle = {
    customer_id: 'missing',
    customer_email: state.customers[0].email,
    plate: 'ABC-123',
    model: 'Audi A3',
  };
  assert.match(importRow('vehicles', vehicle).errors[0].message, /Identifiant client introuvable/);
  assert.match(
    importRow('vehicles', {
      ...vehicle,
      customer_id: state.customers[0].id,
      customer_name: 'Autre client',
    }).errors[0].message,
    /nom du client contradictoires/,
  );
  const reservation = {
    part_id: state.parts[0].id,
    vehicle_id: state.vehicles[0].id,
    quantity: '1',
  };
  assert.match(
    importRow('reservations', {
      ...reservation,
      vehicle_id: 'missing',
      plate: state.vehicles[0].plate,
    }).errors[0].message,
    /visite véhicule introuvable/,
  );
  assert.match(
    importRow('reservations', { ...reservation, visit: String(state.vehicles[0].visit + 1) })
      .errors[0].message,
    /visite contradictoires/,
  );
  assert.match(
    importRow('reservations', {
      ...reservation,
      part_id: 'missing',
      part_reference: state.parts[0].reference,
    }).errors[0].message,
    /Identifiant pièce introuvable/,
  );
  const csv = writeCsv(
    ['id', 'name', 'email'],
    [
      ['new', 'Alice', 'alice@example.com'],
      ['new', 'Bob', 'alice@example.com'],
    ],
  );
  const report = prepareCsvImport(
    state,
    'customers',
    csv,
    suggestMapping('customers', parseCsv(csv).headers),
  ).report;
  assert.match(report.errors[0].message, /plusieurs fois/);
  assert.equal(report.errors[0].row, 3);
  assert.throws(
    () => prepareCsvImport(state, 'customers', 'name\nAlice', { name: 0, email: 0 }),
    /plusieurs champs/,
  );
  const valid = importRow('customers', {
    name: 'International',
    email: 'client@example.com',
    phone: '+32 (412) 34-56-78',
  });
  assert.deepEqual(valid.errors, []);
});

test('each document line is checked before grouping, with the offending row and field', () => {
  const state = createSeed('documents-validation', true);
  const csv = writeCsv(
    ['number', 'kind', 'vehicle_id', 'label', 'quantity', 'unit_price', 'tax_rate'],
    [
      ['NEW-DEV', 'devis', state.vehicles[0].id, 'Main-d’œuvre', '1', '50', '21'],
      ['NEW-DEV', 'devis', state.vehicles[0].id, 'Pièce', '1', '', '21'],
    ],
  );
  const report = prepareCsvImport(
    state,
    'documents',
    csv,
    suggestMapping('documents', parseCsv(csv).headers),
  ).report;
  assert.equal(report.errors[0].row, 3);
  assert.match(report.errors[0].message, /Prix unitaire HT.*obligatoire/);
});
