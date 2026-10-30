import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { io as clientIo } from 'socket.io-client';
import { applyAction, actionSchema, createSeed, type GarageState } from '../src/lib/domain.ts';
import { can, roleLabel, visibleState } from '../src/lib/permissions.ts';
import { Store, passwordHash } from '../src/server/store.ts';
import { testDatabase } from './helpers/database.ts';
import { createApi } from '../src/server/api.ts';
import { createRealtime } from '../src/server/realtime.ts';

test('custom roles replace base grants, preserve individual exceptions and cannot grant ownership', () => {
  let state = createSeed('roles', true);
  const [owner, mechanic] = state.users;
  const create = {
    type: 'customRole' as const,
    name: 'Chef d’atelier',
    baseRole: 'mechanic' as const,
    permissions: { 'garage.view': true, 'documents.view': true, 'garage.configure': true },
  };
  state = applyAction(state, create, owner);
  const role = state.settings.customRoles![0];
  const assign = { type: 'assignRole' as const, userId: mechanic.id, roleId: role.id };
  for (const action of [create, { ...create, id: role.id }, assign])
    assert.throws(() => applyAction(state, action, mechanic), /patron/);
  state = applyAction(state, assign, owner);
  assert.equal(roleLabel(state, state.users[1]), create.name);
  assert.equal(can(state, state.users[1], 'documents.view'), true);
  assert.equal(can(state, state.users[1], 'tasks.work'), false, 'no base-role fallback');
  assert.equal(visibleState(state, mechanic.id).documents.length, state.documents.length);
  assert.throws(() => applyAction(state, { ...create, id: role.id }, state.users[1]), /patron/);
  assert.throws(() => applyAction(state, { ...assign, userId: owner.id }, owner), /accès complet/);
  assert.throws(() => applyAction(state, { ...assign, roleId: 'owner' }, owner), /introuvable/);
  assert.throws(
    () => applyAction(state, { ...assign, roleId: 'foreign-role' }, owner),
    /introuvable/,
  );
  assert.throws(
    () => applyAction(state, { ...assign, userId: 'foreign-member' }, owner),
    /introuvable/,
  );
  assert.throws(() => applyAction(state, create, owner), /déjà utilisé/);
  assert.throws(() => applyAction(state, { ...create, name: 'mécanicien' }, owner), /déjà utilisé/);
  assert.throws(
    () => applyAction(state, { ...create, id: 'foreign-role' }, owner),
    /introuvable|déjà utilisé/,
  );
  assert.equal(actionSchema.safeParse({ ...create, name: ' ' }).success, false);
  assert.equal(
    actionSchema.safeParse({ ...create, permissions: { 'permissions.manage': true } }).success,
    false,
  );
  state = applyAction(
    state,
    {
      type: 'userPermissions',
      userId: mechanic.id,
      permissions: { 'documents.view': false, 'vehicles.edit': true },
    },
    owner,
  );
  assert.equal(can(state, state.users[1], 'documents.view'), false);
  assert.equal(can(state, state.users[1], 'vehicles.edit'), true);
  state = applyAction(
    state,
    {
      ...create,
      id: role.id,
      name: 'Contrôle',
      baseRole: 'reception',
      permissions: { 'garage.view': false, 'documents.view': true },
    },
    owner,
  );
  assert.equal(state.users[1].role, 'reception');
  assert.equal(can(state, state.users[1], 'vehicles.edit'), false, 'prerequisites still apply');
  assert.deepEqual(visibleState(state, mechanic.id).vehicles, []);
  state = applyAction(state, { ...assign, roleId: 'mechanic' }, owner);
  assert.equal(state.users[1].customRoleId, undefined);
  assert.equal(can(state, state.users[1], 'tasks.work'), true);
  assert.equal(
    can(state, state.users[1], 'documents.view'),
    false,
    'individual denial survives reassignment',
  );
  assert.equal(can(state, { ...state.users[1], customRoleId: 'missing' }, 'tasks.work'), false);
});

test(
  'roles persist, synchronize memberships, invitations and live access without crossing garages',
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
    const post = (path: string, body: unknown, cookie: string) =>
      fetch(`${base}/api/${path}`, {
        method: 'POST',
        headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const socket = clientIo(base, { autoConnect: false, transports: ['websocket'] });
    try {
      const hash = await passwordHash('a strong custom role password');
      const owner = await store.register({
        name: 'Patron',
        email: 'owner@example.com',
        garage: 'Garage',
        hash,
      });
      const ownerCookie = `caragem_session=${await store.newSession(owner.garageId, owner.userId)}`;
      const ownerSession = (await store.session(ownerCookie))!;
      let response = await post(
        'actions',
        {
          type: 'customRole',
          name: 'Magasinier',
          baseRole: 'reception',
          permissions: { 'stock.view': true },
        },
        ownerCookie,
      );
      assert.equal(response.status, 200);
      const state = await store.get(owner.garageId);
      const role = state.settings.customRoles![0];
      response = await post(
        'invite',
        { email: 'worker@example.com', role: 'mechanic', customRoleId: role.id },
        ownerCookie,
      );
      assert.equal(response.status, 200);
      const token = new URL((await response.json()).url).searchParams.get('invitation')!;
      const preview = await (
        await fetch(`${base}/api/invitation?token=${token}&email=worker@example.com`)
      ).json();
      assert.equal(preview.roleName, 'Magasinier');
      assert.equal((await store.invitations(ownerSession))[0].customRoleId, role.id);
      const worker = await store.register({
        name: 'Employé',
        email: 'worker@example.com',
        hash,
        invitation: token,
      });
      const workerCookie = `caragem_session=${await store.newSession(worker.garageId, worker.userId)}`;
      const joined = (await store.get(state.id)).users.find((u) => u.id === worker.userId)!;
      assert.equal(joined.customRoleId, role.id);
      assert.equal(joined.role, 'reception');
      assert.equal(
        (
          await post(
            'actions',
            { type: 'assignRole', userId: worker.userId, roleId: 'mechanic' },
            workerCookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await post(
            'actions',
            { type: 'customRole', name: 'Escalade', baseRole: 'mechanic', permissions: {} },
            workerCookie,
          )
        ).status,
        400,
      );
      const other = await store.create(true);
      const otherCookie = `caragem_session=${await store.newSession(other.id, other.users[0].id)}`;
      assert.equal(
        (
          await post(
            'actions',
            { type: 'assignRole', userId: other.users[1].id, roleId: role.id },
            otherCookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await post(
            'invite',
            { email: 'x@example.com', role: 'mechanic', customRoleId: role.id },
            otherCookie,
          )
        ).status,
        400,
      );

      socket.io.opts.extraHeaders = { Origin: base, Cookie: workerCookie };
      function nextRevision(expected: number) {
        return new Promise<GarageState>((resolve, reject) => {
          const timer = setTimeout(() => {
            socket.off('garage:state', receive);
            reject(new Error('Missing role socket update'));
          }, 5000);
          const receive = (view: GarageState) => {
            if (view.revision >= expected) {
              clearTimeout(timer);
              socket.off('garage:state', receive);
              resolve(view);
            }
          };
          socket.on('garage:state', receive);
        });
      }
      let pending = nextRevision(0);
      socket.connect();
      assert.equal(
        (await pending).users.find((u) => u.id === worker.userId)!.customRoleId,
        role.id,
      );
      let current = await store.get(state.id);
      pending = nextRevision(current.revision + 1);
      response = await post(
        'actions',
        {
          type: 'customRole',
          id: role.id,
          name: 'Chef atelier',
          baseRole: 'mechanic',
          permissions: { 'garage.view': true, 'tasks.work': true },
        },
        ownerCookie,
      );
      assert.equal(response.status, 200);
      let view = await pending;
      let member = view.users.find((u) => u.id === worker.userId)!;
      assert.equal(member.role, 'mechanic');
      assert.equal(can(view, member, 'tasks.work'), true);
      assert.equal(can(view, member, 'stock.view'), false);
      assert.equal((await store.garages('worker@example.com'))[0].role, 'mechanic');
      current = await store.get(state.id);
      pending = nextRevision(current.revision + 1);
      response = await post(
        'actions',
        { type: 'assignRole', userId: worker.userId, roleId: 'reception' },
        ownerCookie,
      );
      assert.equal(response.status, 200);
      view = await pending;
      member = view.users.find((u) => u.id === worker.userId)!;
      assert.equal(member.customRoleId, undefined);
      assert.equal(member.role, 'reception');
      assert.equal((await store.garages('worker@example.com'))[0].role, 'reception');
      const sessionView = await (
        await fetch(`${base}/api/session`, { headers: { Cookie: workerCookie } })
      ).json();
      assert.equal(
        sessionView.state.users.find((u: { id: string }) => u.id === worker.userId).role,
        'reception',
      );
      assert.equal(sessionView.state.settings.customRoles[0].name, 'Chef atelier');
    } finally {
      socket.disconnect();
      await new Promise<void>((resolve) => realtime.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.close();
      if (originalOrigin === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = originalOrigin;
    }
  },
);
