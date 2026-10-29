import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store.ts';
import { testDatabase } from './helpers/database.ts';

test('delegated invitations cannot grant more rights, including after role changes or revocation', async () => {
  const store = new Store(testDatabase());
  try {
    const state = await store.create(true);
    const [owner, mechanic] = state.users;
    const ownerSession = (await store.session(
      `carm_session=${await store.newSession(state.id, owner.id)}`,
    ))!;
    const memberSession = (await store.session(
      `carm_session=${await store.newSession(state.id, mechanic.id)}`,
    ))!;
    await store.act(ownerSession, {
      type: 'userPermissions',
      userId: mechanic.id,
      permissions: { 'team.invite': true },
    });
    await assert.rejects(
      store.invite(memberSession, 'strong@example.test', 'reception'),
      /déléguer/,
    );
    const updated = await store.act(ownerSession, {
      type: 'customRole',
      name: 'Lecture',
      baseRole: 'mechanic',
      permissions: { 'garage.view': true },
    });
    const role = updated.settings.customRoles![0];
    const token = await store.invite(memberSession, 'pending@example.test', 'mechanic', role.id);
    await store.act(ownerSession, {
      type: 'customRole',
      id: role.id,
      name: role.name,
      baseRole: role.baseRole,
      permissions: { 'garage.configure': true },
    });
    await assert.rejects(
      store.register({
        email: 'pending@example.test',
        hash: 'test-only',
        name: 'Pending',
        invitation: token,
      }),
      /déléguer/,
    );
    assert.equal(await store.account('pending@example.test'), undefined);
    const ordinary = await store.invite(memberSession, 'ordinary@example.test', 'mechanic');
    await store.act(ownerSession, {
      type: 'userPermissions',
      userId: mechanic.id,
      permissions: { 'team.invite': false },
    });
    await assert.rejects(
      store.register({
        email: 'ordinary@example.test',
        hash: 'test-only',
        name: 'Ordinary',
        invitation: ordinary,
      }),
      /autorisation/,
    );
    const approved = await store.invite(
      ownerSession,
      'approved@example.test',
      'reception',
      role.id,
    );
    const joined = await store.register({
      email: 'approved@example.test',
      hash: 'test-only',
      name: 'Approved',
      invitation: approved,
    });
    assert.equal(joined.garageId, state.id);
    const legacy = await store.invite(ownerSession, 'legacy@example.test', 'mechanic');
    await store.db.query('UPDATE invitations SET inviter_id=NULL WHERE email=$1', [
      'legacy@example.test',
    ]);
    await assert.rejects(
      store.register({
        email: 'legacy@example.test',
        hash: 'test-only',
        name: 'Legacy',
        invitation: legacy,
      }),
      /renouvelée/,
    );
  } finally {
    await store.close();
  }
});
