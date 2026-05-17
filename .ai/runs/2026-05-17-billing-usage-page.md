# Run: billing-usage-page

Date: 2026-05-17
Branch: k8s-workspaces-poc
Start commit: 288ef882e439d7b7c944b7be7888a326e967fd7b
Request: Create a dedicated onboarding billing page for AI usage and remove the billing card from the main dashboard.

## Assumptions

- The intended UX is one authenticated billing route at `/billing`, not a nested
  dashboard widget or a second sandbox page.
- Dashboard must still expose a clear path to activate AI access when sandbox
  creation is blocked.
- The existing billing summary data contract is sufficient for the first
  dedicated usage page without database or API changes.

## Spec Updates

- Updated `.ai/SPEC.md` with the authenticated navigation split between
  `/dashboard` and `/billing`.
- Updated `.ai/WORKLIST.md` to record the dedicated billing page as a completed
  onboarding UX change.

## Tasks

- [x] Create a dedicated `/billing` onboarding page for AI usage and checkout actions — verify with `npx tsc --noEmit` in `apps/onboarding`
- [x] Remove the inline billing card from `/dashboard` while keeping a clear billing CTA for blocked users — verify with `npx tsc --noEmit` in `apps/onboarding`
- [x] Add regression coverage for the new billing navigation/checkout routing behavior — verify with `npm test` in `apps/onboarding`
- [ ] Re-run `npm run build` in an environment with a clean app build state and network access to Google Fonts — verify with `npm run build` in `apps/onboarding`

## Execution Log

### 2026-05-17 16:15 CEST

- Changed: `.ai/SPEC.md`, `.ai/WORKLIST.md`, `.ai/runs/2026-05-17-billing-usage-page.md`
- Ran: none
- Result: documented the new dedicated billing-page requirement before UI implementation

### 2026-05-17 16:31 CEST

- Changed: `apps/onboarding/app/billing/page.tsx`, `apps/onboarding/app/dashboard/page.tsx`, `apps/onboarding/components/authenticated-nav.tsx`, `apps/onboarding/components/billing-usage-card.tsx`, `apps/onboarding/components/site-header.tsx`, `apps/onboarding/components/account-menu.tsx`, `apps/onboarding/components/site-footer.tsx`, `apps/onboarding/lib/app-sections.ts`, `apps/onboarding/lib/billing.ts`, `apps/onboarding/tests/billing.test.ts`, `apps/onboarding/tests/navigation.test.ts`
- Ran: none
- Result: moved billing/usage into a dedicated `/billing` route, removed the inline dashboard card, added authenticated navigation, and pointed blocked dashboard users plus checkout success back to billing

### 2026-05-17 16:32 CEST

- Changed: none
- Ran: `npm test`
- Result: pass; billing and navigation regression coverage both passed in `apps/onboarding`

### 2026-05-17 16:33 CEST

- Changed: none
- Ran: `npm run build`
- Result: failed in the repo working tree during page-data collection for existing routes `/api/sandboxes/[id]/resume` and `/api/sandboxes/[id]`; the partial `.next/server/app-paths-manifest.json` omitted many routes even though the compiled route files existed

### 2026-05-17 16:34 CEST

- Changed: none
- Ran: `npm run build` in `/private/tmp/onboarding-build.uG4x48`
- Result: failed earlier for environment reasons because `next/font` could not fetch `Inter` and `JetBrains Mono` from `fonts.googleapis.com` under restricted network access

### 2026-05-17 16:35 CEST

- Changed: none
- Ran: `npx tsc --noEmit`
- Result: pass; TypeScript validation succeeded for the updated onboarding app without relying on external font downloads

## Final Status

- Completed:
  - onboarding now exposes a dedicated `/billing` page for AI usage and checkout actions
  - the main `/dashboard` page is focused on sandbox management again
  - authenticated header/footer/account navigation now exposes `Billing`
  - blocked sandbox creation on the dashboard links directly to `/billing`
  - billing checkout success now returns users to `/billing`
  - regression coverage now checks the billing return URL and the authenticated nav model
- Not completed:
  - a clean `npm run build` result from the main workspace was not captured in this turn because the existing build output/state caused missing-route manifest errors, and a clean temporary build was blocked by sandboxed font downloads
- Residual risks:
  - no browser smoke test was run against `/billing`
  - the workspace still has an unresolved production-build verification gap tied to `.next` state and external font fetching rather than the billing-page code itself
