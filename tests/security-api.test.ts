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

test('demos require an account, are unique for 24h and cannot send real invitations', async (t) => {
  const { store, post, base } = await apiServer(t);
  assert.equal((await post('demo', {})).status, 401);
  const hash = await passwordHash('a demo account password');
  const owner = await store.register({
    email: 'demo@example.test',
    hash,
    name: 'Demo',
    garage: 'Personal',
  });
  const cookie = `carm_session=${await store.newSession(owner.garageId, owner.userId)}`;
  const first = await post('demo', {}, cookie);
  assert.equal(first.status, 200);
  const demoCookie = first.headers.get('set-cookie')!.split(';')[0];
  const firstSession = (await store.session(demoCookie))!;
  assert.equal(firstSession.email, 'demo@example.test');
  const state = await store.get(firstSession.garageId);
  assert.equal(state.demo, true);
  const expires = (state as typeof state & { demoExpires: number }).demoExpires;
  assert.ok(expires > Date.now() + 23.9 * 3600000 && expires <= Date.now() + 86400000);
  assert.equal(firstSession.expires, expires);
  const responses = await Promise.all([post('demo', {}, demoCookie), post('demo', {}, demoCookie)]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    const current = (await store.session(
      response.headers.get('set-cookie')?.split(';')[0] ?? demoCookie,
    ))!;
    assert.equal(current.garageId, state.id);
    assert.equal(current.expires, expires);
  }
  const currentCookie = responses[0].headers.get('set-cookie')?.split(';')[0] ?? demoCookie;
  assert.equal(
    (await post('invite', { email: 'escape@example.test', role: 'mechanic' }, currentCookie))
      .status,
    400,
  );
  await store.db.query(
    "UPDATE garages SET state=jsonb_set(state,'{demoExpires}',to_jsonb($2::bigint)) WHERE id=$1",
    [state.id, Date.now() - 1],
  );
  await store.db.query('UPDATE accounts SET demo_expires=$1 WHERE email=$2', [
    Date.now() - 1,
    'demo@example.test',
  ]);
  const expired = await fetch(base + '/api/session', { headers: { Cookie: currentCookie } });
  assert.equal((await expired.json()).state, null);
  const personalCookie = `carm_session=${await store.newSession(owner.garageId, owner.userId)}`;
  const replacement = await post('demo', {}, personalCookie);
  assert.equal(replacement.status, 400);
  assert.match((await replacement.json()).error, /essai.*terminé/);
  assert.equal((await store.get(owner.garageId)).settings.name, 'Personal');
  const count = await store.db.query(
    'SELECT count(*)::int AS n FROM garages WHERE demo_account_email=$1',
    ['demo@example.test'],
  );
  assert.equal(count.rows[0].n, 0);
  assert.ok((await store.account('demo@example.test'))!.demoExpires! < Date.now());
});

test('security events record authentication and internal failures without credentials or query tokens', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'info', (value: string) => logs.push(value));
  const { store, post, base } = await apiServer(t);
  await post('login', { email: 'log@example.test', password: 'private-password-never-log' });
  store.account = async () => {
    throw Error('private-database-never-log');
  };
  const failure = await post('login', {
    email: 'log@example.test',
    password: 'private-password-never-log',
  });
  const failureBody = await failure.json();
  await fetch(base + '/api/session?secret=private-query-never-log');
  const events = logs.map((value) => JSON.parse(value));
  assert.ok(
    events.some(
      (event) =>
        event.route === '/api/login' && event.status === 401 && event.outcome === 'failure',
    ),
  );
  assert.ok(
    events.some((event) => event.status === 500 && event.requestId === failureBody.requestId),
  );
  for (const secret of [
    'private-password-never-log',
    'private-database-never-log',
    'private-query-never-log',
    'log@example.test',
  ])
    assert.ok(!logs.join('').includes(secret));
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
