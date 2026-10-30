import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store.ts';
import { testDatabase } from './helpers/database.ts';

test('account metadata defaults migrate safely and session activity preserves authentication provenance', async () => {
  const store = new Store(testDatabase());
  try {
    const target = await store.register({
      email: 'metadata@example.com',
      name: 'Compte',
      hash: 'test',
      garage: 'Garage',
    });
    const account = await store.account('metadata@example.com');
    assert.deepEqual(account!.preferences, {});
    assert.equal(account!.twoFactorEnabled, false);
    assert.equal(account!.firstName, '');
    const authenticated = Date.now() - 10000;
    const token = await store.newSession(
      target.garageId,
      target.userId,
      'Test Browser',
      authenticated,
    );
    const session = await store.session(`caragem_session=${token}`);
    assert.equal(session!.authenticatedAt, authenticated);
    assert.equal(session!.twoFactorVerified, false);
    const { rows } = await store.db.query(
      'SELECT id,user_agent,last_seen::float8 AS seen FROM sessions WHERE token_hash=$1',
      [session!.tokenHash],
    );
    assert.match(String(rows[0].id), /^[a-f0-9-]{36}$/);
    assert.equal(rows[0].user_agent, 'Test Browser');
    assert.ok(Number(rows[0].seen) > Date.now() - 5000);
    await store.db.query('UPDATE sessions SET last_seen=0 WHERE token_hash=$1', [
      session!.tokenHash,
    ]);
    await store.session(`caragem_session=${token}`);
    const activity = (
      await store.db.query(
        'SELECT last_seen::float8 AS seen,authenticated_at::float8 AS authenticated FROM sessions WHERE token_hash=$1',
        [session!.tokenHash],
      )
    ).rows[0];
    assert.ok(Number(activity.seen) > Date.now() - 5000);
    assert.equal(activity.authenticated, authenticated);
  } finally {
    await store.close();
  }
});
