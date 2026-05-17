# Run: resume-dev-command

Date: 2026-05-17
Branch: k8s-workspaces-poc
Start commit: d46878f165fe806f91462c59d70f19c46f0fdb97
Request: Fix workspace resume so the Mercato app process starts correctly after pause/resume.

## Assumptions

- The observed failure is caused by re-running `yarn setup` on workspace resume instead of relaunching the dev server directly.
- A minimal fix can treat "app directory already exists" as the resume signal for now.
- Both the Docker and Kubernetes Coder templates should stay behaviorally aligned.

## Spec Updates

- Updated `.ai/SPEC.md` to require `resume` to relaunch the Mercato dev process with `yarn dev`.
- Updated `.ai/WORKLIST.md`, `README.md`, and `k8s/coder-template/README.md` to describe the new first-boot vs resume startup split.

## Tasks

- [x] Update both Coder startup scripts so first boot runs `yarn setup` and resume runs `yarn dev` — verify with `terraform fmt` on both templates
- [x] Update docs/spec notes for the revised resume behavior — verify with doc review

## Execution Log

### 2026-05-17 08:26 CEST

- Changed: run note created
- Ran: `date '+%Y-%m-%d %H:%M %Z'`
- Result: captured current execution time for the resume-dev follow-up

### 2026-05-17 08:27 CEST

- Changed: `coder/template/main.tf`, `k8s/coder-template/main.tf`
- Ran: none
- Result: split workspace app startup into `yarn setup` for first boot and `yarn dev` for later start/resume cycles, with a small log line recorded in `/tmp/mercato-dev.log`

### 2026-05-17 08:27 CEST

- Changed: `.ai/SPEC.md`, `.ai/WORKLIST.md`, `README.md`, `k8s/coder-template/README.md`
- Ran: `terraform fmt coder/template/main.tf k8s/coder-template/main.tf`
- Result: pass; formatted both templates and updated the repo docs/spec notes for the revised resume behavior

## Final Status

- Completed:
  - both Coder templates now relaunch Mercato with `yarn dev` when the workspace home already exists
  - first boot still uses `yarn setup` after scaffolding a fresh app directory
  - docs/spec notes now describe the first-boot vs resume split explicitly
- Not completed:
  - startup still uses app-directory existence as the resume heuristic; there is no dedicated bootstrap-complete marker file yet
  - no live pause/resume workspace smoke was run in this turn
- Residual risks:
  - if a first boot fails after creating `$HOME/app` but before a usable install is ready, the next resume will still choose `yarn dev`; a dedicated marker file would make that state detection stricter
