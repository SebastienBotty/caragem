import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { io as client, type Socket } from 'socket.io-client';
import { PDFDocument } from 'pdf-lib';
import nodemailer from 'nodemailer';
import { createApi } from '../src/server/api.ts';
import { createRealtime } from '../src/server/realtime.ts';
import { testDatabase } from './helpers/database.ts';
import { Store } from '../src/server/store.ts';
import type { GarageState } from '../src/lib/domain.ts';

function once(socket: Socket, event: string) {
  return new Promise<unknown[]>((resolve) =>
    socket.once(event, (...args: unknown[]) => resolve(args)),
  );
}

test(
  'HTTP authentication, tenant isolation, sockets, PDF and late-body concurrency',
  { timeout: 20000 },
  async () => {
    const db = new Store(testDatabase());
    let api: ReturnType<typeof createApi>;
    const server = createServer(async (req, res) => {
      await api(req, res);
    });
    const realtime = createRealtime(server, db);
    api = createApi(db, realtime);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    process.env.APP_ORIGIN = base;
    const sockets: Socket[] = [];
    const originalTransport = nodemailer.createTransport;
    const smtpHost = process.env.SMTP_HOST;
    const smtpFrom = process.env.SMTP_FROM;
    async function post(path: string, body: unknown, cookie = '', origin = base) {
      return fetch(base + '/api/' + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      });
    }
    async function session(cookie: string) {
      return (await (
        await fetch(base + '/api/session', { headers: { Cookie: cookie } })
      ).json()) as { state: GarageState; userId: string };
    }
    function socket(
      cookie: string,
      transport: 'websocket' | 'polling' = 'websocket',
      demoUserId?: string,
    ) {
      const s = client(base, {
        transports: [transport],
        forceNew: true,
        reconnection: false,
        auth: { demoUserId },
        extraHeaders:
          transport === 'polling'
            ? { Referer: base + '/', Cookie: cookie }
            : { Origin: base, Cookie: cookie },
      });
      sockets.push(s);
      return s;
    }
    try {
      assert.equal((await post('demo', {}, '', 'https://foreign.example')).status, 403);
      assert.equal((await post('actions', { type: 'note' })).status, 401);
      const resA = await post('demo', {});
      const cookieA = resA.headers.get('set-cookie')!.split(';')[0];
      const resB = await post('demo', {});
      const cookieB = resB.headers.get('set-cookie')!.split(';')[0];
      const a = await session(cookieA);
      const b = await session(cookieB);
      const handshake = '/socket.io/?EIO=4&transport=polling';
      assert.equal(
        (await fetch(base + handshake, { headers: { Referer: base + '/' } })).status,
        200,
        'same-origin browser polling omits Origin',
      );
      const deniedHeaders: Record<string, string>[] = [
        {},
        { Referer: 'invalid' },
        { Referer: 'https://foreign.example/' },
        { Origin: 'https://foreign.example', Referer: base + '/' },
      ];
      for (const headers of deniedHeaders) {
        assert.equal((await fetch(base + handshake, { headers })).status, 403);
      }
      assert.notEqual(a.state.id, b.state.id);
      assert.equal(
        (
          await post(
            'actions',
            { type: 'note', id: b.state.vehicles[0].id, text: 'foreign' },
            cookieA,
          )
        ).status,
        400,
      );
      const socketA = socket(cookieA);
      const firstA = (await once(socketA, 'garage:state'))[0] as GarageState;
      assert.equal(firstA.id, a.state.id);
      const socketB = socket(cookieB);
      await once(socketB, 'garage:state');
      let foreignEvents = 0;
      socketB.on('garage:state', () => foreignEvents++);
      const update = once(socketA, 'garage:state');
      const v = a.state.vehicles[0];
      assert.equal(
        (await post('actions', { type: 'note', id: v.id, text: 'Socket update' }, cookieA)).status,
        200,
      );
      const updated = (await update)[0] as GarageState;
      assert.equal(updated.vehicles[0].notes[0].text, 'Socket update');
      assert.equal(foreignEvents, 0);
      const mechanic = a.state.users.find((u) => u.role === 'mechanic')!;
      const mechanicCookie = `carm_session=${await db.newSession(a.state.id, mechanic.id)}`;
      const mechanicSocket = socket(mechanicCookie, 'polling');
      await once(mechanicSocket, 'garage:state');
      const ownerPaint = once(socketA, 'garage:state');
      const mechanicPaint = once(mechanicSocket, 'garage:state');
      assert.equal(
        (
          await post(
            'actions',
            { type: 'vehicleColor', id: v.id, color: '#cc2525' },
            mechanicCookie,
          )
        ).status,
        200,
      );
      for (const event of await Promise.all([ownerPaint, mechanicPaint]))
        assert.equal((event[0] as GarageState).vehicles[0].color, '#cc2525');
      assert.equal((await session(cookieA)).state.vehicles[0].color, '#cc2525');
      assert.equal(foreignEvents, 0);
      const switched = await post('demo-user', { userId: mechanic.id }, cookieA);
      assert.equal(switched.status, 200);
      assert.equal(
        switched.headers.get('set-cookie'),
        null,
        'tab profile must not replace the shared session cookie',
      );
      assert.equal((await session(cookieA)).userId, a.userId);
      assert.equal(socketA.connected, true, 'owner in another tab stays connected');
      const demoMechanic = socket(cookieA, 'websocket', mechanic.id);
      await once(demoMechanic, 'garage:state');
      const taskVehicle = a.state.vehicles.find(
        (v) => v.stage !== 'ready' && v.tasks.some((t) => t.status === 'todo'),
      )!;
      const task = taskVehicle.tasks.find((t) => t.status === 'todo')!;
      const assigned = [
        once(socketA, 'garage:state'),
        once(demoMechanic, 'garage:state'),
        once(mechanicSocket, 'garage:state'),
      ];
      assert.equal(
        (
          await post(
            'actions',
            {
              type: 'task',
              vehicleId: taskVehicle.id,
              taskId: task.id,
              operation: 'assign',
              assignees: [mechanic.id],
            },
            cookieA,
          )
        ).status,
        200,
      );
      await Promise.all(assigned);
      for (const operation of ['start', 'finish'] as const) {
        const updates = [
          once(socketA, 'garage:state'),
          once(demoMechanic, 'garage:state'),
          once(mechanicSocket, 'garage:state'),
        ];
        const result = await fetch(base + '/api/actions', {
          method: 'POST',
          headers: {
            Origin: base,
            Cookie: cookieA,
            'Content-Type': 'application/json',
            'X-Carm-Demo-User': mechanic.id,
          },
          body: JSON.stringify({
            type: 'task',
            vehicleId: taskVehicle.id,
            taskId: task.id,
            operation,
            minutes: 20,
          }),
        });
        assert.equal(result.status, 200, await result.text());
        for (const update of await Promise.all(updates)) {
          const received = update[0] as GarageState;
          assert.equal(
            received.vehicles
              .find((v) => v.id === taskVehicle.id)!
              .tasks.find((t) => t.id === task.id)!.status,
            operation === 'start' ? 'doing' : 'done',
          );
          assert.equal(received.activity[0].author, mechanic.name);
        }
      }
      assert.equal(foreignEvents, 0);
      const unauthorized = socket('');
      const failure = await once(unauthorized, 'connect_error');
      assert.match((failure[0] as Error).message, /Session/);
      const pdfRes = await fetch(base + '/api/document/' + a.state.documents[0].id, {
        headers: { Cookie: cookieA },
      });
      assert.equal(pdfRes.status, 200);
      assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
      const pdf = await PDFDocument.load(await pdfRes.arrayBuffer());
      assert.ok(pdf.getPageCount() >= 1);
      assert.equal(
        (
          await fetch(base + '/api/document/' + b.state.documents[0].id, {
            headers: { Cookie: cookieA },
          })
        ).status,
        400,
      );

      const registered = await post('register', {
        name: 'Test Owner',
        garage: 'Test Garage',
        email: 'owner@example.com',
        password: 'a long test password',
      });
      assert.equal(registered.status, 200);
      const login = await post('login', {
        email: 'owner@example.com',
        password: 'a long test password',
      });
      assert.equal(login.status, 200, await login.text());
      const loginCookie = login.headers.get('set-cookie')!.split(';')[0];
      const secondLogin = await post('login', {
        email: 'owner@example.com',
        password: 'a long test password',
      });
      const secondCookie = secondLogin.headers.get('set-cookie')!.split(';')[0];
      const socket1 = socket(loginCookie);
      await once(socket1, 'garage:state');
      const socket2 = socket(secondCookie);
      await once(socket2, 'garage:state');
      const disconnected1 = once(socket1, 'disconnect');
      const disconnected2 = once(socket2, 'disconnect');
      assert.equal(
        (
          await post(
            'password',
            {
              current: 'a long test password',
              password: 'a different long test password',
            },
            loginCookie,
          )
        ).status,
        200,
      );
      await Promise.all([disconnected1, disconnected2]);
      assert.equal((await session(loginCookie)).state, null);
      assert.equal((await session(secondCookie)).state, null);

      // Regression: a slow request body must not snapshot and overwrite newer mutations.
      const mailRegister = await post('register', {
        name: 'Mail Owner',
        garage: 'Mail Garage',
        email: 'mailowner@example.com',
        password: 'a long test password',
      });
      assert.equal(mailRegister.status, 200);
      const mailCookie = mailRegister.headers.get('set-cookie')!.split(';')[0];
      const mailSession = await session(mailCookie);
      const mailingState = {
        ...structuredClone(a.state),
        id: mailSession.state.id,
        demo: false,
        users: [mailSession.state.users[0], ...a.state.users.slice(1)],
      };
      await db.save(mailingState);
      process.env.SMTP_HOST = 'mock.test';
      process.env.SMTP_FROM = 'garage@example.com';
      let sends = 0;
      let releaseDelivery: () => void = () => {};
      let deliveryStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        deliveryStarted = resolve;
      });
      const delivery = new Promise<void>((resolve) => {
        releaseDelivery = resolve;
      });
      Object.assign(nodemailer, {
        createTransport: () => ({
          sendMail: async () => {
            sends++;
            deliveryStarted();
            await delivery;
          },
        }),
      });
      const payload = JSON.stringify({ id: a.state.mails[0].id });
      const delayed = httpRequest(base + '/api/send-mail', {
        method: 'POST',
        headers: {
          Origin: base,
          Cookie: mailCookie,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      });
      const response = new Promise<number>((resolve) =>
        delayed.on('response', (r) => {
          r.resume();
          r.on('end', () => resolve(r.statusCode!));
        }),
      );
      delayed.flushHeaders();
      delayed.write(payload.slice(0, 2));
      const note = await post(
        'actions',
        {
          type: 'note',
          id: v.id,
          text: 'Committed while mail body is incomplete',
        },
        mailCookie,
      );
      assert.equal(note.status, 200);
      delayed.end(payload.slice(2));
      await started;
      assert.equal(
        (await post('send-mail', { id: a.state.mails[0].id }, mailCookie)).status,
        400,
        'same mail cannot send twice',
      );
      releaseDelivery();
      assert.equal(await response, 200);
      assert.equal(sends, 1);
      assert.equal(
        (await session(mailCookie)).state.vehicles[0].notes[0].text,
        'Committed while mail body is incomplete',
      );
      const loggedOut = once(socketA, 'disconnect');
      await post('logout', {}, cookieA);
      await loggedOut;
      assert.equal((await session(cookieA)).state, null);
    } finally {
      Object.assign(nodemailer, { createTransport: originalTransport });
      if (smtpHost === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = smtpHost;
      if (smtpFrom === undefined) delete process.env.SMTP_FROM;
      else process.env.SMTP_FROM = smtpFrom;
      sockets.forEach((s) => s.disconnect());
      await new Promise<void>((resolve) => realtime.close(() => resolve()));
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
      delete process.env.APP_ORIGIN;
    }
  },
);
