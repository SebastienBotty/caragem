import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { io as clientIo, type Socket } from 'socket.io-client';
import { createApi } from '../src/server/api.ts';
import { createRealtime } from '../src/server/realtime.ts';
import { Store } from '../src/server/store.ts';
import { testDatabase } from './helpers/database.ts';
import type { GarageState } from '../src/lib/domain.ts';

function revision(socket: Socket, expected: number) {
  return new Promise<GarageState>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('garage:state', accept);
      reject(new Error('Socket update missing'));
    }, 5000);
    const accept = (state: GarageState) => {
      if (state.revision < expected) return;
      clearTimeout(timer);
      socket.off('garage:state', accept);
      resolve(state);
    };
    socket.on('garage:state', accept);
  });
}

test(
  'permissions persist per garage and filter HTTP, PDF and live socket data after grants and revocations',
  { timeout: 30000 },
  async () => {
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
    let socket: Socket | undefined;
    const post = (path: string, body: unknown, cookie: string) =>
      fetch(`${base}/api/${path}`, {
        method: 'POST',
        headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const get = (path: string, cookie: string) =>
      fetch(`${base}/api/${path}`, { headers: { Cookie: cookie } });
    try {
      const state = await store.create(true);
      const [owner, mechanic] = state.users;
      const ownerCookie = `caragem_session=${await store.newSession(state.id, owner.id)}`;
      const workerCookie = `caragem_session=${await store.newSession(state.id, mechanic.id)}`;
      let view = (await (await get('session', workerCookie)).json()).state as GarageState;
      assert.deepEqual(view.documents, []);
      assert.ok(view.customers.every((c) => !c.email && !c.phone));
      assert.equal((await get(`document/${state.documents[0].id}`, workerCookie)).status, 400);
      socket = clientIo(base, {
        autoConnect: false,
        transports: ['websocket'],
        extraHeaders: { Origin: base, Cookie: workerCookie },
      });
      const initial = revision(socket, state.revision);
      socket.connect();
      assert.deepEqual((await initial).documents, []);
      const next = revision(socket, state.revision + 1);
      const grant = await post(
        'actions',
        {
          type: 'rolePermissions',
          permissions: {
            mechanic: {
              'documents.view': true,
              'documents.prepare': true,
              'customers.view': true,
              'team.invite': true,
              'garage.configure': true,
            },
          },
        },
        ownerCookie,
      );
      assert.equal(grant.status, 200);
      view = await next;
      assert.equal(view.documents.length, state.documents.length);
      assert.ok(view.customers.some((c) => c.email));
      assert.equal((await get(`document/${state.documents[0].id}`, workerCookie)).status, 200);
      assert.equal(
        (await post('invite', { email: 'invited@example.com', role: 'mechanic' }, workerCookie))
          .status,
        200,
      );
      assert.equal(
        (await post('actions', { type: 'rolePermissions', permissions: {} }, workerCookie)).status,
        400,
      );
      const prepare = await post(
        'actions',
        {
          type: 'document',
          kind: 'estimate',
          vehicleId: state.vehicles[0].id,
          lines: [{ label: 'Diagnostic', quantity: 1, unitPrice: 1000 }],
          taxRate: 20,
        },
        workerCookie,
      );
      assert.equal(prepare.status, 200);
      const document = (await prepare.json()).state.documents.at(-1);
      assert.equal(
        (
          await post(
            'actions',
            { type: 'acceptEstimate', id: document.id, evidence: 'Téléphone' },
            workerCookie,
          )
        ).status,
        400,
      );
      const current = await store.get(state.id);
      const revoked = revision(socket, current.revision + 1);
      assert.equal(
        (
          await post(
            'actions',
            {
              type: 'userPermissions',
              userId: mechanic.id,
              permissions: {
                'documents.view': false,
                'customers.view': false,
                'team.invite': false,
              },
            },
            ownerCookie,
          )
        ).status,
        200,
      );
      view = await revoked;
      assert.deepEqual(view.documents, []);
      assert.ok(view.customers.every((c) => !c.email && !c.phone));
      assert.equal((await get(`document/${document.id}`, workerCookie)).status, 400);
      assert.equal(
        (await post('invite', { email: 'denied@example.com', role: 'mechanic' }, workerCookie))
          .status,
        400,
      );
      const paint = await post(
        'actions',
        { type: 'vehicleColor', id: state.vehicles[0].id, color: '#123456' },
        workerCookie,
      );
      assert.equal(paint.status, 200);
      assert.deepEqual(
        (await paint.json()).state.documents,
        [],
        'action responses are filtered too',
      );
      assert.equal((await store.get(state.id)).users[1].permissions!['documents.view'], false);
      assert.equal(
        (await store.get(state.id)).settings.rolePermissions!.mechanic!['documents.view'],
        true,
      );
      const other = await store.create(true);
      assert.equal(
        (
          await post(
            'actions',
            { type: 'userPermissions', userId: other.users[1].id, permissions: {} },
            ownerCookie,
          )
        ).status,
        400,
      );
      assert.deepEqual((await (await get('session', workerCookie)).json()).state.documents, []);
    } finally {
      socket?.disconnect();
      await new Promise<void>((resolve) => realtime.close(() => resolve()));
      await store.close();
      if (originalOrigin === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = originalOrigin;
    }
  },
);
