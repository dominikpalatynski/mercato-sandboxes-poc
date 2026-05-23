import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import type { QueryResult, QueryResultRow } from 'pg';

import {
  assertActiveSandboxEntitlement,
  OmBillingError,
  processOmAccessChangedWebhook,
  reconcileLlmAccessForUser,
  signOmWebhookPayload,
  startSubscriptionCheckout,
  verifyOmWebhookSignature,
  type OmBillingDependencies,
} from '../lib/om-billing';
import type { OpenRouterApiKeyRecord } from '../lib/openrouter';
import type {
  CreateSubscriptionCheckoutResponse,
  SubscriptionAccessSnapshot,
} from '../lib/openmercato-subscriptions';
import type { CoderUserRef } from '../lib/coder';

type UserRow = {
  id: string;
  email: string;
  openmercato_customer_person_id: string | null;
  coder_user_id: string | null;
  coder_username: string | null;
  coder_temp_password: string | null;
};

type LlmAccountState = {
  id: string;
  user_id: string;
  provider: string;
  openrouter_key_hash: string;
  openrouter_key_label: string;
  status: string;
  coder_secret_sync_state: string;
  limit_usd: number;
  limit_reset: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type BillingEventState = {
  id: string;
  provider: string;
  provider_event_id: string;
  event_type: string;
  payload_json: Record<string, unknown>;
  processed_at: string | null;
};

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function ok<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    rows,
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  } as QueryResult<T>;
}

type State = {
  users: UserRow[];
  llmAccounts: LlmAccountState[];
  billingEvents: BillingEventState[];
  billingOrders: Array<{ id: string; user_id: string; provider: string; provider_order_id: string }>;
  usageSnapshots: Array<{ llm_account_id: string }>;
};

function makeState(initialUser: UserRow, initialAccount?: LlmAccountState): State {
  return {
    users: [{ ...initialUser }],
    llmAccounts: initialAccount ? [{ ...initialAccount }] : [],
    billingEvents: [],
    billingOrders: [],
    usageSnapshots: [],
  };
}

function makeQuery(state: State) {
  return async function query<T extends QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const n = normalize(sql);

    if (n.startsWith('select id, email, openmercato_customer_person_id')) {
      const user = state.users.find((u) => u.id === params[0]);
      return ok((user ? [user] : []) as unknown as T[]);
    }
    if (
      n.startsWith('select id, user_id, provider, openrouter_key_hash')
      && n.includes('from llm_accounts')
    ) {
      const account = state.llmAccounts.find((a) => a.user_id === params[0]);
      return ok((account ? [account] : []) as unknown as T[]);
    }
    if (
      n.startsWith('insert into llm_accounts')
    ) {
      const userId = params[0] as string;
      const keyHash = params[1] as string;
      const keyLabel = params[2] as string;
      const status = params[3] as string;
      const syncState = params[4] as string;
      const limitUsd = Number(params[5]);
      const limitReset = (params[6] as string | null) ?? null;
      const existing = state.llmAccounts.find((a) => a.user_id === userId);
      if (existing) {
        existing.openrouter_key_hash = keyHash;
        existing.openrouter_key_label = keyLabel;
        existing.status = status;
        existing.coder_secret_sync_state = syncState;
        existing.limit_usd = limitUsd;
        existing.limit_reset = limitReset;
        existing.last_synced_at = new Date().toISOString();
        existing.updated_at = new Date().toISOString();
        return ok([{ id: existing.id }] as unknown as T[]);
      }
      const created: LlmAccountState = {
        id: `llm-${state.llmAccounts.length + 1}`,
        user_id: userId,
        provider: 'openrouter',
        openrouter_key_hash: keyHash,
        openrouter_key_label: keyLabel,
        status,
        coder_secret_sync_state: syncState,
        limit_usd: limitUsd,
        limit_reset: limitReset,
        last_synced_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.llmAccounts.push(created);
      return ok([{ id: created.id }] as unknown as T[]);
    }
    if (n.startsWith('insert into llm_usage_snapshots')) {
      state.usageSnapshots.push({ llm_account_id: params[0] as string });
      return ok([] as T[]);
    }
    if (n.startsWith('select usage_total_usd, usage_monthly_usd, limit_remaining_usd, observed_at')) {
      return ok([] as T[]);
    }
    if (n.startsWith('update users')) {
      const user = state.users.find((u) => u.id === params[3]);
      if (user) {
        user.coder_user_id = params[0] as string;
        user.coder_username = params[1] as string;
        user.coder_temp_password = params[2] as string | null;
      }
      return ok([] as T[]);
    }
    if (n.startsWith('select id, processed_at from billing_events')) {
      const event = state.billingEvents.find((e) => e.provider_event_id === params[0]);
      return ok((event ? [{ id: event.id, processed_at: event.processed_at }] : []) as unknown as T[]);
    }
    if (n.startsWith('insert into billing_events')) {
      state.billingEvents.push({
        id: `evt-${state.billingEvents.length + 1}`,
        provider: params[0] as string,
        provider_event_id: params[1] as string,
        event_type: params[2] as string,
        payload_json: JSON.parse(params[3] as string),
        processed_at: null,
      });
      return ok([] as T[]);
    }
    if (n.startsWith('update billing_events')) {
      const event = state.billingEvents.find((e) => e.provider_event_id === params[0]);
      if (event) event.processed_at = new Date().toISOString();
      return ok([] as T[]);
    }
    if (n.startsWith('insert into billing_orders')) {
      state.billingOrders.push({
        id: `order-${state.billingOrders.length + 1}`,
        user_id: params[0] as string,
        provider: params[1] as string,
        provider_order_id: params[2] as string,
      });
      return ok([] as T[]);
    }
    if (n.startsWith('update llm_accounts')) {
      const account = state.llmAccounts.find((a) => a.id === params[0]);
      if (account) account.status = 'suspended';
      return ok([] as T[]);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
}

function makeWithTransaction(query: ReturnType<typeof makeQuery>) {
  return async function withTransaction<T>(fn: (db: { query: typeof query }) => Promise<T>): Promise<T> {
    return fn({ query });
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

function buildDeps(
  state: State,
  overrides: Partial<OmBillingDependencies> = {},
): OmBillingDependencies {
  const query = makeQuery(state);
  const router = makeOpenRouter();
  const ensureCoderUser: (email: string) => Promise<CoderUserRef> = async (email) => ({
    id: 'coder-user-1',
    username: email.split('@')[0]!,
    tempPassword: 'temp',
  });
  return {
    query: query as unknown as OmBillingDependencies['query'],
    withTransaction: makeWithTransaction(query) as unknown as OmBillingDependencies['withTransaction'],
    ensureCoderUser,
    upsertUserSecret: (async () => {}) as unknown as OmBillingDependencies['upsertUserSecret'],
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

function baseUser(): UserRow {
  return {
    id: 'user-1',
    email: 'owner@example.com',
    openmercato_customer_person_id: '99999999-9999-4999-8999-999999999999',
    coder_user_id: null,
    coder_username: null,
    coder_temp_password: null,
  };
}

test('startSubscriptionCheckout calls OM checkout with the user CRM person id', async () => {
  const state = makeState(baseUser());
  const checkoutCalls: Array<Record<string, unknown>> = [];
  const deps = buildDeps(state, {
    createSubscriptionCheckout: (async (input) => {
      checkoutCalls.push(input as unknown as Record<string, unknown>);
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
  user.openmercato_customer_person_id = null;
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
  assert.equal(state.llmAccounts[0]!.coder_secret_sync_state, 'synced');
  assert.equal(state.llmAccounts[0]!.limit_usd, 50);
  assert.equal(state.usageSnapshots.length, 1);
  // Coder user was created on-demand
  assert.equal(state.users[0]!.coder_user_id, 'coder-user-1');
});

test('reconcileLlmAccessForUser is a no-op when access is granted and account already active at the right limit', async () => {
  const state = makeState(baseUser(), {
    id: 'llm-existing',
    user_id: 'user-1',
    provider: 'openrouter',
    openrouter_key_hash: 'hash-existing',
    openrouter_key_label: 'open-mercato-user-1',
    status: 'active',
    coder_secret_sync_state: 'synced',
    limit_usd: 50,
    limit_reset: null,
    last_synced_at: '2026-05-01T00:00:00.000Z',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  });
  state.users[0]!.coder_user_id = 'coder-user-1';
  const deps = buildDeps(state, {
    getSubscriptionAccess: (async () => makeSnapshot('granted')) as unknown as OmBillingDependencies['getSubscriptionAccess'],
  });
  const result = await reconcileLlmAccessForUser('user-1', deps);
  assert.equal(result.changed, false);
  assert.equal(result.llmAccountStatus, 'active');
  assert.equal(state.usageSnapshots.length, 0);
});

test('reconcileLlmAccessForUser suspends active account when access drops to blocked', async () => {
  const state = makeState(baseUser(), {
    id: 'llm-existing',
    user_id: 'user-1',
    provider: 'openrouter',
    openrouter_key_hash: 'hash-existing',
    openrouter_key_label: 'open-mercato-user-1',
    status: 'active',
    coder_secret_sync_state: 'synced',
    limit_usd: 50,
    limit_reset: null,
    last_synced_at: '2026-05-01T00:00:00.000Z',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
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
  // reconcile must only run on first delivery
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
