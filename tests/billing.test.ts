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
