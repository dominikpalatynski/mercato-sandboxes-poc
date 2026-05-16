import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

let pool: Pool | null = null;

export interface DatabaseQueryable {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error('POSTGRES_URL is not set');
    }
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const p = getPool();
  return p.query<T>(sql, params as never[]);
}

function bindClient(client: PoolClient): DatabaseQueryable {
  return {
    query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: unknown[] = [],
    ): Promise<QueryResult<T>> {
      return client.query<T>(sql, params as never[]);
    },
  };
}

export async function withTransaction<T>(
  fn: (db: DatabaseQueryable) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn(bindClient(client));
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
