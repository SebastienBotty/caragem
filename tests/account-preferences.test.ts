import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'socket.io';
import {
  accountPreferencesSchema,
  defaultAccountPreferences,
  normalizeAccountPreferences,
  type AccountNotification,
  type AccountPreferences,
} from '../src/lib/account-preferences.ts';
import { accountPreferencesApi } from '../src/server/account-preferences-api.ts';
import { createSeed } from '../src/lib/domain.ts';
import { Store, type Session } from '../src/server/store.ts';
import { testDatabase } from './helpers/database.ts';

test('account preferences normalize old data without losing valid choices and reject unrecognized writes', () => {
  assert.deepEqual(normalizeAccountPreferences(null), {
    ...defaultAccountPreferences,
    defaultGarageId: undefined,
  });
  const normalized = normalizeAccountPreferences({
    initialPage: 'tasks',
    graphicsQuality: 'ultra',
    reducedMotion: true,
    theme: 'dark',
    notifications: { assignments: false, blockages: 'yes' },
  });
  assert.equal(normalized.initialPage, 'tasks');
  assert.equal(normalized.graphicsQuality, 'auto');
  assert.equal(normalized.reducedMotion, true);
  assert.equal(normalized.theme, 'dark');
  assert.equal(normalizeAccountPreferences({ theme: 'invalid' }).theme, 'light');
  assert.equal(
    accountPreferencesSchema.safeParse({ ...defaultAccountPreferences, theme: 'invalid' }).success,
    false,
  );
  assert.equal(normalized.notifications.assignments, false);
  assert.equal(normalized.notifications.blockages, true);
  assert.equal(
    accountPreferencesSchema.safeParse({ ...defaultAccountPreferences, garageId: 'another' })
      .success,
    false,
  );
  assert.equal(
    accountPreferencesSchema.safeParse({ ...defaultAccountPreferences, reducedMotion: 'false' })
      .success,
    false,
  );
});

test('personal settings persist outside garage writes and notifications honor account choices, assignments and current permissions', async () => {
  const store = new Store(testDatabase());
  const broadcasts: string[] = [];
  const io = { in: (room: string) => ({ emit: () => broadcasts.push(room) }) } as unknown as Server;
  const call = async <T>(
    session: Session | undefined,
    path: string,
    method = 'GET',
    body?: unknown,
  ) => {
    let status = 0,
      data: unknown;
    await accountPreferencesApi(
      store,
      io,
      { method } as IncomingMessage,
      {} as ServerResponse,
      path,
      body,
      session,
      (code, payload) => {
        status = code;
        data = payload;
      },
    );
    return { status, data: data as T };
  };
  try {
    await store.ready;
    await store.db.query(
      readFileSync(new URL('../src/server/account-preferences.sql', import.meta.url), 'utf8'),
    );
    const owner = await store.register({
      email: 'owner@example.com',
      hash: 'fake',
      name: 'Patron',
      garage: 'Garage principal',
    });
    const session: Session = {
      ...owner,
      email: 'owner@example.com',
      expires: Date.now() + 100000,
      tokenHash: 'owner',
    };
    const foreign = await store.register({
      email: 'foreign@example.com',
      hash: 'fake',
      name: 'Autre patron',
      garage: 'Garage étranger',
    });
    const foreignSession: Session = {
      ...foreign,
      email: 'foreign@example.com',
      expires: Date.now() + 100000,
      tokenHash: 'foreign',
    };
    const token = await store.invite(session, 'worker@example.com', 'mechanic');
    const worker = await store.register({
      email: 'worker@example.com',
      hash: 'fake',
      name: 'Mécanicien',
      invitation: token,
    });
    const workerSession: Session = {
      ...worker,
      email: 'worker@example.com',
      expires: Date.now() + 100000,
      tokenHash: 'worker',
    };
    await store.updateGarage(owner.garageId, (state) => {
      state.vehicles = createSeed('fixtures', true).vehicles.slice(0, 2);
      state.vehicles[0].tasks = [
        {
          id: 'mine',
          title: 'Révision attribuée',
          status: 'todo',
          assignees: [session.userId],
          minutes: 0,
        },
        {
          id: 'worker',
          title: 'Travail mécanicien',
          status: 'doing',
          assignees: [worker.userId],
          minutes: 0,
        },
        {
          id: 'finished',
          title: 'Terminé',
          status: 'done',
          assignees: [session.userId],
          minutes: 30,
        },
      ];
      state.vehicles[0].blocker = 'Pièce attendue';
      state.vehicles[0].blockerDetails = {
        kind: 'parts',
        assigneeId: session.userId,
        nextAction: 'Appeler le fournisseur',
        openedAt: new Date().toISOString(),
      };
      state.vehicles[1].stage = 'returned';
      state.vehicles[1].tasks = [
        {
          id: 'archive',
          title: 'Ancienne intervention',
          status: 'todo',
          assignees: [session.userId],
          minutes: 0,
        },
      ];
    });
    assert.equal((await call(undefined, '/api/account/preferences')).status, 401);
    assert.equal((await call(session, '/api/account/preferences', 'DELETE')).status, 405);
    const before = await store.get(owner.garageId);
    await assert.rejects(
      call(session, '/api/account/preferences', 'POST', {
        ...defaultAccountPreferences,
        defaultGarageId: foreign.garageId,
      }),
      /vos garages/,
    );
    const prefs: AccountPreferences = {
      ...defaultAccountPreferences,
      theme: 'dark',
      initialPage: 'tasks',
      graphicsQuality: 'low',
      reducedMotion: true,
      defaultGarageId: owner.garageId,
    };
    assert.equal((await call(session, '/api/account/preferences', 'POST', prefs)).status, 200);
    assert.equal(
      (await store.get(owner.garageId)).revision,
      before.revision,
      'account preference saves do not mutate the garage',
    );
    assert.deepEqual(
      (await call<{ preferences: AccountPreferences }>(session, '/api/account/preferences')).data
        .preferences,
      prefs,
    );
    assert.deepEqual(broadcasts, [`account:${session.email}`]);
    assert.equal(
      (await call<{ preferences: AccountPreferences }>(workerSession, '/api/account/preferences'))
        .data.preferences.theme,
      'light',
    );
    const ownerItems = (
      await call<{ notifications: AccountNotification[] }>(session, '/api/account/notifications')
    ).data.notifications;
    assert.deepEqual(ownerItems.map((item) => item.kind).sort(), ['assignments', 'blockages']);
    assert.match(
      ownerItems.find((item) => item.kind === 'blockages')!.description,
      /Appeler le fournisseur/,
    );
    assert.equal(
      ownerItems.some((item) => item.id.includes('archive')),
      false,
    );
    assert.equal(
      ownerItems.some((item) => item.id.includes('finished')),
      false,
    );
    const workerItems = (
      await call<{ notifications: AccountNotification[] }>(
        workerSession,
        '/api/account/notifications',
      )
    ).data.notifications;
    assert.equal(workerItems.length, 1);
    assert.match(workerItems[0].title, /Travail mécanicien/);
    assert.equal(
      (
        await call<{ notifications: AccountNotification[] }>(
          foreignSession,
          '/api/account/notifications',
        )
      ).data.notifications.length,
      0,
    );
    await store.updateGarage(owner.garageId, (state) => {
      state.users.find((user) => user.id === worker.userId)!.permissions = { 'garage.view': false };
    });
    assert.equal(
      (
        await call<{ notifications: AccountNotification[] }>(
          workerSession,
          '/api/account/notifications',
        )
      ).data.notifications.length,
      0,
      'current permission removals immediately hide vehicle notifications',
    );
    await store.invite(foreignSession, 'owner@example.com', 'mechanic');
    const invites = (
      await call<{ notifications: AccountNotification[] }>(session, '/api/account/notifications')
    ).data.notifications.filter((item) => item.kind === 'invitations');
    assert.equal(invites.length, 1);
    assert.equal(invites[0].garageId, foreign.garageId);
    assert.equal(JSON.stringify(invites).includes('token'), false);
    await store.db.query('UPDATE garage_billing SET trial_ends_at=0 WHERE garage_id=$1', [
      owner.garageId,
    ]);
    assert.equal(
      (
        await call<{ notifications: AccountNotification[] }>(session, '/api/account/notifications')
      ).data.notifications.some((item) => item.kind === 'billing'),
      true,
    );
    assert.equal(
      (
        await call<{ notifications: AccountNotification[] }>(
          workerSession,
          '/api/account/notifications',
        )
      ).data.notifications.some((item) => item.kind === 'billing'),
      false,
    );
    const quiet = {
      ...prefs,
      notifications: { assignments: false, blockages: false, invitations: false, billing: false },
    };
    assert.equal(
      (await call(session, '/api/account/preferences', 'POST', quiet)).status,
      200,
      'account preferences remain editable after the trial',
    );
    assert.equal(
      (await call<{ notifications: AccountNotification[] }>(session, '/api/account/notifications'))
        .data.notifications.length,
      0,
    );
  } finally {
    await store.close();
  }
});
