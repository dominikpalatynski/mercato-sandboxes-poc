# Run: subdomain-host-label-fix

Date: 2026-05-17
Branch: k8s-workspaces-poc
Start commit: d46878f165fe806f91462c59d70f19c46f0fdb97
Request: Fix local sandbox app links when Coder returns a bare `subdomain_name` label without the wildcard apps domain suffix.

## Assumptions

- In the affected local setup, Coder returns `subdomain_name` values like `code-server--test1--superadmin` instead of a fully qualified hostname.
- Local nginx/ingress is already configured for `*.apps.sandbox.lvh.me`, so the missing suffix must be added in onboarding URL construction.
- The existing direct onboarding URL `http://sandbox.lvh.me:3000/...` is a separate access-path issue; this fix is limited to the broken app hostnames.

## Spec Updates

- Updated `.ai/SPEC.md` and `.ai/WORKLIST.md` to describe the case where Coder returns a bare `subdomain_name` label and onboarding must append `WILDCARD_APPS_DOMAIN`.

## Tasks

- [x] Update onboarding subdomain URL construction to append `WILDCARD_APPS_DOMAIN` when `subdomain_name` is a bare label — verify with `npm test` in `apps/onboarding`
- [x] Update docs/spec notes for the bare-label subdomain case — verify with doc review
- [x] Re-run the onboarding production build after the host-label fix — verify with `npm run build` in `apps/onboarding`

## Execution Log

### 2026-05-17 08:41 CEST

- Changed: run note created
- Ran: none
- Result: captured the remaining local-hostname regression after the earlier `subdomain_name` fix

### 2026-05-17 08:43 CEST

- Changed: `apps/onboarding/lib/coder.ts`, `apps/onboarding/tests/coder.test.ts`
- Ran: none
- Result: updated subdomain app URL construction to append the configured wildcard apps domain when Coder returns only a bare host label, and added regression coverage for bare-label plus fully-qualified cases

### 2026-05-17 08:43 CEST

- Changed: `.ai/SPEC.md`, `.ai/WORKLIST.md`
- Ran: none
- Result: documented the bare-label `subdomain_name` fallback so the local routing contract is explicit

### 2026-05-17 08:44 CEST

- Changed: none
- Ran: `npm test`
- Result: pass; resolver coverage now includes bare host labels, preserved VS Code query parameters, and already-qualified subdomain names

### 2026-05-17 08:45 CEST

- Changed: none
- Ran: `npm run build`
- Result: first attempt hit a transient `PageNotFoundError` while collecting page data for existing API routes

### 2026-05-17 08:46 CEST

- Changed: none
- Ran: `npm run build`
- Result: pass; rerun completed successfully, indicating the earlier page-data failure was a build flake rather than a resolver regression

## Final Status

- Completed:
  - onboarding now appends `WILDCARD_APPS_DOMAIN` when Coder returns a bare `subdomain_name` label
  - subdomain app links still preserve path and query fragments such as the VS Code folder parameter
  - docs/spec notes now describe the bare-label local case explicitly
- Not completed:
  - no live sandbox smoke was run against a real Coder workspace in this turn
- Residual risks:
  - local direct onboarding access on `http://sandbox.lvh.me:3000` still bypasses the public HTTPS edge and its cookie/routing behavior; that is separate from the app-link hostname fix
