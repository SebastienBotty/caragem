import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, applyAction, totals, actionSchema } from '../src/lib/domain.ts';

test('mechanics can change vehicle paint without changing other fields', () => {
  const s = createSeed('paint', true);
  const v = s.vehicles[0];
  const next = applyAction(s, { type: 'vehicleColor', id: v.id, color: '#cc2525' }, s.users[1]);
  assert.equal(next.vehicles[0].color, '#cc2525');
  assert.deepEqual({ ...next.vehicles[0], color: v.color }, v);
  assert.equal(s.vehicles[0].color, v.color);
  assert.equal(
    actionSchema.safeParse({ type: 'vehicleColor', id: v.id, color: 'red' }).success,
    false,
  );
  assert.throws(
    () => applyAction(s, { type: 'vehicleColor', id: 'foreign-id', color: '#000000' }, s.users[1]),
    /introuvable/,
  );
});

test('a task claimed twice rejects the second claim without losing the first', () => {
  const s = createSeed('test', true);
  const task = s.vehicles[0].tasks[0];
  task.assignees = [];
  const first = applyAction(
    s,
    {
      type: 'task',
      vehicleId: s.vehicles[0].id,
      taskId: task.id,
      operation: 'claim',
    },
    s.users[1],
  );
  assert.deepEqual(first.vehicles[0].tasks[0].assignees, [s.users[1].id]);
  assert.throws(
    () =>
      applyAction(
        first,
        {
          type: 'task',
          vehicleId: s.vehicles[0].id,
          taskId: task.id,
          operation: 'claim',
        },
        s.users[2],
      ),
    /déjà attribuée/,
  );
});

test('reserved stock is unavailable elsewhere and consumption happens once', () => {
  let s = createSeed('test', true);
  const part = s.parts[0];
  part.stock = 1;
  s.reservations = [];
  const reserve = {
    type: 'reserve' as const,
    vehicleId: s.vehicles[0].id,
    partId: part.id,
    quantity: 1,
  };
  s = applyAction(s, reserve, s.users[0]);
  assert.throws(
    () => applyAction(s, { ...reserve, vehicleId: s.vehicles[1].id }, s.users[0]),
    /Stock disponible/,
  );
  const id = s.reservations[0].id;
  s = applyAction(s, { type: 'consume', id }, s.users[1]);
  assert.equal(s.parts[0].stock, 0);
  assert.throws(() => applyAction(s, { type: 'consume', id }, s.users[1]), /déjà utilisée/);
});

test('purchase receipts may be partial, never exceed ordered quantity', () => {
  let s = createSeed('test', true);
  const p = s.orders[0];
  const before = s.parts.find((x) => x.id === p.partId)!.stock;
  s = applyAction(s, { type: 'receive', id: p.id, quantity: 1 }, s.users[0]);
  assert.equal(s.parts.find((x) => x.id === p.partId)!.stock, before + 1);
  assert.equal(s.orders[0].received, 1);
  assert.throws(
    () => applyAction(s, { type: 'receive', id: p.id, quantity: p.quantity }, s.users[0]),
    /quantité restante/,
  );
});

test('money uses cents and mechanic cannot modify financial documents', () => {
  const s = createSeed('test', true);
  assert.deepEqual(totals([{ label: 'Test', quantity: 3, unitPrice: 1099 }], 20), {
    net: 3297,
    tax: 659,
    gross: 3956,
  });
  assert.throws(
    () => applyAction(s, { type: 'payment', id: s.documents[0].id, amount: 100 }, s.users[1]),
    /autorisation/,
  );
});

test('server rejects invalid quantities, unknown actions and premature completion', () => {
  assert.equal(
    actionSchema.safeParse({
      type: 'reserve',
      vehicleId: 'a',
      partId: 'b',
      quantity: -1,
    }).success,
    false,
  );
  assert.equal(actionSchema.safeParse({ type: 'overwrite', state: {} }).success, false);
  const s = createSeed('test', true);
  assert.throws(
    () => applyAction(s, { type: 'stage', id: s.vehicles[0].id, stage: 'ready' }, s.users[0]),
    /tâches/,
  );
});

test('a returned vehicle retains its dossier independently of payment', () => {
  let s = createSeed('test', true);
  const v = s.vehicles.find((x) => x.stage === 'ready')!;
  s = applyAction(s, { type: 'stage', id: v.id, stage: 'returned' }, s.users[0]);
  assert.equal(s.vehicles.find((x) => x.id === v.id)?.stage, 'returned');
  assert.ok(s.activity[0].text.includes(v.plate));
});

test('stale task transitions cannot undo completed work or replace recorded time', () => {
  let s = createSeed('test', true);
  const v = s.vehicles.find((v) => v.stage === 'workshop')!;
  const t = v.tasks[0];
  s = applyAction(
    s,
    {
      type: 'task',
      vehicleId: v.id,
      taskId: t.id,
      operation: 'finish',
      minutes: 80,
    },
    s.users[0],
  );
  assert.throws(
    () =>
      applyAction(
        s,
        { type: 'task', vehicleId: v.id, taskId: t.id, operation: 'start' },
        s.users[0],
      ),
    /état/,
  );
  assert.throws(
    () =>
      applyAction(
        s,
        {
          type: 'task',
          vehicleId: v.id,
          taskId: t.id,
          operation: 'finish',
          minutes: 0,
        },
        s.users[0],
      ),
    /état/,
  );
  assert.equal(s.vehicles.find((x) => x.id === v.id)!.tasks[0].minutes, 80);
});

test('ready and returned vehicles cannot strand stock reservations', () => {
  let s = createSeed('test', true);
  const v = s.vehicles.find((v) => v.stage === 'ready')!;
  s = applyAction(
    s,
    { type: 'reserve', vehicleId: v.id, partId: s.parts[0].id, quantity: 1 },
    s.users[0],
  );
  assert.throws(
    () => applyAction(s, { type: 'stage', id: v.id, stage: 'returned' }, s.users[0]),
    /réservées/,
  );
});

test('new arrivals for a known plate keep previous dossiers and increment the visit', () => {
  let s = createSeed('test', true);
  const old = s.vehicles.find((v) => v.stage === 'ready')!;
  s = applyAction(s, { type: 'stage', id: old.id, stage: 'returned' }, s.users[0]);
  s = applyAction(
    s,
    {
      type: 'vehicle',
      customerId: old.customerId,
      plate: old.plate.toLowerCase(),
      model: old.model,
      mileage: 100000,
      color: old.color,
      issue: 'Nouvel entretien',
      due: old.due,
      priority: false,
    },
    s.users[0],
  );
  const visits = s.vehicles.filter((v) => v.plate === old.plate);
  assert.equal(visits.length, 2);
  assert.deepEqual(
    visits.map((v) => v.visit),
    [1, 2],
  );
  assert.equal(visits[0].stage, 'returned');
});
