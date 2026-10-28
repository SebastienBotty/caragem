import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store, digest } from '../src/server/store.ts';
import { createApi } from '../src/server/api.ts';
import { createRealtime } from '../src/server/realtime.ts';
import { testDatabase } from './helpers/database.ts';
import type { SessionData } from '../src/lib/account.ts';

test(
  'real accounts create garages, accept invitations, switch memberships, and enforce per-garage roles',
  { timeout: 30000 },
  async () => {
    const db = new Store(testDatabase());
    let api: ReturnType<typeof createApi>;
    const server = createServer(async (req, res) => {
      await api(req, res);
    });
    const realtime = createRealtime(server, db);
    api = createApi(db, realtime);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const originalOrigin = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = base;
    const password = 'a strong account password';
    const post = (path: string, body: unknown, cookie = '') =>
      fetch(`${base}/api/${path}`, {
        method: 'POST',
        headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const get = (path: string, cookie = '') =>
      fetch(`${base}/api/${path}`, { headers: { Cookie: cookie } });
    const cookie = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];
    const session = async (token: string) =>
      (await (await get('session', token)).json()) as SessionData;
    async function invite(owner: string, email: string) {
      const response = await post('invite', { email, role: 'mechanic' }, owner);
      assert.equal(response.status, 200, await response.clone().text());
      const { url } = await response.json();
      return new URL(url).searchParams.get('invitation')!;
    }
    try {
      const registered = await post('register', {
        name: 'Alice Owner',
        email: 'alice@example.com',
        password,
        garage: 'Garage Alice',
      });
      assert.equal(registered.status, 200);
      const alice = cookie(registered);
      const a = await session(alice);
      assert.equal(a.state!.demo, false);
      assert.equal(a.state!.settings.name, 'Garage Alice');
      assert.equal(a.state!.vehicles.length, 0);
      assert.equal(a.account!.email, 'alice@example.com');
      assert.equal(a.garages.length, 1);
      const bobResponse = await post('register', {
        name: 'Bob Owner',
        email: 'bob@example.com',
        password,
        garage: 'Garage Bob',
      });
      assert.equal(bobResponse.status, 200);
      const bob = cookie(bobResponse);
      const b = await session(bob);
      const token = await invite(alice, 'bob@example.com');
      const preview = await get(`invitation?token=${token}&email=bob%40example.com`);
      assert.equal(preview.status, 200);
      assert.equal((await preview.json()).garage, 'Garage Alice');
      const wrong = await post('accept-invitation', { token }, alice);
      assert.equal(wrong.status, 400);
      const accepted = await post('accept-invitation', { token }, bob);
      assert.equal(accepted.status, 200);
      const bobAtAlice = cookie(accepted);
      const member = await session(bobAtAlice);
      assert.equal(member.state!.id, a.state!.id);
      assert.equal(member.garages.length, 2);
      assert.equal(member.state!.users.find((u) => u.id === member.userId)!.role, 'mechanic');
      assert.equal(
        (await post('invite', { email: 'x@example.com', role: 'mechanic' }, bobAtAlice)).status,
        400,
      );
      assert.equal(
        (await post('accept-invitation', { token }, bobAtAlice)).status,
        400,
        'single use invitation',
      );
      assert.equal(
        (await post('switch-garage', { garageId: b.state!.id }, alice)).status,
        400,
        'membership required',
      );
      const switched = await post('switch-garage', { garageId: b.state!.id }, bobAtAlice);
      assert.equal(switched.status, 200);
      const bobBack = cookie(switched);
      const own = await session(bobBack);
      assert.equal(own.state!.users.find((u) => u.id === own.userId)!.role, 'owner');
      const extra = await post('garages', { name: 'Garage Secondaire' }, bobBack);
      assert.equal(extra.status, 200);
      const bobThird = cookie(extra);
      const third = await session(bobThird);
      assert.equal(third.garages.length, 3);
      assert.equal(third.state!.settings.name, 'Garage Secondaire');
      const fresh = await invite(alice, 'new@example.com');
      const worker = await post('register', {
        name: 'New Mechanic',
        email: 'new@example.com',
        password,
        invitation: fresh,
      });
      assert.equal(worker.status, 200);
      const workerSession = await session(cookie(worker));
      assert.equal(workerSession.state!.id, a.state!.id);
      assert.equal(workerSession.garages.length, 1);
      const expired = await invite(alice, 'expired@example.com');
      await db.db.query('UPDATE invitations SET expires=$1 WHERE token_hash=$2', [
        Date.now() - 1,
        digest(expired),
      ]);
      assert.equal(
        (
          await post('register', {
            name: 'Expired',
            email: 'expired@example.com',
            password,
            invitation: expired,
          })
        ).status,
        400,
      );
      assert.equal(await db.account('expired@example.com'), undefined);
      const revoked = await invite(alice, 'revoked@example.com');
      const pending = (await (await get('invitations', alice)).json()).invitations as {
        id: string;
        email: string;
      }[];
      assert.equal(
        (
          await post(
            'revoke-invitation',
            { id: pending.find((i) => i.email === 'revoked@example.com')!.id },
            alice,
          )
        ).status,
        200,
      );
      assert.equal(
        (await get(`invitation?token=${revoked}&email=revoked%40example.com`)).status,
        400,
      );
      assert.equal(
        (
          await post('register', {
            name: 'Charlie Owner',
            email: 'charlie@example.com',
            password,
            garage: 'Garage Charlie',
          })
        ).status,
        200,
      );
      const existingToken = await invite(alice, 'charlie@example.com');
      const loginInvite = await post('login', {
        email: 'charlie@example.com',
        password,
        invitation: existingToken,
      });
      assert.equal(loginInvite.status, 200);
      assert.equal((await session(cookie(loginInvite))).state!.id, a.state!.id);
      assert.equal(
        (await post('login', { email: 'alice@example.com', password: 'not the correct password' }))
          .status,
        401,
      );
      const current = await db.get(a.state!.id);
      assert.equal(
        current.users.filter((u) => u.name === 'Bob Owner').length,
        1,
        'existing member is not duplicated',
      );
    } finally {
      if (originalOrigin === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = originalOrigin;
      await new Promise<void>((resolve) => realtime.close(() => resolve()));
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    }
  },
);
