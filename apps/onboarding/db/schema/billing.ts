import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

export const billingOrders = pgTable(
  'billing_orders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerOrderId: text('provider_order_id').unique(),
    status: text('status').notNull(),
    planType: text('plan_type').notNull(),
    amountPln: numeric('amount_pln', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    creditsUsd: numeric('credits_usd', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => ({
    userCreatedIdx: index('billing_orders_user_id_created_at_idx')
      .on(t.userId, t.createdAt.desc()),
  }),
);

export const billingEvents = pgTable(
  'billing_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull().unique(),
    orderId: uuid('order_id').references(() => billingOrders.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    orderCreatedIdx: index('billing_events_order_id_created_at_idx')
      .on(t.orderId, t.createdAt.desc()),
  }),
);

export type BillingOrder = typeof billingOrders.$inferSelect;
export type NewBillingOrder = typeof billingOrders.$inferInsert;
export type BillingEvent = typeof billingEvents.$inferSelect;
export type NewBillingEvent = typeof billingEvents.$inferInsert;
