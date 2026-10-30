import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { io as clientSocket, type Socket } from 'socket.io-client';
import { Store } from '../src/server/store.ts';
import { createApi } from '../src/server/api.ts';
import { createRealtime } from '../src/server/realtime.ts';
import { testDatabase } from './helpers/database.ts';
import { parseCsv, writeCsv } from '../src/lib/csv.ts';
import { suggestMapping, transferKindSchema } from '../src/lib/data-transfer.ts';
import { readSpreadsheet } from '../src/server/spreadsheet-transfer.ts';
function once(socket: Socket, event: string) {
  return new Promise<any[]>((resolve) => socket.once(event, (...args: any[]) => resolve(args)));
}

async function fixture(t: TestContext) {
  const store = new Store(testDatabase());
  let api: ReturnType<typeof createApi>;
  const server = createServer(async (req, res) => {
    await api(req, res);
  });
  const io = createRealtime(server, store);
  api = createApi(store, io);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const previousOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = base;
  t.after(async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    server.close();
    await store.close();
    if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previousOrigin;
  });
  const state = await store.create(true);
  const owner = `caragem_session=${await store.newSession(state.id, state.users[0].id)}`;
  const mechanic = `caragem_session=${await store.newSession(state.id, state.users[1].id)}`;
  return {
    store,
    state,
    base,
    owner,
    mechanic,
    post: (route: string, data: unknown, cookie = owner, origin = base) =>
      fetch(`${base}/api/${route}`, {
        method: 'POST',
        headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
  };
}

test('CSV routes enforce authentication, current ownership, origins and garage isolation', async (t) => {
  const { store, state, base, post, owner, mechanic } = await fixture(t);
  const foreign = await store.create(true);
  await store.updateGarage(state.id, (s) => {
    s.customers[0].name = 'LOCAL-PRIVATE';
  });
  await store.updateGarage(foreign.id, (s) => {
    s.customers[0].name = 'FOREIGN-PRIVATE';
  });
  for (const route of ['export', 'preview', 'import', 'read']) {
    assert.equal((await post(`data-transfer/${route}`, { kind: 'customers' }, '')).status, 401);
    assert.equal(
      (await post(`data-transfer/${route}`, { kind: 'customers' }, mechanic)).status,
      403,
    );
  }
  assert.equal(
    (await post('data-transfer/export', { kind: 'customers' }, owner, 'https://other.example'))
      .status,
    403,
  );
  assert.equal(
    (await fetch(base + '/api/data-transfer/export', { headers: { Cookie: owner } })).status,
    405,
  );
  assert.equal((await post('data-transfer/export', { kind: 'accounts' })).status, 400);
  const exported = await (
    await post('data-transfer/export', { kind: 'customers', garageId: foreign.id })
  ).json();
  assert.match(exported.csv, /LOCAL-PRIVATE/);
  assert.doesNotMatch(exported.csv, /FOREIGN-PRIVATE/);
  assert.deepEqual(parseCsv(exported.csv).headers, ['id', 'name', 'email', 'phone']);
  for (const kind of transferKindSchema.options) {
    const response = await post('data-transfer/export', { kind, template: true });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(parseCsv((await response.json()).csv).rows.length, 0);
  }
  for (const format of ['xls', 'xlsx'] as const) {
    const response = await post('data-transfer/export', {
      kind: 'customers',
      example: true,
      format,
    });
    assert.equal(response.status, 200);
    const file = await response.json();
    assert.equal(file.filename, `caragem-customers-exemple.${format}`);
    const converted = await post('data-transfer/read', { base64: file.base64 });
    assert.equal(converted.status, 200);
    assert.equal(parseCsv((await converted.json()).csv).rows.length, 1);
    assert.equal(parseCsv(readSpreadsheet(file.base64).csv).rows[0][1], 'Camille Exemple');
  }
  assert.equal((await post('data-transfer/read', { base64: 'AAAA' })).status, 400);
});

test('CSV import is previewed, atomic, persisted and broadcast; stale and concurrent confirmations cannot overwrite data', async (t) => {
  const { store, state, base, post, owner } = await fixture(t);
  const count = state.customers.length;
  const bad = writeCsv(
    ['name', 'email'],
    [
      ['Valid', 'valid@example.com'],
      ['', 'bad@example.com'],
    ],
  );
  const body = (csv: string) => ({
    kind: 'customers',
    csv,
    mapping: suggestMapping('customers', parseCsv(csv).headers),
  });
  const badPreview = await (await post('data-transfer/preview', body(bad))).json();
  assert.equal(badPreview.errors.length, 1);
  assert.equal(
    (await post('data-transfer/import', { ...body(bad), revision: badPreview.revision })).status,
    400,
  );
  assert.equal((await store.get(state.id)).customers.length, count);
  const csv = writeCsv(
    ['name', 'email'],
    [
      ['CSV Alice', 'csv-a@example.com'],
      ['CSV Bob', 'csv-b@example.com'],
    ],
  );
  const preview = await (await post('data-transfer/preview', body(csv))).json();
  assert.equal(preview.added, 2);
  assert.equal((await store.get(state.id)).customers.length, count);
  await post('actions', {
    type: 'customer',
    name: 'Concurrent',
    email: 'concurrent@example.com',
    phone: '',
  });
  assert.equal(
    (await post('data-transfer/import', { ...body(csv), revision: preview.revision })).status,
    400,
  );
  const fresh = await (await post('data-transfer/preview', body(csv))).json();
  const socket = clientSocket(base, {
    transports: ['websocket'],
    extraHeaders: { Origin: base, Cookie: owner },
  });
  t.after(() => {
    socket.disconnect();
  });
  await once(socket, 'garage:state');
  const update = once(socket, 'garage:state');
  const response = await post('data-transfer/import', { ...body(csv), revision: fresh.revision });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.report.added, 2);
  assert.equal(result.state.customers.length, count + 3);
  assert.equal((await update)[0].customers.length, count + 3);
  assert.equal((await store.get(state.id)).customers.length, count + 3);
  const repeated = await (await post('data-transfer/preview', body(csv))).json();
  assert.equal(repeated.added, 0);
  assert.equal(repeated.skipped, 2);
  const next = writeCsv(['name', 'email'], [['Once', 'once@example.com']]);
  const nextPreview = await (await post('data-transfer/preview', body(next))).json();
  const replies = await Promise.all([
    post('data-transfer/import', { ...body(next), revision: nextPreview.revision }),
    post('data-transfer/import', { ...body(next), revision: nextPreview.revision }),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 400]);
  assert.equal(
    (await store.get(state.id)).customers.filter((c) => c.email === 'once@example.com').length,
    1,
  );
  await store.updateGarage(state.id, (s) => {
    s.users[0].role = 'mechanic';
  });
  assert.equal(
    (await post('data-transfer/import', { ...body(next), revision: nextPreview.revision })).status,
    403,
  );
});

test('CSV-specific size limits allow real batches while rejecting malformed or oversized files', async (t) => {
  const { post } = await fixture(t);
  const csv = writeCsv(
    ['name', 'email'],
    Array.from({ length: 800 }, (_, i) => [
      'Client ' + String(i) + 'x'.repeat(170),
      `csv${i}@example.com`,
    ]),
  );
  assert.ok(Buffer.byteLength(csv) > 128000);
  const preview = await post('data-transfer/preview', {
    kind: 'customers',
    csv,
    mapping: { name: 0, email: 1 },
  });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).added, 800);
  assert.equal(
    (
      await post('data-transfer/preview', {
        kind: 'customers',
        csv: 'name\n' + 'x'.repeat(1024 * 1024),
        mapping: { name: 0 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post('data-transfer/preview', {
        kind: 'customers',
        csv: 'name\n"unclosed',
        mapping: { name: 0 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post('data-transfer/preview', {
        kind: 'customers',
        csv: 'name\nValid',
        mapping: { name: 99 },
      })
    ).status,
    400,
  );
});

test('invalid data cannot bypass validation by calling import directly, even without preview', async (t) => {
  const { post, state, store } = await fixture(t);
  const before = JSON.stringify(await store.get(state.id));
  const csv = writeCsv(
    ['name', 'email', 'phone'],
    [
      ['Valide', 'valid@example.com', '+32412345678'],
      ['Invalide', 'bad@example.com', 'bonjour'],
    ],
  );
  const input = { kind: 'customers', csv, mapping: { name: 0, email: 1, phone: 2 } };
  const preview = await (await post('data-transfer/preview', input)).json();
  assert.equal(preview.errors[0].row, 3);
  assert.match(preview.errors[0].message, /Téléphone/);
  const response = await post('data-transfer/import', { ...input, revision: state.revision });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Import annulé/);
  assert.equal(JSON.stringify(await store.get(state.id)), before);
  assert.equal(
    (await post('data-transfer/preview', { ...input, mapping: { name: 0, email: 0 } })).status,
    400,
  );
});
