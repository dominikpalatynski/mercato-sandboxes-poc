import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const sandboxes = pgTable(
  'sandboxes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    presetId: text('preset_id').notNull().default('crm'),
    coderWorkspaceId: uuid('coder_workspace_id'),
    status: text('status').notNull().default('pending'),
    statusMessage: text('status_message'),
    vscodeUrl: text('vscode_url'),
    terminalUrl: text('terminal_url'),
    appUrl: text('app_url'),
    splashUrl: text('splash_url'),
    repoOrigin: text('repo_origin').notNull().default('gitea'),
    giteaRepoName: text('gitea_repo_name'),
    giteaCloneUrl: text('gitea_clone_url'),
    githubRepoFullName: text('github_repo_full_name'),
    githubCloneUrl: text('github_clone_url'),
    workspaceCredsSecretName: text('workspace_creds_secret_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    userIdIdx: index('sandboxes_user_id_idx').on(t.userId),
  }),
);

export type Sandbox = typeof sandboxes.$inferSelect;
export type NewSandbox = typeof sandboxes.$inferInsert;
