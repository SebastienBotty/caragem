import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createSeed, actionSchema } from '../src/lib/domain.ts';
import { Store } from '../src/server/store.ts';
import { testDatabase } from './helpers/database.ts';

test('structured blockages validate the assignee, preserve their age and retain resolution history', () => {
  let state = createSeed('blockages', true);
  const [owner, worker] = state.users;
  const id = state.vehicles.find((v) => v.stage !== 'returned')!.id;
  const action = {
    type: 'blocker' as const,
    id,
    text: 'Filtre attendu',
    kind: 'parts' as const,
    assigneeId: worker.id,
    expectedAt: '2027-01-01T10:00:00.000Z',
    nextAction: 'Relancer le fournisseur',
  };
  state = applyAction(state, action, owner);
  const openedAt = state.vehicles.find((v) => v.id === id)!.blockerDetails!.openedAt;
  state = applyAction(state, { ...action, text: 'Livraison retardée' }, owner);
  assert.equal(state.vehicles.find((v) => v.id === id)!.blockerDetails!.openedAt, openedAt);
  assert.throws(
    () => applyAction(state, { ...action, assigneeId: 'other-garage' }, owner),
    /introuvable/,
  );
  assert.throws(() => applyAction(state, { ...action, nextAction: '' }, owner), /prochaine action/);
  assert.equal(actionSchema.safeParse({ ...action, expectedAt: 'tomorrow' }).success, false);
  assert.equal(actionSchema.safeParse({ ...action, kind: 'unknown' }).success, false);
  state = applyAction(state, { type: 'blocker', id, text: '' }, owner);
  const vehicle = state.vehicles.find((v) => v.id === id)!;
  assert.equal(vehicle.blocker, '');
  assert.equal(vehicle.blockerDetails, undefined);
  assert.equal(vehicle.blockerHistory![0].text, 'Livraison retardée');
  assert.equal(vehicle.blockerHistory![0].openedAt, openedAt);
  assert.ok(vehicle.blockerHistory![0].resolvedAt);
  vehicle.stage = 'returned';
  state = applyAction(
    state,
    { type: 'revisit', id, issue: 'Contrôle', due: '2027-01-02T10:00:00.000Z' },
    owner,
  );
  const next = state.vehicles.at(-1)!;
  assert.equal(next.blockerDetails, undefined);
  assert.deepEqual(next.blockerHistory, []);
});

test('legacy text blockers remain usable and read-only members cannot edit a blockage', () => {
  let state = createSeed('legacy-blockages', true);
  const [owner, worker] = state.users;
  const id = state.vehicles[0].id;
  state = applyAction(state, { type: 'blocker', id, text: 'Ancienne saisie' }, owner);
  assert.equal(state.vehicles[0].blockerDetails!.kind, 'other');
  worker.permissions = { 'vehicles.edit': false };
  state.users[1] = worker;
  assert.throws(
    () => applyAction(state, { type: 'blocker', id, text: '' }, worker),
    /autorisation/,
  );
});

test('blockage details and history persist in PostgreSQL', async () => {
  const store = new Store(testDatabase());
  try {
    const state = await store.create(true);
    const cookie = `caragem_session=${await store.newSession(state.id, state.users[0].id)}`;
    const session = (await store.session(cookie))!;
    await store.act(session, {
      type: 'blocker',
      id: state.vehicles[0].id,
      text: 'Accord attendu',
      kind: 'approval',
      nextAction: 'Appeler Camille',
      assigneeId: state.users[0].id,
    });
    assert.equal((await store.get(state.id)).vehicles[0].blockerDetails!.kind, 'approval');
    await store.act(session, { type: 'blocker', id: state.vehicles[0].id, text: '' });
    assert.equal(
      (await store.get(state.id)).vehicles[0].blockerHistory![0].nextAction,
      'Appeler Camille',
    );
  } finally {
    await store.close();
  }
});
