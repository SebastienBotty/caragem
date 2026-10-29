import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import next from 'next';
import { Store } from './src/server/store.ts';
import { createApi } from './src/server/api.ts';
import { createRealtime } from './src/server/realtime.ts';
import { securityHeaders } from './src/server/http.ts';
import { securityEvent } from './src/server/security-log.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const dev = !process.argv.includes('--production');
const hostname = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const store = new Store();
await store.ready;
const http = createServer(async (req, res) => {
  securityHeaders(res);
  try {
    if (!(await api(req, res))) await handle(req, res);
  } catch (error) {
    const requestId = crypto.randomUUID();
    securityEvent({ event: 'server.error', outcome: 'failure', requestId });
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('X-Request-Id', requestId);
      res.end('Erreur serveur.');
    }
  }
});
const io = createRealtime(http, store);
const api = createApi(store, io);
http.listen(port, hostname, () =>
  console.log(`CaRM prêt sur http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`),
);
process.on('SIGTERM', async () => {
  io.close();
  http.close();
  await store.close();
});
