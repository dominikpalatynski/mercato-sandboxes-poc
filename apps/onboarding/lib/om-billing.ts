import { createHmac, timingSafeEqual } from 'node:crypto';

import type { QueryResultRow } from 'pg';

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
  disableOpenRouterKey,
  type OpenRouterApiKeyRecord,
} from '@/lib/openrouter';
import {
  createSubscriptionCheckout,
  getSubscriptionAccess,
  hasGrantedAccess,
  readEntitlementsView,
  DEFAULT_PRICE_CODE,
  DEFAULT_PRODUCT_CODE,
  type SubscriptionAccessSnapshot,
} from '@/lib/openmercato-subscriptions';
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

export interface OmBillingUserRef {
  id: string;
  email: string;
  openmercato_customer_person_id: string | null;
  coder_user_id: string | null;
}

interface OmBillingUserRow extends QueryResultRow {
  id: string;
  email: string;
  openmercato_customer_person_id: string | null;
  coder_user_id: string | null;
  coder_username: string | null;
  coder_temp_password: string | null;
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

export interface OmBillingDependencies {
  query?: typeof query;
  withTransaction?: typeof withTransaction;
  ensureCoderUser?: (email: string) => Promise<CoderUserRef>;
  upsertUserSecret?: typeof upsertUserSecret;
  createSubscriptionCheckout?: typeof createSubscriptionCheckout;
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
    query: deps.query ?? query,
    withTransaction: deps.withTransaction ?? withTransaction,
    ensureCoderUser: deps.ensureCoderUser ?? ensureCoderUser,
    upsertUserSecret: deps.upsertUserSecret ?? upsertUserSecret,
    createSubscriptionCheckout: deps.createSubscriptionCheckout ?? createSubscriptionCheckout,
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

function parseMoney(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}

async function getUser(db: DatabaseQueryable, userId: string): Promise<OmBillingUserRow> {
  const result = await db.query<OmBillingUserRow>(
    `select id, email, openmercato_customer_person_id, coder_user_id, coder_username, coder_temp_password
       from users
      where id = $1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user) {
    throw new OmBillingError(404, 'user_not_found', 'User not found');
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

async function ensureCoderUserForRow(
  db: DatabaseQueryable,
  user: OmBillingUserRow,
  factory: (email: string) => Promise<CoderUserRef>,
): Promise<string> {
  if (user.coder_user_id) return user.coder_user_id;
  const created = await factory(user.email);
  await db.query(
    `update users
        set coder_user_id = $1,
            coder_username = $2,
            coder_temp_password = $3
      where id = $4`,
    [created.id, created.username, created.tempPassword, user.id],
  );
  return created.id;
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
  const db = { query: resolved.query };
  const user = await getUser(db, input.userId);
  if (!user.openmercato_customer_person_id) {
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
      subjectEntityId: user.openmercato_customer_person_id,
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

  await resolved.query(
    `insert into billing_orders (
       user_id, provider, provider_order_id, status, plan_type, amount_pln, credits_usd, updated_at
     ) values ($1, $2, $3, 'pending', 'activation', 0, 0, now())`,
    [user.id, OM_BILLING_PROVIDER, checkout.subscriptionRequestId],
  );

  return {
    checkoutUrl: checkout.checkoutUrl,
    subscriptionRequestId: checkout.subscriptionRequestId,
    priceCode: chosenPriceCode,
    productCode: productCode(),
  };
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
  const db = { query: resolved.query };
  const user = await getUser(db, userId);

  const snapshot = await resolved.getSubscriptionAccess({
    externalAccountId: user.id,
    productCode: productCode(),
  });

  if (!hasGrantedAccess(snapshot)) {
    const llmAccount = await getLlmAccount(db, user.id);
    if (llmAccount && llmAccount.status === 'active') {
      await suspendLlmAccount(resolved, db, user.id, llmAccount);
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

  const result = await resolved.withTransaction(async (txDb) => {
    const lockedUser = await getUser(txDb, user.id);
    const coderUserId = await ensureCoderUserForRow(txDb, lockedUser, resolved.ensureCoderUser);
    const llmAccount = await getLlmAccount(txDb, lockedUser.id, true);

    if (
      llmAccount
      && llmAccount.status === 'active'
      && llmAccount.coder_secret_sync_state === 'synced'
      && parseMoney(llmAccount.limit_usd) === targetLimit
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
      llmAccount.coder_secret_sync_state !== 'synced'
      || llmAccount.status !== 'active'
    ) {
      const replacementKey = await resolved.createOpenRouterKey({
        name: keyName,
        limit: targetLimit,
        limit_reset: null,
      });
      providerKey = replacementKey;
      rawKeyForSecretSync = replacementKey.key;
      await resolved.deleteOpenRouterKey(llmAccount.openrouter_key_hash).catch(async () => {
        await resolved.updateOpenRouterKey(llmAccount.openrouter_key_hash, { disabled: true })
          .catch(() => {});
      });
    } else {
      providerKey = await resolved.updateOpenRouterKey(llmAccount.openrouter_key_hash, {
        name: keyName,
        limit: targetLimit,
        disabled: false,
      });
    }

    let status = 'active';
    let secretSyncState: string = llmAccount?.coder_secret_sync_state === 'synced' && !rawKeyForSecretSync
      ? 'synced'
      : 'pending';

    if (rawKeyForSecretSync) {
      try {
        await upsertBillingSecrets(resolved.upsertUserSecret, coderUserId, rawKeyForSecretSync);
        secretSyncState = 'synced';
      } catch (error) {
        status = 'sync_failed';
        secretSyncState = 'failed';
        // We still upsert llm_accounts so the failure is visible; reconcile will retry later
        const failedAccountId = await upsertLlmAccount(txDb, lockedUser.id, providerKey, status, secretSyncState);
        await insertUsageSnapshot(txDb, failedAccountId, providerKey);
        throw new OmBillingError(
          502,
          'coder_secret_sync_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    } else {
      secretSyncState = 'synced';
    }

    const llmAccountId = await upsertLlmAccount(txDb, lockedUser.id, providerKey, status, secretSyncState);
    await insertUsageSnapshot(txDb, llmAccountId, providerKey);

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

async function suspendLlmAccount(
  resolved: ReturnType<typeof resolveDeps>,
  db: DatabaseQueryable,
  userId: string,
  llmAccount: LlmAccountRow,
): Promise<void> {
  await resolved.disableOpenRouterKey(llmAccount.openrouter_key_hash).catch(() => {});
  await db.query(
    `update llm_accounts
        set status = 'suspended', updated_at = now()
      where id = $1`,
    [llmAccount.id],
  );
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
  canCreateSandbox: boolean;
}

interface LlmUsageSnapshotRow extends QueryResultRow {
  usage_total_usd: string | number;
  usage_monthly_usd: string | number;
  limit_remaining_usd: string | number;
  observed_at: Date | string;
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
  const db = { query: resolved.query };
  const user = await getUser(db, userId);

  let accessSnapshot: SubscriptionAccessSnapshot | null = null;
  try {
    accessSnapshot = await resolved.getSubscriptionAccess({
      externalAccountId: user.id,
      productCode: productCode(),
    });
  } catch {
    accessSnapshot = null;
  }

  const llmAccount = await getLlmAccount(db, user.id);
  const latestUsageResult = llmAccount
    ? await resolved.query<LlmUsageSnapshotRow>(
      `select usage_total_usd, usage_monthly_usd, limit_remaining_usd, observed_at
         from llm_usage_snapshots
        where llm_account_id = $1
        order by observed_at desc
        limit 1`,
      [llmAccount.id],
    )
    : { rows: [] as LlmUsageSnapshotRow[] };

  const latestUsage = latestUsageResult.rows[0] ?? null;
  const canCreateSandbox = hasGrantedAccess(accessSnapshot)
    && llmAccount?.status === 'active'
    && llmAccount.coder_secret_sync_state === 'synced';

  return {
    accessSnapshot,
    llmAccount: llmAccount
      ? {
        id: llmAccount.id,
        status: llmAccount.status,
        secretSyncState: llmAccount.coder_secret_sync_state,
        limitUsd: parseMoney(llmAccount.limit_usd),
        lastSyncedAt: toIsoString(llmAccount.last_synced_at),
      }
      : null,
    latestUsage: latestUsage
      ? {
        usageTotalUsd: parseMoney(latestUsage.usage_total_usd),
        usageMonthlyUsd: parseMoney(latestUsage.usage_monthly_usd),
        limitRemainingUsd: parseMoney(latestUsage.limit_remaining_usd),
        observedAt: toIsoString(latestUsage.observed_at)!,
      }
      : null,
    canCreateSandbox: Boolean(canCreateSandbox),
  };
}

export async function assertActiveSandboxEntitlement(
  userId: string,
  deps: OmBillingDependencies = {},
): Promise<void> {
  const result = await reconcileLlmAccessForUser(userId, deps);
  if (
    hasGrantedAccess(result.accessSnapshot)
    && result.llmAccountStatus === 'active'
  ) {
    return;
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
    !externalAccountId
    || !productCodeRaw
    || !['pending', 'granted', 'grace', 'blocked'].includes(accessStateRaw)
  ) {
    throw new OmBillingError(400, 'invalid_webhook_payload', 'Open Mercato webhook payload is missing required fields');
  }
  return {
    externalAccountId,
    productCode: productCodeRaw,
    accessState: accessStateRaw as OmWebhookPayload['accessState'],
    subscriptionId: typeof value.subscriptionId === 'string' ? value.subscriptionId : null,
    entitlements: value.entitlements && typeof value.entitlements === 'object' && !Array.isArray(value.entitlements)
      ? value.entitlements as Record<string, unknown>
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
  const eventId = input.deliveryId || `om-${payload.externalAccountId}-${payload.subscriptionId ?? 'na'}-${payload.occurredAt ?? Date.now()}`;

  const dedupe = await resolved.withTransaction(async (db) => {
    const existing = await db.query<{ id: string; processed_at: Date | string | null }>(
      `select id, processed_at
         from billing_events
        where provider_event_id = $1
        for update`,
      [eventId],
    );
    if (existing.rows[0]?.processed_at) {
      return { already: true };
    }
    if (existing.rowCount === 0) {
      await db.query(
        `insert into billing_events (
           provider, provider_event_id, event_type, payload_json
         ) values ($1, $2, $3, $4::jsonb)`,
        [OM_BILLING_PROVIDER, eventId, 'subscriptions.access.changed', JSON.stringify(payload)],
      );
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

  await resolved.query(
    `update billing_events
        set processed_at = now()
      where provider_event_id = $1`,
    [eventId],
  );

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

export async function syncActiveOmBillingUsage(
  deps: OmBillingDependencies = {},
): Promise<UsageSyncResult> {
  const resolved = resolveDeps(deps);
  const accounts = await resolved.query<LlmAccountRow>(
    `select id, user_id, provider, openrouter_key_hash, openrouter_key_label,
            status, coder_secret_sync_state, limit_usd, limit_reset,
            last_synced_at, created_at, updated_at
       from llm_accounts
      where status = 'active'`,
  );

  let reconciled = 0;
  let snapshotWritten = 0;
  let failed = 0;

  for (const account of accounts.rows) {
    try {
      await reconcileLlmAccessForUser(account.user_id, deps);
      reconciled += 1;
    } catch {
      failed += 1;
      continue;
    }
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
      snapshotWritten += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    total: accounts.rowCount ?? accounts.rows.length,
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
