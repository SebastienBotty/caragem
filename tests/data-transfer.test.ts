import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, totals, applyAction, type GarageState } from '../src/lib/domain.ts';
import { available } from '../src/lib/domain.ts';
import { parseCsv, writeCsv } from '../src/lib/csv.ts';
import {
  exportDataCsv,
  prepareCsvImport,
  suggestMapping,
  transferKindSchema,
  type TransferKind,
} from '../src/lib/data-transfer.ts';

function importFile(state: GarageState, kind: TransferKind, csv: string) {
  return prepareCsvImport(state, kind, csv, suggestMapping(kind, parseCsv(csv).headers));
}

test('all business datasets transfer with links, physical and reserved stock, history, document lines and discounts', () => {
  const source = createSeed('source', true);
  source.vehicles[0].notes = Array.from({ length: 110 }, (_, i) => ({
    id: `note-${i}`,
    text: `Note historique ${i}`,
    author: source.users[0].name,
    at: new Date().toISOString(),
  }));
  source.documents[0].discountRate = 12.5;
  source.documents[0].lines.push({
    label: 'Ligne supplémentaire; "test"',
    quantity: 2,
    unitPrice: 1234,
  });
  let target = createSeed('target', false);
  target.users = source.users;
  for (const kind of [
    'customers',
    'stock',
    'vehicles',
    'reservations',
    'appointments',
    'orders',
    'documents',
  ] as const) {
    const csv = exportDataCsv(source, kind);
    const result = importFile(target, kind, csv);
    assert.deepEqual(result.report.errors, [], kind);
    target = result.state;
    const duplicate = importFile(target, kind, csv);
    assert.deepEqual(duplicate.report.errors, [], 'duplicate ' + kind);
    assert.equal(duplicate.report.added, 0, kind);
  }
  assert.deepEqual(target.customers, source.customers);
  assert.equal(target.vehicles.length, source.vehicles.length);
  for (const vehicle of source.vehicles) {
    const imported = target.vehicles.find((v) => v.id === vehicle.id)!;
    assert.equal(imported.customerId, vehicle.customerId);
    assert.equal(imported.stage, vehicle.stage);
    assert.deepEqual(imported.tasks, vehicle.tasks);
    assert.deepEqual(imported.notes, vehicle.notes);
  }
  for (const part of source.parts) {
    assert.equal(target.parts.find((p) => p.id === part.id)!.stock, part.stock);
    assert.equal(available(target, part.id), available(source, part.id));
  }
  for (const document of source.documents) {
    const imported = target.documents.find((d) => d.id === document.id)!;
    assert.equal(imported.number, document.number);
    assert.equal(imported.vehicleId, document.vehicleId);
    assert.equal(imported.paid, document.paid);
    assert.deepEqual(imported.lines, document.lines);
    assert.deepEqual(
      totals(imported.lines, imported.taxRate, imported.discountRate, imported.discountAmount),
      totals(document.lines, document.taxRate, document.discountRate, document.discountAmount),
    );
  }
  assert.equal(target.orders.length, source.orders.length);
  assert.equal(target.appointments.length, source.appointments.length);
});

test('external column mapping accepts French decimals and matches client, vehicle and part references', () => {
  let state = createSeed('external', false);
  const contacts = 'Nom complet;Courriel;GSM\nÉlodie Garage;elodie@example.com;+32412345678';
  state = prepareCsvImport(state, 'customers', contacts, { name: 0, email: 1, phone: 2 }).state;
  assert.equal(state.customers[0].phone, '+32412345678');
  state = importFile(
    state,
    'stock',
    'reference;name;cost;price;stock\nFILTRE;Filtre;12,35;19,99;4',
  ).state;
  assert.equal(state.parts[0].cost, 1235);
  const result = importFile(
    state,
    'vehicles',
    'customer_email;plate;brand;model\nelodie@example.com;AB-123-CD;Renault;Clio',
  );
  assert.deepEqual(result.report.errors, []);
  state = result.state;
  assert.equal(state.vehicles[0].model, 'Renault Clio');
  assert.equal(state.vehicles[0].stage, 'returned');
  const order = importFile(
    state,
    'orders',
    'reference;supplier;part_reference;plate;quantity;received;due;unit_cost\nCMD-1;Fournisseur;FILTRE;AB-123-CD;3;1;2026-12-01;12,35',
  );
  assert.deepEqual(order.report.errors, []);
  assert.equal(order.state.orders[0].partId, state.parts[0].id);
  assert.equal(order.state.orders[0].vehicleId, state.vehicles[0].id);
  assert.equal(order.state.parts[0].stock, 4, 'received orders do not count stock twice');
  const invalidDate = importFile(
    state,
    'appointments',
    'customer_email;plate;model;reason;at\nelodie@example.com;AB-123-CD;Renault Clio;Entretien;2026-02-31',
  );
  assert.equal(invalidDate.report.errors.length, 1);
});

test('invalid rows leave the source untouched and duplicates never overwrite existing records', () => {
  const state = createSeed('invalid', true),
    before = structuredClone(state);
  const reference = state.parts[0].reference;
  const csv = writeCsv(
    ['reference', 'name', 'stock'],
    [
      [reference, 'Changed', 999],
      ['NEW', 'New', 3],
      ['BAD', 'Bad', -1],
    ],
  );
  const result = importFile(state, 'stock', csv);
  assert.equal(result.report.added, 1);
  assert.equal(result.report.skipped, 1);
  assert.equal(result.report.errors.length, 1);
  assert.equal(result.report.errors[0].row, 4);
  assert.deepEqual(state, before);
  assert.deepEqual(result.state.parts[0], state.parts[0]);
  assert.throws(() => prepareCsvImport(state, 'stock', csv, { name: 0 }), /Référence/);
  assert.throws(
    () => prepareCsvImport(state, 'stock', csv, { reference: 99, name: 1 }),
    /Correspondance/,
  );
  const conflict = importFile(
    state,
    'customers',
    writeCsv(['id', 'name', 'email'], [[state.customers[0].id, 'Another', 'another@example.com']]),
  );
  assert.match(conflict.report.errors[0].message, /identifiant/);
});

test('imports reject missing/ambiguous links, oversold reservations, excessive payments and inconsistent document groups', () => {
  const state = createSeed('references', true);
  assert.ok(
    importFile(
      state,
      'vehicles',
      'customer_email;plate;model\nmissing@example.com;NOPE;Renault Clio',
    ).report.errors.length,
  );
  const reservation = writeCsv(
    ['part_id', 'vehicle_id', 'quantity'],
    [[state.parts[0].id, state.vehicles.find((v) => v.stage === 'workshop')!.id, 10000]],
  );
  assert.ok(importFile(state, 'reservations', reservation).report.errors.length);
  const headers = [
    'number',
    'kind',
    'vehicle_id',
    'label',
    'quantity',
    'unit_price',
    'tax_rate',
    'paid',
  ];
  const tooPaid = writeCsv(headers, [
    ['CSV-NEW', 'invoice', state.vehicles[0].id, 'Work', 1, 10, 20, 13],
  ]);
  assert.match(importFile(state, 'documents', tooPaid).report.errors[0].message, /réglé/);
  const inconsistent = writeCsv(headers, [
    ['CSV-NEW', 'invoice', state.vehicles[0].id, 'Work', 1, 10, 20, 0],
    ['CSV-NEW', 'invoice', state.vehicles[0].id, 'Part', 1, 10, 21, 0],
  ]);
  assert.match(
    importFile(state, 'documents', inconsistent).report.errors[0].message,
    /différentes/,
  );
  const aliases = writeCsv(headers, [
    ['CSV-ALIAS', 'devis', state.vehicles[0].id, 'Work', 1, 10, 20, 0],
    ['CSV-ALIAS', 'estimate', state.vehicles[0].id, 'Part', 1, 10, 20, 0],
  ]);
  const accepted = importFile(state, 'documents', aliases);
  assert.deepEqual(accepted.report.errors, []);
  assert.equal(accepted.report.added, 1);
  assert.equal(accepted.state.documents.at(-1)!.lines.length, 2);
});

test('empty exports are reusable templates and foreign staff assignments are not attached to local team members', () => {
  const state = createSeed('templates', true);
  for (const kind of transferKindSchema.options) {
    const template = parseCsv(exportDataCsv(state, kind, true));
    assert.equal(template.rows.length, 0);
    assert.ok(Object.keys(suggestMapping(kind, template.headers)).length);
  }
  let target = createSeed('other-team', false);
  target = importFile(target, 'customers', exportDataCsv(state, 'customers')).state;
  const vehicles = importFile(target, 'vehicles', exportDataCsv(state, 'vehicles'));
  assert.deepEqual(vehicles.report.errors, []);
  assert.ok(vehicles.state.vehicles.flatMap((v) => v.tasks).every((t) => !t.assignees.length));
});

test('exported client identities preserve shared email addresses and future document numbers stay unique', () => {
  const source = createSeed('shared-email', true);
  source.customers[1].email = source.customers[0].email;
  let target = createSeed('shared-target', false);
  const contacts = importFile(target, 'customers', exportDataCsv(source, 'customers'));
  assert.equal(contacts.report.added, source.customers.length);
  target = contacts.state;
  target = importFile(target, 'vehicles', exportDataCsv(source, 'vehicles')).state;
  const car = source.vehicles.find((v) => v.customerId === source.customers[1].id)!;
  assert.equal(target.vehicles.find((v) => v.id === car.id)!.customerId, source.customers[1].id);
  const ambiguous = importFile(
    target,
    'vehicles',
    writeCsv(
      ['customer_email', 'plate', 'model'],
      [[source.customers[0].email, 'NEW-123', 'Renault Clio']],
    ),
  );
  assert.match(ambiguous.report.errors[0].message, /ambigu/);
  const number = `FAC-${new Date().getFullYear()}-002`;
  target = importFile(
    target,
    'documents',
    writeCsv(
      ['number', 'kind', 'vehicle_id', 'label', 'quantity', 'unit_price', 'tax_rate'],
      [[number, 'invoice', target.vehicles[0].id, 'Work', 1, 10, 20]],
    ),
  ).state;
  const next = applyAction(
    target,
    {
      type: 'document',
      kind: 'invoice',
      vehicleId: target.vehicles[0].id,
      lines: [{ label: 'Work', quantity: 1, unitPrice: 1000 }],
      taxRate: 20,
    },
    target.users[0],
  );
  assert.notEqual(next.documents.at(-1)!.number, number);
  assert.equal(new Set(next.documents.map((d) => d.number)).size, next.documents.length);
});
