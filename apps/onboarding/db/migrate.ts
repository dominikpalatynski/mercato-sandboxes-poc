import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

async function main(): Promise<void> {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error('[migrate] POSTGRES_URL not set');
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const sqlPath = join(here, 'schema.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  console.log(`[migrate] connecting to ${url.replace(/:[^:@/]+@/, ':***@')}`);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    console.log('[migrate] applying schema.sql in a transaction…');
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log('[migrate] done.');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error('[migrate] FAILED:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
