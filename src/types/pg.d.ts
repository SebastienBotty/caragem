// Only the node-postgres surface used by Caragem; validated by PostgreSQL integration tests.
declare module 'pg' {
  export type QueryResult = { rows: Record<string, unknown>[] };
  export type PoolConfig = {
    connectionString?: string;
    max?: number;
    connectionTimeoutMillis?: number;
    options?: string;
  };
  export type PoolClient = {
    query(text: string, values?: unknown[]): Promise<QueryResult>;
    release(): void;
  };
  export class Pool {
    constructor(config?: PoolConfig);
    query(text: string, values?: unknown[]): Promise<QueryResult>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
