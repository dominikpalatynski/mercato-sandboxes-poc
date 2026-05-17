# Run: subdomain-public-url-fix

Date: 2026-05-17
Branch: k8s-workspaces-poc
Start commit: d46878f165fe806f91462c59d70f19c46f0fdb97
Request: Fix broken sandbox app links that started showing `localhost` after the Coder subdomain-app migration.

## Assumptions

- Coder's workspace app payload exposes the browser-facing host in `subdomain_name`, while `url` remains the internal proxied target such as `http://localhost:3000`.
- The right minimal fix is in onboarding URL resolution, not in the Coder template itself.
- The local Kubernetes `:8443` public port still needs to be applied when constructing the browser-facing URL.

## Spec Updates

- Updated `.ai/SPEC.md` to describe the correct Coder subdomain app contract: `subdomain_name` is the browser-facing host, while `url` contributes the proxied path/query.
- Updated `.ai/WORKLIST.md` to record the corrected onboarding resolver behavior.

## Tasks

- [x] Update onboarding workspace app parsing/resolution to use `subdomain_name` for subdomain apps and preserve path/query from `url` — verify with `npm test` in `apps/onboarding`
- [x] Update spec/worklist notes for the corrected subdomain app URL contract — verify with doc review
- [x] Re-run the onboarding production build after the resolver fix — verify with `npm run build` in `apps/onboarding`

## Execution Log

### 2026-05-17 08:33 CEST

- Changed: run note created
- Ran: none
- Result: recorded the localhost-link regression introduced by the earlier subdomain-app migration

### 2026-05-17 08:35 CEST

- Changed: `apps/onboarding/lib/coder.ts`, `apps/onboarding/app/api/sandboxes/[id]/status/route.ts`, `apps/onboarding/tests/coder.test.ts`
- Ran: none
- Result: switched subdomain app URL resolution from `url` to `subdomain_name`, while keeping the original path/query from the proxied app URL for cases such as VS Code

### 2026-05-17 08:35 CEST

- Changed: `.ai/SPEC.md`, `.ai/WORKLIST.md`
- Ran: none
- Result: corrected the documented subdomain-app contract so future changes do not treat `url` as the browser-facing host

### 2026-05-17 08:36 CEST

- Changed: none
- Ran: `npm test`
- Result: pass; onboarding regression tests now cover public subdomain host construction from `subdomain_name` plus VS Code query preservation

### 2026-05-17 08:37 CEST

- Changed: none
- Ran: `npm run build`
- Result: pass; Next.js production build completed with the corrected subdomain app URL resolver

## Final Status

- Completed:
  - onboarding now uses Coder's `subdomain_name` as the browser-facing host for subdomain apps
  - the original proxied `url` now only contributes path/query fragments such as `?folder=/home/coder/app`
  - regression coverage now protects both plain app URLs and VS Code query preservation
- Not completed:
  - no live sandbox smoke was run against a real Coder workspace in this turn
- Residual risks:
  - if Coder omits `subdomain_name` for a subdomain app, onboarding still falls back to the older `url` normalization path
