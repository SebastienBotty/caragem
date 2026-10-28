import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store, passwordHash } from '../src/server/store.ts';
import { createApi } from '../src/server/api.ts';
import { createRealtime } from '../src/server/realtime.ts';
import { testDatabase } from './helpers/database.ts';

test('tour dismissal persists per account across garages and per demo member without accepting another identity', async () => {
  const store = new Store(testDatabase());
  let api: ReturnType<typeof createApi>;
  const server = createServer(async (req, res) => {
    await api(req, res);
  });
  const realtime = createRealtime(server, store);
  api = createApi(store, realtime);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const originalOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = base;
  const post = (cookie: string, body: unknown = {}, origin = base) =>
    fetch(`${base}/api/onboarding`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const seen = async (cookie: string) =>
    (await (await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).json())
      .onboardingSeen;
  try {
    const hash = await passwordHash('a strong onboarding password');
    const first = await store.register({
      name: 'Alice',
      email: 'alice@example.com',
      garage: 'Garage Alice',
      hash,
    });
    const second = await store.register({
      name: 'Béatrice',
      email: 'beatrice@example.com',
      garage: 'Garage Béatrice',
      hash,
    });
    const alice = `carm_session=${await store.newSession(first.garageId, first.userId)}`;
    const beatrice = `carm_session=${await store.newSession(second.garageId, second.userId)}`;
    assert.equal(await seen(alice), false);
    assert.equal((await post('')).status, 401);
    assert.equal((await post(alice, {}, 'https://untrusted.example')).status, 403);
    assert.equal((await post(alice, { email: 'beatrice@example.com' })).status, 400);
    assert.equal((await post(alice)).status, 200);
    assert.equal((await post(alice)).status, 200, 'dismissal is idempotent');
    assert.equal(await seen(alice), true);
    assert.equal(await seen(beatrice), false);
    const another = await store.createGarage((await store.session(alice))!, 'Garage secondaire');
    const newDevice = `carm_session=${await store.newSession(another.garageId, another.userId)}`;
    assert.equal(
      await seen(newDevice),
      true,
      'preference follows the account rather than a device or garage',
    );
    const demo = await store.create(true);
    const owner = `carm_session=${await store.newSession(demo.id, demo.users[0].id)}`;
    const mechanic = `carm_session=${await store.newSession(demo.id, demo.users[1].id)}`;
    assert.equal(await seen(owner), false);
    assert.equal((await post(owner)).status, 200);
    assert.equal(await seen(owner), true);
    assert.equal(await seen(mechanic), false);
  } finally {
    await new Promise<void>((resolve) => realtime.close(() => resolve()));
    await store.close();
    if (originalOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = originalOrigin;
  }
});
