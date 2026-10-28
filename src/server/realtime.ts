import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { validOrigin } from './api.ts';
import type { Store } from './store.ts';

export function createRealtime(http: HttpServer, store: Store) {
  const io = new Server(http, {
    maxHttpBufferSize: 128000,
    allowRequest: (req, done) => done(null, validOrigin(req.headers.origin)),
  });
  // ASVS 8.2.2: identity and garage room come exclusively from the verified session.
  io.use((socket, next) => {
    const session = store.session(socket.request.headers.cookie);
    if (!session) return next(new Error('Session requise'));
    socket.data.session = session;
    next();
  });
  io.on('connection', (socket) => {
    const s = socket.data.session;
    socket.join(s.garageId);
    socket.join(`session:${s.tokenHash}`);
    socket.join(`user:${s.userId}`);
    socket.emit('garage:state', store.get(s.garageId));
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0, s.expires - Date.now()));
    socket.on('disconnect', () => clearTimeout(timer));
  });
  return io;
}
