import { createHmac, timingSafeEqual } from 'node:crypto';

import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import {
  ensureCoderUser,
  type CoderUserRef,
} from '@/lib/coder';
import { db } from '@/lib/db';
import {
  billingEvents,
  billingOrders,
  llmAccounts,
  llmUsageSnapshots,
  sandboxes,
  users,
} from '@/db/schema';
import {
  buildOpenRouterKeyName,
  createOpenRouterKey,
  deleteOpenRouterKey,
  findOpenRouterKeyByName,
  getOpenRouterKey,
  updateOpenRouterKey,
  disableOpenRouterKey,
  type OpenRouterApiKeyRecord,
} from '@/lib/openrouter';
import {
  createSubscriptionCheckout,
  createSubscriptionPortal,
  getSubscriptionAccess,
  hasGrantedAccess,
  readEntitlementsView,
  DEFAULT_PRICE_CODE,
  DEFAULT_PRODUCT_CODE,
  type SubscriptionAccessSnapshot,
} from '@/lib/openmercato-subscriptions';
import {
  buildSandboxQuota,
  SANDBOX_QUOTA_COUNTED_STATUSES,
  type SandboxQuota,
} from '@/lib/sandbox-quota';
import {
  getWorkspaceBillingSecrets,
  upsertWorkspaceBillingSecrets,
  type WorkspaceBillingEnv,
} from '@/lib/k8s/workspace-secrets';

export const BILLING_ERROR_CODES = {
  AI_ENTITLEMENT_REQUIRED: 'ai_entitlement_required',
  INVALID_WEBHOOK_SIGNATURE: 'invalid_webhook_signature',
  INTERNAL_SYNC_AUTH_FAILED: 'internal_sync_auth_failed',
  PROVIDER_CONFIGURATION_MISSING: 'provider_configuration_missing',
} as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

export const OM_BILLING_PROVIDER = 'om_stripe' as const;
export const OM_WEBHOOK_SIGNATURE_HEADER = 'x-om-webhook-signature' as const;
export const OM_WEBHOOK_EVENT_ID_HEADER = 'x-om-webhook-delivery-id' as const;

export class OmBillingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OmBillingError';
  }
}

export interface OmBillingUser {
  id: string;
  email: string;
  openMercatoCustomerPersonId: string | null;
  coderUserId: string | null;
  coderUsername: string | null;
  coderTempPassword: string | null;
}

export interface OmLlmAccountRow {
  id: string;
  userId: string;
  provider: string;
  openrouterKeyHash: string;
  openrouterKeyLabel: string;
  status: string;
  coderSecretSyncState: string;
  limitUsd: number;
  limitReset: string | null;
  lastSyncedAt: Date | null;
}

export interface OmLatestUsageSnapshot {
  usageTotalUsd: number;
  usageMonthlyUsd: number;
  limitRemainingUsd: number;
  observedAt: Date;
}

export interface OmBillingRepository {
  getUser: (userId: string) => Promise<OmBillingUser | null>;
  setUserCoderFields: (
    userId: string,
    fields: { coderUserId: string; coderUsername: string; coderTempPassword: string | null },
  ) => Promise<void>;
  getLlmAccount: (userId: string) => Promise<OmLlmAccountRow | null>;
  insertBillingOrder: (input: {
    userId: string;
    provider: string;
    providerOrderId: string;
  }) => Promise<void>;
  countQuotaSandboxes: (userId: string) => Promise<number>;
  listWorkspaceCredentialSecretNames: (userId: string) => Promise<string[]>;
  getLatestUsageSnapshot: (llmAccountId: string) => Promise<OmLatestUsageSnapshot | null>;
  listActiveLlmAccounts: () => Promise<OmLlmAccountRow[]>;
  syncLlmAccountFromProvider: (
    accountId: string,
    fields: {
      keyLabel: string;
      limitUsd: number;
      limitReset: string | null;
      status: string;
    },
  ) => Promise<void>;
  insertUsageSnapshot: (input: {
    llmAccountId: string;
    usageTotalUsd: number;
    usageMonthlyUsd: number;
    limitRemainingUsd: number;
  }) => Promise<void>;
  /**
   * Run `fn` inside a serializable transaction. The inner repository is bound
   * to the transaction (so `for update` reads and writes are atomic).
   */
  transaction: <T>(fn: (txRepo: OmBillingTxRepository) => Promise<T>) => Promise<T>;
}

export interface OmBillingTxRepository {
  getUser: (userId: string) => Promise<OmBillingUser | null>;
  setUserCoderFields: (
    userId: string,
    fields: { coderUserId: string; coderUsername: string; coderTempPassword: string | null },
  ) => Promise<void>;
  getLlmAccount: (userId: string, forUpdate?: boolean) => Promise<OmLlmAccountRow | null>;
  upsertLlmAccount: (input: {
    userId: string;
    keyHash: string;
    keyLabel: string;
    status: string;
    coderSecretSyncState: string;
    limitUsd: number;
    limitReset: string | null;
  }) => Promise<string>;
  insertUsageSnapshot: (input: {
    llmAccountId: string;
    usageTotalUsd: number;
    usageMonthlyUsd: number;
    limitRemainingUsd: number;
  }) => Promise<void>;
  suspendLlmAccount: (accountId: string) => Promise<void>;
  findBillingEvent: (
    providerEventId: string,
  ) => Promise<{ id: string; processedAt: Date | null } | null>;
  insertBillingEvent: (input: {
    providerEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  markBillingEventProcessed: (providerEventId: string) => Promise<void>;
}

type DrizzleDb = typeof db;
type DrizzleTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type DbOrTx = DrizzleDb | DrizzleTx;

function toBillingUser(row: typeof users.$inferSelect | undefined): OmBillingUser | null {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    openMercatoCustomerPersonId: row.openMercatoCustomerPersonId,
    coderUserId: row.coderUserId,
    coderUsername: row.coderUsername,
    coderTempPassword: row.coderTempPassword,
  };
}

function toLlmAccountRow(
  row: typeof llmAccounts.$inferSelect | undefined,
): OmLlmAccountRow | null {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    openrouterKeyHash: row.openrouterKeyHash,
    openrouterKeyLabel: row.openrouterKeyLabel,
    status: row.status,
    coderSecretSyncState: row.coderSecretSyncState,
    limitUsd: row.limitUsd,
    limitReset: row.limitReset,
    lastSyncedAt: row.lastSyncedAt,
  };
}

function buildTxRepository(tx: DrizzleTx): OmBillingTxRepository {
  return {
    async getUser(userId) {
      const [row] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      return toBillingUser(row);
    },
    async setUserCoderFields(userId, fields) {
      await tx
        .update(users)
        .set({
          coderUserId: fields.coderUserId,
          coderUsername: fields.coderUsername,
          coderTempPassword: fields.coderTempPassword,
        })
        .where(eq(users.id, userId));
    },
    async getLlmAccount(userId, forUpdate = false) {
      const builder = tx.select().from(llmAccounts).where(eq(llmAccounts.userId, userId)).limit(1);
      const [row] = await (forUpdate ? builder.for('update') : builder);
      return toLlmAccountRow(row);
    },
    async upsertLlmAccount(input) {
      const [row] = await tx
        .insert(llmAccounts)
        .values({
          userId: input.userId,
          provider: 'openrouter',
          openrouterKeyHash: input.keyHash,
          openrouterKeyLabel: input.keyLabel,
          status: input.status,
          coderSecretSyncState: input.coderSecretSyncState,
          limitUsd: input.limitUsd,
          limitReset: input.limitReset,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: llmAccounts.userId,
          set: {
            provider: 'openrouter',
            openrouterKeyHash: input.keyHash,
            openrouterKeyLabel: input.keyLabel,
            status: input.status,
            coderSecretSyncState: input.coderSecretSyncState,
            limitUsd: input.limitUsd,
            limitReset: input.limitReset,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning({ id: llmAccounts.id });
      return row!.id;
    },
    async insertUsageSnapshot(input) {
      await tx.insert(llmUsageSnapshots).values({
        llmAccountId: input.llmAccountId,
        usageTotalUsd: input.usageTotalUsd,
        usageMonthlyUsd: input.usageMonthlyUsd,
        limitRemainingUsd: input.limitRemainingUsd,
        observedAt: new Date(),
      });
    },
    async suspendLlmAccount(accountId) {
      await tx
        .update(llmAccounts)
        .set({ status: 'suspended', updatedAt: new Date() })
        .where(eq(llmAccounts.id, accountId));
    },
    async findBillingEvent(providerEventId) {
      const [row] = await tx
        .select({ id: billingEvents.id, processedAt: billingEvents.processedAt })
        .from(billingEvents)
        .where(eq(billingEvents.providerEventId, providerEventId))
        .for('update')
        .limit(1);
      return row ? { id: row.id, processedAt: row.processedAt } : null;
    },
    async insertBillingEvent(input) {
      await tx.insert(billingEvents).values({
        provider: OM_BILLING_PROVIDER,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        payloadJson: input.payload,
      });
    },
    async markBillingEventProcessed(providerEventId) {
      await tx
        .update(billingEvents)
        .set({ processedAt: new Date() })
        .where(eq(billingEvents.providerEventId, providerEventId));
    },
  };
}

export const defaultOmBillingRepository: OmBillingRepository = {
  async getUser(userId) {
    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return toBillingUser(row);
  },
  async setUserCoderFields(userId, fields) {
    await db
      .update(users)
      .set({
        coderUserId: fields.coderUserId,
        coderUsername: fields.coderUsername,
        coderTempPassword: fields.coderTempPassword,
      })
      .where(eq(users.id, userId));
  },
  async getLlmAccount(userId) {
    const [row] = await db
      .select()
      .from(llmAccounts)
      .where(eq(llmAccounts.userId, userId))
      .limit(1);
    return toLlmAccountRow(row);
  },
  async insertBillingOrder(input) {
    await db.insert(billingOrders).values({
      userId: input.userId,
      provider: input.provider,
      providerOrderId: input.providerOrderId,
      status: 'pending',
      planType: 'activation',
      amountPln: 0,
      creditsUsd: 0,
      updatedAt: new Date(),
    });
  },
  async getLatestUsageSnapshot(llmAccountId) {
    const [row] = await db
      .select({
        usageTotalUsd: llmUsageSnapshots.usageTotalUsd,
        usageMonthlyUsd: llmUsageSnapshots.usageMonthlyUsd,
        limitRemainingUsd: llmUsageSnapshots.limitRemainingUsd,
        observedAt: llmUsageSnapshots.observedAt,
      })
      .from(llmUsageSnapshots)
      .where(eq(llmUsageSnapshots.llmAccountId, llmAccountId))
      .orderBy(desc(llmUsageSnapshots.observedAt))
      .limit(1);
    return row ?? null;
  },
  async countQuotaSandboxes(userId) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxes)
      .where(
        and(
          eq(sandboxes.userId, userId),
          inArray(sandboxes.status, [...SANDBOX_QUOTA_COUNTED_STATUSES]),
        ),
      );
    return Number(row?.count ?? 0);
  },
  async listWorkspaceCredentialSecretNames(userId) {
    const rows = await db
      .select({ secretName: sandboxes.workspaceCredsSecretName })
      .from(sandboxes)
      .where(
        and(
          eq(sandboxes.userId, userId),
          inArray(sandboxes.status, [...SANDBOX_QUOTA_COUNTED_STATUSES]),
          isNotNull(sandboxes.workspaceCredsSecretName),
        ),
      );
    return rows
      .map((row) => row.secretName)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
  },
  async listActiveLlmAccounts() {
    const rows = await db.select().from(llmAccounts).where(eq(llmAccounts.status, 'active'));
    return rows.map((r) => toLlmAccountRow(r)!).filter((r): r is OmLlmAccountRow => r !== null);
  },
  async syncLlmAccountFromProvider(accountId, fields) {
    await db
      .update(llmAccounts)
      .set({
        openrouterKeyLabel: fields.keyLabel,
        limitUsd: fields.limitUsd,
        limitReset: fields.limitReset,
        status: fields.status,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(llmAccounts.id, accountId));
  },
  async insertUsageSnapshot(input) {
    await db.insert(llmUsageSnapshots).values({
      llmAccountId: input.llmAccountId,
      usageTotalUsd: input.usageTotalUsd,
      usageMonthlyUsd: input.usageMonthlyUsd,
      limitRemainingUsd: input.limitRemainingUsd,
      observedAt: new Date(),
    });
  },
  async transaction(fn) {
    return db.transaction(async (tx) => fn(buildTxRepository(tx)));
  },
};

export interface OmBillingDependencies {
  repository?: OmBillingRepository;
  ensureCoderUser?: (email: string) => Promise<CoderUserRef>;
  getWorkspaceBillingSecrets?: typeof getWorkspaceBillingSecrets;
  upsertWorkspaceBillingSecrets?: typeof upsertWorkspaceBillingSecrets;
  createSubscriptionCheckout?: typeof createSubscriptionCheckout;
  createSubscriptionPortal?: typeof createSubscriptionPortal;
  getSubscriptionAccess?: typeof getSubscriptionAccess;
  createOpenRouterKey?: typeof createOpenRouterKey;
  getOpenRouterKey?: typeof getOpenRouterKey;
  updateOpenRouterKey?: typeof updateOpenRouterKey;
  disableOpenRouterKey?: typeof disableOpenRouterKey;
  deleteOpenRouterKey?: typeof deleteOpenRouterKey;
  findOpenRouterKeyByName?: typeof findOpenRouterKeyByName;
}

function resolveDeps(deps: OmBillingDependencies = {}) {
  return {
    repository: deps.repository ?? defaultOmBillingRepository,
    ensureCoderUser: deps.ensureCoderUser ?? ensureCoderUser,
    getWorkspaceBillingSecrets: deps.getWorkspaceBillingSecrets ?? getWorkspaceBillingSecrets,
    upsertWorkspaceBillingSecrets:
      deps.upsertWorkspaceBillingSecrets ?? upsertWorkspaceBillingSecrets,
    createSubscriptionCheckout: deps.createSubscriptionCheckout ?? createSubscriptionCheckout,
    createSubscriptionPortal: deps.createSubscriptionPortal ?? createSubscriptionPortal,
    getSubscriptionAccess: deps.getSubscriptionAccess ?? getSubscriptionAccess,
    createOpenRouterKey: deps.createOpenRouterKey ?? createOpenRouterKey,
    getOpenRouterKey: deps.getOpenRouterKey ?? getOpenRouterKey,
    updateOpenRouterKey: deps.updateOpenRouterKey ?? updateOpenRouterKey,
    disableOpenRouterKey: deps.disableOpenRouterKey ?? disableOpenRouterKey,
    deleteOpenRouterKey: deps.deleteOpenRouterKey ?? deleteOpenRouterKey,
    findOpenRouterKeyByName: deps.findOpenRouterKeyByName ?? findOpenRouterKeyByName,
  };
}

function priceCode(): string {
  return process.env.BASIC_PLAN_PRICE_CODE || DEFAULT_PRICE_CODE;
}

function productCode(): string {
  return process.env.BASIC_PLAN_PRODUCT_CODE || DEFAULT_PRODUCT_CODE;
}

function webhookSecret(): string {
  const value = process.env.OM_BILLING_WEBHOOK_SECRET;
  if (!value) {
    throw new OmBillingError(
      500,
      BILLING_ERROR_CODES.PROVIDER_CONFIGURATION_MISSING,
      'OM_BILLING_WEBHOOK_SECRET is not configured',
    );
  }
  return value;
}

function toMoney(value: number): number {
  return Number(value.toFixed(2));
}

async function requireUser(
  repo: { getUser: (id: string) => Promise<OmBillingUser | null> },
  userId: string,
): Promise<OmBillingUser> {
  const user = await repo.getUser(userId);
  if (!user) {
    throw new OmBillingError(404, 'user_not_found', 'User not found');
  }
  return user;
}

async function ensureCoderUserForRow(
  txRepo: OmBillingTxRepository,
  user: OmBillingUser,
  factory: (email: string) => Promise<CoderUserRef>,
): Promise<string> {
  if (user.coderUserId) return user.coderUserId;
  const created = await factory(user.email);
  await txRepo.setUserCoderFields(user.id, {
    coderUserId: created.id,
    coderUsername: created.username,
    coderTempPassword: created.tempPassword,
  });
  return created.id;
}

interface WorkspaceBillingSecretSync {
  synced: boolean;
  targetCount: number;
}

function hasCompleteWorkspaceBillingEnv(env: WorkspaceBillingEnv | null): env is WorkspaceBillingEnv {
  return Boolean(env?.OPENROUTER_API_KEY && env.ANTHROPIC_AUTH_TOKEN);
}

async function ensureWorkspaceBillingSecrets(
  secretNames: string[],
  getSecret: typeof getWorkspaceBillingSecrets,
  upsertSecret: typeof upsertWorkspaceBillingSecrets,
  rawKey: string | null,
): Promise<WorkspaceBillingSecretSync> {
  if (secretNames.length === 0) {
    return { synced: rawKey === null, targetCount: 0 };
  }

  let sourceKey = rawKey;
  const missing: string[] = [];

  for (const secretName of secretNames) {
    const existing = await getSecret(secretName);
    if (hasCompleteWorkspaceBillingEnv(existing)) {
      sourceKey ??= existing.OPENROUTER_API_KEY;
    } else {
      missing.push(secretName);
    }
  }

  if (!sourceKey) {
    return { synced: false, targetCount: secretNames.length };
  }

  const finalSourceKey = sourceKey;
  const targets = rawKey ? secretNames : missing;
  await Promise.all(
    targets.map((secretName) =>
      upsertSecret(secretName, {
        OPENROUTER_API_KEY: finalSourceKey,
        ANTHROPIC_AUTH_TOKEN: finalSourceKey,
      }),
    ),
  );

  return { synced: true, targetCount: secretNames.length };
}

export interface StartSubscriptionCheckoutInput {
  userId: string;
  baseUrl: string;
  priceCode?: string;
}

export interface StartSubscriptionCheckoutResult {
  checkoutUrl: string;
  subscriptionRequestId: string;
  priceCode: string;
  productCode: string;
}

export async function startSubscriptionCheckout(
  input: StartSubscriptionCheckoutInput,
  deps: OmBillingDependencies = {},
): Promise<StartSubscriptionCheckoutResult> {
  const resolved = resolveDeps(deps);
  const user = await requireUser(resolved.repository, input.userId);
  if (!user.openMercatoCustomerPersonId) {
    throw new OmBillingError(
      409,
      'crm_customer_missing',
      'Open Mercato CRM person id is missing for this user; signup CRM sync must run before checkout.',
    );
  }

  const successUrl = new URL('/billing?status=success', input.baseUrl).toString();
  const cancelUrl = new URL('/billing?status=cancelled', input.baseUrl).toString();
  const chosenPriceCode = input.priceCode || priceCode();

  let checkout;
  try {
    checkout = await resolved.createSubscriptionCheckout({
      externalAccountId: user.id,
      subjectEntityId: user.openMercatoCustomerPersonId,
      priceCode: chosenPriceCode,
      successUrl,
      cancelUrl,
    });
  } catch (error) {
    throw new OmBillingError(
      502,
      'om_checkout_failed',
      `Open Mercato subscriptions checkout failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await resolved.repository.insertBillingOrder({
    userId: user.id,
    provider: OM_BILLING_PROVIDER,
    providerOrderId: checkout.subscriptionRequestId,
  });

  return {
    checkoutUrl: checkout.checkoutUrl,
    subscriptionRequestId: checkout.subscriptionRequestId,
    priceCode: chosenPriceCode,
    productCode: productCode(),
  };
}

export interface StartSubscriptionPortalInput {
  userId: string;
  baseUrl: string;
}

export interface StartSubscriptionPortalResult {
  portalUrl: string;
}

export async function startSubscriptionPortal(
  input: StartSubscriptionPortalInput,
  deps: OmBillingDependencies = {},
): Promise<StartSubscriptionPortalResult> {
  const resolved = resolveDeps(deps);
  const user = await requireUser(resolved.repository, input.userId);
  const returnUrl = new URL('/billing', input.baseUrl).toString();

  try {
    const portal = await resolved.createSubscriptionPortal({
      externalAccountId: user.id,
      returnUrl,
    });
    return { portalUrl: portal.portalUrl };
  } catch (error) {
    throw new OmBillingError(
      502,
      'om_portal_failed',
      `Open Mercato subscriptions portal failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface ReconcileLlmAccessResult {
  accessSnapshot: SubscriptionAccessSnapshot;
  llmAccountStatus: string | null;
  llmAccountId: string | null;
  changed: boolean;
}

export async function reconcileLlmAccessForUser(
  userId: string,
  deps: OmBillingDependencies = {},
): Promise<ReconcileLlmAccessResult> {
  const resolved = resolveDeps(deps);
  const user = await requireUser(resolved.repository, userId);

  const snapshot = await resolved.getSubscriptionAccess({
    externalAccountId: user.id,
    productCode: productCode(),
  });

  if (!hasGrantedAccess(snapshot)) {
    const llmAccount = await resolved.repository.getLlmAccount(user.id);
    if (llmAccount && llmAccount.status === 'active') {
      await resolved.disableOpenRouterKey(llmAccount.openrouterKeyHash).catch(() => {});
      await resolved.repository.transaction(async (tx) => {
        await tx.suspendLlmAccount(llmAccount.id);
      });
      return {
        accessSnapshot: snapshot,
        llmAccountStatus: 'suspended',
        llmAccountId: llmAccount.id,
        changed: true,
      };
    }
    return {
      accessSnapshot: snapshot,
      llmAccountStatus: llmAccount?.status ?? null,
      llmAccountId: llmAccount?.id ?? null,
      changed: false,
    };
  }

  const entitlements = readEntitlementsView(snapshot.entitlements);
  const targetLimit = toMoney(Math.max(entitlements.openRouterTokensUsageUsd ?? 0, 0));

  const result = await resolved.repository.transaction(async (tx) => {
    const lockedUser = await tx.getUser(user.id);
    if (!lockedUser) {
      throw new OmBillingError(404, 'user_not_found', 'User not found');
    }
    await ensureCoderUserForRow(tx, lockedUser, resolved.ensureCoderUser);
    const llmAccount = await tx.getLlmAccount(lockedUser.id, true);
    const workspaceSecretNames = await resolved.repository.listWorkspaceCredentialSecretNames(
      lockedUser.id,
    );
    const billingSecretsSynced =
      llmAccount?.status === 'active' &&
      llmAccount.coderSecretSyncState === 'synced' &&
      (await ensureWorkspaceBillingSecrets(
        workspaceSecretNames,
        resolved.getWorkspaceBillingSecrets,
        resolved.upsertWorkspaceBillingSecrets,
        null,
      )).synced;

    if (
      llmAccount &&
      llmAccount.status === 'active' &&
      llmAccount.coderSecretSyncState === 'synced' &&
      llmAccount.limitUsd === targetLimit &&
      billingSecretsSynced
    ) {
      return {
        llmAccountStatus: 'active',
        llmAccountId: llmAccount.id,
        changed: false,
      };
    }

    const keyName = buildOpenRouterKeyName(lockedUser.id);
    let providerKey: OpenRouterApiKeyRecord;
    let rawKeyForSecretSync: string | null = null;

    if (!llmAccount) {
      const orphanKey = await resolved.findOpenRouterKeyByName(keyName);
      if (orphanKey) {
        await resolved.deleteOpenRouterKey(orphanKey.hash).catch(() => {});
      }
      const createdKey = await resolved.createOpenRouterKey({
        name: keyName,
        limit: targetLimit,
        limit_reset: null,
      });
      providerKey = createdKey;
      rawKeyForSecretSync = createdKey.key;
    } else if (
      llmAccount.coderSecretSyncState !== 'synced' ||
      llmAccount.status !== 'active' ||
      !billingSecretsSynced
    ) {
      const replacementKey = await resolved.createOpenRouterKey({
        name: keyName,
        limit: targetLimit,
        limit_reset: null,
      });
      providerKey = replacementKey;
      rawKeyForSecretSync = replacementKey.key;
      await resolved.deleteOpenRouterKey(llmAccount.openrouterKeyHash).catch(async () => {
        await resolved
          .updateOpenRouterKey(llmAccount.openrouterKeyHash, { disabled: true })
          .catch(() => {});
      });
    } else {
      providerKey = await resolved.updateOpenRouterKey(llmAccount.openrouterKeyHash, {
        name: keyName,
        limit: targetLimit,
        disabled: false,
      });
    }

    let status = 'active';
    let secretSyncState: string =
      llmAccount?.coderSecretSyncState === 'synced' && !rawKeyForSecretSync ? 'synced' : 'pending';

    if (rawKeyForSecretSync) {
      try {
        const syncResult = await ensureWorkspaceBillingSecrets(
          workspaceSecretNames,
          resolved.getWorkspaceBillingSecrets,
          resolved.upsertWorkspaceBillingSecrets,
          rawKeyForSecretSync,
        );
        secretSyncState = syncResult.synced ? 'synced' : 'pending';
      } catch (error) {
        status = 'sync_failed';
        secretSyncState = 'failed';
        const failedAccountId = await tx.upsertLlmAccount({
          userId: lockedUser.id,
          keyHash: providerKey.hash,
          keyLabel: providerKey.label,
          status,
          coderSecretSyncState: secretSyncState,
          limitUsd: toMoney(providerKey.limit ?? 0),
          limitReset: providerKey.limit_reset,
        });
        await tx.insertUsageSnapshot({
          llmAccountId: failedAccountId,
          usageTotalUsd: toMoney(providerKey.usage),
          usageMonthlyUsd: toMoney(providerKey.usage_monthly),
          limitRemainingUsd: toMoney(providerKey.limit_remaining ?? 0),
        });
        throw new OmBillingError(
          502,
          'workspace_secret_sync_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    } else if (secretSyncState !== 'synced') {
      throw new OmBillingError(
        502,
        'openrouter_key_missing',
        'OpenRouter create key response did not include a raw key for workspace secret sync',
      );
    } else {
      secretSyncState = 'synced';
    }

    const llmAccountId = await tx.upsertLlmAccount({
      userId: lockedUser.id,
      keyHash: providerKey.hash,
      keyLabel: providerKey.label,
      status,
      coderSecretSyncState: secretSyncState,
      limitUsd: toMoney(providerKey.limit ?? 0),
      limitReset: providerKey.limit_reset,
    });
    await tx.insertUsageSnapshot({
      llmAccountId,
      usageTotalUsd: toMoney(providerKey.usage),
      usageMonthlyUsd: toMoney(providerKey.usage_monthly),
      limitRemainingUsd: toMoney(providerKey.limit_remaining ?? 0),
    });

    return {
      llmAccountStatus: status,
      llmAccountId,
      changed: true,
    };
  });

  return {
    accessSnapshot: snapshot,
    llmAccountStatus: result.llmAccountStatus,
    llmAccountId: result.llmAccountId,
    changed: result.changed,
  };
}

export interface OmBillingSummary {
  accessSnapshot: SubscriptionAccessSnapshot | null;
  llmAccount: {
    id: string;
    status: string;
    secretSyncState: string;
    limitUsd: number;
    lastSyncedAt: string | null;
  } | null;
  latestUsage: {
    usageTotalUsd: number;
    usageMonthlyUsd: number;
    limitRemainingUsd: number;
    observedAt: string;
  } | null;
  sandboxQuota: SandboxQuota;
  canCreateSandbox: boolean;
}

function toIsoString(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function getOmBillingSummaryForUser(
  userId: string,
  deps: OmBillingDependencies = {},
): Promise<OmBillingSummary> {
  const resolved = resolveDeps(deps);
  const user = await requireUser(resolved.repository, userId);

  let accessSnapshot: SubscriptionAccessSnapshot | null = null;
  try {
    accessSnapshot = await resolved.getSubscriptionAccess({
      externalAccountId: user.id,
      productCode: productCode(),
    });
  } catch {
    accessSnapshot = null;
  }

  const llmAccount = await resolved.repository.getLlmAccount(user.id);
  const latestUsage = llmAccount
    ? await resolved.repository.getLatestUsageSnapshot(llmAccount.id)
    : null;
  const quotaUsed = await resolved.repository.countQuotaSandboxes(user.id);
  const sandboxQuota = buildSandboxQuota(accessSnapshot?.entitlements ?? null, quotaUsed);

  const canCreateSandbox =
    hasGrantedAccess(accessSnapshot) &&
    llmAccount?.status === 'active' &&
    llmAccount.coderSecretSyncState === 'synced' &&
    sandboxQuota.valid &&
    !sandboxQuota.reached;

  return {
    accessSnapshot,
    llmAccount: llmAccount
      ? {
          id: llmAccount.id,
          status: llmAccount.status,
          secretSyncState: llmAccount.coderSecretSyncState,
          limitUsd: llmAccount.limitUsd,
          lastSyncedAt: toIsoString(llmAccount.lastSyncedAt),
        }
      : null,
    latestUsage: latestUsage
      ? {
          usageTotalUsd: latestUsage.usageTotalUsd,
          usageMonthlyUsd: latestUsage.usageMonthlyUsd,
          limitRemainingUsd: latestUsage.limitRemainingUsd,
          observedAt: toIsoString(latestUsage.observedAt)!,
        }
      : null,
    sandboxQuota,
    canCreateSandbox: Boolean(canCreateSandbox),
  };
}

export async function assertActiveSandboxEntitlement(
  userId: string,
  deps: OmBillingDependencies = {},
): Promise<SubscriptionAccessSnapshot> {
  const result = await reconcileLlmAccessForUser(userId, deps);
  if (hasGrantedAccess(result.accessSnapshot) && result.llmAccountStatus === 'active') {
    return result.accessSnapshot;
  }
  throw new OmBillingError(
    402,
    BILLING_ERROR_CODES.AI_ENTITLEMENT_REQUIRED,
    'Paid AI access is required before you can create a sandbox.',
  );
}

export interface OmWebhookPayload {
  externalAccountId: string;
  productCode: string;
  accessState: 'pending' | 'granted' | 'grace' | 'blocked';
  subscriptionId?: string | null;
  entitlements?: Record<string, unknown> | null;
  occurredAt?: string;
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function readWebhookPayload(value: Record<string, unknown>): OmWebhookPayload {
  const externalAccountId = typeof value.externalAccountId === 'string' ? value.externalAccountId : '';
  const productCodeRaw = typeof value.productCode === 'string' ? value.productCode : '';
  const accessStateRaw = typeof value.accessState === 'string' ? value.accessState : '';
  if (
    !externalAccountId ||
    !productCodeRaw ||
    !['pending', 'granted', 'grace', 'blocked'].includes(accessStateRaw)
  ) {
    throw new OmBillingError(
      400,
      'invalid_webhook_payload',
      'Open Mercato webhook payload is missing required fields',
    );
  }
  return {
    externalAccountId,
    productCode: productCodeRaw,
    accessState: accessStateRaw as OmWebhookPayload['accessState'],
    subscriptionId: typeof value.subscriptionId === 'string' ? value.subscriptionId : null,
    entitlements:
      value.entitlements && typeof value.entitlements === 'object' && !Array.isArray(value.entitlements)
        ? (value.entitlements as Record<string, unknown>)
        : null,
    occurredAt: typeof value.occurredAt === 'string' ? value.occurredAt : undefined,
  };
}

export function verifyOmWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string = webhookSecret(),
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export interface ProcessOmWebhookInput {
  rawBody: string;
  signature: string | null;
  deliveryId: string | null;
}

export interface ProcessOmWebhookResult {
  already_processed: boolean;
  user_id: string | null;
  access_state: OmWebhookPayload['accessState'];
}

export async function processOmAccessChangedWebhook(
  input: ProcessOmWebhookInput,
  deps: OmBillingDependencies = {},
): Promise<ProcessOmWebhookResult> {
  if (!verifyOmWebhookSignature(input.rawBody, input.signature)) {
    throw new OmBillingError(
      401,
      BILLING_ERROR_CODES.INVALID_WEBHOOK_SIGNATURE,
      'Invalid Open Mercato webhook signature',
    );
  }
  const parsed = safeJsonParse(input.rawBody);
  if (!parsed) {
    throw new OmBillingError(400, 'invalid_webhook_payload', 'Webhook body is not valid JSON');
  }
  const payload = readWebhookPayload(parsed);
  if (payload.productCode !== productCode()) {
    return {
      already_processed: true,
      user_id: null,
      access_state: payload.accessState,
    };
  }

  const resolved = resolveDeps(deps);
  const eventId =
    input.deliveryId ||
    `om-${payload.externalAccountId}-${payload.subscriptionId ?? 'na'}-${payload.occurredAt ?? Date.now()}`;

  const dedupe = await resolved.repository.transaction(async (tx) => {
    const existing = await tx.findBillingEvent(eventId);
    if (existing?.processedAt) {
      return { already: true };
    }
    if (!existing) {
      await tx.insertBillingEvent({
        providerEventId: eventId,
        eventType: 'subscriptions.access.changed',
        payload: payload as unknown as Record<string, unknown>,
      });
    }
    return { already: false };
  });

  if (dedupe.already) {
    return {
      already_processed: true,
      user_id: payload.externalAccountId,
      access_state: payload.accessState,
    };
  }

  await reconcileLlmAccessForUser(payload.externalAccountId, deps);

  await resolved.repository.transaction(async (tx) => {
    await tx.markBillingEventProcessed(eventId);
  });

  return {
    already_processed: false,
    user_id: payload.externalAccountId,
    access_state: payload.accessState,
  };
}

export function signOmWebhookPayload(rawBody: string, secret: string = webhookSecret()): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export interface UsageSyncResult {
  total: number;
  reconciled: number;
  snapshot_written: number;
  failed: number;
}

export type SyncOmBillingUsageForUserOutcome =
  | 'synced'
  | 'skipped-throttled'
  | 'skipped-inactive'
  | 'reconcile-failed'
  | 'sync-failed';

export interface SyncOmBillingUsageForUserOptions {
  minIntervalMs?: number;
}

export const DEFAULT_USAGE_SYNC_MIN_INTERVAL_MS = 30_000;

export async function syncOmBillingUsageForUser(
  userId: string,
  deps: OmBillingDependencies = {},
  options: SyncOmBillingUsageForUserOptions = {},
): Promise<SyncOmBillingUsageForUserOutcome> {
  const resolved = resolveDeps(deps);
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_USAGE_SYNC_MIN_INTERVAL_MS;

  if (minIntervalMs > 0) {
    const existing = await resolved.repository.getLlmAccount(userId);
    if (existing?.lastSyncedAt) {
      const elapsed = Date.now() - existing.lastSyncedAt.getTime();
      if (elapsed < minIntervalMs) return 'skipped-throttled';
    }
  }

  try {
    await reconcileLlmAccessForUser(userId, deps);
  } catch {
    return 'reconcile-failed';
  }

  try {
    const latestAccount = await resolved.repository.getLlmAccount(userId);
    if (!latestAccount || latestAccount.status !== 'active') {
      return 'skipped-inactive';
    }
    const key = await resolved.getOpenRouterKey(latestAccount.openrouterKeyHash);
    await resolved.repository.syncLlmAccountFromProvider(latestAccount.id, {
      keyLabel: key.label,
      limitUsd: toMoney(key.limit ?? 0),
      limitReset: key.limit_reset,
      status: key.disabled ? 'suspended' : 'active',
    });
    await resolved.repository.insertUsageSnapshot({
      llmAccountId: latestAccount.id,
      usageTotalUsd: toMoney(key.usage),
      usageMonthlyUsd: toMoney(key.usage_monthly),
      limitRemainingUsd: toMoney(key.limit_remaining ?? 0),
    });
    return 'synced';
  } catch {
    return 'sync-failed';
  }
}

export async function syncActiveOmBillingUsage(
  deps: OmBillingDependencies = {},
): Promise<UsageSyncResult> {
  const resolved = resolveDeps(deps);
  const accounts = await resolved.repository.listActiveLlmAccounts();

  let reconciled = 0;
  let snapshotWritten = 0;
  let failed = 0;

  for (const account of accounts) {
    const outcome = await syncOmBillingUsageForUser(account.userId, deps, { minIntervalMs: 0 });
    switch (outcome) {
      case 'synced':
        reconciled += 1;
        snapshotWritten += 1;
        break;
      case 'skipped-inactive':
        reconciled += 1;
        break;
      case 'sync-failed':
        reconciled += 1;
        failed += 1;
        break;
      case 'reconcile-failed':
        failed += 1;
        break;
      case 'skipped-throttled':
        break;
    }
  }

  return {
    total: accounts.length,
    reconciled,
    snapshot_written: snapshotWritten,
    failed,
  };
}

export function verifyInternalBillingSyncRequest(req: Request): void {
  const expected = process.env.BILLING_SYNC_SECRET;
  const provided = req.headers.get('x-billing-sync-secret');
  if (!expected || provided !== expected) {
    throw new OmBillingError(
      401,
      BILLING_ERROR_CODES.INTERNAL_SYNC_AUTH_FAILED,
      'Invalid billing sync secret',
    );
  }
}

// Re-exports to keep imports stable
export { and };
export type { DbOrTx };
