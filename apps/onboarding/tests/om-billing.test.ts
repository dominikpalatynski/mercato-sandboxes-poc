import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  assertActiveSandboxEntitlement,
  OmBillingError,
  processOmAccessChangedWebhook,
  reconcileLlmAccessForUser,
  signOmWebhookPayload,
  getOmBillingSummaryForUser,
  startSubscriptionCheckout,
  startSubscriptionPortal,
  verifyOmWebhookSignature,
  type OmBillingDependencies,
  type OmBillingRepository,
  type OmBillingTxRepository,
  type OmBillingUser,
  type OmLlmAccountRow,
} from '../lib/om-billing';
import type { OpenRouterApiKeyRecord } from '../lib/openrouter';
import type {
  CreateSubscriptionCheckoutResponse,
  CreateSubscriptionPortalResponse,
  SubscriptionAccessSnapshot,
} from '../lib/openmercato-subscriptions';
import type { CoderUserRef } from '../lib/coder';

interface BillingEventState {
  id: string;
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  processedAt: Date | null;
}

interface State {
  users: OmBillingUser[];
  llmAccounts: OmLlmAccountRow[];
  billingEvents: BillingEventState[];
  billingOrders: Array<{ id: string; userId: string; provider: string; providerOrderId: string }>;
  usageSnapshots: Array<{ llmAccountId: string }>;
  sandboxes: Array<{ userId: string; status: string; workspaceCredsSecretName?: string | null }>;
  workspaceSecrets: Map<string, { OPENROUTER_API_KEY?: string; ANTHROPIC_AUTH_TOKEN?: string }>;
}

function makeState(initialUser: OmBillingUser, initialAccount?: OmLlmAccountRow): State {
  return {
    users: [{ ...initialUser }],
    llmAccounts: initialAccount ? [{ ...initialAccount }] : [],
    billingEvents: [],
    billingOrders: [],
    usageSnapshots: [],
    sandboxes: [],
    workspaceSecrets: new Map(),
  };
}

function makeRepository(state: State): OmBillingRepository {
  const txRepo: OmBillingTxRepository = {
    async getUser(userId) {
      const user = state.users.find((u) => u.id === userId);
      return user ? { ...user } : null;
    },
    async setUserCoderFields(userId, fields) {
      const user = state.users.find((u) => u.id === userId);
      if (user) {
        user.coderUserId = fields.coderUserId;
        user.coderUsername = fields.coderUsername;
        user.coderTempPassword = fields.coderTempPassword;
      }
    },
    async getLlmAccount(userId) {
      const account = state.llmAccounts.find((a) => a.userId === userId);
      return account ? { ...account } : null;
    },
    async upsertLlmAccount(input) {
      const existing = state.llmAccounts.find((a) => a.userId === input.userId);
      if (existing) {
        existing.openrouterKeyHash = input.keyHash;
        existing.openrouterKeyLabel = input.keyLabel;
        existing.status = input.status;
        existing.coderSecretSyncState = input.coderSecretSyncState;
        existing.limitUsd = input.limitUsd;
        existing.limitReset = input.limitReset;
        existing.lastSyncedAt = new Date();
        return existing.id;
      }
      const created: OmLlmAccountRow = {
        id: `llm-${state.llmAccounts.length + 1}`,
        userId: input.userId,
        provider: 'openrouter',
        openrouterKeyHash: input.keyHash,
        openrouterKeyLabel: input.keyLabel,
        status: input.status,
        coderSecretSyncState: input.coderSecretSyncState,
        limitUsd: input.limitUsd,
        limitReset: input.limitReset,
        lastSyncedAt: new Date(),
      };
      state.llmAccounts.push(created);
      return created.id;
    },
    async insertUsageSnapshot(input) {
      state.usageSnapshots.push({ llmAccountId: input.llmAccountId });
    },
    async suspendLlmAccount(accountId) {
      const account = state.llmAccounts.find((a) => a.id === accountId);
      if (account) account.status = 'suspended';
    },
    async findBillingEvent(providerEventId) {
      const event = state.billingEvents.find((e) => e.providerEventId === providerEventId);
      return event ? { id: event.id, processedAt: event.processedAt } : null;
    },
    async insertBillingEvent(input) {
      state.billingEvents.push({
        id: `evt-${state.billingEvents.length + 1}`,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        payload: input.payload,
        processedAt: null,
      });
    },
    async markBillingEventProcessed(providerEventId) {
      const event = state.billingEvents.find((e) => e.providerEventId === providerEventId);
      if (event) event.processedAt = new Date();
    },
  };

  return {
    getUser: txRepo.getUser,
    setUserCoderFields: txRepo.setUserCoderFields,
    getLlmAccount: txRepo.getLlmAccount,
    async insertBillingOrder(input) {
      state.billingOrders.push({
        id: `order-${state.billingOrders.length + 1}`,
        userId: input.userId,
        provider: input.provider,
        providerOrderId: input.providerOrderId,
      });
    },
    async getLatestUsageSnapshot() {
      return null;
    },
    async countQuotaSandboxes(userId) {
      return state.sandboxes.filter(
        (sandbox) =>
          sandbox.userId === userId &&
          ['building', 'ready', 'stopped'].includes(sandbox.status),
      ).length;
    },
    async listWorkspaceCredentialSecretNames(userId) {
      return state.sandboxes
        .filter(
          (sandbox) =>
            sandbox.userId === userId &&
            ['building', 'ready', 'stopped'].includes(sandbox.status) &&
            sandbox.workspaceCredsSecretName,
        )
        .map((sandbox) => sandbox.workspaceCredsSecretName!);
    },
    async listActiveLlmAccounts() {
      return state.llmAccounts.filter((a) => a.status === 'active').map((a) => ({ ...a }));
    },
    async syncLlmAccountFromProvider(accountId, fields) {
      const account = state.llmAccounts.find((a) => a.id === accountId);
      if (account) {
        account.openrouterKeyLabel = fields.keyLabel;
        account.limitUsd = fields.limitUsd;
        account.limitReset = fields.limitReset;
        account.status = fields.status;
        account.lastSyncedAt = new Date();
      }
    },
    insertUsageSnapshot: txRepo.insertUsageSnapshot,
    async transaction(fn) {
      return fn(txRepo);
    },
  };
}

function makeOpenRouter() {
  let nextHash = 1;
  const keys = new Map<string, OpenRouterApiKeyRecord & { key: string }>();
  return {
    keys,
    async createOpenRouterKey(input: { name: string; limit: number | null }) {
      const hash = `hash-${nextHash++}`;
      const record = {
        hash,
        label: input.name,
        name: input.name,
        limit: input.limit ?? 0,
        limit_remaining: input.limit ?? 0,
        limit_reset: null,
        usage: 0,
        usage_monthly: 0,
        disabled: false,
        key: `sk-${hash}`,
      } as OpenRouterApiKeyRecord & { key: string };
      keys.set(hash, record);
      return record;
    },
    async getOpenRouterKey(hash: string) {
      const record = keys.get(hash);
      if (!record) throw new Error(`no key for ${hash}`);
      return record;
    },
    async updateOpenRouterKey(hash: string, input: Record<string, unknown>) {
      const record = keys.get(hash);
      if (!record) throw new Error(`no key for ${hash}`);
      Object.assign(record, input);
      return record;
    },
    async disableOpenRouterKey(hash: string) {
      const record = keys.get(hash);
      if (record) record.disabled = true;
      return record as OpenRouterApiKeyRecord;
    },
    async deleteOpenRouterKey(hash: string) {
      keys.delete(hash);
    },
    async findOpenRouterKeyByName(name: string) {
      for (const record of keys.values()) {
        if (record.name === name) return record;
      }
      return null;
    },
  };
}

function buildDeps(state: State, overrides: Partial<OmBillingDependencies> = {}): OmBillingDependencies {
  const router = makeOpenRouter();
  const ensureCoderUser: (email: string) => Promise<CoderUserRef> = async (email) => ({
    id: 'coder-user-1',
    username: email.split('@')[0]!,
    tempPassword: 'temp',
  });
  return {
    repository: makeRepository(state),
    ensureCoderUser,
    getWorkspaceBillingSecrets: (async (secretName: string) => {
      const secret = state.workspaceSecrets.get(secretName);
      if (!secret?.OPENROUTER_API_KEY) return null;
      return {
        OPENROUTER_API_KEY: secret.OPENROUTER_API_KEY,
        ANTHROPIC_AUTH_TOKEN: secret.ANTHROPIC_AUTH_TOKEN ?? secret.OPENROUTER_API_KEY,
      };
    }) as unknown as OmBillingDependencies['getWorkspaceBillingSecrets'],
    upsertWorkspaceBillingSecrets: (async (
      secretName: string,
      env: { OPENROUTER_API_KEY: string; ANTHROPIC_AUTH_TOKEN?: string },
    ) => {
      state.workspaceSecrets.set(secretName, {
        OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
        ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ?? env.OPENROUTER_API_KEY,
      });
    }) as unknown as OmBillingDependencies['upsertWorkspaceBillingSecrets'],
    createOpenRouterKey: router.createOpenRouterKey as unknown as OmBillingDependencies['createOpenRouterKey'],
    getOpenRouterKey: router.getOpenRouterKey as unknown as OmBillingDependencies['getOpenRouterKey'],
    updateOpenRouterKey: router.updateOpenRouterKey as unknown as OmBillingDependencies['updateOpenRouterKey'],
    disableOpenRouterKey: router.disableOpenRouterKey as unknown as OmBillingDependencies['disableOpenRouterKey'],
    deleteOpenRouterKey: router.deleteOpenRouterKey as unknown as OmBillingDependencies['deleteOpenRouterKey'],
    findOpenRouterKeyByName: router.findOpenRouterKeyByName as unknown as OmBillingDependencies['findOpenRouterKeyByName'],
    ...overrides,
  };
}

function makeSnapshot(
  state: SubscriptionAccessSnapshot['accessState'],
  entitlements: Record<string, unknown> | null = { sandboxCount: 1, openRouterTokensUsageUsd: 50 },
): SubscriptionAccessSnapshot {
  return {
    subscriptionId: state === 'pending' ? null : 'sub-1',
    externalAccountId: 'user-1',
    productCode: 'basic-sandbox',
    planCode: 'basic',
    priceCode: 'basic-monthly-pln-v1',
    provider: 'stripe',
    providerStatus: state === 'granted' ? 'active' : state,
    accessState: state,
    currentPeriodStart: '2026-05-01T00:00:00.000Z',
    currentPeriodEnd: '2026-06-01T00:00:00.000Z',
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    entitlements,
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}

function baseUser(): OmBillingUser {
  return {
    id: 'user-1',
    email: 'owner@example.com',
    openMercatoCustomerPersonId: '99999999-9999-4999-8999-999999999999',
    coderUserId: null,
    coderUsername: null,
    coderTempPassword: null,
  };
}

test('startSubscriptionCheckout calls OM checkout with the user CRM person id', async () => {
  const state = makeState(baseUser());
  const checkoutCalls: Array<Record<string, unknown>> = [];
  const deps = buildDeps(state, {
    createSubscriptionCheckout: (async (input: unknown) => {
      checkoutCalls.push(input as Record<string, unknown>);
      return {
        checkoutUrl: 'https://stripe.test/checkout/abc',
        provider: 'stripe',
        subscriptionRequestId: '88888888-8888-4888-8888-888888888888',
      } satisfies CreateSubscriptionCheckoutResponse;
    }) as unknown as OmBillingDependencies['createSubscriptionCheckout'],
  });

  const result = await startSubscriptionCheckout(
    { userId: 'user-1', baseUrl: 'https://app.example' },
    deps,
  );
  assert.equal(result.checkoutUrl, 'https://stripe.test/checkout/abc');
  assert.equal(result.subscriptionRequestId, '88888888-8888-4888-8888-888888888888');
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0]!.externalAccountId, 'user-1');
  assert.equal(checkoutCalls[0]!.subjectEntityId, '99999999-9999-4999-8999-999999999999');
  assert.equal(checkoutCalls[0]!.successUrl, 'https://app.example/billing?status=success');
  assert.equal(checkoutCalls[0]!.cancelUrl, 'https://app.example/billing?status=cancelled');
  assert.equal(state.billingOrders.length, 1);
  assert.equal(state.billingOrders[0]!.provider, 'om_stripe');
});

test('startSubscriptionCheckout refuses when CRM person id is missing', async () => {
  const user = baseUser();
  user.openMercatoCustomerPersonId = null;
  const state = makeState(user);
  const deps = buildDeps(state);
  await assert.rejects(
    () => startSubscriptionCheckout({ userId: 'user-1', baseUrl: 'https://app.example' }, deps),
    (err: unknown) => {
      assert.ok(err instanceof OmBillingError);
      assert.equal(err.code, 'crm_customer_missing');
      assert.equal(err.status, 409);
      return true;
    },
  );
});

test('startSubscriptionPortal calls OM portal with the user external account id', async () => {
  const state = makeState(baseUser());
  const portalCalls: Array<Record<string, unknown>> = [];
  const deps = buildDeps(state, {
    createSubscriptionPortal: (async (input: unknown) => {
      portalCalls.push(input as Record<string, unknown>);
      return {
        portalUrl: 'https://billing.stripe.test/session/abc',
      } satisfies CreateSubscriptionPortalResponse;
    }) as unknown as OmBillingDependencies['createSubscriptionPortal'],
  });

  const result = await startSubscriptionPortal(
    { userId: 'user-1', baseUrl: 'https://app.example' },
    deps,
  );

  assert.equal(result.portalUrl, 'https://billing.stripe.test/session/abc');
  assert.equal(portalCalls.length, 1);
  assert.equal(portalCalls[0]!.externalAccountId, 'user-1');
  assert.equal(portalCalls[0]!.returnUrl, 'https://app.example/billing');
  assert.equal(state.billingOrders.length, 0);
});

test('reconcileLlmAccessForUser provisions OpenRouter key when access becomes granted', async () => {
  const state = makeState(baseUser());
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => makeSnapshot('granted')) as unknown as OmBillingDependencies['getSubscriptionAccess'],
  });
  const result = await reconcileLlmAccessForUser('user-1', deps);
  assert.equal(result.accessSnapshot.accessState, 'granted');
  assert.equal(result.llmAccountStatus, 'active');
  assert.equal(result.changed, true);
  assert.equal(state.llmAccounts.length, 1);
  assert.equal(state.llmAccounts[0]!.status, 'active');
  assert.equal(state.llmAccounts[0]!.coderSecretSyncState, 'pending');
  assert.equal(state.llmAccounts[0]!.limitUsd, 50);
  assert.equal(state.usageSnapshots.length, 1);
  assert.equal(state.users[0]!.coderUserId, 'coder-user-1');
});

test('reconcileLlmAccessForUser is a no-op when access is granted and account already active at the right limit', async () => {
  const state = makeState(baseUser(), {
    id: 'llm-existing',
    userId: 'user-1',
    provider: 'openrouter',
    openrouterKeyHash: 'hash-existing',
    openrouterKeyLabel: 'open-mercato-user-1',
    status: 'active',
    coderSecretSyncState: 'synced',
    limitUsd: 50,
    limitReset: null,
    lastSyncedAt: new Date('2026-05-01T00:00:00.000Z'),
  });
  state.users[0]!.coderUserId = 'coder-user-1';
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => makeSnapshot('granted')) as unknown as OmBillingDependencies['getSubscriptionAccess'],
  });
  const result = await reconcileLlmAccessForUser('user-1', deps);
  assert.equal(result.changed, false);
  assert.equal(result.llmAccountStatus, 'active');
  assert.equal(state.usageSnapshots.length, 0);
});

test('reconcileLlmAccessForUser rotates key when workspace billing secrets are missing', async () => {
  const state = makeState(baseUser(), {
    id: 'llm-existing',
    userId: 'user-1',
    provider: 'openrouter',
    openrouterKeyHash: 'hash-existing',
    openrouterKeyLabel: 'open-mercato-user-1',
    status: 'active',
    coderSecretSyncState: 'synced',
    limitUsd: 50,
    limitReset: null,
    lastSyncedAt: new Date('2026-05-01T00:00:00.000Z'),
  });
  state.users[0]!.coderUserId = 'coder-user-1';
  state.sandboxes.push({
    userId: 'user-1',
    status: 'ready',
    workspaceCredsSecretName: 'mercato-workspace-creds-sandbox-1',
  });

  const upsertedSecrets: Array<{ secretName: string; key: string }> = [];
  const deletedKeys: string[] = [];
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => makeSnapshot('granted')) as unknown as OmBillingDependencies['getSubscriptionAccess'],
    createOpenRouterKey: (async (input: { name: string; limit: number | null }) => ({
      hash: 'hash-replacement',
      label: input.name,
      name: input.name,
      limit: input.limit ?? 0,
      limit_remaining: input.limit ?? 0,
      limit_reset: null,
      usage: 0,
      usage_monthly: 0,
      disabled: false,
      key: 'sk-replacement',
    })) as unknown as OmBillingDependencies['createOpenRouterKey'],
    deleteOpenRouterKey: (async (hash: string) => {
      deletedKeys.push(hash);
    }) as unknown as OmBillingDependencies['deleteOpenRouterKey'],
    upsertWorkspaceBillingSecrets: (async (
      secretName: string,
      env: { OPENROUTER_API_KEY: string },
    ) => {
      upsertedSecrets.push({ secretName, key: env.OPENROUTER_API_KEY });
      state.workspaceSecrets.set(secretName, {
        OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
        ANTHROPIC_AUTH_TOKEN: env.OPENROUTER_API_KEY,
      });
    }) as unknown as OmBillingDependencies['upsertWorkspaceBillingSecrets'],
  });

  const result = await reconcileLlmAccessForUser('user-1', deps);

  assert.equal(result.changed, true);
  assert.equal(result.llmAccountStatus, 'active');
  assert.equal(state.llmAccounts[0]!.openrouterKeyHash, 'hash-replacement');
  assert.equal(state.llmAccounts[0]!.coderSecretSyncState, 'synced');
  assert.deepEqual(upsertedSecrets, [
    { secretName: 'mercato-workspace-creds-sandbox-1', key: 'sk-replacement' },
  ]);
  assert.deepEqual(deletedKeys, ['hash-existing']);
});

test('reconcileLlmAccessForUser copies an existing workspace billing key into a new workspace secret', async () => {
  const state = makeState(baseUser(), {
    id: 'llm-existing',
    userId: 'user-1',
    provider: 'openrouter',
    openrouterKeyHash: 'hash-existing',
    openrouterKeyLabel: 'open-mercato-user-1',
    status: 'active',
    coderSecretSyncState: 'synced',
    limitUsd: 50,
    limitReset: null,
    lastSyncedAt: new Date('2026-05-01T00:00:00.000Z'),
  });
  state.users[0]!.coderUserId = 'coder-user-1';
  state.sandboxes.push(
    {
      userId: 'user-1',
      status: 'ready',
      workspaceCredsSecretName: 'mercato-workspace-creds-existing',
    },
    {
      userId: 'user-1',
      status: 'building',
      workspaceCredsSecretName: 'mercato-workspace-creds-new',
    },
  );
  state.workspaceSecrets.set('mercato-workspace-creds-existing', {
    OPENROUTER_API_KEY: 'sk-existing',
    ANTHROPIC_AUTH_TOKEN: 'sk-existing',
  });

  const upsertedSecrets: Array<{ secretName: string; key: string }> = [];
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => makeSnapshot('granted')) as unknown as OmBillingDependencies['getSubscriptionAccess'],
    createOpenRouterKey: (async (input: { name: string; limit: number | null }) => ({
      hash: 'hash-owner-session',
      label: input.name,
      name: input.name,
      limit: input.limit ?? 0,
      limit_remaining: input.limit ?? 0,
      limit_reset: null,
      usage: 0,
      usage_monthly: 0,
      disabled: false,
      key: 'sk-owner-session',
    })) as unknown as OmBillingDependencies['createOpenRouterKey'],
    upsertWorkspaceBillingSecrets: (async (
      secretName: string,
      env: { OPENROUTER_API_KEY: string },
    ) => {
      upsertedSecrets.push({ secretName, key: env.OPENROUTER_API_KEY });
      state.workspaceSecrets.set(secretName, {
        OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
        ANTHROPIC_AUTH_TOKEN: env.OPENROUTER_API_KEY,
      });
    }) as unknown as OmBillingDependencies['upsertWorkspaceBillingSecrets'],
  });

  const result = await reconcileLlmAccessForUser('user-1', deps);

  assert.equal(result.changed, false);
  assert.equal(result.llmAccountStatus, 'active');
  assert.deepEqual(upsertedSecrets, [
    { secretName: 'mercato-workspace-creds-new', key: 'sk-existing' },
  ]);
});

test('reconcileLlmAccessForUser suspends active account when access drops to blocked', async () => {
  const state = makeState(baseUser(), {
    id: 'llm-existing',
    userId: 'user-1',
    provider: 'openrouter',
    openrouterKeyHash: 'hash-existing',
    openrouterKeyLabel: 'open-mercato-user-1',
    status: 'active',
    coderSecretSyncState: 'synced',
    limitUsd: 50,
    limitReset: null,
    lastSyncedAt: new Date('2026-05-01T00:00:00.000Z'),
  });
  const disableCalls: string[] = [];
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => makeSnapshot('blocked')) as unknown as OmBillingDependencies['getSubscriptionAccess'],
    disableOpenRouterKey: (async (hash: string) => {
      disableCalls.push(hash);
      return { hash, disabled: true } as OpenRouterApiKeyRecord;
    }) as unknown as OmBillingDependencies['disableOpenRouterKey'],
  });
  const result = await reconcileLlmAccessForUser('user-1', deps);
  assert.equal(result.accessSnapshot.accessState, 'blocked');
  assert.equal(result.llmAccountStatus, 'suspended');
  assert.equal(result.changed, true);
  assert.deepEqual(disableCalls, ['hash-existing']);
  assert.equal(state.llmAccounts[0]!.status, 'suspended');
});

test('assertActiveSandboxEntitlement throws 402 when access is pending', async () => {
  const state = makeState(baseUser());
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => makeSnapshot('pending', null)) as unknown as OmBillingDependencies['getSubscriptionAccess'],
  });
  await assert.rejects(
    () => assertActiveSandboxEntitlement('user-1', deps),
    (err: unknown) => {
      assert.ok(err instanceof OmBillingError);
      assert.equal(err.status, 402);
      assert.equal(err.code, 'ai_entitlement_required');
      return true;
    },
  );
});

test('getOmBillingSummaryForUser blocks sandbox creation when quota is reached', async () => {
  const state = makeState(baseUser(), {
    id: 'llm-existing',
    userId: 'user-1',
    provider: 'openrouter',
    openrouterKeyHash: 'hash-existing',
    openrouterKeyLabel: 'open-mercato-user-1',
    status: 'active',
    coderSecretSyncState: 'synced',
    limitUsd: 50,
    limitReset: null,
    lastSyncedAt: new Date('2026-05-01T00:00:00.000Z'),
  });
  state.sandboxes.push({ userId: 'user-1', status: 'ready' });
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => makeSnapshot('granted')) as unknown as OmBillingDependencies['getSubscriptionAccess'],
  });

  const summary = await getOmBillingSummaryForUser('user-1', deps);
  assert.equal(summary.sandboxQuota.limit, 1);
  assert.equal(summary.sandboxQuota.used, 1);
  assert.equal(summary.sandboxQuota.remaining, 0);
  assert.equal(summary.sandboxQuota.reached, true);
  assert.equal(summary.canCreateSandbox, false);
});

test('getOmBillingSummaryForUser ignores failed sandboxes for quota', async () => {
  const state = makeState(baseUser(), {
    id: 'llm-existing',
    userId: 'user-1',
    provider: 'openrouter',
    openrouterKeyHash: 'hash-existing',
    openrouterKeyLabel: 'open-mercato-user-1',
    status: 'active',
    coderSecretSyncState: 'synced',
    limitUsd: 50,
    limitReset: null,
    lastSyncedAt: new Date('2026-05-01T00:00:00.000Z'),
  });
  state.sandboxes.push({ userId: 'user-1', status: 'failed' });
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => makeSnapshot('granted')) as unknown as OmBillingDependencies['getSubscriptionAccess'],
  });

  const summary = await getOmBillingSummaryForUser('user-1', deps);
  assert.equal(summary.sandboxQuota.limit, 1);
  assert.equal(summary.sandboxQuota.used, 0);
  assert.equal(summary.sandboxQuota.remaining, 1);
  assert.equal(summary.canCreateSandbox, true);
});

test('getOmBillingSummaryForUser blocks sandbox creation when quota entitlement is invalid', async () => {
  const state = makeState(baseUser(), {
    id: 'llm-existing',
    userId: 'user-1',
    provider: 'openrouter',
    openrouterKeyHash: 'hash-existing',
    openrouterKeyLabel: 'open-mercato-user-1',
    status: 'active',
    coderSecretSyncState: 'synced',
    limitUsd: 50,
    limitReset: null,
    lastSyncedAt: new Date('2026-05-01T00:00:00.000Z'),
  });
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => makeSnapshot('granted', { openRouterTokensUsageUsd: 50 })) as unknown as OmBillingDependencies['getSubscriptionAccess'],
  });

  const summary = await getOmBillingSummaryForUser('user-1', deps);
  assert.equal(summary.sandboxQuota.valid, false);
  assert.equal(summary.sandboxQuota.limit, null);
  assert.equal(summary.canCreateSandbox, false);
});

test('verifyOmWebhookSignature accepts a valid signature and rejects a bad one', () => {
  const secret = 'shh';
  const body = '{"externalAccountId":"u1"}';
  const valid = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyOmWebhookSignature(body, valid, secret), true);
  assert.equal(verifyOmWebhookSignature(body, 'deadbeef', secret), false);
  assert.equal(verifyOmWebhookSignature(body, null, secret), false);
});

test('processOmAccessChangedWebhook is idempotent for duplicate delivery ids', async () => {
  process.env.OM_BILLING_WEBHOOK_SECRET = 'test-secret';
  const state = makeState(baseUser());
  let calls = 0;
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => {
      calls += 1;
      return makeSnapshot('granted');
    }) as unknown as OmBillingDependencies['getSubscriptionAccess'],
  });
  const payload = {
    externalAccountId: 'user-1',
    productCode: 'basic-sandbox',
    accessState: 'granted' as const,
    subscriptionId: 'sub-1',
    entitlements: { sandboxCount: 1, openRouterTokensUsageUsd: 50 },
  };
  const rawBody = JSON.stringify(payload);
  const signature = signOmWebhookPayload(rawBody, 'test-secret');

  const first = await processOmAccessChangedWebhook(
    { rawBody, signature, deliveryId: 'evt-1' },
    deps,
  );
  assert.equal(first.already_processed, false);
  assert.equal(first.user_id, 'user-1');
  const second = await processOmAccessChangedWebhook(
    { rawBody, signature, deliveryId: 'evt-1' },
    deps,
  );
  assert.equal(second.already_processed, true);
  assert.equal(calls, 1);
  delete process.env.OM_BILLING_WEBHOOK_SECRET;
});

test('processOmAccessChangedWebhook rejects payloads with bad signature', async () => {
  process.env.OM_BILLING_WEBHOOK_SECRET = 'test-secret';
  const state = makeState(baseUser());
  const deps = buildDeps(state);
  const rawBody = '{"externalAccountId":"user-1","productCode":"basic-sandbox","accessState":"granted"}';
  await assert.rejects(
    () => processOmAccessChangedWebhook(
      { rawBody, signature: 'deadbeef', deliveryId: 'evt-2' },
      deps,
    ),
    (err: unknown) => {
      assert.ok(err instanceof OmBillingError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'invalid_webhook_signature');
      return true;
    },
  );
  delete process.env.OM_BILLING_WEBHOOK_SECRET;
});

test('processOmAccessChangedWebhook ignores events for other product codes', async () => {
  process.env.OM_BILLING_WEBHOOK_SECRET = 'test-secret';
  const state = makeState(baseUser());
  let reconcileCalls = 0;
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => {
      reconcileCalls += 1;
      return makeSnapshot('granted');
    }) as unknown as OmBillingDependencies['getSubscriptionAccess'],
  });
  const payload = {
    externalAccountId: 'user-1',
    productCode: 'other-product',
    accessState: 'granted' as const,
  };
  const rawBody = JSON.stringify(payload);
  const signature = signOmWebhookPayload(rawBody, 'test-secret');
  const result = await processOmAccessChangedWebhook(
    { rawBody, signature, deliveryId: 'evt-3' },
    deps,
  );
  assert.equal(result.already_processed, true);
  assert.equal(reconcileCalls, 0);
  delete process.env.OM_BILLING_WEBHOOK_SECRET;
});
