# Database

Drizzle ORM owns the schema. The TypeScript schema in `db/schema/` is the
source of truth.

## Files

- `db/schema/` — typed table definitions, one file per domain
  - `users.ts`, `sandboxes.ts`, `billing.ts`, `llm.ts`
  - re-exported from `db/schema/index.ts`
- `db/migrations/` — generated SQL migrations (committed)
- `db/migrate.ts` — runtime migrator (runs in CI / init container / locally)
- `drizzle.config.ts` — drizzle-kit configuration

## Day-to-day

### Bootstrap a new repo checkout

```sh
npm install
npm run db:migrate    # applies migrations against $POSTGRES_URL
```

The committed baseline (`db/migrations/0000_init.sql` + `meta/`) is generated
from the schema TypeScript. Re-running `db:generate` should be a no-op until
you actually change the schema.

### Make a schema change

1. Edit the relevant file in `db/schema/`.
2. `npm run db:generate` — drizzle-kit diffs the snapshot and writes the
   next numbered migration plus updated meta.
3. Inspect the generated SQL; tweak by hand for things drizzle cannot infer
   (data backfills, `with concurrently`, etc.).
4. Commit `db/migrations/000N_*.sql` and the updated `meta/` files.
5. `npm run db:migrate` — apply locally; CI / deploy applies on the next
   rollout.

### Inspect the database

`npm run db:studio` opens drizzle-kit's web UI against `$POSTGRES_URL`.

## Adopting an existing database

The first time `db/migrate.ts` runs against a database that was previously
managed by the raw `schema.sql` (i.e. `public.users` already exists), it
auto-stamps the baseline `0000_*.sql` migration as applied in
`drizzle.__drizzle_migrations`. This prevents drizzle from trying to
`create table` rows that are already there.

For a fresh database, no adoption step happens — drizzle runs all migrations
from scratch.

## Helm chart migration step

The Helm chart at `infra/helm/charts/onboarding/` runs `tsx db/migrate.ts`
from an init container that reuses the main app image. The toggle is
`databaseMigration.enabled` in the chart values. See the chart's
`templates/deployment.yaml` for the exact command.
