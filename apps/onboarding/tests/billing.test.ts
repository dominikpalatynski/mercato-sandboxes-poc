import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResult, QueryResultRow } from 'pg';

import {
  assertActiveSandboxEntitlement,
  BillingError,
  createBillingCheckout,
  processPayByLinkPaymentWebhook,
  type BillingDependencies,
} from '../lib/billing';

type UserState = {
  id: string;
  email: string;
  coder_user_id: string | null;
  coder_username: string | null;
  coder_temp_password: string | null;
};

type OrderState = {
  id: string;
  user_id: string;
  provider_order_id: string | null;
  status: string;
  plan_type: 'activation' | 'topup';
  amount_pln: number;
  credits_usd: number;
  created_at: string;
  paid_at: string | null;
};

type EventState = {
  id: string;
  provider_event_id: string;
  order_id: string | null;
  processed_at: string | null;
  payload_json: Record<string, unknown>;
};

type AccountState = {
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

type UsageState = {
  llm_account_id: string;
  usage_total_usd: number;
  usage_monthly_usd: number;
  limit_remaining_usd: number;
  observed_at: string;
};

type ProviderKeyState = {
  hash: string;
  label: string;
  name: string | null;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: null;
  usage: number;
  usage_monthly: number;
  disabled: boolean;
  key: string;
};

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function result<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return {
    command: 'SELECT',
    fields: [],
    oid: 0,
    rowCount,
    rows,
  };
}

function createContext(args?: {
  users?: UserState[];
  orders?: OrderState[];
  events?: EventState[];
  accounts?: AccountState[];
  usage?: UsageState[];
  providerKeys?: ProviderKeyState[];
}) {
  const state = {
    users: [...(args?.users ?? [])],
    orders: [...(args?.orders ?? [])],
    events: [...(args?.events ?? [])],
    accounts: [...(args?.accounts ?? [])],
    usage: [...(args?.usage ?? [])],
    providerKeys: new Map((args?.providerKeys ?? []).map((key) => [key.hash, { ...key }])),
    secretWrites: [] as Array<{ user: string; name: string; value: string }>,
  };

  let orderSeq = state.orders.length + 1;
  let eventSeq = state.events.length + 1;
  let accountSeq = state.accounts.length + 1;
  let providerSeq = state.providerKeys.size + 1;

  const db = {
    async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const text = normalizeSql(sql);

      if (text.startsWith('select id, email, coder_user_id, coder_username, coder_temp_password from users where id = $1')) {
        const user = state.users.find((item) => item.id === params[0]);
        return result((user ? [user] : []) as unknown as T[], user ? 1 : 0);
      }

      if (text.startsWith('update users set coder_user_id = $1, coder_username = $2, coder_temp_password = $3 where id = $4')) {
        const user = state.users.find((item) => item.id === params[3]);
        if (user) {
          user.coder_user_id = String(params[0]);
          user.coder_username = String(params[1]);
          user.coder_temp_password = String(params[2]);
        }
        return result([] as T[], user ? 1 : 0);
      }

      if (text.includes('from llm_accounts where user_id = $1')) {
        const account = state.accounts.find((item) => item.user_id === params[0]) ?? null;
        return result((account ? [account] : []) as unknown as T[], account ? 1 : 0);
      }

      if (text.startsWith('insert into billing_orders (')) {
        const order: OrderState = {
          id: `order-${orderSeq++}`,
          user_id: String(params[0]),
          provider_order_id: null,
          status: 'pending',
          plan_type: params[1] as 'activation' | 'topup',
          amount_pln: Number(params[2]),
          credits_usd: Number(params[3]),
          created_at: new Date().toISOString(),
          paid_at: null,
        };
        state.orders.push(order);
        return result([{ id: order.id } as unknown as T], 1);
      }

      if (text.startsWith('update billing_orders set provider_order_id = $1, updated_at = now() where id = $2')) {
        const order = state.orders.find((item) => item.id === params[1]);
        if (order) order.provider_order_id = String(params[0]);
        return result([] as T[], order ? 1 : 0);
      }

      if (text.startsWith("update billing_orders set status = 'failed', updated_at = now() where id = $1")) {
        const order = state.orders.find((item) => item.id === params[0]);
        if (order) order.status = 'failed';
        return result([] as T[], order ? 1 : 0);
      }

      if (text.startsWith('select id, order_id, processed_at from billing_events where provider_event_id = $1')) {
        const event = state.events.find((item) => item.provider_event_id === params[0]) ?? null;
        return result((event ? [event] : []) as unknown as T[], event ? 1 : 0);
      }

      if (text.startsWith('select id, user_id, provider_order_id, status, plan_type, amount_pln, credits_usd, created_at, paid_at from billing_orders where provider_order_id = $1 or id = $2')) {
        const order = state.orders.find(
          (item) => item.provider_order_id === params[0] || item.id === params[1],
        ) ?? null;
        return result((order ? [order] : []) as unknown as T[], order ? 1 : 0);
      }

      if (text.startsWith('insert into billing_events (')) {
        const event: EventState = {
          id: `event-${eventSeq++}`,
          provider_event_id: String(params[0]),
          order_id: params[1] == null ? null : String(params[1]),
          processed_at: null,
          payload_json: JSON.parse(String(params[2])),
        };
        state.events.push(event);
        return result([] as T[], 1);
      }

      if (text.startsWith("update billing_events set order_id = $2, event_type = 'payment.completed', payload_json = $3::jsonb where provider_event_id = $1")) {
        const event = state.events.find((item) => item.provider_event_id === params[0]);
        if (event) {
          event.order_id = params[1] == null ? null : String(params[1]);
          event.payload_json = JSON.parse(String(params[2]));
        }
        return result([] as T[], event ? 1 : 0);
      }

      if (text.startsWith('insert into llm_accounts (')) {
        const existing = state.accounts.find((item) => item.user_id === params[0]);
        const target = existing ?? {
          id: `llm-${accountSeq++}`,
          user_id: String(params[0]),
          provider: 'openrouter',
          openrouter_key_hash: '',
          openrouter_key_label: '',
          status: '',
          coder_secret_sync_state: '',
          limit_usd: 0,
          limit_reset: null,
          last_synced_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        target.provider = 'openrouter';
        target.openrouter_key_hash = String(params[1]);
        target.openrouter_key_label = String(params[2]);
        target.status = String(params[3]);
        target.coder_secret_sync_state = String(params[4]);
        target.limit_usd = Number(params[5]);
        target.limit_reset = params[6] == null ? null : String(params[6]);
        target.last_synced_at = new Date().toISOString();
        target.updated_at = new Date().toISOString();
        if (!existing) state.accounts.push(target);
        return result([{ id: target.id } as unknown as T], 1);
      }

      if (text.startsWith('insert into llm_usage_snapshots (')) {
        state.usage.push({
          llm_account_id: String(params[0]),
          usage_total_usd: Number(params[1]),
          usage_monthly_usd: Number(params[2]),
          limit_remaining_usd: Number(params[3]),
          observed_at: new Date().toISOString(),
        });
        return result([] as T[], 1);
      }

      if (text.startsWith("update billing_orders set status = 'paid', paid_at = coalesce(paid_at, now()), updated_at = now() where id = $1")) {
        const order = state.orders.find((item) => item.id === params[0]);
        if (order) {
          order.status = 'paid';
          order.paid_at = order.paid_at ?? new Date().toISOString();
        }
        return result([] as T[], order ? 1 : 0);
      }

      if (text.startsWith('update billing_events set processed_at = now() where provider_event_id = $1')) {
        const event = state.events.find((item) => item.provider_event_id === params[0]);
        if (event) event.processed_at = new Date().toISOString();
        return result([] as T[], event ? 1 : 0);
      }

      if (text.startsWith('select id, user_id, provider_order_id, status, plan_type, amount_pln, credits_usd, created_at, paid_at from billing_orders where user_id = $1 order by created_at desc limit 1')) {
        const order = state.orders.filter((item) => item.user_id === params[0]).at(-1) ?? null;
        return result((order ? [order] : []) as unknown as T[], order ? 1 : 0);
      }

      if (text.startsWith("select exists( select 1 from billing_orders where user_id = $1 and status = 'paid' ) as has_paid_order")) {
        const hasPaidOrder = state.orders.some(
          (item) => item.user_id === params[0] && item.status === 'paid',
        );
        return result([{ has_paid_order: hasPaidOrder } as unknown as T], 1);
      }

      if (text.startsWith('select usage_total_usd, usage_monthly_usd, limit_remaining_usd, observed_at from llm_usage_snapshots where llm_account_id = $1 order by observed_at desc limit 1')) {
        const usage = state.usage.filter((item) => item.llm_account_id === params[0]).at(-1) ?? null;
        return result((usage ? [usage] : []) as unknown as T[], usage ? 1 : 0);
      }

      throw new Error(`Unhandled SQL in test double: ${text}`);
    },
  };

  const deps: BillingDependencies = {
    query: db.query,
    withTransaction: async (fn) => fn(db),
    ensureCoderUser: async (email) => ({
      id: 'coder-user-1',
      username: email.split('@')[0] || 'user',
      tempPassword: 'temp-password',
    }),
    upsertUserSecret: async (user, input) => {
      state.secretWrites.push({ user, name: input.name, value: input.value });
      return {
        id: `secret-${state.secretWrites.length}`,
        name: input.name,
        description: input.description ?? null,
        env_name: input.env_name ?? null,
        file_path: input.file_path ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },
    createPayByLinkCheckoutSession: async () => ({
      providerOrderId: `provider-order-${state.orders.length || 1}`,
      paymentUrl: 'https://pay.example.test/checkout',
    }),
    verifyPayByLinkWebhook: () => ({
      provider: 'paybylink',
      providerEventId: 'provider-order-1:1',
      providerOrderId: 'provider-order-1',
      localOrderId: 'order-1',
      amountPln: 200,
      email: 'user@example.com',
      paymentType: 'transfer',
      notificationAttempt: 1,
      rawPayload: { ok: true },
    }),
    createOpenRouterKey: async ({ name, limit }) => {
      const key: ProviderKeyState = {
        hash: `hash-${providerSeq}`,
        label: name,
        name,
        limit,
        limit_remaining: limit,
        limit_reset: null,
        usage: 0,
        usage_monthly: 0,
        disabled: false,
        key: `raw-${providerSeq}`,
      };
      providerSeq += 1;
      state.providerKeys.set(key.hash, key);
      return key;
    },
    getOpenRouterKey: async (hash) => {
      const key = state.providerKeys.get(hash);
      if (!key) throw new Error(`Missing provider key ${hash}`);
      return key;
    },
    updateOpenRouterKey: async (hash, input) => {
      const key = state.providerKeys.get(hash);
      if (!key) throw new Error(`Missing provider key ${hash}`);
      key.name = input.name ?? key.name;
      key.label = input.name ?? key.label;
      if (input.limit !== undefined) {
        key.limit = input.limit;
        key.limit_remaining = input.limit;
      }
      if (input.disabled !== undefined) {
        key.disabled = input.disabled;
      }
      return key;
    },
    deleteOpenRouterKey: async (hash) => {
      state.providerKeys.delete(hash);
    },
    findOpenRouterKeyByName: async (name) =>
      [...state.providerKeys.values()].find((key) => key.name === name) ?? null,
  };

  return { state, deps };
}

test('createBillingCheckout creates a pending order and stores the provider order id', async () => {
  const { state, deps } = createContext({
    users: [
      {
        id: 'user-1',
        email: 'user@example.com',
        coder_user_id: null,
        coder_username: null,
        coder_temp_password: null,
      },
    ],
  });

  const result = await createBillingCheckout(
    {
      userId: 'user-1',
      planType: 'activation',
      creditsUsd: 50,
      baseUrl: 'https://sandbox.lvh.me',
    },
    deps,
  );

  assert.equal(result.order_id, 'order-1');
  assert.equal(result.plan_type, 'activation');
  assert.equal(state.orders.length, 1);
  assert.equal(state.orders[0]?.provider_order_id, 'provider-order-1');
  assert.equal(state.orders[0]?.status, 'pending');
});

test('processPayByLinkPaymentWebhook provisions the first LLM account and marks the order paid', async () => {
  const { state, deps } = createContext({
    users: [
      {
        id: 'user-1',
        email: 'user@example.com',
        coder_user_id: null,
        coder_username: null,
        coder_temp_password: null,
      },
    ],
    orders: [
      {
        id: 'order-1',
        user_id: 'user-1',
        provider_order_id: 'provider-order-1',
        status: 'pending',
        plan_type: 'activation',
        amount_pln: 200,
        credits_usd: 50,
        created_at: new Date().toISOString(),
        paid_at: null,
      },
    ],
  });

  const result = await processPayByLinkPaymentWebhook('ignored', deps);

  assert.equal(result.already_processed, false);
  assert.equal(result.retry_needed, false);
  assert.equal(state.orders[0]?.status, 'paid');
  assert.equal(state.users[0]?.coder_user_id, 'coder-user-1');
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0]?.status, 'active');
  assert.equal(state.accounts[0]?.coder_secret_sync_state, 'synced');
  assert.deepEqual(
    state.secretWrites.map((entry) => entry.name).sort(),
    ['ANTHROPIC_AUTH_TOKEN', 'OPENROUTER_API_KEY'],
  );
});

test('processPayByLinkPaymentWebhook is idempotent for repeated provider events', async () => {
  const { state, deps } = createContext({
    users: [
      {
        id: 'user-1',
        email: 'user@example.com',
        coder_user_id: 'coder-user-1',
        coder_username: 'user',
        coder_temp_password: 'temp-password',
      },
    ],
    orders: [
      {
        id: 'order-1',
        user_id: 'user-1',
        provider_order_id: 'provider-order-1',
        status: 'pending',
        plan_type: 'activation',
        amount_pln: 200,
        credits_usd: 50,
        created_at: new Date().toISOString(),
        paid_at: null,
      },
    ],
  });

  await processPayByLinkPaymentWebhook('ignored', deps);
  const second = await processPayByLinkPaymentWebhook('ignored', deps);

  assert.equal(second.already_processed, true);
  assert.equal(state.accounts.length, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.secretWrites.length, 2);
});

test('processPayByLinkPaymentWebhook tops up an existing account instead of creating a second one', async () => {
  const existingKey: ProviderKeyState = {
    hash: 'hash-1',
    label: 'open-mercato-user-1',
    name: 'open-mercato-user-1',
    limit: 50,
    limit_remaining: 50,
    limit_reset: null,
    usage: 0,
    usage_monthly: 0,
    disabled: false,
    key: 'raw-1',
  };
  const { state, deps } = createContext({
    users: [
      {
        id: 'user-1',
        email: 'user@example.com',
        coder_user_id: 'coder-user-1',
        coder_username: 'user',
        coder_temp_password: 'temp-password',
      },
    ],
    orders: [
      {
        id: 'order-1',
        user_id: 'user-1',
        provider_order_id: 'provider-order-1',
        status: 'pending',
        plan_type: 'topup',
        amount_pln: 200,
        credits_usd: 20,
        created_at: new Date().toISOString(),
        paid_at: null,
      },
    ],
    accounts: [
      {
        id: 'llm-1',
        user_id: 'user-1',
        provider: 'openrouter',
        openrouter_key_hash: 'hash-1',
        openrouter_key_label: existingKey.label,
        status: 'active',
        coder_secret_sync_state: 'synced',
        limit_usd: 50,
        limit_reset: null,
        last_synced_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    providerKeys: [existingKey],
  });

  const topupDeps: BillingDependencies = {
    ...deps,
    verifyPayByLinkWebhook: () => ({
      provider: 'paybylink',
      providerEventId: 'provider-order-1:1',
      providerOrderId: 'provider-order-1',
      localOrderId: 'order-1',
      amountPln: 200,
      email: 'user@example.com',
      paymentType: 'transfer',
      notificationAttempt: 1,
      rawPayload: { ok: true },
    }),
  };

  await processPayByLinkPaymentWebhook('ignored', topupDeps);

  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0]?.limit_usd, 70);
  assert.equal(state.providerKeys.size, 1);
  assert.equal(state.providerKeys.get('hash-1')?.limit, 70);
  assert.equal(state.secretWrites.length, 0);
});

test('assertActiveSandboxEntitlement rejects users without a paid synced AI account', async () => {
  const { deps } = createContext({
    users: [
      {
        id: 'user-1',
        email: 'user@example.com',
        coder_user_id: null,
        coder_username: null,
        coder_temp_password: null,
      },
    ],
  });

  await assert.rejects(
    () => assertActiveSandboxEntitlement('user-1', deps),
    (error: unknown) =>
      error instanceof BillingError && error.code === 'ai_entitlement_required',
  );
});
