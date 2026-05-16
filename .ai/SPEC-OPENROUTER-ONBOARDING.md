# Mini-Spec: OpenRouter Billing and Key Provisioning in Onboarding

Date: 2026-05-16
Status: Implemented in repo; live provider smoke pending
Scope: Alpha

## Purpose

Enable paid AI access for sandbox users so one paid account can use both Codex
and Claude inside the provisioned workspace.

All API, persistence, and orchestration for this flow must live in
`apps/onboarding`. No separate backend service is introduced for alpha.

## Decisions

- `apps/onboarding` is the only backend for signup, billing, webhook handling,
  OpenRouter provisioning, usage reporting, and sandbox entitlement checks.
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

### New or updated backend modules

- `apps/onboarding/lib/openrouter.ts`
- `apps/onboarding/lib/paybylink.ts`
- `apps/onboarding/lib/billing.ts`
- `apps/onboarding/lib/coder.ts`
- `apps/onboarding/lib/db.ts`

### New or updated route handlers

- `apps/onboarding/app/api/signup/route.ts`
- `apps/onboarding/app/api/sandboxes/route.ts`
- `apps/onboarding/app/api/billing/checkout/route.ts`
- `apps/onboarding/app/api/billing/paybylink/webhook/route.ts`
- `apps/onboarding/app/api/billing/summary/route.ts`
- `apps/onboarding/app/api/internal/billing/sync-usage/route.ts`

### Database and workspace template changes

- `apps/onboarding/db/schema.sql`
- `apps/onboarding/db/migrate.ts`
- `coder/template/main.tf`
- `k8s/coder-template/main.tf`

## Runtime Configuration

Required environment:

- `OPENROUTER_MANAGEMENT_KEY` or `OPENROUTER_MANAGEMENT_API_KEY`
- `PAYBYLINK_SHOP_ID`
- `PAYBYLINK_PRIVATE_KEY`
- `BILLING_SYNC_SECRET`

Optional pricing configuration:

- `BILLING_USD_TO_PLN_RATE`
- `BILLING_ACTIVATION_FEE_PLN`

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

### `lib/paybylink.ts`

Responsibilities:

- create a checkout session or payment link
- verify webhook signatures and normalize event payloads
- map provider-specific fields into stable billing-domain fields

This module also never writes to the database directly.

### `lib/billing.ts`

Responsibilities:

- create a pending order
- mark an order paid in an idempotent transaction
- provision the first OpenRouter key for a user
- apply a top-up to an existing OpenRouter key
- synchronize secrets into Coder
- update `llm_accounts` and `llm_usage_snapshots`
- suspend an account after refund/chargeback/admin action

This is the orchestration layer that combines DB writes, Coder calls, and
OpenRouter calls.

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

Request body:

- `plan_type`: `activation` or `topup`
- `credits_usd`: numeric amount to provision after payment

Behavior:

- creates a `billing_orders` row with `status='pending'`
- calls PayByLink
- stores `provider_order_id`
- returns a payment URL and the local order id

### `POST /api/billing/paybylink/webhook`

Unauthenticated route protected by provider signature verification.

Behavior:

- verifies signature, provider order id, amount, and currency
- inserts a `billing_events` row keyed by `provider_event_id`
- if already processed, returns success without duplicating work
- marks the target order as `paid`
- ensures the user has a Coder user
- creates or updates the OpenRouter key
- synchronizes Coder user secrets
- updates `llm_accounts`

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
2. Onboarding creates `billing_orders(status='pending')`.
3. Onboarding requests a PayByLink payment URL.
4. UI redirects the user to payment.

### 3. First successful payment

1. PayByLink calls `POST /api/billing/paybylink/webhook`.
2. Onboarding validates the webhook and records `billing_events`.
3. Onboarding marks the order `paid`.
4. If the user has no `coder_user_id`, onboarding runs `ensureCoderUser`.
5. Onboarding creates one OpenRouter inference key.
6. Onboarding stores only metadata plus `openrouter_key_hash`.
7. Onboarding upserts per-user Coder secrets:
   - `OPENROUTER_API_KEY`
   - `ANTHROPIC_AUTH_TOKEN`
8. Onboarding marks `llm_accounts.status='active'` and
   `coder_secret_sync_state='synced'`.

### 4. Sandbox creation after payment

1. Authenticated user calls `POST /api/sandboxes`.
2. Onboarding verifies:
   - the user owns an active `llm_accounts` row
   - `coder_secret_sync_state='synced'`
3. Only then does onboarding create the Coder workspace.

### 5. Top-up

1. Authenticated user creates another checkout with `plan_type='topup'`.
2. A paid webhook updates the existing OpenRouter key limit instead of creating
   a new key.
3. Coder secrets remain unchanged because the key value itself does not change.

### 6. Usage sync

1. Internal cron calls `POST /api/internal/billing/sync-usage`.
2. Onboarding reads current usage from OpenRouter.
3. Onboarding stores `llm_usage_snapshots`.
4. Dashboard summary reads the latest snapshot for display.

### 7. Refund, chargeback, or suspension

1. Billing state is changed to `refunded`, `chargeback`, or admin-suspended.
2. Onboarding disables the OpenRouter key.
3. Onboarding marks `llm_accounts.status='suspended'` or `revoked`.
4. New sandbox creation is blocked immediately.
5. Existing workspace sessions lose future provider access when the secret stops
   authorizing requests.

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

`apps/onboarding/app/api/sandboxes/route.ts` must reject creation when any of
the following are true:

- no paid `billing_orders` exist for the user
- no `llm_accounts` row exists for the user
- `llm_accounts.status` is not `active`
- `coder_secret_sync_state` is not `synced`

Expected response for blocked users:

- `402` or `403` with a stable JSON error code the UI can render

## Verification Plan

### Automated

- API test: `POST /api/billing/checkout` creates `billing_orders`
- API test: repeated webhook delivery with the same `provider_event_id` is
  idempotent
- API test: first successful payment creates `llm_accounts`
- API test: top-up updates the existing `llm_accounts` row rather than creating
  a second one
- API test: `POST /api/sandboxes` returns blocked status for unpaid users
- unit test: OpenRouter payload mapping and webhook signature verification

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
