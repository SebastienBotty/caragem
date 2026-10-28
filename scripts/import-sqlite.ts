import { existsSync } from 'node:fs';
import { Store } from '../src/server/store.ts';
import { importLegacyDatabase, readLegacyDatabase } from '../src/server/import-sqlite.ts';
if (existsSync('.env')) process.loadEnvFile('.env');
const path =
  process.argv.find((arg) => arg.startsWith('--source='))?.slice(9) ?? 'data/carm.sqlite';
const legacy = readLegacyDatabase(path);
console.log({
  garages: legacy.garages.length,
  accounts: legacy.accounts.length,
  sessions: legacy.sessions.length,
  invitations: legacy.invitations.length,
});
if (!process.argv.includes('--apply'))
  console.log(
    'Simulation uniquement. Ajoutez --apply pour importer dans une base PostgreSQL vide. Le fichier SQLite source reste intact.',
  );
else {
  const store = new Store();
  try {
    await importLegacyDatabase(store, legacy);
    console.log('Import terminé. Source SQLite conservée.');
  } finally {
    await store.close();
  }
}
