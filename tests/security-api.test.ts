import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store } from '../src/server/store.ts';
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
