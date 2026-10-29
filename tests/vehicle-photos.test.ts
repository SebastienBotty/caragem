import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { io as clientIo } from 'socket.io-client';
import { normalizedPhoto } from '../src/server/vehicle-photo-api.ts';
import { Store } from '../src/server/store.ts';
import { createApi } from '../src/server/api.ts';
import { createRealtime } from '../src/server/realtime.ts';
import { testDatabase } from './helpers/database.ts';
import { applyAction, uid, type GarageState } from '../src/lib/domain.ts';

const png = async () =>
  sharp({ create: { width: 1800, height: 100, channels: 3, background: '#ce4545' } })
    .withMetadata()
    .png()
    .toBuffer();

test('photos are decoded, resized and rewritten as JPEG without source metadata; invalid formats and contents are rejected', async () => {
  const original = await png();
  assert.ok((await sharp(original).metadata()).exif);
  const output = await normalizedPhoto(`data:image/png;base64,${original.toString('base64')}`);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.exif, undefined);
  await assert.rejects(
    normalizedPhoto(`data:image/jpeg;base64,${original.toString('base64')}`),
    /invalide/,
  );
  await assert.rejects(normalizedPhoto('data:image/png;base64,PGh0bWw+'), /invalide/);
  await assert.rejects(normalizedPhoto('data:image/svg+xml;base64,PHN2Zy8+'), /JPEG/);
  await assert.rejects(
    normalizedPhoto(
      `data:image/png;base64,${Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64')}`,
    ),
    /8 Mio/,
  );
});

test('photo API isolates tenants and history, persists images outside snapshots, synchronizes metadata and enforces concurrent quotas', async () => {
  const store = new Store(testDatabase());
  let api: ReturnType<typeof createApi>;
  const server = createServer(async (req, res) => {
    await api(req, res);
  });
  const io = createRealtime(server, store);
  api = createApi(store, io);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const oldOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = base;
  const post = (path: string, body: unknown, cookie: string, origin = base) =>
    fetch(`${base}/api/${path}`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const get = (id: string, cookie: string) =>
    fetch(`${base}/api/vehicle-photos/${id}`, { headers: { Cookie: cookie } });
  let socket: ReturnType<typeof clientIo> | undefined;
  const nextState = () =>
    new Promise<GarageState>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Mise à jour photo absente du socket')),
        5000,
      );
      socket!.once('garage:state', (state) => {
        clearTimeout(timer);
        resolve(state);
      });
    });
  try {
    const state = await store.create(true),
      other = await store.create(true);
    const owner = `carm_session=${await store.newSession(state.id, state.users[0].id)}`;
    const worker = `carm_session=${await store.newSession(state.id, state.users[1].id)}`;
    const stranger = `carm_session=${await store.newSession(other.id, other.users[0].id)}`;
    const session = (await store.session(owner))!;
    const source = await sharp(randomBytes(512 * 512 * 3), {
      raw: { width: 512, height: 512, channels: 3 },
    })
      .png()
      .toBuffer();
    const image = `data:image/png;base64,${source.toString('base64')}`;
    assert.ok(image.length > 128000);
    const input = {
      vehicleId: state.vehicles[0].id,
      category: 'diagnosis',
      finding: 'urgent',
      caption: 'Filtre usé',
      image,
    };
    assert.equal((await post('vehicle-photos', input, '')).status, 401);
    assert.equal((await post('vehicle-photos', input, owner, 'https://evil.invalid')).status, 403);
    assert.equal((await post('vehicle-photos', input, stranger)).status, 400);
    socket = clientIo(base, {
      autoConnect: false,
      transports: ['websocket'],
      extraHeaders: { Origin: base, Cookie: worker },
    });
    const initial = nextState();
    socket.connect();
    await initial;
    const live = nextState();
    const upload = await post('vehicle-photos', input, owner);
    assert.equal(upload.status, 200);
    const view = (await upload.json()).state;
    const photo = view.vehicles[0].photos[0];
    assert.equal((await live).vehicles[0].photos![0].id, photo.id);
    assert.equal(photo.caption, 'Filtre usé');
    assert.equal(photo.finding, 'urgent');
    assert.equal(JSON.stringify(view).includes('base64'), false);
    const read = await get(photo.id, worker);
    assert.equal(read.status, 200);
    assert.match((await read.json()).image, /^data:image\/jpeg;base64,/);
    assert.equal((await get(photo.id, stranger)).status, 400);
    assert.equal((await get(photo.id, '')).status, 401);
    await store.act(session, {
      type: 'userPermissions',
      userId: state.users[1].id,
      permissions: { 'vehicles.edit': false },
    });
    assert.equal((await post('vehicle-photos', input, worker)).status, 400);
    assert.equal((await post('vehicle-photos/delete', { id: photo.id }, worker)).status, 400);
    await store.act(session, {
      type: 'addTask',
      vehicleId: input.vehicleId,
      title: 'Remplacer le filtre',
      photoId: photo.id,
    });
    await assert.rejects(
      store.act(session, {
        type: 'addTask',
        vehicleId: input.vehicleId,
        title: 'Doublon',
        photoId: photo.id,
      }),
      /existe déjà/,
    );
    await assert.rejects(
      store.act(session, {
        type: 'addTask',
        vehicleId: input.vehicleId,
        title: 'Étranger',
        photoId: 'foreign',
      }),
      /introuvable/,
    );
    const persisted = await store.get(state.id);
    assert.ok(
      persisted.vehicles[0].tasks.some(
        (task) => task.id === persisted.vehicles[0].photos![0].taskId,
      ),
    );
    await store.updateGarage(state.id, (current) => {
      current.vehicles[0].stage = 'returned';
    });
    assert.equal((await post('vehicle-photos', input, owner)).status, 400);
    await store.act(session, {
      type: 'userPermissions',
      userId: state.users[1].id,
      permissions: { 'history.view': false },
    });
    assert.equal((await get(photo.id, worker)).status, 400);
    const revisited = applyAction(
      await store.get(state.id),
      {
        type: 'revisit',
        id: input.vehicleId,
        issue: 'Autre visite',
        due: new Date().toISOString(),
      },
      state.users[0],
    );
    assert.deepEqual(revisited.vehicles.at(-1)!.photos, []);
    assert.equal((await post('vehicle-photos/delete', { id: photo.id }, owner)).status, 200);
    assert.equal((await get(photo.id, owner)).status, 400);
    assert.equal(
      (await store.db.query('SELECT id FROM vehicle_photos WHERE garage_id=$1', [state.id])).rows
        .length,
      0,
    );
    await store.updateGarage(state.id, (current) => {
      current.vehicles[0].stage = 'workshop';
      current.vehicles[0].photos = Array.from({ length: 29 }, () => ({ ...photo, id: uid() }));
    });
    const concurrent = await Promise.all([
      post('vehicle-photos', input, owner),
      post('vehicle-photos', input, owner),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 400]);
    assert.equal((await store.get(state.id)).vehicles[0].photos!.length, 30);
  } finally {
    socket?.disconnect();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.close();
    if (oldOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = oldOrigin;
  }
});
