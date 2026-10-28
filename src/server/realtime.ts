import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { validOrigin } from './http.ts';
import type { Store } from './store.ts';
import type { GarageState } from '../lib/domain.ts';
import { visibleState } from '../lib/permissions.ts';

export async function broadcastGarage(io: Server, state: GarageState) {
  for (const socket of await io.in(state.id).fetchSockets()) {
    const session = socket.data.session;
    if (
      !session ||
      session.expires <= Date.now() ||
      !state.users.some((u) => u.id === session.userId)
    ) {
      socket.disconnect(true);
      continue;
    }
    socket.emit('garage:state', visibleState(state, session.userId));
  }
}

export function createRealtime(http: HttpServer, store: Store) {
  const io = new Server(http, {
    maxHttpBufferSize: 128000,
    allowRequest: (req, done) => {
      let origin = req.headers.origin;
      // Same-origin browser polling GETs may provide Referer instead of Origin.
      if (origin === undefined && req.headers.referer) {
        try {
          origin = new URL(req.headers.referer).origin;
        } catch {
          return done(null, false);
        }
      }
      done(null, validOrigin(origin));
    },
  });
  // ASVS 8.2.2: identity and garage room come exclusively from the verified session.
  io.use(async (socket, next) => {
    try {
      const session = await store.session(
        socket.request.headers.cookie,
        socket.handshake.auth.demoUserId,
      );
      if (!session) return next(new Error('Session requise'));
      socket.data.session = session;
      next();
    } catch {
      next(new Error('Connexion au garage indisponible.'));
    }
  });
  io.on('connection', async (socket) => {
    const s = socket.data.session;
    socket.join(s.garageId);
    socket.join(`session:${s.tokenHash}`);
    socket.join(`user:${s.userId}`);
    if (s.email) socket.join(`account:${s.email}`);
    try {
      socket.emit('garage:state', visibleState(await store.get(s.garageId), s.userId));
    } catch {
      socket.disconnect(true);
      return;
    }
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0, s.expires - Date.now()));
    socket.on('disconnect', () => clearTimeout(timer));
  });
  return io;
}
