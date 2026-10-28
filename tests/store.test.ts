import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, passwordHash, passwordMatches } from '../src/server/store.ts';
import { testDatabase } from './helpers/database.ts';

test('sessions isolate garages; demo identity overrides cannot impersonate real accounts', async () => {
  const db = new Store(testDatabase());
  try {
    const a = await db.create(true),
      b = await db.create(true);
    const token = await db.newSession(a.id, a.users[0].id),
      cookie = `carm_session=${token}`;
    const session = (await db.session(cookie))!;
    assert.equal(session.garageId, a.id);
    assert.equal((await db.session(cookie, a.users[1].id))?.userId, a.users[1].id);
    assert.equal((await db.session(cookie))?.userId, a.users[0].id);
    assert.equal(await db.session(cookie, b.users[0].id), undefined);
    assert.equal(await db.session(cookie, { userId: a.users[1].id }), undefined);
    const real = await db.register({
      email: 'owner@example.com',
      hash: 'test-hash',
      name: 'Owner',
      garage: 'Personal Garage',
    });
    const realCookie = `carm_session=${await db.newSession(real.garageId, real.userId)}`;
    assert.equal(await db.session(realCookie, real.userId), undefined);
    assert.equal(await db.session('carm_session=' + 'a'.repeat(64)), undefined);
    await assert.rejects(
      db.act(session, { type: 'note', id: b.vehicles[0].id, text: 'foreign mutation' }),
      /introuvable/,
    );
    await db.logout(session);
    assert.equal(await db.session(cookie), undefined);
  } finally {
    await db.close();
  }
});

test('salted password hashes verify exactly and invitations are scoped and single use', async () => {
  const hash = await passwordHash('une phrase de passe solide');
  assert.equal(await passwordMatches('une phrase de passe solide', hash), true);
  assert.equal(await passwordMatches('Une phrase de passe solide', hash), false);
  const db = new Store(testDatabase());
  try {
    const a = await db.create(true);
    const token = await db.newSession(a.id, a.users[0].id);
    const session = (await db.session(`carm_session=${token}`))!;
    const invite = await db.invite(session, 'test@example.com', 'mechanic');
    assert.equal(await db.invitation(invite, 'other@example.com'), undefined);
    assert.equal((await db.invitation(invite, 'test@example.com'))?.garage_id, a.id);
    await db.useInvitation(invite);
    assert.equal(await db.invitation(invite, 'test@example.com'), undefined);
  } finally {
    await db.close();
  }
});

test('one account joins multiple garages, keeps distinct roles, and creates empty personal garages', async () => {
  const db = new Store(testDatabase());
  try {
    const a = await db.register({
      email: 'a@example.com',
      hash: 'test-hash',
      name: 'Alice',
      garage: 'Garage A',
    });
    const b = await db.register({
      email: 'b@example.com',
      hash: 'test-hash',
      name: 'Bob',
      garage: 'Garage B',
    });
    const ownerA = (await db.session(`carm_session=${await db.newSession(a.garageId, a.userId)}`))!;
    const ownerB = (await db.session(`carm_session=${await db.newSession(b.garageId, b.userId)}`))!;
    const token = await db.invite(ownerA, 'b@example.com', 'mechanic');
    await assert.rejects(db.joinGarage('other@example.com', token), /invitation|Invitation/);
    const joined = await db.joinGarage('b@example.com', token);
    assert.equal(joined.garageId, a.garageId);
    assert.notEqual(joined.userId, b.userId);
    assert.equal((await db.garages('b@example.com')).length, 2);
    assert.deepEqual(
      new Set((await db.garages('b@example.com')).map((g) => g.role)),
      new Set(['owner', 'mechanic']),
    );
    await assert.rejects(db.joinGarage('b@example.com', token), /Invitation/);
    const mechanicCookie = `carm_session=${await db.newSession(joined.garageId, joined.userId)}`;
    const mechanic = (await db.session(mechanicCookie))!;
    await assert.rejects(db.invite(mechanic, 'x@example.com', 'mechanic'), /autorisation/);
    await assert.rejects(db.membership('a@example.com', b.garageId), /partie/);
    const extra = await db.createGarage(ownerB, 'Garage C');
    const state = await db.get(extra.garageId);
    assert.equal(state.demo, false);
    assert.equal(state.settings.name, 'Garage C');
    assert.equal(state.settings.address, '');
    assert.deepEqual(
      [state.vehicles.length, state.customers.length, state.parts.length, state.users.length],
      [0, 0, 0, 1],
    );
    await assert.rejects(
      db.register({
        email: 'new@example.com',
        hash: 'test-hash',
        name: 'New',
        invitation: 'invalid-token',
      }),
      /Invitation/,
    );
    assert.equal(
      await db.account('new@example.com'),
      undefined,
      'failed registration rolls back account creation',
    );
    const revoked = await db.invite(ownerA, 'new@example.com', 'mechanic');
    const pending = await db.invitations(ownerA);
    await db.revokeInvitation(ownerA, pending.find((i) => i.email === 'new@example.com')!.id);
    assert.equal(await db.invitation(revoked, 'new@example.com'), undefined);
    const extraCookie = `carm_session=${await db.newSession(extra.garageId, extra.userId)}`;
    await db.changePassword(ownerB, await passwordHash('a different strong password'));
    assert.equal(await db.session(mechanicCookie), undefined);
    assert.equal(await db.session(extraCookie), undefined);
  } finally {
    await db.close();
  }
});

test('concurrent actions lock garage rows and preserve every committed change', async () => {
  const db = new Store(testDatabase());
  try {
    const state = await db.create(true);
    const session = (await db.session(
      `carm_session=${await db.newSession(state.id, state.users[0].id)}`,
    ))!;
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        db.act(session, { type: 'note', id: state.vehicles[0].id, text: `Concurrent note ${i}` }),
      ),
    );
    const persisted = await db.get(state.id);
    assert.equal(persisted.revision, state.revision + 12);
    for (let i = 0; i < 12; i++)
      assert.ok(persisted.vehicles[0].notes.some((n) => n.text === `Concurrent note ${i}`));
  } finally {
    await db.close();
  }
});
