import { existsSync } from 'node:fs';
import { Store } from '../src/server/store.ts';
if (existsSync('.env')) process.loadEnvFile('.env');
const store = new Store();
try {
  await store.ready;
  console.log('Schéma PostgreSQL prêt.');
} finally {
  await store.close();
}
