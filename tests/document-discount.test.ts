import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { applyAction, createSeed, totals, actionSchema } from '../src/lib/domain.ts';
import { documentPdf } from '../src/server/pdf.ts';

const lines = [{ label: 'Entretien', quantity: 1, unitPrice: 10005 }];

test('discount reduces HT before VAT and rounds to cents, including no discount and a full discount', () => {
  assert.deepEqual(totals(lines, 20, 10), {
    subtotal: 10005,
    discount: 1001,
    net: 9004,
    tax: 1801,
    gross: 10805,
  });
  assert.deepEqual(totals(lines, 21, 10), {
    subtotal: 10005,
    discount: 1001,
    net: 9004,
    tax: 1891,
    gross: 10895,
  });
  assert.deepEqual(totals(lines, 20, 100), {
    subtotal: 10005,
    discount: 10005,
    net: 0,
    tax: 0,
    gross: 0,
  });
  assert.deepEqual(totals(lines, 20), {
    subtotal: 10005,
    discount: 0,
    net: 10005,
    tax: 2001,
    gross: 12006,
  });
  assert.equal(
    totals([{ label: 'Travail', quantity: 1, unitPrice: 10000 }], 20, 12.5).gross,
    10500,
  );
  assert.equal(totals([{ label: 'Travail', quantity: 1, unitPrice: 5000 }], 20, 0.57).discount, 29);
});

test('estimate discount survives invoicing and payments cannot exceed the discounted balance', () => {
  let state = createSeed('discount', true);
  state.documents = [];
  const actor = state.users[0];
  const document = {
    type: 'document' as const,
    vehicleId: state.vehicles[0].id,
    kind: 'estimate' as const,
    lines,
    taxRate: 20,
    discountRate: 10,
  };
  state = applyAction(state, document, actor);
  const estimate = state.documents[0];
  assert.equal(estimate.discountRate, 10);
  state = applyAction(
    state,
    { type: 'acceptEstimate', id: estimate.id, evidence: 'Accord client' },
    actor,
  );
  state = applyAction(state, { type: 'convertEstimate', id: estimate.id }, actor);
  const invoice = state.documents.at(-1)!;
  assert.equal(invoice.discountRate, 10);
  state = applyAction(state, { type: 'validateDocument', id: invoice.id }, actor);
  assert.throws(
    () => applyAction(state, { type: 'payment', id: invoice.id, amount: 10806 }, actor),
    /solde/,
  );
  state = applyAction(state, { type: 'payment', id: invoice.id, amount: 10000 }, actor);
  assert.throws(
    () => applyAction(state, { type: 'payment', id: invoice.id, amount: 806 }, actor),
    /solde/,
  );
  state = applyAction(state, { type: 'payment', id: invoice.id, amount: 805 }, actor);
  assert.equal(state.documents.at(-1)!.paid, 10805);
  for (const rate of [-1, 100.01, 12.345, NaN, Infinity, '10'])
    assert.equal(
      actionSchema.safeParse({ ...document, discountRate: rate }).success,
      false,
      String(rate),
    );
  assert.throws(
    () => applyAction(state, { ...document, kind: 'invoice' }, state.users[1]),
    /autorisation/,
  );
  const legacy = applyAction(
    state,
    { ...document, kind: 'invoice', discountRate: undefined },
    actor,
  ).documents.at(-1)!;
  assert.equal(totals(legacy.lines, legacy.taxRate, legacy.discountRate).gross, 12006);
  const free = applyAction(state, { ...document, kind: 'invoice', discountRate: 100 }, actor);
  const freeId = free.documents.at(-1)!.id;
  const validated = applyAction(free, { type: 'validateDocument', id: freeId }, actor);
  assert.throws(
    () => applyAction(validated, { type: 'payment', id: freeId, amount: 1 }, actor),
    /solde/,
  );
});

test('estimate and invoice PDFs include the discount and the same discounted totals', async () => {
  for (const discount of [{ discountRate: 10 }, { discountAmount: 1001 }]) {
    for (const kind of ['estimate', 'invoice'] as const) {
      const original = createSeed('pdf-discount', true);
      const state = applyAction(
        original,
        {
          type: 'document',
          kind,
          vehicleId: original.vehicles[0].id,
          lines,
          taxRate: 20,
          ...discount,
        },
        original.users[0],
      );
      const bytes = await documentPdf(state, state.documents.at(-1)!);
      const pdf = await PDFDocument.load(bytes);
      const text = pdf
        .getPages()
        .map((page) => {
          const streams = page.node.Contents();
          assert.ok(streams instanceof PDFArray);
          return streams
            .asArray()
            .map((ref) => {
              const stream = pdf.context.lookup(ref);
              assert.ok(stream instanceof PDFRawStream);
              const content = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
              return [...content.matchAll(/<([0-9A-F]+)>/gi)]
                .map((match) => Buffer.from(match[1], 'hex').toString('latin1'))
                .join(' ');
            })
            .join(' ');
        })
        .join(' ');
      for (const expected of [
        'Sous-total HT',
        discount.discountAmount ? 'Ristourne (EUR)' : 'Ristourne (10 %)',
        '-10,01',
        '90,04',
        '18,01',
        '108,05',
      ])
        assert.ok(text.includes(expected), expected);
    }
  }
});

test('fixed-euro discounts remain exact through invoicing and reject negative or excessive amounts', () => {
  assert.deepEqual(totals(lines, 20, 0, 1001), totals(lines, 20, 10));
  let state = createSeed('fixed-discount', true);
  state.documents = [];
  const actor = state.users[0];
  const input = {
    type: 'document' as const,
    vehicleId: state.vehicles[0].id,
    kind: 'estimate' as const,
    lines,
    taxRate: 20,
    discountAmount: 1001,
  };
  state = applyAction(state, input, actor);
  const estimate = state.documents[0];
  assert.equal(estimate.discountAmount, 1001);
  state = applyAction(
    state,
    { type: 'acceptEstimate', id: estimate.id, evidence: 'Accord' },
    actor,
  );
  state = applyAction(state, { type: 'convertEstimate', id: estimate.id }, actor);
  const invoice = state.documents.at(-1)!;
  assert.equal(invoice.discountAmount, 1001);
  state = applyAction(state, { type: 'validateDocument', id: invoice.id }, actor);
  assert.throws(
    () => applyAction(state, { type: 'payment', id: invoice.id, amount: 10806 }, actor),
    /solde/,
  );
  state = applyAction(state, { type: 'payment', id: invoice.id, amount: 10805 }, actor);
  assert.equal(state.documents.at(-1)!.paid, 10805);
  for (const amount of [-1, 0.5, NaN, Infinity, '10'])
    assert.equal(actionSchema.safeParse({ ...input, discountAmount: amount }).success, false);
  assert.throws(() => applyAction(state, { ...input, discountAmount: 10006 }, actor), /ristourne/i);
  assert.equal(actionSchema.safeParse({ ...input, discountRate: 10 }).success, false);
  assert.equal(totals(lines, 20, 0, 10005).gross, 0);
});
