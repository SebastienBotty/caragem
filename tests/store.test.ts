import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, passwordHash, passwordMatches } from '../src/server/store.ts';

test('sessions isolate garages and invalid tokens cannot access a garage', () => {
  const db = new Store(':memory:');
  try {
    const a = db.create(true);
    const b = db.create(true);
    const token = db.newSession(a.id, a.users[0].id);
    const session = db.session(`carm_session=${token}`)!;
    assert.equal(session.garageId, a.id);
    assert.equal(db.session('carm_session=' + 'a'.repeat(64)), undefined);
    assert.throws(
      () =>
        db.act(session, {
          type: 'note',
          id: b.vehicles[0].id,
          text: 'foreign mutation',
        }),
      /introuvable/,
    );
    db.logout(session);
    assert.equal(db.session(`carm_session=${token}`), undefined);
  } finally {
    db.close();
  }
});

test('salted password hashes verify exactly and invitations are scoped and single use', async () => {
  const hash = await passwordHash('une phrase de passe solide');
  assert.equal(await passwordMatches('une phrase de passe solide', hash), true);
  assert.equal(await passwordMatches('Une phrase de passe solide', hash), false);
  const db = new Store(':memory:');
  try {
    const a = db.create(true);
    const token = db.newSession(a.id, a.users[0].id);
    const s = db.session(`carm_session=${token}`)!;
    const invite = db.invite(s, 'test@example.com', 'mechanic');
    assert.equal(db.invitation(invite, 'other@example.com'), undefined);
    assert.equal(db.invitation(invite, 'test@example.com')?.garage_id, a.id);
    db.useInvitation(invite);
    assert.equal(db.invitation(invite, 'test@example.com'), undefined);
  } finally {
    db.close();
  }
});
