# Run: onboarding-om-subscriptions-billing

Date: 2026-05-22
Branch: k8s-workspaces-poc
Request: Wbudować billing onboardingu na bazie modułu `subscriptions` z CRM
przez `OpenMercatoClient`. Usunąć PayByLink. OpenRouter provisioning ma być
side-effectem subscription activation, nie częścią checkoutu.

## Decisions

- OM `subscriptions` jest source of truth dla planu, ceny, sesji checkoutu,
  stanu subskrypcji i access state. Onboarding nigdy nie woła Stripe.
- Bridge OM → onboarding to custom CRM moduł `onboarding_bridge` z
  persystentnym subscriberem na `subscriptions.access.changed`, który robi
  HMAC-signed POST na `onboarding /api/billing/om/webhook`.
- Webhook to tylko trigger — zawsze reconcile czyta świeży snapshot z
  `GET /api/subscriptions/access` jako źródło prawdy.
- `/billing` page i `assertActiveSandboxEntitlement` wołają reconcile na
  każde wejście, więc dropped webhook samo się leczy.
- PayByLink usunięty całkowicie. Stripe via OM to jedyna ścieżka.

## Tasks

- [x] Faza 0: weryfikacja preconditions (users ma openmercato_customer_person_id,
      CRM modules.ts ma subscriptions + gateway_stripe, plan w plans.ts ok)
- [x] Faza 1: `lib/openmercato-subscriptions.ts` + testy
- [x] Faza 1: `lib/om-billing.ts` (orchestrator) + 10 testów
- [x] Faza 1: przepięcie `/api/billing/checkout` na OM
- [x] Faza 1: refresh `/api/billing/summary`, `/billing` page, `BillingUsageCard`
- [x] Faza 2: `/api/billing/om/webhook` w onboardingu (HMAC + dedupe + reconcile)
- [x] Faza 2: guard w `/api/sandboxes` i `/api/internal/billing/sync-usage`
      przez `om-billing`
- [x] Faza 2: CRM moduł `onboarding_bridge` + subscriber, `yarn generate`
- [x] Faza 3: usunięcie PayByLink (lib/billing.ts, lib/paybylink.ts,
      lib/billing-types.ts, tests, routes), inline BILLING_ERROR_CODES
- [x] Faza 3: update `.ai/SPEC.md`, `.ai/SPEC-OPENROUTER-ONBOARDING.md`,
      `.ai/WORKLIST.md`

## Execution Log

### 2026-05-22 22:00 Europe/Warsaw

- Added: `apps/onboarding/lib/openmercato-subscriptions.ts`,
  `apps/onboarding/tests/openmercato-subscriptions.test.ts`
- Ran: `npm test -- tests/openmercato-subscriptions.test.ts`
- Result: pass; 34 onboarding tests green.

### 2026-05-22 22:20 Europe/Warsaw

- Added: `apps/onboarding/lib/om-billing.ts`,
  `apps/onboarding/tests/om-billing.test.ts`
- Ran: `npm test -- tests/om-billing.test.ts`
- Result: pass; 44 onboarding tests green, including 10 new for the
  orchestrator (checkout, reconcile granted/blocked/no-op, sandbox guard,
  HMAC verify, dedupe).

### 2026-05-22 22:30 Europe/Warsaw

- Replaced: `apps/onboarding/app/api/billing/checkout/route.ts`,
  `apps/onboarding/app/api/billing/summary/route.ts`,
  `apps/onboarding/app/billing/page.tsx`,
  `apps/onboarding/components/billing-usage-card.tsx`
- Result: UI now renders subscription/access state and CTA "Subscribe" /
  "Manage subscription". Checkout returns `{ checkout_url }`.

### 2026-05-22 22:40 Europe/Warsaw

- Added: `apps/onboarding/app/api/billing/om/webhook/route.ts`
- Updated: `apps/onboarding/app/api/sandboxes/route.ts`,
  `apps/onboarding/app/api/internal/billing/sync-usage/route.ts`,
  `apps/onboarding/app/dashboard/page.tsx`
- Result: webhook + guard + cron use `om-billing.reconcileLlmAccessForUser`.

### 2026-05-22 22:50 Europe/Warsaw

- Added CRM bridge module:
  `apps/crm/src/modules/onboarding_bridge/index.ts`,
  `apps/crm/src/modules/onboarding_bridge/subscribers/on-access-changed-forward.ts`
- Registered in `apps/crm/src/modules.ts` with `from: '@app'`.
- Ran: `yarn generate` in `apps/crm`.
- Result: pass with the pre-existing OpenAPI fallback warning (isolated-vm
  missing on Node 25). Generated manifests include the new subscriber under
  `subscribers.generated.ts` and the module in `modules.app.generated.ts`.

### 2026-05-22 23:00 Europe/Warsaw

- Removed: `apps/onboarding/lib/billing.ts`,
  `apps/onboarding/lib/paybylink.ts`,
  `apps/onboarding/lib/billing-types.ts`,
  `apps/onboarding/app/api/billing/paybylink/webhook/route.ts`,
  `apps/onboarding/tests/billing.test.ts`,
  `apps/onboarding/tests/paybylink.test.ts`
- Updated: `apps/onboarding/lib/openrouter.ts` (now imports
  `BILLING_ERROR_CODES` from `@/lib/om-billing`).
- Ran: `npm test`
- Result: pass; 37 onboarding tests green (44 minus 7 obsolete PayByLink
  tests).

## Final Status

- Completed: end-to-end OM-subscriptions billing path on the onboarding
  side, CRM bridge subscriber, sandbox guard, cron reconcile,
  documentation, PayByLink removal.
- Not completed:
  - live smoke against a real CRM tenant with Stripe in test mode
  - infra envs (`OM_BILLING_WEBHOOK_SECRET`, `ONBOARDING_WEBHOOK_URL`,
    `ONBOARDING_WEBHOOK_SECRET`, `BASIC_PLAN_PRICE_CODE`,
    `BASIC_PLAN_PRODUCT_CODE`) need to be added to `infra/helm/values/*`
    and onboarding/CRM secret templates before deploy
  - Phase 2 (push usage back to CRM as a new `subscriptions_usage`-like
    module) deferred per the plan
- Residual risks:
  - OM API key used by onboarding must have features
    `subscriptions.manage` + `subscriptions.access` granted. Existing key
    likely lacks them — verify before live tests.
  - CRM bridge subscriber is persistent: if `ONBOARDING_WEBHOOK_URL` /
    `ONBOARDING_WEBHOOK_SECRET` are missing, the subscriber silently no-ops
    (returns without forwarding). Verify env in deployment manifests.
