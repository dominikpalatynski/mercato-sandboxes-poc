# Run: coder-subdomain-apps

Date: 2026-05-17
Branch: k8s-workspaces-poc
Start commit: d46878f165fe806f91462c59d70f19c46f0fdb97
Request: Switch the Kubernetes Coder template from manually composed external app URLs to Coder-managed subdomain/share apps.

## Assumptions

- The desired scope is the Kubernetes Coder template plus the onboarding URL resolver; the Docker Compose template is unchanged.
- `share = "owner"` is the correct minimal access policy for VS Code, app, and splash in this iteration.
- Local Kubernetes still exposes the wildcard ingress through `:8443`, so onboarding must normalize Coder-returned subdomain app URLs to the public scheme and port.

## Spec Updates

- Updated `.ai/SPEC.md` with the `subdomain = true` / `share = "owner"` requirement for Kubernetes Coder apps and the onboarding URL-resolution rule.
- Updated `.ai/WORKLIST.md` to record the new subdomain-app migration as a completed fix.

## Tasks

- [x] Update the Kubernetes Coder template app resources to use `subdomain = true` and `share = "owner"` — verify with `terraform fmt k8s/coder-template/main.tf`
- [x] Update onboarding Coder app URL resolution for subdomain apps and local `:8443` normalization — verify with `npm test` in `apps/onboarding`
- [x] Re-run the onboarding production build after the resolver change — verify with `npm run build` in `apps/onboarding`

## Execution Log

### 2026-05-17 08:18 CEST

- Changed: run note created
- Ran: `git rev-parse --abbrev-ref HEAD`, `git rev-parse HEAD`, `git status --short`
- Result: confirmed branch `k8s-workspaces-poc`, start commit `d46878f165fe806f91462c59d70f19c46f0fdb97`, and existing dirty worktree from the earlier pause/resume change

### 2026-05-17 08:20 CEST

- Changed: `k8s/coder-template/main.tf`, `apps/onboarding/lib/coder.ts`, `apps/onboarding/tests/coder.test.ts`
- Ran: none
- Result: migrated `coder_app` resources to Coder-managed subdomain apps with `share = "owner"` and updated onboarding to prefer API-returned subdomain URLs while normalizing them to the public scheme/port

### 2026-05-17 08:21 CEST

- Changed: `k8s/coder-template/main.tf`, `.ai/SPEC.md`, `.ai/WORKLIST.md`
- Ran: `terraform fmt k8s/coder-template/main.tf`
- Result: pass; formatted the template and documented the subdomain-app contract in the spec/worklist

### 2026-05-17 08:21 CEST

- Changed: none
- Ran: `npm test`
- Result: pass; added regression coverage for subdomain app URL resolution and local public-port normalization

### 2026-05-17 08:21 CEST

- Changed: none
- Ran: `npm run build`
- Result: pass; Next.js production build completed without needing escalated network access in this run

## Final Status

- Completed:
  - Kubernetes Coder template app resources now use `subdomain = true` with `share = "owner"` instead of manually composed `external` wildcard URLs
  - onboarding now consumes Coder-returned subdomain app URLs and normalizes them to the local public scheme/port
  - regression tests cover subdomain URL resolution and the path-based fallback
- Not completed:
  - runtime env bootstrap for Mercato still uses the manually composed `APP_URL` for port 3000; this change did not attempt to source that from Coder app metadata
  - no live end-to-end Kubernetes workspace smoke was run against a real cluster in this turn
- Residual risks:
  - local `:8443` still depends on onboarding normalizing returned app URLs because `CODER_WILDCARD_ACCESS_URL` is configured without the port suffix
  - if a future Coder version changes the app JSON shape beyond `subdomain` and `url`, `getWorkspaceStatus()` will need a matching schema update
