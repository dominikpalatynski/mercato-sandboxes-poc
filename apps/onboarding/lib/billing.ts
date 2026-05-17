import type { QueryResultRow } from 'pg';

import {
  BILLING_ERROR_CODES,
  type BillingPlanType,
  type BillingSummary,
  type BillingOrderSummary,
  type LlmAccountSummary,
  type LlmUsageSnapshotSummary,
} from '@/lib/billing-types';
import {
  ensureCoderUser,
  upsertUserSecret,
  type CoderUserRef,
} from '@/lib/coder';
import {
  query,
  withTransaction,
  type DatabaseQueryable,
} from '@/lib/db';
import {
  buildOpenRouterKeyName,
  createOpenRouterKey,
  deleteOpenRouterKey,
  findOpenRouterKeyByName,
  getOpenRouterKey,
  updateOpenRouterKey,
  type OpenRouterLimitReset,
  type OpenRouterApiKeyRecord,
} from '@/lib/openrouter';
import {
  createPayByLinkCheckoutSession,
  verifyPayByLinkWebhook,
  type PayByLinkWebhookEvent,
} from '@/lib/paybylink';

export class BillingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

export interface CreateBillingCheckoutInput {
  userId: string;
  planType: BillingPlanType;
  creditsUsd: number;
  baseUrl: string;
}

export interface CreateBillingCheckoutResult {
  order_id: string;
  payment_url: string;
  amount_pln: number;
  credits_usd: number;
  plan_type: BillingPlanType;
}

export interface ProcessPayByLinkWebhookResult {
  already_processed: boolean;
  order_id: string | null;
  retry_needed: boolean;
}

export interface UsageSyncResult {
  total: number;
  synced: number;
  failed: number;
}

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  coder_user_id: string | null;
  coder_username: string | null;
  coder_temp_password: string | null;
}

interface BillingOrderRow extends QueryResultRow {
  id: string;
  user_id: string;
  provider_order_id: string | null;
  status: string;
  plan_type: BillingPlanType;
  amount_pln: string | number;
  credits_usd: string | number;
  created_at: Date | string;
  paid_at: Date | string | null;
}

interface BillingEventRow extends QueryResultRow {
  id: string;
  order_id: string | null;
  processed_at: Date | string | null;
}

interface LlmAccountRow extends QueryResultRow {
  id: string;
  user_id: string;
  provider: string;
  openrouter_key_hash: string;
  openrouter_key_label: string;
  status: string;
  coder_secret_sync_state: string;
  limit_usd: string | number;
  limit_reset: string | null;
  last_synced_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface LlmUsageSnapshotRow extends QueryResultRow {
  usage_total_usd: string | number;
  usage_monthly_usd: string | number;
  limit_remaining_usd: string | number;
  observed_at: Date | string;
}

export interface BillingDependencies {
  query?: typeof query;
  withTransaction?: typeof withTransaction;
  ensureCoderUser?: (email: string) => Promise<CoderUserRef>;
  upsertUserSecret?: typeof upsertUserSecret;
  createPayByLinkCheckoutSession?: typeof createPayByLinkCheckoutSession;
  verifyPayByLinkWebhook?: typeof verifyPayByLinkWebhook;
  createOpenRouterKey?: typeof createOpenRouterKey;
  getOpenRouterKey?: typeof getOpenRouterKey;
  updateOpenRouterKey?: typeof updateOpenRouterKey;
  deleteOpenRouterKey?: typeof deleteOpenRouterKey;
  findOpenRouterKeyByName?: typeof findOpenRouterKeyByName;
}

function resolveDeps(deps: BillingDependencies = {}) {
  return {
    query: deps.query ?? query,
    withTransaction: deps.withTransaction ?? withTransaction,
    ensureCoderUser: deps.ensureCoderUser ?? ensureCoderUser,
    upsertUserSecret: deps.upsertUserSecret ?? upsertUserSecret,
    createPayByLinkCheckoutSession:
      deps.createPayByLinkCheckoutSession ?? createPayByLinkCheckoutSession,
    verifyPayByLinkWebhook: deps.verifyPayByLinkWebhook ?? verifyPayByLinkWebhook,
    createOpenRouterKey: deps.createOpenRouterKey ?? createOpenRouterKey,
    getOpenRouterKey: deps.getOpenRouterKey ?? getOpenRouterKey,
    updateOpenRouterKey: deps.updateOpenRouterKey ?? updateOpenRouterKey,
    deleteOpenRouterKey: deps.deleteOpenRouterKey ?? deleteOpenRouterKey,
    findOpenRouterKeyByName: deps.findOpenRouterKeyByName ?? findOpenRouterKeyByName,
  };
}

function toMoney(value: number): number {
  return Number(value.toFixed(2));
}

function parseMoney(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}

function toIsoString(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeLimitReset(value: string | null | undefined): OpenRouterLimitReset {
  if (value === 'daily' || value === 'weekly' || value === 'monthly') {
    return value;
  }
  return null;
}

function usdToPlnRate(): number {
  const raw = Number(process.env.BILLING_USD_TO_PLN_RATE || '4.0');
  return Number.isFinite(raw) && raw > 0 ? raw : 4.0;
}

function activationFeePln(): number {
  const raw = Number(process.env.BILLING_ACTIVATION_FEE_PLN || '0');
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function calculateAmountPln(planType: BillingPlanType, creditsUsd: number): number {
  const converted = creditsUsd * usdToPlnRate();
  const fee = planType === 'activation' ? activationFeePln() : 0;
  return toMoney(converted + fee);
}

function buildCheckoutDescription(planType: BillingPlanType, creditsUsd: number): string {
  const label = planType === 'activation' ? 'Activation' : 'Top-up';
  return `Open Mercato ${label} $${creditsUsd.toFixed(2)}`;
}

async function getUser(db: DatabaseQueryable, userId: string): Promise<UserRow> {
  const result = await db.query<UserRow>(
    `select id, email, coder_user_id, coder_username, coder_temp_password
       from users
      where id = $1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user) {
    throw new BillingError(404, 'user_not_found', 'User not found');
  }
  return user;
}

async function getLlmAccount(
  db: DatabaseQueryable,
  userId: string,
  forUpdate = false,
): Promise<LlmAccountRow | null> {
  const result = await db.query<LlmAccountRow>(
    `select id, user_id, provider, openrouter_key_hash, openrouter_key_label,
            status, coder_secret_sync_state, limit_usd, limit_reset,
            last_synced_at, created_at, updated_at
       from llm_accounts
      where user_id = $1
      ${forUpdate ? 'for update' : ''}`,
    [userId],
  );
  return result.rows[0] ?? null;
}

async function getMatchingOrder(
  db: DatabaseQueryable,
  event: PayByLinkWebhookEvent,
): Promise<BillingOrderRow> {
  const clauses: string[] = ['provider_order_id = $1'];
  const params: unknown[] = [event.providerOrderId];
  if (event.localOrderId) {
    clauses.push(`id = $${params.length + 1}`);
    params.push(event.localOrderId);
  }

  const result = await db.query<BillingOrderRow>(
    `select id, user_id, provider_order_id, status, plan_type, amount_pln,
            credits_usd, created_at, paid_at
       from billing_orders
      where ${clauses.join(' or ')}
      order by created_at desc
      limit 1
      for update`,
    params,
  );

  const order = result.rows[0];
  if (!order) {
    throw new BillingError(
      404,
      BILLING_ERROR_CODES.ORDER_NOT_FOUND,
      'Billing order not found for webhook',
    );
  }
  return order;
}

async function insertUsageSnapshot(
  db: DatabaseQueryable,
  llmAccountId: string,
  key: OpenRouterApiKeyRecord,
): Promise<void> {
  await db.query(
    `insert into llm_usage_snapshots (
       llm_account_id, usage_total_usd, usage_monthly_usd, limit_remaining_usd, observed_at
     ) values ($1, $2, $3, $4, now())`,
    [
      llmAccountId,
      toMoney(key.usage),
      toMoney(key.usage_monthly),
      toMoney(key.limit_remaining ?? 0),
    ],
  );
}

async function upsertBillingSecrets(
  upsertSecret: typeof upsertUserSecret,
  coderUserId: string,
  rawKey: string,
): Promise<void> {
  await upsertSecret(coderUserId, {
    name: 'OPENROUTER_API_KEY',
    env_name: 'OPENROUTER_API_KEY',
    description: 'Per-user OpenRouter key for Codex inside Open Mercato sandboxes',
    value: rawKey,
  });
  await upsertSecret(coderUserId, {
    name: 'ANTHROPIC_AUTH_TOKEN',
    env_name: 'ANTHROPIC_AUTH_TOKEN',
    description: 'Per-user OpenRouter-backed Anthropic auth token for Claude',
    value: rawKey,
  });
}

async function upsertLlmAccount(
  db: DatabaseQueryable,
  userId: string,
  key: OpenRouterApiKeyRecord,
  status: string,
  secretSyncState: string,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into llm_accounts (
       user_id, provider, openrouter_key_hash, openrouter_key_label, status,
       coder_secret_sync_state, limit_usd, limit_reset, last_synced_at, updated_at
     ) values ($1, 'openrouter', $2, $3, $4, $5, $6, $7, now(), now())
     on conflict (user_id) do update set
       provider = excluded.provider,
       openrouter_key_hash = excluded.openrouter_key_hash,
       openrouter_key_label = excluded.openrouter_key_label,
       status = excluded.status,
       coder_secret_sync_state = excluded.coder_secret_sync_state,
       limit_usd = excluded.limit_usd,
       limit_reset = excluded.limit_reset,
       last_synced_at = excluded.last_synced_at,
       updated_at = now()
     returning id`,
    [
      userId,
      key.hash,
      key.label,
      status,
      secretSyncState,
      toMoney(key.limit ?? 0),
      key.limit_reset,
    ],
  );
  return result.rows[0]!.id;
}

function buildSummary(
  hasPaidOrder: boolean,
  latestOrder: BillingOrderRow | null,
  llmAccount: LlmAccountRow | null,
  latestUsage: LlmUsageSnapshotRow | null,
): BillingSummary {
  const latestOrderSummary: BillingOrderSummary | null = latestOrder
    ? {
        id: latestOrder.id,
        provider_order_id: latestOrder.provider_order_id,
        status: latestOrder.status,
        plan_type: latestOrder.plan_type,
        amount_pln: parseMoney(latestOrder.amount_pln),
        credits_usd: parseMoney(latestOrder.credits_usd),
        created_at: toIsoString(latestOrder.created_at)!,
        paid_at: toIsoString(latestOrder.paid_at),
      }
    : null;

  const llmAccountSummary: LlmAccountSummary | null = llmAccount
    ? {
        id: llmAccount.id,
        provider: llmAccount.provider,
        openrouter_key_label: llmAccount.openrouter_key_label,
        status: llmAccount.status,
        coder_secret_sync_state: llmAccount.coder_secret_sync_state,
        limit_usd: parseMoney(llmAccount.limit_usd),
        limit_reset: llmAccount.limit_reset,
        last_synced_at: toIsoString(llmAccount.last_synced_at),
      }
    : null;

  const latestUsageSummary: LlmUsageSnapshotSummary | null = latestUsage
    ? {
        usage_total_usd: parseMoney(latestUsage.usage_total_usd),
        usage_monthly_usd: parseMoney(latestUsage.usage_monthly_usd),
        limit_remaining_usd: parseMoney(latestUsage.limit_remaining_usd),
        observed_at: toIsoString(latestUsage.observed_at)!,
      }
    : null;

  const canCreateSandbox =
    hasPaidOrder
    && llmAccountSummary?.status === 'active'
    && llmAccountSummary?.coder_secret_sync_state === 'synced';

  return {
    has_paid_order: hasPaidOrder,
    latest_order: latestOrderSummary,
    llm_account: llmAccountSummary,
    latest_usage: latestUsageSummary,
    can_create_sandbox: canCreateSandbox,
  };
}

export async function createBillingCheckout(
  input: CreateBillingCheckoutInput,
  deps: BillingDependencies = {},
): Promise<CreateBillingCheckoutResult> {
  const resolved = resolveDeps(deps);
  const db = { query: resolved.query };
  const user = await getUser(db, input.userId);
  const existingAccount = await getLlmAccount(db, input.userId);

  if (input.planType === 'activation' && existingAccount?.status === 'active') {
    throw new BillingError(
      409,
      BILLING_ERROR_CODES.INVALID_PLAN_TRANSITION,
      'AI access is already active. Use a top-up instead.',
    );
  }
  if (input.planType === 'topup' && !existingAccount) {
    throw new BillingError(
      409,
      BILLING_ERROR_CODES.INVALID_PLAN_TRANSITION,
      'You need to activate AI access before topping up.',
    );
  }

  const creditsUsd = toMoney(input.creditsUsd);
  if (!Number.isFinite(creditsUsd) || creditsUsd <= 0) {
    throw new BillingError(400, 'invalid_credits_amount', 'credits_usd must be greater than zero');
  }

  const amountPln = calculateAmountPln(input.planType, creditsUsd);
  const inserted = await resolved.query<{ id: string }>(
    `insert into billing_orders (
       user_id, provider, status, plan_type, amount_pln, credits_usd, updated_at
     ) values ($1, 'paybylink', 'pending', $2, $3, $4, now())
     returning id`,
    [input.userId, input.planType, amountPln, creditsUsd],
  );

  const orderId = inserted.rows[0]?.id;
  if (!orderId) {
    throw new BillingError(500, 'order_create_failed', 'Failed to create billing order');
  }

  try {
    const checkout = await resolved.createPayByLinkCheckoutSession({
      orderId,
      email: user.email,
      amountPln,
      description: buildCheckoutDescription(input.planType, creditsUsd),
      notifyUrl: new URL('/api/billing/paybylink/webhook', input.baseUrl).toString(),
      returnUrlSuccess: new URL('/billing', input.baseUrl).toString(),
    });

    await resolved.query(
      `update billing_orders
          set provider_order_id = $1, updated_at = now()
        where id = $2`,
      [checkout.providerOrderId, orderId],
    );

    return {
      order_id: orderId,
      payment_url: checkout.paymentUrl,
      amount_pln: amountPln,
      credits_usd: creditsUsd,
      plan_type: input.planType,
    };
  } catch (error) {
    await resolved.query(
      `update billing_orders
          set status = 'failed', updated_at = now()
        where id = $1`,
      [orderId],
    );
    throw error;
  }
}

export async function processPayByLinkPaymentWebhook(
  rawBody: string,
  deps: BillingDependencies = {},
): Promise<ProcessPayByLinkWebhookResult> {
  const resolved = resolveDeps(deps);
  const event = resolved.verifyPayByLinkWebhook(rawBody);
  let retryErrorMessage: string | null = null;

  const result = await resolved.withTransaction(async (db) => {
    const existingEvent = await db.query<BillingEventRow>(
      `select id, order_id, processed_at
         from billing_events
        where provider_event_id = $1
        for update`,
      [event.providerEventId],
    );

    if (existingEvent.rows[0]?.processed_at) {
      return {
        already_processed: true,
        order_id: existingEvent.rows[0].order_id,
        retry_needed: false,
      };
    }

    const order = await getMatchingOrder(db, event);
    const expectedAmount = toMoney(parseMoney(order.amount_pln));
    if (event.localOrderId && event.localOrderId !== order.id) {
      throw new BillingError(
        400,
        'billing_order_control_mismatch',
        'PayByLink control value does not match the local order id',
      );
    }
    if (toMoney(event.amountPln) !== expectedAmount) {
      throw new BillingError(
        400,
        BILLING_ERROR_CODES.PAYMENT_AMOUNT_MISMATCH,
        'PayByLink amount does not match the billing order',
      );
    }

    if (existingEvent.rowCount === 0) {
      await db.query(
        `insert into billing_events (
           provider, provider_event_id, order_id, event_type, payload_json
         ) values ('paybylink', $1, $2, 'payment.completed', $3::jsonb)`,
        [event.providerEventId, order.id, JSON.stringify(event.rawPayload)],
      );
    } else {
      await db.query(
        `update billing_events
            set order_id = $2,
                event_type = 'payment.completed',
                payload_json = $3::jsonb
          where provider_event_id = $1`,
        [event.providerEventId, order.id, JSON.stringify(event.rawPayload)],
      );
    }

    const user = await getUser(db, order.user_id);
    let coderUserId = user.coder_user_id;
    if (!coderUserId) {
      const created = await resolved.ensureCoderUser(user.email);
      await db.query(
        `update users
            set coder_user_id = $1,
                coder_username = $2,
                coder_temp_password = $3
          where id = $4`,
        [created.id, created.username, created.tempPassword, user.id],
      );
      coderUserId = created.id;
    }

    let llmAccount = await getLlmAccount(db, user.id, true);
    if (order.status === 'paid'
      && llmAccount?.status === 'active'
      && llmAccount.coder_secret_sync_state === 'synced') {
      await db.query(
        `update billing_events
            set processed_at = now()
          where provider_event_id = $1`,
        [event.providerEventId],
      );
      return {
        already_processed: true,
        order_id: order.id,
        retry_needed: false,
      };
    }

    const shouldAddCredits = order.status !== 'paid';
    const keyName = buildOpenRouterKeyName(user.id);
    let providerKey: OpenRouterApiKeyRecord;
    let rawKeyForSecretSync: string | null = null;

    if (!llmAccount) {
      const orphanKey = await resolved.findOpenRouterKeyByName(keyName);
      if (orphanKey) {
        await resolved.deleteOpenRouterKey(orphanKey.hash).catch(() => {});
      }
      const createdKey = await resolved.createOpenRouterKey({
        name: keyName,
        limit: toMoney(parseMoney(order.credits_usd)),
        limit_reset: null,
      });
      providerKey = createdKey;
      rawKeyForSecretSync = createdKey.key;
    } else if (llmAccount.coder_secret_sync_state !== 'synced' || llmAccount.status !== 'active') {
      const replacementLimit = shouldAddCredits
        ? toMoney(parseMoney(llmAccount.limit_usd) + parseMoney(order.credits_usd))
        : toMoney(parseMoney(llmAccount.limit_usd));
      const replacementKey = await resolved.createOpenRouterKey({
        name: keyName,
        limit: replacementLimit,
        limit_reset: normalizeLimitReset(llmAccount.limit_reset),
      });
      providerKey = replacementKey;
      rawKeyForSecretSync = replacementKey.key;
      await resolved.deleteOpenRouterKey(llmAccount.openrouter_key_hash)
        .catch(() => resolved.updateOpenRouterKey(llmAccount!.openrouter_key_hash, { disabled: true })
          .catch(() => {}));
    } else {
      const currentKey = await resolved.getOpenRouterKey(llmAccount.openrouter_key_hash);
      const nextLimit = shouldAddCredits
        ? toMoney(parseMoney(currentKey.limit) + parseMoney(order.credits_usd))
        : toMoney(parseMoney(currentKey.limit));
      providerKey = await resolved.updateOpenRouterKey(llmAccount.openrouter_key_hash, {
        name: keyName,
        limit: nextLimit,
        limit_reset: normalizeLimitReset(llmAccount.limit_reset),
        disabled: false,
      });
    }

    let status = 'active';
    let secretSyncState = llmAccount?.coder_secret_sync_state === 'synced' && !rawKeyForSecretSync
      ? 'synced'
      : 'pending';

    if (rawKeyForSecretSync) {
      try {
        await upsertBillingSecrets(resolved.upsertUserSecret, coderUserId, rawKeyForSecretSync);
        secretSyncState = 'synced';
      } catch (error) {
        retryErrorMessage = error instanceof Error ? error.message : String(error);
        status = 'sync_failed';
        secretSyncState = 'failed';
      }
    } else {
      secretSyncState = 'synced';
    }

    const llmAccountId = await upsertLlmAccount(db, user.id, providerKey, status, secretSyncState);
    await insertUsageSnapshot(db, llmAccountId, providerKey);

    await db.query(
      `update billing_orders
          set status = 'paid',
              paid_at = coalesce(paid_at, now()),
              updated_at = now()
        where id = $1`,
      [order.id],
    );

    if (!retryErrorMessage) {
      await db.query(
        `update billing_events
            set processed_at = now()
          where provider_event_id = $1`,
        [event.providerEventId],
      );
    }

    llmAccount = await getLlmAccount(db, user.id);
    return {
      already_processed: false,
      order_id: order.id,
      retry_needed: Boolean(retryErrorMessage) || llmAccount?.coder_secret_sync_state !== 'synced',
    };
  });

  if (retryErrorMessage) {
    throw new BillingError(
      502,
      'coder_secret_sync_failed',
      retryErrorMessage,
    );
  }

  return result;
}

export async function getBillingSummaryForUser(
  userId: string,
  deps: BillingDependencies = {},
): Promise<BillingSummary> {
  const resolved = resolveDeps(deps);
  const paidOrderCheck = await resolved.query<{ has_paid_order: boolean }>(
    `select exists(
       select 1
         from billing_orders
        where user_id = $1
          and status = 'paid'
     ) as has_paid_order`,
    [userId],
  );
  const latestOrder = await resolved.query<BillingOrderRow>(
    `select id, user_id, provider_order_id, status, plan_type, amount_pln,
            credits_usd, created_at, paid_at
       from billing_orders
      where user_id = $1
      order by created_at desc
      limit 1`,
    [userId],
  );
  const llmAccount = await resolved.query<LlmAccountRow>(
    `select id, user_id, provider, openrouter_key_hash, openrouter_key_label,
            status, coder_secret_sync_state, limit_usd, limit_reset,
            last_synced_at, created_at, updated_at
       from llm_accounts
      where user_id = $1
      limit 1`,
    [userId],
  );
  const latestUsage = llmAccount.rows[0]
    ? await resolved.query<LlmUsageSnapshotRow>(
      `select usage_total_usd, usage_monthly_usd, limit_remaining_usd, observed_at
         from llm_usage_snapshots
        where llm_account_id = $1
        order by observed_at desc
        limit 1`,
      [llmAccount.rows[0].id],
    )
    : { rows: [] as LlmUsageSnapshotRow[] };

  return buildSummary(
    paidOrderCheck.rows[0]?.has_paid_order ?? false,
    latestOrder.rows[0] ?? null,
    llmAccount.rows[0] ?? null,
    latestUsage.rows[0] ?? null,
  );
}

export async function assertActiveSandboxEntitlement(
  userId: string,
  deps: BillingDependencies = {},
): Promise<void> {
  const summary = await getBillingSummaryForUser(userId, deps);
  if (summary.can_create_sandbox) {
    return;
  }
  throw new BillingError(
    402,
    BILLING_ERROR_CODES.AI_ENTITLEMENT_REQUIRED,
    'Paid AI access is required before you can create a sandbox.',
  );
}

export async function syncActiveBillingUsage(
  deps: BillingDependencies = {},
): Promise<UsageSyncResult> {
  const resolved = resolveDeps(deps);
  const accounts = await resolved.query<LlmAccountRow>(
    `select id, user_id, provider, openrouter_key_hash, openrouter_key_label,
            status, coder_secret_sync_state, limit_usd, limit_reset,
            last_synced_at, created_at, updated_at
       from llm_accounts
      where status = 'active'`,
  );

  let synced = 0;
  let failed = 0;

  for (const account of accounts.rows) {
    try {
      const key = await resolved.getOpenRouterKey(account.openrouter_key_hash);
      await resolved.query(
        `update llm_accounts
            set openrouter_key_label = $2,
                limit_usd = $3,
                limit_reset = $4,
                status = $5,
                last_synced_at = now(),
                updated_at = now()
          where id = $1`,
        [
          account.id,
          key.label,
          toMoney(key.limit ?? 0),
          key.limit_reset,
          key.disabled ? 'suspended' : 'active',
        ],
      );
      await resolved.query(
        `insert into llm_usage_snapshots (
           llm_account_id, usage_total_usd, usage_monthly_usd, limit_remaining_usd, observed_at
         ) values ($1, $2, $3, $4, now())`,
        [
          account.id,
          toMoney(key.usage),
          toMoney(key.usage_monthly),
          toMoney(key.limit_remaining ?? 0),
        ],
      );
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    total: accounts.rowCount ?? accounts.rows.length,
    synced,
    failed,
  };
}

export function verifyInternalBillingSyncRequest(req: Request): void {
  const expected = process.env.BILLING_SYNC_SECRET;
  const provided = req.headers.get('x-billing-sync-secret');
  if (!expected || provided !== expected) {
    throw new BillingError(
      401,
      BILLING_ERROR_CODES.INTERNAL_SYNC_AUTH_FAILED,
      'Invalid billing sync secret',
    );
  }
}
