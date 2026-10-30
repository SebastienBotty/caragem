import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingAccess, requireWritable, trialDuration } from '../src/lib/billing.ts';
import { Store } from '../src/server/store.ts';
import { testDatabase } from './helpers/database.ts';

test('billing has exact boundaries and preserves the already paid period after cancellation or failed renewal', () => {
  const b = { trialEndsAt: 100, paidUntil: 0, status: 'none', cancelAtPeriodEnd: false };
  assert.equal(trialDuration, 14 * 86400000);
  assert.equal(billingAccess(b, 99), 'trial');
  assert.equal(billingAccess(b, 100), 'readonly');
  assert.equal(billingAccess({ ...b, paidUntil: 200, status: 'past_due' }, 199), 'paid');
  assert.equal(billingAccess({ ...b, paidUntil: 200, cancelAtPeriodEnd: true }, 200), 'readonly');
  assert.throws(() => requireWritable({ demo: false, billing: b }), /lecture seule/);
  assert.doesNotThrow(() => requireWritable({ demo: true, billing: b }));
});

test('trials persist, expired garages retain data and reject mutations and invitations without affecting another garage', async () => {
  const store = new Store(testDatabase());
  try {
    const state = await store.create(false);
    const other = await store.create(false);
    const initial = await store.get(state.id);
    assert.ok(initial.billing);
    assert.ok(Math.abs(initial.billing.trialEndsAt - Date.now() - trialDuration) < 5000);
    const session = {
      garageId: state.id,
      userId: state.users[0].id,
      expires: Date.now() + 100000,
      tokenHash: 'test',
    };
    const modules = { reception: 1, diagnosis: 1, waiting: 1, workshop: 1, ready: 1 };
    await store.act(session, {
      type: 'settings',
      ...state.settings,
      modules,
      name: 'Garage conservé',
    });
    await store.db.query('UPDATE garage_billing SET trial_ends_at=0 WHERE garage_id=$1', [
      state.id,
    ]);
    await assert.rejects(
      store.act(session, { type: 'settings', ...state.settings, modules, name: 'Interdit' }),
      /lecture seule/,
    );
    await assert.rejects(
      store.updateGarage(state.id, (s) => {
        s.customers = [];
      }),
      /lecture seule/,
    );
    await assert.rejects(store.invite(session, 'test@example.com', 'mechanic'), /lecture seule/);
    assert.equal((await store.get(state.id)).settings.name, 'Garage conservé');
    await store.updateGarage(other.id, (s) => {
      s.settings.name = 'Autre garage actif';
    });
    assert.equal((await store.get(other.id)).settings.name, 'Autre garage actif');
    assert.equal((await store.get(state.id)).customers.length, state.customers.length);
  } finally {
    await store.close();
  }
});

test('only the first owned garage has a trial; additional garages require separate payment and cannot regain a trial on save', async () => {
  const store = new Store(testDatabase());
  try {
    const first = await store.register({
      email: 'first-owner@example.com',
      hash: 'test',
      name: 'Patron',
      garage: 'Premier',
    });
    const session = {
      ...first,
      email: 'first-owner@example.com',
      expires: Date.now() + 100000,
      tokenHash: 'test',
    };
    const initial = await store.get(first.garageId);
    assert.equal(billingAccess(initial.billing), 'trial');
    const extras = await Promise.all([
      store.createGarage(session, 'Deuxième'),
      store.createGarage(session, 'Troisième'),
    ]);
    for (const extra of extras) {
      const state = await store.get(extra.garageId);
      assert.equal(state.billing!.trialEndsAt, 0);
      assert.equal(billingAccess(state.billing), 'readonly');
      await assert.rejects(
        store.updateGarage(state.id, (s) => {
          s.settings.name = 'Interdit';
        }),
        /lecture seule/,
      );
      state.billing!.trialEndsAt = Date.now() + trialDuration;
      await store.save(state);
      assert.equal((await store.get(state.id)).billing!.trialEndsAt, 0);
    }
    await store.db.query('UPDATE garage_billing SET trial_ends_at=0 WHERE garage_id=$1', [
      first.garageId,
    ]);
    const later = await store.createGarage(session, 'Après expiration');
    assert.equal(billingAccess((await store.get(later.garageId)).billing), 'readonly');
    const different = await store.register({
      email: 'different@example.com',
      hash: 'test',
      name: 'Autre',
      garage: 'Autre premier',
    });
    assert.equal(billingAccess((await store.get(different.garageId)).billing), 'trial');
    await store.db.query('UPDATE garage_billing SET paid_until=$2 WHERE garage_id=$1', [
      extras[0].garageId,
      Date.now() + 86400000,
    ]);
    assert.equal(billingAccess((await store.get(extras[0].garageId)).billing), 'paid');
    assert.equal(billingAccess((await store.get(extras[1].garageId)).billing), 'readonly');
  } finally {
    await store.close();
  }
});

test('joining a garage and using the demo do not consume the first personal garage trial, including concurrent creations', async () => {
  const store = new Store(testDatabase());
  try {
    const owner = await store.register({
      email: 'inviter@example.com',
      hash: 'test',
      name: 'Patron',
      garage: 'Partagé',
    });
    const invitation = await store.invite(
      { ...owner, email: 'inviter@example.com', expires: Date.now() + 100000, tokenHash: 'test' },
      'member@example.com',
      'mechanic',
    );
    const member = await store.register({
      email: 'member@example.com',
      hash: 'test',
      name: 'Membre',
      invitation,
    });
    const session = {
      ...member,
      email: 'member@example.com',
      expires: Date.now() + 100000,
      tokenHash: 'test',
    };
    await store.createDemo(session);
    const targets = await Promise.all([
      store.createGarage(session, 'Personnel A'),
      store.createGarage(session, 'Personnel B'),
    ]);
    const states = await Promise.all(targets.map((t) => store.get(t.garageId)));
    assert.equal(states.filter((s) => billingAccess(s.billing) === 'trial').length, 1);
    assert.equal(states.filter((s) => billingAccess(s.billing) === 'readonly').length, 1);
    assert.ok(
      states.some((s) => Math.abs(s.billing!.trialEndsAt - Date.now() - trialDuration) < 5000),
    );
  } finally {
    await store.close();
  }
});
