# Run: openrouter-onboarding-minispec

Date: 2026-05-16
Branch: k8s-workspaces-poc
Start commit: 5bab516
Request: Prepare a mini-spec for OpenRouter billing/key provisioning in `apps/onboarding`

## Assumptions

- `apps/onboarding` remains the only backend for onboarding and sandbox API
  work in alpha.
- OpenRouter key delivery should go through per-user Coder secrets rather than
  shared template variables.
- Alpha can use provider-side USD limits as the enforcement mechanism.

## Spec Updates

- Created `.ai/SPEC-OPENROUTER-ONBOARDING.md`
- Updated `.ai/WORKLIST.md`

## Tasks

- [x] Review current onboarding, auth, sandbox, and schema layout — verify with
  file inspection
- [x] Write a scoped mini-spec for billing, OpenRouter, and Coder secret sync —
  verify with document review
- [x] Add actionable follow-up items to `.ai/WORKLIST.md` — verify with
  document review

## Execution Log

### 2026-05-16 09:34 CEST

- Changed: none
- Ran: `sed -n '1,260p' .ai/SPEC.md`
- Result: confirmed current top-level product spec and its scope

### 2026-05-16 09:34 CEST

- Changed: none
- Ran: `sed -n '1,220p' .ai/Alpha_requirements.md`
- Result: confirmed alpha requirement text for OpenRouter and billing

### 2026-05-16 09:34 CEST

- Changed: none
- Ran: `find apps/onboarding -maxdepth 3 -type f | sort`
- Result: confirmed `apps/onboarding` already contains auth, DB, and sandbox
  API layers

### 2026-05-16 09:34 CEST

- Changed: none
- Ran: `sed -n '1,220p' apps/onboarding/lib/coder.ts`
- Result: confirmed current Coder integration lives in onboarding and is the
  right extension point

### 2026-05-16 09:34 CEST

- Changed: `.ai/SPEC-OPENROUTER-ONBOARDING.md`, `.ai/WORKLIST.md`
- Ran: `mkdir -p .ai/runs`
- Result: created run-note directory and prepared repo docs for the new spec

## Final Status

- Completed: mini-spec for OpenRouter billing in `apps/onboarding`; worklist
  updated with implementation tasks
- Not completed: implementation, migrations, tests, provider integration
- Residual risks: Coder user-secret API details and PayByLink webhook contract
  still need confirmation during implementation
