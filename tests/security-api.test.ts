import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store, passwordHash } from '../src/server/store.ts';
import { scryptSync } from 'node:crypto';
import { createApi } from '../src/server/api.ts';
import { createRealtime } from '../src/server/realtime.ts';
import { testDatabase } from './helpers/database.ts';

async function apiServer(t: TestContext) {
  const store = new Store(testDatabase());
  let api: ReturnType<typeof createApi>;
  const server = createServer(async (req, res) => {
    await api(req, res);
  });
  const io = createRealtime(server, store);
  api = createApi(store, io);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const origin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = base;
  t.after(async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    server.close();
    await store.close();
    if (origin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = origin;
  });
  return {
    store,
    base,
    post: (path: string, body: unknown, cookie = '') =>
      fetch(`${base}/api/${path}`, {
        method: 'POST',
        headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}

test('HTTP responses prohibit framing without restricting application scripts or WebGL', async (t) => {
  const { base } = await apiServer(t);
  const response = await fetch(base + '/api/session');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.match(response.headers.get('Content-Security-Policy')!, /frame-ancestors 'none'/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('unexpected API exceptions are hidden while validation and business errors stay useful', async (t) => {
  const { store, post } = await apiServer(t);
  const original = store.account.bind(store);
  store.account = async () => {
    throw Error('database-password-private-detail');
  };
  const failure = await post('login', {
    email: 'failure@example.test',
    password: 'a long test password',
  });
  assert.equal(failure.status, 500);
  const payload = await failure.json();
  assert.equal(payload.error, 'Une erreur interne est survenue.');
  assert.match(payload.requestId, /^[a-f0-9-]{36}$/);
  assert.ok(!JSON.stringify(payload).includes('database-password-private-detail'));
  store.account = original;
  const invalid = await post('register', { email: 'invalid' });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /champs/);
  const business = await post('register', {
    email: 'valid@example.test',
    password: 'a long test password',
    name: 'Valid',
  });
  assert.equal(business.status, 400);
  assert.match((await business.json()).error, /nom de votre garage/);
});

test('a successful legacy password login upgrades its hash without changing the password', async (t) => {
  const { store, post } = await apiServer(t);
  const password = 'a legacy password for upgrade';
  const salt = 'b'.repeat(32);
  const legacy = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  await store.register({
    email: 'legacy@example.test',
    name: 'Legacy',
    garage: 'Legacy',
    hash: legacy,
  });
  assert.equal(
    (await post('login', { email: 'legacy@example.test', password: 'incorrect-password' })).status,
    401,
  );
  assert.equal((await store.account('legacy@example.test'))!.hash, legacy);
  assert.equal((await post('login', { email: 'legacy@example.test', password })).status, 200);
  assert.match((await store.account('legacy@example.test'))!.hash!, /^scrypt\$32768\$8\$3\$/);
  assert.equal((await post('login', { email: 'legacy@example.test', password })).status, 200);
});

test('password confirmation is limited per account across sessions without blocking other accounts', async (t) => {
  const { store, post } = await apiServer(t);
  const hash = await passwordHash('a password for the account');
  const target = await store.register({
    email: 'limited@example.test',
    hash,
    name: 'Limited',
    garage: 'Limited',
  });
  const cookie = `carm_session=${await store.newSession(target.garageId, target.userId)}`;
  for (let attempt = 0; attempt < 10; attempt++)
    assert.equal(
      (await post('password', { current: 'wrong', password: 'a replacement password' }, cookie))
        .status,
      400,
    );
  const secondCookie = `carm_session=${await store.newSession(target.garageId, target.userId)}`;
  assert.equal(
    (await post('password', { current: 'wrong', password: 'a replacement password' }, secondCookie))
      .status,
    429,
  );
  const other = await store.register({
    email: 'unlimited@example.test',
    hash,
    name: 'Other',
    garage: 'Other',
  });
  const otherCookie = `carm_session=${await store.newSession(other.garageId, other.userId)}`;
  assert.equal(
    (await post('password', { current: 'wrong', password: 'a replacement password' }, otherCookie))
      .status,
    400,
  );
});
