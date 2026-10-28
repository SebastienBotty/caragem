import { Pool } from 'pg';
export type Sql = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};
export type Database = Sql & {
  transaction: <T>(work: (sql: Sql) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};
export function postgresDatabase(connectionString = process.env.DATABASE_URL): Database {
  if (!connectionString)
    throw new Error('Configurez DATABASE_URL avec votre connexion PostgreSQL / Neon.');
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 15000 });
  return {
    query: (text, values) => pool.query(text, values),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
