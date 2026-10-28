import { randomUUID } from 'node:crypto';
import { postgresDatabase, type Database } from '../../src/server/database.ts';

export function testDatabase(): Database {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      'Configurez TEST_DATABASE_URL dans .env.test avec une base PostgreSQL dédiée aux tests.',
    );
  const schema = 'carm_test_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', '-c search_path=' + schema);
  const db = postgresDatabase(url.toString());
  const ready = db.query(`CREATE SCHEMA "${schema}"`);
  return {
    async query(text, values) {
      await ready;
      return db.query(text, values);
    },
    async transaction(work) {
      await ready;
      return db.transaction(work);
    },
    async close() {
      try {
        await ready;
        if (!/^carm_test_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe test schema');
        await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await db.close();
      }
    },
  };
}
