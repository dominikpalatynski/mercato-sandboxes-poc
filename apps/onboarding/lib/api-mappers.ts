import type { Sandbox } from '@/db/schema';

/**
 * The frontend (status-poller, dashboard, sandbox detail page) expects the
 * historical snake_case shape that the previous raw-SQL routes returned. The
 * Drizzle schema uses idiomatic camelCase, so we map at the API boundary.
 */
export interface ApiSandbox {
  id: string;
  user_id: string;
  name: string;
  preset_id: string;
  coder_workspace_id: string | null;
  status: string;
  status_message: string | null;
  vscode_url: string | null;
  terminal_url: string | null;
  app_url: string | null;
  splash_url: string | null;
  repo_origin: string;
  gitea_repo_name: string | null;
  gitea_clone_url: string | null;
  github_repo_full_name: string | null;
  github_clone_url: string | null;
  workspace_creds_secret_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

export function toApiSandbox(s: Sandbox): ApiSandbox {
  return {
    id: s.id,
    user_id: s.userId,
    name: s.name,
    preset_id: s.presetId,
    coder_workspace_id: s.coderWorkspaceId,
    status: s.status,
    status_message: s.statusMessage,
    vscode_url: s.vscodeUrl,
    terminal_url: s.terminalUrl,
    app_url: s.appUrl,
    splash_url: s.splashUrl,
    repo_origin: s.repoOrigin,
    gitea_repo_name: s.giteaRepoName,
    gitea_clone_url: s.giteaCloneUrl,
    github_repo_full_name: s.githubRepoFullName,
    github_clone_url: s.githubCloneUrl,
    workspace_creds_secret_name: s.workspaceCredsSecretName,
    created_at: toIso(s.createdAt),
    updated_at: toIso(s.updatedAt),
  };
}
