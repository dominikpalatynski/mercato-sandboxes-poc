# Mini-Spec: OpenRouter Billing and Key Provisioning in Onboarding

Date: 2026-05-16 (revised 2026-05-22)
Status: PayByLink path removed. Open Mercato subscriptions are now the
authoritative billing/payment provider for onboarding.
Scope: Alpha

## Purpose

Enable paid AI access for sandbox users so one paid account can use both Codex
and Claude inside the provisioned workspace.

Payment and subscription state live in Open Mercato (CRM). Onboarding owns the
side effects of "access granted": provisioning a per-user OpenRouter key and
synchronizing it as a Coder user secret.

## Decisions

- Open Mercato `subscriptions` is the canonical source of truth for plan,
  price, payment session, subscription lifecycle, and access state. Onboarding
  never talks to Stripe directly.
- Onboarding owns business side effects: OpenRouter key lifecycle, Coder
  secret sync, usage snapshots, and sandbox creation guard.
- The bridge from Open Mercato to onboarding is a CRM custom module
  (`apps/crm/src/modules/onboarding_bridge`) that subscribes to
  `subscriptions.access.changed` and forwards an HMAC-signed POST to
  `onboarding /api/billing/om/webhook`.
- Onboarding's webhook trusts only signed payloads; it dedupes by delivery
  id, then calls `GET /api/subscriptions/access` against OM as the source of
  truth before mutating local state.
- `/billing` page and the sandbox creation guard run the same idempotent
  reconcile path so dropped webhooks self-heal on next user interaction.
- The legacy PayByLink path (`lib/paybylink.ts`,
  `/api/billing/paybylink/webhook`) is fully removed.
- The onboarding backend stores one OpenRouter Management API key server-side.
- Each user gets one OpenRouter inference key that is reused across sandbox
  sessions and top-ups.
- The raw OpenRouter inference key is not stored in plaintext in the onboarding
  database.
- The raw OpenRouter inference key is delivered to workspaces through Coder
  user secrets rather than shared template variables.
- Alpha billing is denominated in USD budget at the provider layer, even if the
  product UI describes the plan in token-oriented language.
- Alpha does not expose the raw OpenRouter key in the onboarding UI.
- If full Open Mercato-native pay links are required later, implement a real
  `PayByLink` gateway provider in Open Mercato's `payment_gateways` layer
  instead of extending this onboarding-only billing schema.
- Creating a sandbox requires an active paid AI entitlement and successfully
  synchronized Coder secrets.

## In Scope

- paid checkout initiation in `apps/onboarding`
- PayByLink webhook processing in `apps/onboarding`
- OpenRouter key create, top-up, disable, and usage sync flows
- per-user Coder secret synchronization
- sandbox creation guard in `apps/onboarding/app/api/sandboxes/route.ts`
- workspace bootstrap changes so Codex and Claude read provider settings from
  workspace config plus per-user secrets
- dashboard/API summary for remaining budget and observed usage

## Out of Scope

- exposing a downloadable raw key to the user
- building a custom AI gateway or request proxy
- exact token accounting independent from provider-side USD accounting
- multi-provider AI routing beyond OpenRouter
- replacing the existing auth/session model in onboarding
- background worker infrastructure outside what `apps/onboarding` can trigger
  through route handlers or a simple cron-invoked endpoint

## Implementation Locations

### Onboarding backend modules

- `apps/onboarding/lib/openrouter.ts` — OpenRouter management API client
- `apps/onboarding/lib/openmercato-client.ts` — base Open Mercato REST client
- `apps/onboarding/lib/openmercato-subscriptions.ts` — typed subscriptions client
- `apps/onboarding/lib/openmercato-customers.ts` — CRM customer sync (signup)
- `apps/onboarding/lib/om-billing.ts` — orchestrator: checkout, reconcile,
  webhook processing, sandbox guard, usage sync
- `apps/onboarding/lib/coder.ts`
- `apps/onboarding/lib/db.ts`

### Onboarding route handlers

- `apps/onboarding/app/api/signup/route.ts`
- `apps/onboarding/app/api/sandboxes/route.ts`
- `apps/onboarding/app/api/billing/checkout/route.ts`
- `apps/onboarding/app/api/billing/om/webhook/route.ts`
- `apps/onboarding/app/api/billing/summary/route.ts`
- `apps/onboarding/app/api/internal/billing/sync-usage/route.ts`

### CRM bridge module

- `apps/crm/src/modules/onboarding_bridge/index.ts`
- `apps/crm/src/modules/onboarding_bridge/subscribers/on-access-changed-forward.ts`
- `apps/crm/src/modules.ts` registers the module with `from: '@app'`. Run
  `yarn generate` after edits.
- `apps/crm/src/plans.ts` declares the basic plan
  (`code: 'basic'`, `productCode: 'basic-sandbox'`, price
  `basic-monthly-pln-v1`, entitlements `{ sandboxCount, openRouterTokensUsageUsd }`).
  Run the OM `subscriptions sync-plans` command before checkout works.

### Database and workspace template changes

- `apps/onboarding/db/schema.sql`
- `apps/onboarding/db/migrate.ts`
- `coder/template/main.tf`
- `k8s/coder-template/main.tf`

## Runtime Configuration

Onboarding requires:

- `OPENROUTER_MANAGEMENT_KEY` or `OPENROUTER_MANAGEMENT_API_KEY`
- `OPENMERCATO_API_BASE_URL` (or legacy `OPENMERCATO_BILLING_BASE_URL`)
- `OPENMERCATO_API_KEY` — API key whose role has `subscriptions.manage`,
  `subscriptions.access`, and `customers.people.view/manage`
- `OPENMERCATO_CUSTOMER_TENANT_ID`, `OPENMERCATO_CUSTOMER_ORGANIZATION_ID`
- `OM_BILLING_WEBHOOK_SECRET` — shared HMAC secret with the CRM bridge
- `BILLING_SYNC_SECRET` — for the internal `sync-usage` cron endpoint
- optional: `BASIC_PLAN_PRICE_CODE` (default `basic-monthly-pln-v1`)
- optional: `BASIC_PLAN_PRODUCT_CODE` (default `basic-sandbox`)

CRM requires (for the bridge subscriber):

- `ONBOARDING_WEBHOOK_URL` — onboarding's `/api/billing/om/webhook` endpoint
- `ONBOARDING_WEBHOOK_SECRET` — same value as onboarding's `OM_BILLING_WEBHOOK_SECRET`
- optional: `ONBOARDING_WEBHOOK_PRODUCT_CODE` (default `basic-sandbox`) —
  restricts forwarding to events for this product.

## Data Model

### Existing tables

`users` stays the account anchor table. Alpha should not overload it with raw
provider secrets.

`sandboxes` stays the workspace registry and source of truth for user-owned
sandbox instances.

### New tables

#### `billing_orders`

Tracks every checkout/top-up request initiated by a logged-in user.

- `id uuid primary key`
- `user_id uuid not null references users(id)`
- `provider text not null`
- `provider_order_id text unique`
- `status text not null`
- `plan_type text not null`
- `amount_pln numeric(12,2) not null`
- `credits_usd numeric(12,2) not null`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`
- `paid_at timestamptz null`

Expected alpha statuses:

- `pending`
- `paid`
- `failed`
- `refunded`
- `chargeback`

Expected alpha plan types:

- `activation`
- `topup`

#### `billing_events`

Stores raw webhook events and enforces idempotency.

- `id uuid primary key`
- `provider text not null`
- `provider_event_id text not null unique`
- `order_id uuid null references billing_orders(id)`
- `event_type text not null`
- `payload_json jsonb not null`
- `processed_at timestamptz null`
- `created_at timestamptz default now()`

#### `llm_accounts`

Stores the provider-side AI account state for one onboarding user.

- `id uuid primary key`
- `user_id uuid not null unique references users(id)`
- `provider text not null`
- `openrouter_key_hash text not null unique`
- `openrouter_key_label text not null`
- `status text not null`
- `coder_secret_sync_state text not null`
- `limit_usd numeric(12,2) not null`
- `limit_reset text null`
- `last_synced_at timestamptz null`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Expected alpha statuses:

- `pending`
- `active`
- `suspended`
- `revoked`
- `sync_failed`

Expected alpha secret sync states:

- `pending`
- `synced`
- `failed`

Alpha entitlement is derived from `llm_accounts.status = 'active'` and
`coder_secret_sync_state = 'synced'`. No separate entitlement table is
required yet.

#### `llm_usage_snapshots`

Stores periodic provider usage observations used by the dashboard.

- `id uuid primary key`
- `llm_account_id uuid not null references llm_accounts(id)`
- `usage_total_usd numeric(12,2) not null`
- `usage_monthly_usd numeric(12,2) not null`
- `limit_remaining_usd numeric(12,2) not null`
- `observed_at timestamptz not null`

## Service Responsibilities

### `lib/openrouter.ts`

Responsibilities:

- create a new inference key for a user
- increase the limit on an existing key
- disable or revoke a key
- read current usage and remaining budget

The module accepts only server-side credentials and returns typed results used
by billing orchestration. It never writes to the database directly.

### `lib/openmercato-subscriptions.ts`

Typed wrapper over `OpenMercatoClient` for the OM subscriptions endpoints:

- `createSubscriptionCheckout()` → POST `/api/subscriptions/checkout`
- `getSubscriptionAccess()` → GET `/api/subscriptions/access`
- Helper `readEntitlementsView()` and `hasGrantedAccess()`

Never writes to the local database.

### `lib/om-billing.ts`

The orchestration layer. Combines DB writes, Coder calls, OpenRouter calls,
and Open Mercato subscription state. Key functions:

- `startSubscriptionCheckout({ userId, baseUrl, priceCode })` — calls OM
  checkout with `externalAccountId=user.id` and
  `subjectEntityId=user.openmercato_customer_person_id`. Writes a
  `billing_orders` audit row keyed by `subscriptionRequestId`.
- `reconcileLlmAccessForUser(userId)` — idempotent. Reads OM access snapshot
  as the source of truth, then creates/updates/disables the OpenRouter key,
  upserts the Coder secret, and updates `llm_accounts` +
  `llm_usage_snapshots`. Returns `{ accessSnapshot, llmAccountStatus, changed }`.
- `processOmAccessChangedWebhook({ rawBody, signature, deliveryId })` —
  verifies HMAC signature, dedupes by `provider_event_id` in
  `billing_events`, then calls `reconcileLlmAccessForUser`.
- `getOmBillingSummaryForUser(userId)` — read-only summary for `/billing`.
- `assertActiveSandboxEntitlement(userId)` — reconcile-then-check guard for
  the sandbox creation route.
- `syncActiveOmBillingUsage()` — cron-driven: for every active llm_account,
  reconcile then push a fresh OpenRouter usage snapshot.

Suspension is automatic: when OM reports `accessState='blocked'`,
`reconcileLlmAccessForUser` disables the OpenRouter key and marks the
local llm_account `suspended`.

### `lib/coder.ts`

Add methods for Coder user-secret management:

- `createUserSecret`
- `updateUserSecret`
- `deleteUserSecret`
- `upsertUserSecret`

The onboarding app remains responsible for creating the Coder user and keeping
its secrets synchronized with the provider state.

## API Contract

### `POST /api/billing/checkout`

Authenticated route.

Request body (all optional):

- `price_code`: explicit OM `subscription_prices.code`; defaults to
  `BASIC_PLAN_PRICE_CODE` env (`basic-monthly-pln-v1`).

Behavior:

- requires the user to have a CRM person id (`openmercato_customer_person_id`)
- calls Open Mercato `POST /api/subscriptions/checkout`
- writes a `billing_orders(provider='om_stripe', status='pending')` audit row
  keyed by `provider_order_id = subscriptionRequestId`
- returns `{ checkout_url, subscription_request_id, price_code, product_code }`

### `POST /api/billing/om/webhook`

Unauthenticated route protected by HMAC signature.

Headers:

- `x-om-webhook-signature`: hex-encoded `HMAC-SHA256(raw_body)` using
  `OM_BILLING_WEBHOOK_SECRET`
- `x-om-webhook-delivery-id`: idempotency key

Behavior:

- verifies signature; rejects with 401 on mismatch
- dedupes by `billing_events.provider_event_id = delivery_id`
- ignores events with `productCode` ≠ configured product
- calls `reconcileLlmAccessForUser(externalAccountId)` which fetches the
  authoritative snapshot from OM and updates local state accordingly

### `GET /api/billing/summary`

Authenticated route.

Returns:

- current order/payment state summary
- current `llm_accounts` status
- latest observed provider usage
- remaining USD budget

### `POST /api/internal/billing/sync-usage`

Internal route triggered by cron or a trusted caller.

Behavior:

- iterates active `llm_accounts`
- fetches current usage from OpenRouter
- writes `llm_usage_snapshots`
- updates `llm_accounts.last_synced_at`

Protection:

- shared secret header or equivalent internal auth

## End-to-End Flows

### 1. Signup

1. User calls `POST /api/signup`.
2. Onboarding creates a `users` row and session cookie.
3. User is authenticated but has no active AI entitlement yet.

### 2. Checkout

1. Authenticated user calls `POST /api/billing/checkout`.
2. Onboarding calls OM `/api/subscriptions/checkout` with the user's CRM
   person id as `subjectEntityId` and the onboarding user id (UUID) as
   `externalAccountId`.
3. OM creates the Stripe Checkout session.
4. Onboarding writes a `billing_orders` audit row and returns the checkout
   URL to the UI.
5. UI redirects the user to Stripe.

### 3. First successful payment

1. Stripe sends its webhook to OM. The OM `gateway_stripe` subscribers
   create/update the `Subscription` and emit `subscriptions.access.changed`.
2. The CRM `onboarding_bridge` subscriber posts an HMAC-signed payload to
   onboarding `/api/billing/om/webhook`.
3. Onboarding validates the signature, dedupes by delivery id, records a
   `billing_events` row, and calls `reconcileLlmAccessForUser`.
4. `reconcileLlmAccessForUser` reads `/api/subscriptions/access` from OM as
   the source of truth, then:
   - if `coder_user_id` is missing, runs `ensureCoderUser`
   - creates an OpenRouter inference key with
     `limit = entitlements.openRouterTokensUsageUsd`
   - upserts the Coder user secrets `OPENROUTER_API_KEY` and
     `ANTHROPIC_AUTH_TOKEN`
   - marks `llm_accounts.status='active'`,
     `coder_secret_sync_state='synced'`

### 4. Sandbox creation after payment

1. Authenticated user calls `POST /api/sandboxes`.
2. `assertActiveSandboxEntitlement` reconciles the user (in case the webhook
   was dropped or the user got here before the webhook), then verifies:
   - OM access state is `granted` or `grace`
   - local `llm_accounts.status='active'`
   - `coder_secret_sync_state='synced'`
3. Only then does onboarding create the Coder workspace.

### 5. Renewal or plan change

1. Stripe webhook → OM subscriber → CRM bridge → onboarding webhook.
2. Onboarding reconciles. If `entitlements.openRouterTokensUsageUsd`
   changed, the OpenRouter key limit is updated in place; otherwise it is
   a no-op.

### 6. Usage sync

1. Internal cron calls `POST /api/internal/billing/sync-usage`.
2. For each active `llm_account`, onboarding reconciles, then fetches the
   latest OpenRouter usage and inserts `llm_usage_snapshots`.

### 7. Refund, chargeback, or cancellation

1. OM emits `subscriptions.access.changed` with `accessState='blocked'`.
2. Onboarding reconciles, disables the OpenRouter key, and marks
   `llm_accounts.status='suspended'`.
3. New sandbox creation is blocked immediately.
4. Existing workspace sessions lose future provider access when the secret
   stops authorizing requests.

### 8. `/billing` page fallback reconcile

Every request to the `/billing` page calls `reconcileLlmAccessForUser` so a
user returning from Stripe before the webhook arrives still sees the correct
state. Reconcile is idempotent and safe to call repeatedly.

## Workspace Bootstrap Changes

`k8s/coder-template/main.tf` must change in three ways:

1. Remove shared `openai_api_key` and `anthropic_api_key` template variables.
2. Keep only non-secret provider configuration in the workspace bootstrap:
   - Codex configured to use OpenRouter from `~/.codex/config.toml`
   - Claude configured with `ANTHROPIC_BASE_URL=https://openrouter.ai/api`
   - `ANTHROPIC_API_KEY` left empty
3. Read secret values from per-user Coder secrets so workspaces do not share a
   global inference credential.

Expected secret usage in the workspace:

- Codex reads `OPENROUTER_API_KEY`
- Claude reads `ANTHROPIC_AUTH_TOKEN`

## Sandbox Guard Rules

`apps/onboarding/app/api/sandboxes/route.ts` calls
`assertActiveSandboxEntitlement`, which reconciles first and then rejects
creation when any of the following are true:

- OM access state is not `granted` or `grace`
- no `llm_accounts` row exists for the user
- `llm_accounts.status` is not `active`
- `coder_secret_sync_state` is not `synced`

Expected response for blocked users:

- `402` with `code: 'ai_entitlement_required'`

## Verification Plan

### Automated

- Unit test: `OpenMercatoClient` posts to `/api/subscriptions/checkout` with
  the correct subject entity type and price code.
- Unit test: `getSubscriptionAccess` queries the access endpoint with the
  configured product code.
- Unit test: `startSubscriptionCheckout` refuses when the user has no
  CRM person id and writes a `billing_orders` audit row when OM returns a
  session URL.
- Unit test: `reconcileLlmAccessForUser` provisions an OR key + Coder secret
  on `granted`, is a no-op on already-active accounts at the right limit,
  and suspends on `blocked`.
- Unit test: `verifyOmWebhookSignature` accepts a valid HMAC and rejects
  bad/missing signatures.
- Unit test: `processOmAccessChangedWebhook` is idempotent across duplicate
  delivery ids and ignores events for other product codes.

### Manual smoke

1. Sign up a new user in onboarding.
2. Confirm sandbox creation is blocked before payment.
3. Complete one payment in the provider sandbox.
4. Confirm the webhook activates the user and the dashboard shows AI access.
5. Create a sandbox and confirm Codex and Claude can authenticate from inside
   the workspace.
6. Trigger one usage sync and confirm the dashboard updates remaining budget.

## Open Questions

- Exact PayByLink webhook signature fields and retry semantics must be pinned to
  the provider documentation before implementation.
- Exact Coder API surface for user-secret create/update/delete must be verified
  against the running Coder version before coding.
- The product copy may still talk about token packs, but alpha enforcement
  should remain provider-budget-based unless we deliberately build a separate
  ledger.
