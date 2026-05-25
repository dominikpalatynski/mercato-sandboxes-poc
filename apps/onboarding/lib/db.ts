import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '@/db/schema';

let pool: Pool | null = null;
let drizzleInstance: NodePgDatabase<typeof schema> | null = null;

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

export function getDb(): NodePgDatabase<typeof schema> {
  if (!drizzleInstance) {
    drizzleInstance = drizzle(getPool(), { schema });
  }
  return drizzleInstance;
}

export type Db = NodePgDatabase<typeof schema>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const instance = getDb() as unknown as Record<string | symbol, unknown>;
    const value = instance[prop];
    return typeof value === 'function' ? (value as Function).bind(instance) : value;
  },
});
