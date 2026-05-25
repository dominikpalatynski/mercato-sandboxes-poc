import { sql } from 'drizzle-orm';
import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

export const llmAccounts = pgTable(
  'llm_accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    openrouterKeyHash: text('openrouter_key_hash').notNull().unique(),
    openrouterKeyLabel: text('openrouter_key_label').notNull(),
    status: text('status').notNull(),
    coderSecretSyncState: text('coder_secret_sync_state').notNull(),
    limitUsd: numeric('limit_usd', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    limitReset: text('limit_reset'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    statusUserIdx: index('llm_accounts_status_user_id_idx').on(t.status, t.userId),
  }),
);

export const llmUsageSnapshots = pgTable(
  'llm_usage_snapshots',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    llmAccountId: uuid('llm_account_id')
      .notNull()
      .references(() => llmAccounts.id, { onDelete: 'cascade' }),
    usageTotalUsd: numeric('usage_total_usd', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    usageMonthlyUsd: numeric('usage_monthly_usd', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    limitRemainingUsd: numeric('limit_remaining_usd', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    accountObservedIdx: index('llm_usage_snapshots_account_observed_at_idx')
      .on(t.llmAccountId, t.observedAt.desc()),
  }),
);

export type LlmAccount = typeof llmAccounts.$inferSelect;
export type NewLlmAccount = typeof llmAccounts.$inferInsert;
export type LlmUsageSnapshot = typeof llmUsageSnapshots.$inferSelect;
export type NewLlmUsageSnapshot = typeof llmUsageSnapshots.$inferInsert;
