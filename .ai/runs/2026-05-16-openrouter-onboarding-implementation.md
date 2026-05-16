# Run: openrouter-onboarding-implementation

Date: 2026-05-16
Branch: k8s-workspaces-poc
Start commit: 5bab516
Request: Implement `.ai/SPEC-OPENROUTER-ONBOARDING.md`

## Assumptions

- `apps/onboarding` remains the only alpha backend for checkout, webhook
  processing, OpenRouter provisioning, usage sync, and sandbox entitlement.
- PayByLink online-transfer integration uses
  `https://secure.paybylink.pl/api/v1/transfer/generate` for checkout creation
  and JSON webhook notifications on `notifyURL`, signed with the partner
  private key.
- Coder user secrets are available through `/api/v2/users/{user}/secrets` and
  are injected into workspaces on the next workspace start.
- OpenRouter management-key endpoints at `/api/v1/keys` and `/api/v1/keys/:hash`
  are the source of truth for per-user key limits and usage.

## Spec Updates

- Updated `.ai/SPEC-OPENROUTER-ONBOARDING.md` to reflect the implemented repo
  state and required runtime environment
- Updated `.ai/WORKLIST.md` to move the implementation item into completed work
  and leave only the live-provider smoke follow-up

## Tasks

- [x] Extend onboarding schema and DB helpers for billing + LLM account state
  — verify with `npm test`
- [x] Add PayByLink, OpenRouter, and Coder-secret orchestration in
  `apps/onboarding` — verify with targeted route/unit tests
- [x] Gate sandbox creation on active synced LLM entitlement — verify with API
  tests for blocked creation before provisioning calls
- [x] Update workspace templates/scripts to remove shared AI keys and switch to
  per-user Coder secrets — verify with file inspection and `npm run build`
  through compile/type/static generation
- [x] Add dashboard billing summary + checkout entry point — verify with
  `npm run build` through compile/type/static generation

## Execution Log

### 2026-05-16 21:45 CEST

- Changed: none
- Ran: `sed -n '1,260p' .ai/SPEC-OPENROUTER-ONBOARDING.md`
- Result: confirmed required API routes, data model, workspace bootstrap, and
  verification targets

### 2026-05-16 21:46 CEST

- Changed: none
- Ran: `sed -n '1,340p' apps/onboarding/app/api/sandboxes/route.ts`
- Result: confirmed current sandbox flow provisions Coder users/workspaces
  without any billing or entitlement guard

### 2026-05-16 21:47 CEST

- Changed: none
- Ran: `sed -n '1,320p' k8s/coder-template/main.tf`
- Result: confirmed current templates still inject shared `OPENAI_API_KEY` and
  `ANTHROPIC_API_KEY`

### 2026-05-16 22:07 CEST

- Changed: `apps/onboarding/db/schema.sql`, `apps/onboarding/lib/db.ts`,
  `apps/onboarding/lib/coder.ts`, `apps/onboarding/lib/openrouter.ts`,
  `apps/onboarding/lib/paybylink.ts`, `apps/onboarding/lib/billing.ts`,
  `apps/onboarding/app/api/billing/*`, `apps/onboarding/app/api/internal/billing/sync-usage/route.ts`,
  `apps/onboarding/app/api/sandboxes/route.ts`, `apps/onboarding/app/dashboard/*`,
  `apps/onboarding/app/page.tsx`, `apps/onboarding/app/sandboxes/new/form.tsx`
- Ran: implementation edits
- Result: added billing tables, orchestration, API routes, dashboard billing UI,
  and the sandbox entitlement gate

### 2026-05-16 22:10 CEST

- Changed: `coder/template/main.tf`, `k8s/coder-template/main.tf`,
  `scripts/push-template.sh`, `k8s/scripts/push-template.sh`, `README.md`
- Ran: implementation edits
- Result: removed shared AI template variables and switched both workspace
  templates to managed OpenRouter/Coder-secret bootstrap

### 2026-05-16 22:18 CEST

- Changed: `apps/onboarding/tests/*`, `apps/onboarding/package.json`
- Ran: `npm test`
- Result: pass; 7 tests covering checkout creation, first-payment provisioning,
  webhook idempotency, top-up reuse, entitlement guard, and PayByLink signature
  verification

### 2026-05-16 22:24 CEST

- Changed: none
- Ran: `npm run build`
- Result: compile/type check initially exposed billing TypeScript issues around
  `limit_reset` and retry-error narrowing; fixed in follow-up edits

### 2026-05-16 22:31 CEST

- Changed: none
- Ran: `npm run build`
- Result: production build now passes font fetch, compile, type checking, page
  generation, and trace collection until the final standalone file-copy step,
  which fails locally with `ENOSPC`

### 2026-05-16 22:44 CEST

- Changed: `scripts/mock-paybylink.js`, `README.md`
- Ran: `node --check scripts/mock-paybylink.js`
- Result: added a local mock PayByLink checkout server for
  `POST /api/v1/transfer/generate`; syntax check passed

## Final Status

- Completed: billing schema, orchestration, new billing routes, dashboard
  billing UI, entitlement guard, Coder user-secret sync helpers, template
  bootstrap changes, automated tests, and spec/worklist updates
- Not completed: live provider-backed manual smoke for PayByLink, OpenRouter,
  and a paid workspace session
- Residual risks: the final `next build` standalone copy step is blocked by low
  local disk space (`ENOSPC`), and live provider credentials were not available
  in this session for an end-to-end payment/authentication smoke
