import { dirname, join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(here, 'migrations');

function maskUrl(url: string): string {
  return url.replace(/:[^:@/]+@/, ':***@');
}

async function adoptExistingDatabaseIfNeeded(pool: Pool): Promise<void> {
  // If the legacy schema.sql has already populated the public schema on this
  // database (i.e. `users` exists) but the drizzle migrations bookkeeping
  // table is empty, stamp the baseline migration as applied so drizzle does
  // not try to recreate tables.
  //
  // This branch is a one-shot for environments that pre-date the ORM. New
  // databases skip it entirely because `users` will not exist yet.
  const usersExists = await pool.query<{ exists: boolean }>(
    `select exists (
       select 1 from information_schema.tables
       where table_schema = 'public' and table_name = 'users'
     ) as exists`,
  );
  if (!usersExists.rows[0]?.exists) return;

  await pool.query(`create schema if not exists drizzle`);
  await pool.query(
    `create table if not exists drizzle.__drizzle_migrations (
       id serial primary key,
       hash text not null,
       created_at bigint
     )`,
  );

  const existing = await pool.query<{ count: string }>(
    `select count(*)::text as count from drizzle.__drizzle_migrations`,
  );
  if (Number(existing.rows[0]?.count ?? '0') > 0) return;

  // Find baseline migration (0000_*) and stamp its hash so drizzle treats it
  // as already applied. Hash format follows drizzle-kit's convention: sha256
  // of the migration SQL.
  if (!existsSync(MIGRATIONS_FOLDER)) {
    console.warn(
      '[migrate] migrations folder missing; cannot adopt existing database',
    );
    return;
  }
  const baseline = readdirSync(MIGRATIONS_FOLDER)
    .filter((f) => f.startsWith('0000') && f.endsWith('.sql'))
    .sort()[0];
  if (!baseline) {
    console.warn(
      '[migrate] no baseline 0000_*.sql migration found; run `npm run db:generate` first',
    );
    return;
  }

  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const sql = readFileSync(join(MIGRATIONS_FOLDER, baseline), 'utf8');
  const hash = createHash('sha256').update(sql).digest('hex');

  await pool.query(
    `insert into drizzle.__drizzle_migrations (hash, created_at)
     values ($1, $2)`,
    [hash, Date.now()],
  );
  console.log(
    `[migrate] adopted existing database: stamped ${baseline} (hash=${hash.slice(0, 12)}…)`,
  );
}

async function main(): Promise<void> {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error('[migrate] POSTGRES_URL not set');
    process.exit(1);
  }

  if (!existsSync(MIGRATIONS_FOLDER)) {
    console.error(
      `[migrate] migrations folder ${MIGRATIONS_FOLDER} does not exist. ` +
        'Run `npm run db:generate` to create the baseline migration.',
    );
    process.exit(1);
  }

  console.log(`[migrate] connecting to ${maskUrl(url)}`);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await adoptExistingDatabaseIfNeeded(pool);
    const db = drizzle(pool);
    console.log(`[migrate] applying migrations from ${MIGRATIONS_FOLDER}…`);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('[migrate] done.');
  } catch (err) {
    console.error('[migrate] FAILED:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
