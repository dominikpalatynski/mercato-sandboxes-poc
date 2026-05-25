import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, type Db } from '@/lib/db';
import { sandboxes, users } from '@/db/schema';
import {
  CoderApiError,
  createWorkspace,
  ensureCoderUser,
} from '@/lib/coder';
import { createRepo, createRepoDeployToken, createUserOrg } from '@/lib/gitea/client';
import { upsertWorkspaceCredsSecret } from '@/lib/k8s/workspace-secrets';
import { assertActiveSandboxEntitlement, OmBillingError } from '@/lib/om-billing';
import type { SubscriptionAccessSnapshot } from '@/lib/openmercato-subscriptions';
import type { CreatableSandboxPresetId } from '@/lib/sandbox-presets';
import {
  assertSandboxQuotaAvailable,
  buildSandboxQuota,
  SANDBOX_QUOTA_COUNTED_STATUSES,
} from '@/lib/sandbox-quota';

type SandboxOwner = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  coderUserId: string | null;
  coderUsername: string | null;
  coderTempPassword: string | null;
  giteaOrgName: string | null;
  githubLogin: string | null;
};

export class SandboxProvisioningError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly sandboxId: string,
  ) {
    super(message);
    this.name = 'SandboxProvisioningError';
  }
}

export interface SandboxServiceDependencies {
  db?: Db;
  assertActiveSandboxEntitlement?: typeof assertActiveSandboxEntitlement;
  ensureCoderUser?: typeof ensureCoderUser;
  createUserOrg?: typeof createUserOrg;
  createRepo?: typeof createRepo;
  createRepoDeployToken?: typeof createRepoDeployToken;
  upsertWorkspaceCredsSecret?: typeof upsertWorkspaceCredsSecret;
  createWorkspace?: typeof createWorkspace;
}

export interface CreateSandboxInput {
  userId: string;
  name: string;
  presetId: CreatableSandboxPresetId;
}

export interface CreateSandboxResult {
  id: string;
}

export class SandboxService {
  private readonly db: Db;
  private readonly assertActiveSandboxEntitlement: typeof assertActiveSandboxEntitlement;
  private readonly ensureCoderUser: typeof ensureCoderUser;
  private readonly createUserOrg: typeof createUserOrg;
  private readonly createRepo: typeof createRepo;
  private readonly createRepoDeployToken: typeof createRepoDeployToken;
  private readonly upsertWorkspaceCredsSecret: typeof upsertWorkspaceCredsSecret;
  private readonly createWorkspace: typeof createWorkspace;

  constructor(deps: SandboxServiceDependencies = {}) {
    this.db = deps.db ?? db;
    this.assertActiveSandboxEntitlement =
      deps.assertActiveSandboxEntitlement ?? assertActiveSandboxEntitlement;
    this.ensureCoderUser = deps.ensureCoderUser ?? ensureCoderUser;
    this.createUserOrg = deps.createUserOrg ?? createUserOrg;
    this.createRepo = deps.createRepo ?? createRepo;
    this.createRepoDeployToken = deps.createRepoDeployToken ?? createRepoDeployToken;
    this.upsertWorkspaceCredsSecret = deps.upsertWorkspaceCredsSecret ?? upsertWorkspaceCredsSecret;
    this.createWorkspace = deps.createWorkspace ?? createWorkspace;
  }

  async createSandbox(input: CreateSandboxInput): Promise<CreateSandboxResult> {
    const accessSnapshot = await this.assertActiveSandboxEntitlement(input.userId);
    const { user, sandboxId } = await this.reserveSandboxSlot({ ...input, accessSnapshot });

    const coderUserId = await this.ensureCoderUserForSandbox(user, sandboxId);
    const giteaOrgName = await this.ensureGiteaOrgForSandbox(user, sandboxId);
    const workspaceCredsSecretName = await this.provisionRepositoryAccess({
      sandboxId,
      user,
      sandboxName: input.name,
      giteaOrgName,
    });
    await this.provisionBillingAccess({
      userId: user.id,
      sandboxId,
    });
    await this.provisionCoderWorkspace({
      sandboxId,
      coderUserId,
      sandboxName: input.name,
      presetId: input.presetId,
      workspaceCredsSecretName,
    });

    return { id: sandboxId };
  }

  private async reserveSandboxSlot(input: CreateSandboxInput & {
    accessSnapshot: SubscriptionAccessSnapshot;
  }): Promise<{ user: SandboxOwner; sandboxId: string }> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          coderUserId: users.coderUserId,
          coderUsername: users.coderUsername,
          coderTempPassword: users.coderTempPassword,
          giteaOrgName: users.giteaOrgName,
          githubLogin: users.githubLogin,
        })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)
        .for('update');

      if (!user) {
        throw new OmBillingError(404, 'user_not_found', 'User not found');
      }

      const [quotaRow] = await tx
        .select({ used: sql<number>`count(*)::int` })
        .from(sandboxes)
        .where(
          and(
            eq(sandboxes.userId, input.userId),
            inArray(sandboxes.status, [...SANDBOX_QUOTA_COUNTED_STATUSES]),
          ),
        );
      const quota = buildSandboxQuota(input.accessSnapshot.entitlements, Number(quotaRow?.used ?? 0));
      assertSandboxQuotaAvailable(quota);

      const [inserted] = await tx
        .insert(sandboxes)
        .values({
          userId: user.id,
          name: input.name,
          presetId: input.presetId,
          status: 'building',
          statusMessage: 'Creating workspace…',
        })
        .returning({ id: sandboxes.id });

      if (!inserted?.id) {
        throw new OmBillingError(500, 'sandbox_create_failed', 'Failed to create sandbox row');
      }

      return { user, sandboxId: inserted.id };
    });
  }

  private async ensureCoderUserForSandbox(user: SandboxOwner, sandboxId: string): Promise<string> {
    if (user.coderUserId) {
      return user.coderUserId;
    }

    try {
      const created = await this.ensureCoderUser(user.email);
      await this.db
        .update(users)
        .set({
          coderUserId: created.id,
          coderUsername: created.username,
          coderTempPassword: created.tempPassword,
        })
        .where(eq(users.id, user.id));
      return created.id;
    } catch (error) {
      const message = `Failed to create Coder user: ${String(error).slice(0, 500)}`;
      await this.markSandboxFailed(sandboxId, message);
      throw new SandboxProvisioningError(500, message, sandboxId);
    }
  }

  private async ensureGiteaOrgForSandbox(user: SandboxOwner, sandboxId: string): Promise<string> {
    if (user.giteaOrgName) {
      return user.giteaOrgName;
    }

    try {
      const org = await this.createUserOrg({
        userId: user.id,
        email: user.email,
        fullName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
      });
      await this.db.update(users).set({ giteaOrgName: org.name }).where(eq(users.id, user.id));
      return org.name;
    } catch (error) {
      const message = `Failed to create Gitea organization: ${String(error).slice(0, 500)}`;
      await this.markSandboxFailed(sandboxId, message);
      throw new SandboxProvisioningError(502, message, sandboxId);
    }
  }

  private async provisionRepositoryAccess(input: {
    sandboxId: string;
    user: SandboxOwner;
    sandboxName: string;
    giteaOrgName: string;
  }): Promise<string> {
    try {
      const repo = await this.createRepo(input.giteaOrgName, input.sandboxName);
      const token = await this.createRepoDeployToken(input.giteaOrgName, repo.name);
      const url = new URL(repo.cloneUrl);
      url.username = input.giteaOrgName;
      url.password = token.sha1;

      const secret = await this.upsertWorkspaceCredsSecret(input.sandboxId, {
        MERCATO_REPO_URL: url.toString(),
        MERCATO_REPO_TOKEN: token.sha1,
        ...(input.user.githubLogin
          ? { MERCATO_GH_USER_NAME: input.user.githubLogin, MERCATO_GH_USER_EMAIL: input.user.email }
          : {}),
      });

      await this.db
        .update(sandboxes)
        .set({
          repoOrigin: 'gitea',
          giteaRepoName: repo.name,
          giteaCloneUrl: repo.cloneUrl,
          workspaceCredsSecretName: secret.name,
          updatedAt: new Date(),
        })
        .where(eq(sandboxes.id, input.sandboxId));

      return secret.name;
    } catch (error) {
      const message = String(error).slice(0, 500);
      await this.markSandboxFailed(input.sandboxId, message);
      throw new SandboxProvisioningError(500, String(error), input.sandboxId);
    }
  }

  private async provisionBillingAccess(input: {
    userId: string;
    sandboxId: string;
  }): Promise<void> {
    try {
      await this.assertActiveSandboxEntitlement(input.userId);
    } catch (error) {
      const message = error instanceof OmBillingError ? error.message : String(error);
      await this.markSandboxFailed(input.sandboxId, message);
      throw new SandboxProvisioningError(500, message, input.sandboxId);
    }
  }

  private async provisionCoderWorkspace(input: {
    sandboxId: string;
    coderUserId: string;
    sandboxName: string;
    presetId: CreatableSandboxPresetId;
    workspaceCredsSecretName: string;
  }): Promise<void> {
    try {
      const workspace = await this.createWorkspace(input.coderUserId, input.sandboxName, {
        sandboxPreset: input.presetId,
        workspaceCredsSecretName: input.workspaceCredsSecretName,
      });
      await this.db
        .update(sandboxes)
        .set({
          coderWorkspaceId: workspace.id,
          statusMessage: 'Provisioning…',
          updatedAt: new Date(),
        })
        .where(eq(sandboxes.id, input.sandboxId));
    } catch (error) {
      const message = error instanceof CoderApiError ? error.body || error.message : String(error);
      await this.markSandboxFailed(input.sandboxId, message);
      throw new SandboxProvisioningError(500, String(error), input.sandboxId);
    }
  }

  private async markSandboxFailed(sandboxId: string, message: string): Promise<void> {
    await this.db
      .update(sandboxes)
      .set({
        status: 'failed',
        statusMessage: message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(sandboxes.id, sandboxId));
  }
}

export const sandboxService = new SandboxService();
