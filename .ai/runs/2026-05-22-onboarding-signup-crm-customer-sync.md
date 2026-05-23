# Run: onboarding-signup-crm-customer-sync

Date: 2026-05-22
Branch: k8s-workspaces-poc
Start commit: 205f91041e54356bab30807f06c62665ae4450f3
Request: Podczas zakładania konta w onboarding utworzyć customera w CRM przez openmercato-client.ts

## Assumptions

- Onboarding should reuse the existing Open Mercato REST API instead of adding
  a new CRM-specific endpoint.
- The Open Mercato API key used by onboarding is scoped to roles that include
  `customers.people.view` and `customers.people.manage`.
- CRM signup sync should use one configured tenant/org scope shared by the
  onboarding deployment.

## Spec Updates

- Updated `.ai/SPEC.md` with the signup CRM sync contract and required envs.
- Updated `.ai/WORKLIST.md` with the completed onboarding-side customer sync.

## Tasks

- [x] Regenerate `apps/crm` after enabling `api_keys` in `src/modules.ts` — verify with `yarn generate`
- [x] Add onboarding-side Open Mercato customer find-or-create helper — verify with `npm test`
- [x] Persist CRM identifiers on onboarding users and wire signup to CRM sync — verify with `npm test`
- [x] Document the new tenant/org env wiring for cluster deploys — verify by diff review

## Execution Log

### 2026-05-22 21:00 Europe/Warsaw

- Changed: `apps/crm/.mercato/generated/*`
- Ran: `yarn generate`
- Result: pass with OpenAPI fallback warning caused by `isolated-vm` native build missing for local Node 25; generator completed and emitted updated manifests.

### 2026-05-22 21:10 Europe/Warsaw

- Changed: `apps/onboarding/db/schema.sql`, `apps/onboarding/lib/openmercato-customers.ts`, `apps/onboarding/lib/signup.ts`, `apps/onboarding/app/api/signup/route.ts`, onboarding tests
- Ran: `npm test -- openmercato-customers.test.ts signup.test.ts openmercato-client.test.ts`
- Result: fail; exposed an existing bug where `resolveOpenMercatoApiBaseUrl()` did not fall back to `OPENMERCATO_BILLING_BASE_URL` despite test coverage.

### 2026-05-22 21:15 Europe/Warsaw

- Changed: `apps/onboarding/lib/openmercato-client.ts`
- Ran: `npm test`
- Result: pass; 29 onboarding tests green.

### 2026-05-22 21:20 Europe/Warsaw

- Changed: `infra/helm/values/onboarding.yaml`, `infra/manifests/onboarding/onboarding-app-secrets.template.yaml`, `infra/helm/README.md`
- Ran: `git diff -- apps/onboarding infra/helm .ai`
- Result: pass; deployment templates now expose the tenant/org envs needed for signup CRM sync.

## Final Status

- Completed: CRM customer create-or-reuse during onboarding signup, local persistence of CRM ids, deployment config/docs, onboarding regression tests.
- Not completed: live end-to-end smoke against a running CRM instance with a real scoped API key.
- Residual risks: Signup CRM sync depends on the configured API key having `customers.people.view/manage`; if the key lacks those features, signup now fails with a dependency error until the credential is fixed.
