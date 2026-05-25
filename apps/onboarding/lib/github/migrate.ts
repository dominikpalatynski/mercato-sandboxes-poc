import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { sandboxes, users } from '@/db/schema';
import {
  createInstallationRepo,
  getInstallation,
  mintInstallationToken,
  GitHubApiError,
} from '@/lib/github/app';
import { archiveRepo as archiveGiteaRepo, GiteaApiError } from '@/lib/gitea/client';
import { upsertWorkspaceCredsSecret } from '@/lib/k8s/workspace-secrets';
import { spawnGitMirrorJob, getJobStatus } from '@/lib/k8s/mirror-job';
import { restartWorkspace } from '@/lib/coder';

export class MigrationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const MIRROR_POLL_DEADLINE_MS = 5 * 60_000;

/**
 * Move a sandbox's git origin from Gitea to the user's own GitHub account.
 *
 * Sequence (see infra/USER-CODE-PERSISTENCE-PLAN.md Phase 5):
 *   1. Mint an installation token for the user's GitHub App install.
 *   2. Create a private repo on GitHub via that token.
 *   3. Spawn a clone-mirror + push-mirror Job in cluster.
 *   4. Wait for the Job to finish (bounded poll).
 *   5. Update the workspace-credentials Secret with the GitHub URL + token.
 *   6. Restart the workspace pod so origin is re-read.
 *   7. Archive (not delete) the Gitea repo.
 */
export async function migrateRepoToGitHub(args: {
  userId: string;
  sandboxId: string;
}): Promise<{ githubRepoFullName: string; githubCloneUrl: string }> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      giteaOrgName: users.giteaOrgName,
      githubInstallationId: users.githubInstallationId,
    })
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);
  if (!user) throw new MigrationError(404, 'user_not_found', 'User not found');
  if (!user.githubInstallationId) {
    throw new MigrationError(
      409,
      'github_not_linked',
      'GitHub App is not installed for this user yet',
    );
  }
  if (!user.giteaOrgName) {
    throw new MigrationError(409, 'no_gitea_org', 'User has no Gitea organization');
  }

  const [sb] = await db
    .select({
      id: sandboxes.id,
      userId: sandboxes.userId,
      name: sandboxes.name,
      coderWorkspaceId: sandboxes.coderWorkspaceId,
      repoOrigin: sandboxes.repoOrigin,
      giteaRepoName: sandboxes.giteaRepoName,
      giteaCloneUrl: sandboxes.giteaCloneUrl,
    })
    .from(sandboxes)
    .where(and(eq(sandboxes.id, args.sandboxId), eq(sandboxes.userId, args.userId)))
    .limit(1);
  if (!sb) throw new MigrationError(404, 'sandbox_not_found', 'Sandbox not found');
  if (sb.repoOrigin === 'github') {
    throw new MigrationError(409, 'already_on_github', 'Sandbox already migrated to GitHub');
  }
  if (!sb.giteaRepoName || !sb.giteaCloneUrl) {
    throw new MigrationError(409, 'no_gitea_repo', 'Sandbox has no Gitea repo to migrate');
  }

  const installation = await getInstallation(user.githubInstallationId);
  const tokenRef = await mintInstallationToken(user.githubInstallationId);
  const ghRepo = await createInstallationRepo({
    installationToken: tokenRef.token,
    owner: installation.account.login,
    ownerType: installation.account.type === 'Organization' ? 'org' : 'user',
    name: sb.name,
    description: `Mercato sandbox ${sb.name}`,
  });

  const srcUrl = new URL(sb.giteaCloneUrl);
  const { readFileSync } = await import('node:fs');
  const giteaAdminToken = readFileSync(
    process.env.GITEA_ADMIN_TOKEN_FILE || '/run/secrets/gitea-admin/token',
    'utf8',
  ).trim();
  srcUrl.username = user.giteaOrgName;
  srcUrl.password = giteaAdminToken;
  const sourceUrlWithCreds = srcUrl.toString();

  const { jobName } = await spawnGitMirrorJob({
    sandboxId: sb.id,
    sourceUrlWithCreds,
    targetUrl: ghRepo.cloneUrl,
    targetToken: tokenRef.token,
  });

  const deadline = Date.now() + MIRROR_POLL_DEADLINE_MS;
  while (true) {
    const status = await getJobStatus(jobName);
    if (status && status.succeeded > 0) break;
    if (status && status.failed > 0) {
      throw new MigrationError(
        500,
        'mirror_job_failed',
        `Mirror Job ${jobName} failed (see kubectl logs)`,
      );
    }
    if (Date.now() > deadline) {
      throw new MigrationError(
        504,
        'mirror_job_timeout',
        `Mirror Job ${jobName} did not finish within ${MIRROR_POLL_DEADLINE_MS / 1000}s`,
      );
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }

  const ghUrlWithCreds = new URL(ghRepo.cloneUrl);
  ghUrlWithCreds.username = 'x-access-token';
  ghUrlWithCreds.password = tokenRef.token;
  await upsertWorkspaceCredsSecret(sb.id, {
    MERCATO_REPO_URL: ghUrlWithCreds.toString(),
    MERCATO_REPO_TOKEN: tokenRef.token,
    MERCATO_GH_USER_NAME: installation.account.login,
    MERCATO_GH_USER_EMAIL: user.email,
  });

  if (sb.coderWorkspaceId) {
    try {
      await restartWorkspace(sb.coderWorkspaceId);
    } catch (e) {
      console.warn(`[migrate] workspace restart for ${sb.id} failed:`, String(e).slice(0, 300));
    }
  }

  try {
    await archiveGiteaRepo(user.giteaOrgName, sb.giteaRepoName);
  } catch (e) {
    if (!(e instanceof GiteaApiError)) throw e;
    console.warn(`[migrate] archive Gitea repo ${sb.giteaRepoName} failed:`, e.status);
  }

  await db
    .update(sandboxes)
    .set({
      repoOrigin: 'github',
      githubRepoFullName: ghRepo.fullName,
      githubCloneUrl: ghRepo.cloneUrl,
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.id, sb.id));

  return { githubRepoFullName: ghRepo.fullName, githubCloneUrl: ghRepo.cloneUrl };
}

export { GitHubApiError };
