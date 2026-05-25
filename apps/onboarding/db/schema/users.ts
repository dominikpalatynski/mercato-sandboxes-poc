import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  coderUserId: uuid('coder_user_id'),
  coderUsername: text('coder_username'),
  coderTempPassword: text('coder_temp_password'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  companyName: text('company_name'),
  acceptedTermsAt: timestamp('accepted_terms_at', { withTimezone: true }),
  openMercatoCustomerEntityId: uuid('openmercato_customer_entity_id'),
  openMercatoCustomerPersonId: uuid('openmercato_customer_person_id'),
  giteaOrgName: text('gitea_org_name'),
  githubInstallationId: text('github_installation_id'),
  githubLogin: text('github_login'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
