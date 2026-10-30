import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store, passwordHash, digest } from '../src/server/store.ts';
import { createApi } from '../src/server/api.ts';
import { createRealtime } from '../src/server/realtime.ts';
import { newTotpSecret, totp, validTotp, sealTotp, openTotp } from '../src/lib/totp.ts';
import { testDatabase } from './helpers/database.ts';

test('TOTP follows RFC6238 with 30s steps, tolerates adjacent clock drift, rejects replay and encrypts seeds with authenticated encryption', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp(secret, 59000), '287082');
  assert.equal(totp(secret, 1111111109000), '081804');
  assert.equal(validTotp(secret, '287082', -1, 59000), 1);
  assert.equal(validTotp(secret, '287082', 1, 59000), undefined);
  assert.equal(validTotp(secret, '287082', -1, 60000), 1);
  assert.equal(validTotp(secret, '287082', -1, 90000), undefined);
  assert.equal(validTotp(secret, totp(secret, 90000), -1, 60000), 3);
  assert.equal(validTotp(secret, totp(secret, 90000), 3, 60000), undefined);
  assert.equal(validTotp(secret, '28708', -1, 59000), undefined);
  assert.match(newTotpSecret(), /^[A-Z2-7]{32}$/);
  const key = 'ab'.repeat(32),
    sealed = sealTotp(secret, key);
  assert.equal(openTotp(sealed, key), secret);
  assert.ok(!sealed.includes(secret));
  assert.throws(() => openTotp(sealed, 'cd'.repeat(32)));
  assert.throws(() => sealTotp(secret, 'bad-key'));
});

test('account sessions and MFA enforce account isolation, first-factor reauthentication, pending login, expiry and single-use recovery codes', async () => {
  const store = new Store(testDatabase());
  let api: ReturnType<typeof createApi>;
  const server = createServer(async (req, res) => {
    await api(req, res);
  });
  const io = createRealtime(server, store);
  api = createApi(store, io);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const original = { origin: process.env.APP_ORIGIN, key: process.env.ACCOUNT_ENCRYPTION_KEY };
  process.env.APP_ORIGIN = base;
  const password = 'my secure testing password';
  const post = (path: string, body: unknown, cookie = '') =>
    fetch(`${base}/api/${path}`, {
      method: 'POST',
      headers: {
        Origin: base,
        Cookie: cookie,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 Windows Chrome/130',
      },
      body: JSON.stringify(body),
    });
  const get = (path: string, cookie = '') =>
    fetch(`${base}/api/${path}`, { headers: { Cookie: cookie } });
  const cookieOf = (res: Response, name = 'caragem_session') =>
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith(name + '='))
      ?.split(';')[0] ?? '';
  try {
    const target = await store.register({
      email: 'security@example.com',
      hash: await passwordHash(password),
      name: 'Security User',
      garage: 'Security garage',
    });
    const cookie = `caragem_session=${await store.newSession(target.garageId, target.userId, 'Initial Chrome', Date.now())}`;
    const secondCookie = `caragem_session=${await store.newSession(target.garageId, target.userId, 'Old phone')}`;
    const other = await store.register({
      email: 'foreign@example.com',
      hash: 'fake',
      name: 'Other User',
      garage: 'Other garage',
    });
    const foreignCookie = `caragem_session=${await store.newSession(other.garageId, other.userId)}`;
    const foreignInfo = await (await get('account/security', foreignCookie)).json();
    let info = await (await get('account/security', cookie)).json();
    assert.equal(info.sessions.length, 2);
    assert.equal(info.sessions.filter((s: { current: boolean }) => s.current).length, 1);
    assert.equal(JSON.stringify(info).includes('token_hash'), false);
    assert.equal(
      (await post('account/security/sessions/revoke', { id: foreignInfo.sessions[0].id }, cookie))
        .status,
      200,
    );
    assert.ok(await store.session(foreignCookie));
    assert.equal(
      (await post('account/security/sessions/revoke', { others: true }, cookie)).status,
      200,
    );
    assert.equal(await store.session(secondCookie), undefined);
    assert.ok(await store.session(cookie));
    delete process.env.ACCOUNT_ENCRYPTION_KEY;
    assert.equal((await post('account/security/2fa/setup', { password }, cookie)).status, 400);
    process.env.ACCOUNT_ENCRYPTION_KEY = '71'.repeat(32);
    assert.equal(
      (await post('account/security/2fa/setup', { password: 'wrong' }, cookie)).status,
      400,
    );
    const setup = await (await post('account/security/2fa/setup', { password }, cookie)).json();
    assert.match(setup.secret, /^[A-Z2-7]{32}$/);
    assert.match(setup.uri, /^otpauth:\/\/totp\//);
    const encrypted = (
      await store.db.query('SELECT pending_secret FROM account_security WHERE email=$1', [
        'security@example.com',
      ])
    ).rows[0].pending_secret;
    assert.notEqual(encrypted, setup.secret);
    await store.db.query('UPDATE account_security SET pending_expires=0 WHERE email=$1', [
      'security@example.com',
    ]);
    assert.equal(
      (await post('account/security/2fa/enable', { code: totp(setup.secret) }, cookie)).status,
      400,
    );
    const setupAgain = await (
      await post('account/security/2fa/setup', { password }, cookie)
    ).json();
    const current = totp(setupAgain.secret);
    const wrong = String((Number(current) + 1) % 1000000).padStart(6, '0');
    assert.equal((await post('account/security/2fa/enable', { code: wrong }, cookie)).status, 400);
    const enable = await post('account/security/2fa/enable', { code: current }, cookie);
    assert.equal(enable.status, 200, await enable.clone().text());
    const { recoveryCodes } = await enable.json();
    assert.equal(recoveryCodes.length, 8);
    const security = (
      await store.db.query('SELECT * FROM account_security WHERE email=$1', [
        'security@example.com',
      ])
    ).rows[0];
    assert.equal(JSON.stringify(security).includes(recoveryCodes[0]), false);
    assert.equal(JSON.stringify(security).includes(setupAgain.secret), false);
    assert.equal((await store.account('security@example.com'))!.twoFactorEnabled, true);
    const racedCookie = `caragem_session=${await store.newSession(target.garageId, target.userId, 'Concurrent first-factor login', Date.now())}`;
    assert.equal(
      await store.session(racedCookie),
      undefined,
      'a session created without MFA cannot race past activation',
    );
    const login = async () => {
      const result = await post('login', { email: 'security@example.com', password });
      assert.equal(result.status, 200, await result.clone().text());
      assert.equal((await result.json()).twoFactorRequired, true);
      assert.equal(cookieOf(result), '');
      const challenge = cookieOf(result, 'caragem_2fa');
      assert.ok(challenge);
      return challenge;
    };
    let challenge = await login();
    assert.equal(
      (await (await get('session', challenge)).json()).state,
      null,
      'challenge is not a session',
    );
    assert.equal(
      (await post('auth/2fa/verify', { code: current }, challenge)).status,
      400,
      'activation code cannot be replayed',
    );
    const verified = await post('auth/2fa/verify', { code: recoveryCodes[0] }, challenge);
    assert.equal(verified.status, 200);
    const freshCookie = cookieOf(verified);
    assert.ok(await store.session(freshCookie));
    assert.ok((await store.session(freshCookie))!.authenticatedAt! > Date.now() - 5000);
    assert.equal(
      (await post('auth/2fa/verify', { code: recoveryCodes[1] }, challenge)).status,
      400,
      'challenge is single use',
    );
    challenge = await login();
    assert.equal(
      (await post('auth/2fa/verify', { code: recoveryCodes[0] }, challenge)).status,
      400,
      'recovery code is single use',
    );
    const ch2 = await login();
    const [one, two] = await Promise.all([
      post('auth/2fa/verify', { code: recoveryCodes[1] }, challenge),
      post('auth/2fa/verify', { code: recoveryCodes[1] }, ch2),
    ]);
    assert.deepEqual([one.status, two.status].sort(), [200, 400], 'concurrent reuse succeeds once');
    const expired = await login();
    await store.db.query('UPDATE two_factor_challenges SET expires=0 WHERE token_hash=$1', [
      digest(expired.split('=')[1]),
    ]);
    assert.equal((await (await get('auth/2fa/status', expired)).json()).required, false);
    assert.equal((await post('auth/2fa/verify', { code: recoveryCodes[2] }, expired)).status, 400);
    const exhausted = await login();
    for (let attempt = 0; attempt < 5; attempt++)
      assert.equal((await post('auth/2fa/verify', { code: wrong }, exhausted)).status, 400);
    assert.equal(
      (await post('auth/2fa/verify', { code: recoveryCodes[2] }, exhausted)).status,
      400,
      'five failed attempts exhaust a challenge',
    );
    const missingKey = await login();
    delete process.env.ACCOUNT_ENCRYPTION_KEY;
    assert.equal(
      (await post('auth/2fa/verify', { code: totp(setupAgain.secret) }, missingKey)).status,
      400,
      'missing encryption key never bypasses MFA',
    );
    process.env.ACCOUNT_ENCRYPTION_KEY = '71'.repeat(32);
    // A Google-only session needs a first-factor timestamp; a new session id does not prove authentication.
    await store.db.query('UPDATE accounts SET hash=NULL WHERE email=$1', ['foreign@example.com']);
    assert.equal((await post('account/security/2fa/setup', {}, foreignCookie)).status, 400);
    const authenticatedForeign = `caragem_session=${await store.newSession(other.garageId, other.userId, 'Chrome', Date.now())}`;
    assert.equal((await post('account/security/2fa/setup', {}, authenticatedForeign)).status, 200);
    // Valid TOTP can be consumed once per time step after an independently established login.
    await store.db.query('UPDATE account_security SET last_step=-1 WHERE email=$1', [
      'security@example.com',
    ]);
    const totpChallenge = await login();
    assert.equal(
      (await post('auth/2fa/verify', { code: totp(setupAgain.secret) }, totpChallenge)).status,
      200,
    );
    assert.equal(
      (
        await post(
          'account/security/2fa/disable',
          { password: 'wrong', code: recoveryCodes[3] },
          freshCookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          'account/security/2fa/disable',
          { password, code: recoveryCodes[3] },
          freshCookie,
        )
      ).status,
      200,
    );
    assert.equal((await store.account('security@example.com'))!.twoFactorEnabled, false);
    const plain = await post('login', { email: 'security@example.com', password });
    assert.equal(plain.status, 200);
    assert.ok(cookieOf(plain));
    info = await (await get('account/security', freshCookie)).json();
    const self = info.sessions.find((s: { current: boolean }) => s.current);
    assert.equal(
      (await (await post('account/security/sessions/revoke', { id: self.id }, freshCookie)).json())
        .loggedOut,
      true,
    );
    assert.equal(await store.session(freshCookie), undefined);
    // Accounts can lose their old membership and still need MFA before accepting a new invitation.
    await store.db.query(
      'INSERT INTO account_security(email,enabled,recovery_hashes) VALUES($1,true,$2::jsonb)',
      ['security@example.com', JSON.stringify([digest('af'.repeat(16))])],
    );
    await store.db.query('DELETE FROM memberships WHERE email=$1', ['security@example.com']);
    const foreignSession = (await store.session(authenticatedForeign))!;
    const invitation = await store.invite(foreignSession, 'security@example.com', 'mechanic');
    const invitedLogin = await post('login', {
      email: 'security@example.com',
      password,
      invitation,
    });
    assert.equal((await invitedLogin.json()).twoFactorRequired, true);
    assert.ok(
      await store.invitation(invitation, 'security@example.com'),
      'invitation is not consumed before MFA',
    );
    const accepted = await post(
      'auth/2fa/verify',
      { code: 'af'.repeat(16) },
      cookieOf(invitedLogin, 'caragem_2fa'),
    );
    assert.equal(accepted.status, 200, await accepted.clone().text());
    assert.equal((await store.session(cookieOf(accepted)))!.garageId, other.garageId);
  } finally {
    if (original.origin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = original.origin;
    if (original.key === undefined) delete process.env.ACCOUNT_ENCRYPTION_KEY;
    else process.env.ACCOUNT_ENCRYPTION_KEY = original.key;
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await store.close();
  }
});
