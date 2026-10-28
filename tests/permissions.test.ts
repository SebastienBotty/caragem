import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, actionSchema, createSeed } from '../src/lib/domain.ts';
import { can, permissions, visibleState } from '../src/lib/permissions.ts';

test('approved defaults apply to existing garages; individual exceptions override their role', () => {
  let state = createSeed('permissions', true);
  const [owner, mechanic] = state.users;
  const reception = {
    id: 'reception',
    name: 'Accueil',
    role: 'reception' as const,
    color: '#123456',
  };
  state.users.push(reception);
  for (const p of permissions) {
    assert.equal(can(state, owner, p.id), true);
    assert.equal(can(state, mechanic, p.id), p.mechanic, p.id);
    assert.equal(can(state, reception, p.id), p.reception, p.id);
  }
  state = applyAction(
    state,
    {
      type: 'rolePermissions',
      permissions: {
        mechanic: { 'documents.view': true, 'documents.prepare': true, 'vehicles.edit': false },
      },
    },
    owner,
  );
  assert.equal(can(state, state.users[1], 'documents.prepare'), true);
  state = applyAction(
    state,
    {
      type: 'userPermissions',
      userId: mechanic.id,
      permissions: { 'documents.prepare': false, 'vehicles.edit': true },
    },
    owner,
  );
  assert.equal(can(state, state.users[1], 'documents.prepare'), false);
  assert.equal(can(state, state.users[1], 'vehicles.edit'), true);
  state = applyAction(state, { type: 'rolePermissions', permissions: {} }, owner);
  assert.equal(can(state, state.users[1], 'vehicles.edit'), true);
  state = applyAction(
    state,
    { type: 'userPermissions', userId: mechanic.id, permissions: {} },
    owner,
  );
  assert.equal(can(state, state.users[1], 'documents.view'), false);
  assert.equal(can(createSeed('other', true), mechanic, 'documents.view'), false);
});

test('delegation never allows permission editing or escalation, even with a forged actor', () => {
  let state = createSeed('owner-only', true);
  const [owner, mechanic] = state.users;
  state = applyAction(
    state,
    {
      type: 'userPermissions',
      userId: mechanic.id,
      permissions: { 'garage.configure': true, 'team.invite': true },
    },
    owner,
  );
  const delegated = state.users[1];
  const settings = {
    type: 'settings' as const,
    name: state.settings.name,
    country: state.settings.country,
    address: '',
    businessId: '',
    modules: { reception: 1, diagnosis: 1, waiting: 1, workshop: 1, ready: 1 },
  };
  assert.doesNotThrow(() => applyAction(state, settings, delegated));
  assert.throws(
    () => applyAction(state, { ...settings, rolePermissions: {} }, delegated),
    /patron/,
  );
  assert.throws(
    () => applyAction(state, { type: 'rolePermissions', permissions: {} }, delegated),
    /patron/,
  );
  assert.throws(
    () =>
      applyAction(
        state,
        { type: 'userPermissions', userId: mechanic.id, permissions: {} },
        delegated,
      ),
    /patron/,
  );
  assert.throws(
    () =>
      applyAction(
        state,
        { type: 'userPermissions', userId: owner.id, permissions: { 'garage.view': false } },
        owner,
      ),
    /accès complet/,
  );
  assert.equal(
    actionSchema.safeParse({ type: 'rolePermissions', permissions: { owner: {} } }).success,
    false,
  );
  assert.equal(
    actionSchema.safeParse({
      type: 'userPermissions',
      userId: mechanic.id,
      permissions: { 'permissions.manage': true },
    }).success,
    false,
  );
  const forged = {
    ...mechanic,
    permissions: { 'documents.prepare': true, 'documents.view': true },
  };
  assert.throws(
    () =>
      applyAction(
        state,
        {
          type: 'document',
          vehicleId: state.vehicles[0].id,
          kind: 'estimate',
          lines: [{ label: 'Travail', quantity: 1, unitPrice: 1000 }],
          taxRate: 20,
        },
        forged,
      ),
    /autorisation/,
  );
});

test('document preparation, validation and payments require separate permissions', () => {
  const state = createSeed('documents', true);
  const reception = {
    id: 'reception',
    name: 'Accueil',
    role: 'reception' as const,
    color: '#123456',
  };
  state.users.push(reception);
  let next = applyAction(
    state,
    {
      type: 'document',
      kind: 'invoice',
      vehicleId: state.vehicles[0].id,
      lines: [{ label: 'Travail', quantity: 1, unitPrice: 1000 }],
      taxRate: 20,
    },
    reception,
  );
  const invoice = next.documents.at(-1)!;
  assert.equal(invoice.validated, false);
  assert.throws(
    () => applyAction(next, { type: 'validateDocument', id: invoice.id }, reception),
    /autorisation/,
  );
  assert.throws(
    () => applyAction(next, { type: 'payment', id: invoice.id, amount: 100 }, reception),
    /autorisation/,
  );
  assert.throws(
    () => applyAction(next, { type: 'payment', id: invoice.id, amount: 100 }, state.users[0]),
    /Validez/,
  );
  next = applyAction(next, { type: 'validateDocument', id: invoice.id }, state.users[0]);
  next = applyAction(next, { type: 'payment', id: invoice.id, amount: 100 }, state.users[0]);
  assert.equal(next.documents.at(-1)!.paid, 100);
});

test('read permissions remove protected fields and records without changing persisted data', () => {
  const state = createSeed('projection', true);
  const mechanic = state.users[1];
  const before = structuredClone(state);
  let view = visibleState(state, mechanic.id);
  assert.ok(view.customers.every((c) => c.email === '' && c.phone === ''));
  assert.deepEqual(view.documents, []);
  assert.deepEqual(view.mails, []);
  assert.deepEqual(view.orders, []);
  mechanic.permissions = { 'garage.view': false, 'planning.view': false, 'stock.view': false };
  view = visibleState(state, mechanic.id);
  assert.deepEqual(view.vehicles, []);
  assert.deepEqual(view.appointments, []);
  assert.deepEqual(view.parts, []);
  assert.deepEqual(view.reservations, []);
  assert.equal(can(state, mechanic, 'vehicles.edit'), false);
  mechanic.permissions = { 'history.view': false, 'vehicles.create': true };
  state.vehicles[0].stage = 'returned';
  view = visibleState(state, mechanic.id);
  assert.ok(!view.vehicles.some((v) => v.id === state.vehicles[0].id));
  assert.throws(
    () =>
      applyAction(
        state,
        {
          type: 'revisit',
          id: state.vehicles[0].id,
          issue: 'Retour',
          due: new Date().toISOString(),
        },
        mechanic,
      ),
    /autorisation/,
  );
  assert.deepEqual(state.customers, before.customers);
});
