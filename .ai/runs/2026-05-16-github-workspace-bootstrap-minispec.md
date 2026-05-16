# Run: github-workspace-bootstrap-minispec

Date: 2026-05-16
Branch: k8s-workspaces-poc
Start commit: 5bab516
Request: Prepare an English implementation spec for GitHub sync and workspace bootstrap

## Assumptions

- The immediate goal is a scoped alpha spec, not implementation.
- `apps/onboarding` remains the only backend for GitHub connect, storage, and
  sandbox bootstrap orchestration in alpha.
- Coder user secrets are too broad for sandbox-specific GitHub bootstrap, so
  the spec should introduce a workspace bootstrap mechanism.

## Spec Updates

- Created `.ai/SPEC-GITHUB-WORKSPACE-BOOTSTRAP.md`
- Updated `.ai/WORKLIST.md`

## Tasks

- [x] Review current onboarding, Coder, and workspace bootstrap extension
  points — verify with file inspection
- [x] Write an English mini-spec for GitHub account sync and workspace
  bootstrap — verify with document review
- [x] Add a concrete implementation follow-up to `.ai/WORKLIST.md` — verify
  with document review

## Execution Log

### 2026-05-16 10:05 CEST

- Changed: none
- Ran: `sed -n '1,220p' .ai/Alpha_requirements.md`
- Result: confirmed the alpha requirement text for CLI, VS Code, and GitHub
  support

### 2026-05-16 10:05 CEST

- Changed: none
- Ran: `sed -n '1,220p' .codex/skills/continue-development/SKILL.md`
- Result: confirmed spec-first workflow expectations for this repo

### 2026-05-16 10:06 CEST

- Changed: none
- Ran: `sed -n '1,260p' apps/onboarding/lib/coder.ts`
- Result: confirmed user-secret helpers already exist and that workspace
  creation still sends empty `rich_parameter_values`

### 2026-05-16 10:06 CEST

- Changed: none
- Ran: `sed -n '1,180p' apps/onboarding/app/api/sandboxes/route.ts`
- Result: confirmed sandbox creation is the right place to attach bootstrap
  token generation and workspace parameters

### 2026-05-16 10:08 CEST

- Changed: `.ai/SPEC-GITHUB-WORKSPACE-BOOTSTRAP.md`, `.ai/WORKLIST.md`
- Ran: `git status --short`
- Result: verified the repo is already dirty and kept the spec-only changes
  isolated

## Final Status

- Completed: English mini-spec for GitHub account sync and workspace bootstrap;
  worklist updated with implementation follow-up
- Not completed: implementation, migrations, OAuth flow, workspace bootstrap,
  tests
- Residual risks: exact GitHub OAuth scope set and Coder hidden-parameter
  mechanics still need confirmation during implementation
