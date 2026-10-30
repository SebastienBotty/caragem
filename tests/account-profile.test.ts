import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from 'socket.io';
import sharp from 'sharp';
import { Store, digest, passwordHash, type Session } from '../src/server/store.ts';
import {
  accountProfileApi,
  normalizedAvatar,
  type AccountMail,
  type AccountMailer,
} from '../src/server/account-profile-api.ts';
import { testDatabase } from './helpers/database.ts';

async function fixture(email: string, google = false) {
  const store = new Store(testDatabase());
  await store.ready;
  for (const file of ['account-security.sql', 'account-profile.sql'])
    await store.db.query(readFileSync(new URL(`../src/server/${file}`, import.meta.url), 'utf8'));
  const target = await store.register({
    email,
    hash: await passwordHash('my secure password'),
    name: 'Ancien Nom',
    garage: 'Garage test',
  });
  if (google) {
    await store.db.query('UPDATE accounts SET hash=NULL WHERE email=$1', [email]);
    await store.db.query('INSERT INTO google_identities(subject,email) VALUES($1,$2)', [
      'google-profile-test',
      email,
    ]);
  }
  const token = await store.newSession(target.garageId, target.userId, 'Test browser', Date.now());
  const session = (await store.session(`carm_session=${token}`))!;
  const io = new Server();
  const messages: AccountMail[] = [];
  const mailer: AccountMailer = async (mail) => {
    messages.push(mail);
  };
  const call = async (
    path: string,
    body: unknown = {},
    actor: Session | undefined = session,
    sendMail = mailer,
  ) => {
    let status = 0;
    let data: Record<string, unknown> = {};
    let cookie = '';
    await accountProfileApi(
      store,
      io,
      { method: 'POST', headers: { 'user-agent': 'Test browser' } } as IncomingMessage,
      {
        setHeader: (_name: string, value: string) => {
          cookie = value;
        },
      } as unknown as ServerResponse,
      `/api/account/${path}`,
      body,
      actor,
      (code, result) => {
        status = code;
        data = result as Record<string, unknown>;
      },
      sendMail,
    );
    return { status, data, cookie };
  };
  return {
    store,
    session,
    io,
    messages,
    call,
    close: async () => {
      await store.close();
    },
  };
}
const receivedCode = (messages: AccountMail[], email: string) =>
  messages.find((m) => m.to === email)!.text.match(/\b\d{6}\b/)![0];

test('avatar input is rewritten to a bounded metadata-free JPEG and rejects invalid content', async () => {
  const image = await sharp({
    create: { width: 600, height: 400, channels: 3, background: '#aa9988' },
  })
    .withMetadata()
    .png()
    .toBuffer();
  const avatar = await normalizedAvatar(`data:image/png;base64,${image.toString('base64')}`);
  const bytes = Buffer.from(avatar.split(',')[1], 'base64');
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  assert.equal(metadata.exif, undefined);
  assert.ok(bytes.length <= 64 * 1024);
  await assert.rejects(normalizedAvatar('data:image/png;base64,PGh0bWw+'), /invalide/);
  await assert.rejects(normalizedAvatar('data:image/svg+xml;base64,PHN2Zz4='), /JPEG/);
  await assert.rejects(
    normalizedAvatar(`data:image/jpeg;base64,${image.toString('base64')}`),
    /invalide/,
  );
});

test('personal profile updates only the account memberships, including read-only garages, without changing roles', async () => {
  const f = await fixture('profile@example.com');
  try {
    const second = await f.store.createGarage(f.session, 'Deuxième garage');
    const foreign = await f.store.register({
      email: 'foreign@example.com',
      hash: 'test',
      name: 'Autre Patron',
      garage: 'Étranger',
    });
    await f.store.db.query('UPDATE garage_billing SET trial_ends_at=0 WHERE garage_id=$1', [
      second.garageId,
    ]);
    const image = await sharp({
      create: { width: 80, height: 80, channels: 3, background: '#aa9988' },
    })
      .png()
      .toBuffer();
    const result = await f.call('profile', {
      firstName: 'Sébastien',
      lastName: 'Botty',
      avatar: `data:image/png;base64,${image.toString('base64')}`,
    });
    assert.equal(result.status, 200);
    for (const id of [f.session.garageId, second.garageId]) {
      const user = (await f.store.get(id)).users[0];
      assert.equal(user.name, 'Sébastien Botty');
      assert.equal(user.role, 'owner');
      assert.match(user.avatar!, /^data:image\/jpeg;base64,/);
    }
    assert.equal((await f.store.get(foreign.garageId)).users[0].name, 'Autre Patron');
    await assert.rejects(
      f.call('profile', { firstName: 'Sébastien', lastName: 'Botty', role: 'owner' }),
      /Unrecognized key/,
    );
    await f.call('profile', { firstName: 'Seb', lastName: 'Botty', avatar: null });
    assert.equal((await f.store.get(f.session.garageId)).users[0].avatar, undefined);
    const rows = await f.store.db.query('SELECT avatar,first_name FROM accounts WHERE email=$1', [
      f.session.email,
    ]);
    assert.equal(rows.rows[0].avatar, null);
    assert.equal(rows.rows[0].first_name, 'Seb');
  } finally {
    await f.close();
  }
});

test('password reauthentication and a single-use new-address code preserve memberships while rotating and revoking sessions', async () => {
  const f = await fixture('email-password@example.com');
  try {
    const second = await f.store.createGarage(f.session, 'Autre garage');
    const oldOtherToken = await f.store.newSession(second.garageId, second.userId);
    await assert.rejects(
      f.call('email/start', { email: 'changed@example.com', password: 'wrong' }),
      /Mot de passe/,
    );
    const result = await f.call('email/start', {
      email: 'changed@example.com',
      password: 'my secure password',
    });
    assert.equal(result.data.oldCodeRequired, false);
    assert.equal(f.messages.length, 2);
    const code = receivedCode(f.messages, 'changed@example.com');
    await assert.rejects(
      f.call('email/confirm', { code }, (await f.store.session(`carm_session=${oldOtherToken}`))!),
      /expirée/,
    );
    const pending = await f.store.db.query(
      'SELECT new_code_hash FROM account_email_changes WHERE account_email=$1',
      [f.session.email],
    );
    assert.notEqual(pending.rows[0].new_code_hash, code);
    await assert.rejects(f.call('email/confirm', { code: '000000' }), /incorrect/);
    const changed = await f.call('email/confirm', { code });
    assert.equal(changed.status, 200);
    assert.match(changed.cookie, /carm_session=[a-f0-9]{64}/);
    const newSession = await f.store.session(changed.cookie.split(';')[0]);
    assert.equal(newSession!.email, 'changed@example.com');
    assert.equal(newSession!.authenticatedAt, f.session.authenticatedAt);
    assert.equal(await f.store.session(`carm_session=${oldOtherToken}`), undefined);
    assert.equal(await f.store.account('email-password@example.com'), undefined);
    assert.equal((await f.store.garages('changed@example.com')).length, 2);
    assert.equal(
      (await f.store.db.query('SELECT count(*)::int AS count FROM account_email_changes')).rows[0]
        .count,
      0,
    );
    await assert.rejects(f.call('email/confirm', { code }, newSession), /expirée/);
  } finally {
    await f.close();
  }
});

test('Google-only email changes require both mailbox proofs and preserve the Google subject', async () => {
  const f = await fixture('google-only@example.com', true);
  try {
    assert.equal(
      (await f.call('email/start', { email: 'google-new@example.com' })).data.oldCodeRequired,
      true,
    );
    const code = receivedCode(f.messages, 'google-new@example.com');
    await assert.rejects(f.call('email/confirm', { code }), /incorrect/);
    const changed = await f.call('email/confirm', {
      code,
      oldCode: receivedCode(f.messages, 'google-only@example.com'),
    });
    assert.equal(changed.status, 200);
    const identities = await f.store.db.query('SELECT subject,email FROM google_identities');
    assert.deepEqual(identities.rows, [
      { subject: 'google-profile-test', email: 'google-new@example.com' },
    ]);
    const target = await f.store.googleAccount(
      {
        sub: 'google-profile-test',
        email: 'google-only@example.com',
        name: 'Google Name',
        emailVerified: true,
      },
      { verifier: '', nonce: '' },
    );
    assert.equal(target.garageId, f.session.garageId);
  } finally {
    await f.close();
  }
});

test('failed delivery, expired requests and exhausted code attempts never change an email', async () => {
  const f = await fixture('email-errors@example.com');
  try {
    await assert.rejects(
      f.call(
        'email/start',
        { email: 'failure@example.com', password: 'my secure password' },
        f.session,
        async () => {
          throw new Error('SMTP unavailable');
        },
      ),
      /SMTP unavailable/,
    );
    assert.equal(
      (await f.store.db.query('SELECT count(*)::int AS count FROM account_email_changes')).rows[0]
        .count,
      0,
    );
    await f.call('email/start', { email: 'valid@example.com', password: 'my secure password' });
    const code = receivedCode(f.messages, 'valid@example.com');
    await f.store.db.query('UPDATE account_email_changes SET expires=0');
    await assert.rejects(f.call('email/confirm', { code }), /expirée/);
    await f.store.db.query('UPDATE account_email_changes SET expires=$1', [Date.now() + 60000]);
    for (let n = 0; n < 5; n++)
      await assert.rejects(f.call('email/confirm', { code: '000000' }), /incorrect/);
    await assert.rejects(f.call('email/confirm', { code }), /expirée/);
    assert.ok(await f.store.account('email-errors@example.com'));
  } finally {
    await f.close();
  }
});

test('enabled second factor is required before sending email-change proofs', async () => {
  const f = await fixture('email-factor@example.com');
  try {
    const backup = 'a'.repeat(32);
    await f.store.db.query(
      'INSERT INTO account_security(email,enabled,recovery_hashes) VALUES($1,true,$2::jsonb)',
      [f.session.email, JSON.stringify([digest(backup)])],
    );
    await assert.rejects(
      f.call('email/start', { email: 'factor-new@example.com', password: 'my secure password' }),
      /code/,
    );
    assert.equal(f.messages.length, 0);
    assert.equal(
      (
        await f.call('email/start', {
          email: 'factor-new@example.com',
          password: 'my secure password',
          securityCode: backup,
        })
      ).status,
      200,
    );
    assert.equal(f.messages.length, 2);
    const security = await f.store.db.query(
      'SELECT recovery_hashes FROM account_security WHERE email=$1',
      [f.session.email],
    );
    assert.deepEqual(security.rows[0].recovery_hashes, []);
  } finally {
    await f.close();
  }
});
