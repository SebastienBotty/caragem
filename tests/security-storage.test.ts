import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store.ts';
import { testDatabase } from './helpers/database.ts';

test('garage creation quotas are atomic and oversized snapshots cannot overwrite saved data', async () => {
  const store = new Store(testDatabase());
  try {
    const owner = await store.register({
      email: 'quota@example.test',
      hash: 'test-only',
      name: 'Quota',
      garage: 'Personal',
    });
    const session = (await store.session(
      `caragem_session=${await store.newSession(owner.garageId, owner.userId)}`,
    ))!;
    for (let i = 1; i < 9; i++) await store.createGarage(session, `Garage ${i}`);
    const attempts = await Promise.allSettled([
      store.createGarage(session, 'Last'),
      store.createGarage(session, 'Excess'),
    ]);
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await store.garages(session.email!)).length, 10);
    const [firstDemo, secondDemo] = await Promise.all([
      store.createDemo(session),
      store.createDemo(session),
    ]);
    assert.equal(firstDemo.garageId, secondDemo.garageId);
    const state = await store.create(true);
    const before = await store.get(state.id);
    state.vehicles[0].notes = Array.from({ length: 2700 }, () => ({
      id: 'test',
      author: 'Test',
      at: new Date().toISOString(),
      text: 'a'.repeat(4000),
    }));
    await assert.rejects(store.save(state), /limite.*10 Mio/);
    assert.deepEqual(await store.get(state.id), before);
  } finally {
    await store.close();
  }
});

test('demo cleanup removes expired legacy demo dependencies and preserves accounts, active demos and personal garages', async () => {
  const store = new Store(testDatabase());
  try {
    const owner = await store.register({
      email: 'cleanup@example.test',
      hash: 'test-only',
      name: 'Cleanup',
      garage: 'Personal',
    });
    const expired = await store.create(true);
    const active = await store.create(true);
    const token = await store.newSession(expired.id, expired.users[0].id);
    await store.db.query('UPDATE sessions SET expires=$1 WHERE garage_id=$2', [
      Date.now() + 7 * 86400000,
      expired.id,
    ]);
    assert.equal((await store.session(`caragem_session=${token}`))!.expires, expired.demoExpires);
    const session = (await store.session(`caragem_session=${token}`))!;
    await store.invite(session, 'pending@example.test', 'mechanic');
    await store.db.query(
      "UPDATE garages SET state=state-'demoExpires',created_at=now()-interval '2 days' WHERE id=$1",
      [expired.id],
    );
    assert.equal(await store.session(`caragem_session=${token}`), undefined);
    await store.purgeExpiredDemos();
    assert.equal(
      (await store.db.query('SELECT id FROM garages WHERE id=$1', [expired.id])).rows.length,
      0,
    );
    assert.equal(
      (await store.db.query('SELECT id FROM invitations WHERE garage_id=$1', [expired.id])).rows
        .length,
      0,
    );
    assert.equal((await store.get(owner.garageId)).settings.name, 'Personal');
    assert.equal((await store.get(active.id)).demo, true);
    assert.ok(await store.account('cleanup@example.test'));
  } finally {
    await store.close();
  }
});
