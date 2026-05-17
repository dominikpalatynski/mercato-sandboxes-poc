# Run: sandbox-preset-selection

Date: 2026-05-17
Branch: k8s-workspaces-poc
Start commit: d46878f
Request: Standardize sandbox preset selection, move bootstrap logic out of `k8s/coder-template/main.tf`, and support multiple Open Mercato presets from one Coder template.

## Assumptions

- The immediate supported presets are the three Open Mercato variants: `crm`, `empty`, and `classic`.
- The bare shell workspace should be modeled now but can remain non-creatable until the app/link UX is designed for non-Mercato ports.
- Existing dirty changes in `.ai/*`, onboarding, and template files are user work and must be preserved.

## Spec Updates

- Updated `.ai/SPEC.md` with the persisted `preset_id` / Coder `sandbox_preset` contract and acceptance criteria for `crm`, `empty`, and `classic`.
- Updated `.ai/WORKLIST.md` with the completed preset-selection refactor and the follow-up task for the bare shell preset.
- Updated `k8s/coder-template/README.md` to document the parameterized startup script layout.

## Tasks

- [x] Add a sandbox preset registry and persist the selected preset in onboarding DB/API/form — verify with onboarding unit tests.
- [x] Refactor the Kubernetes Coder template to a parameterized startup script file and map presets to `create-mercato-app` bootstrap commands — verify with `terraform fmt k8s/coder-template/main.tf`.
- [x] Document the new preset contract and follow-up for the bare shell preset — verify by updating `.ai/SPEC.md` and `.ai/WORKLIST.md`.

## Execution Log

### 2026-05-17 08:45 CEST

- Reviewed: `k8s/coder-template/main.tf`, `apps/onboarding/lib/coder.ts`, `apps/onboarding/app/api/sandboxes/route.ts`, `apps/onboarding/app/sandboxes/new/form.tsx`, `.ai/template-selection.md`, `.ai/SPEC.md`, `.ai/WORKLIST.md`
- Result: confirmed the current flow has one fixed Coder template id, no preset stored in onboarding, and an inline Terraform heredoc that hardcodes `create-mercato-app --preset crm`

### 2026-05-17 08:56 CEST

- Changed: `apps/onboarding/lib/sandbox-presets.ts`, `apps/onboarding/db/schema.sql`, `apps/onboarding/app/api/sandboxes/route.ts`, `apps/onboarding/app/sandboxes/new/page.tsx`, `apps/onboarding/app/sandboxes/new/form.tsx`, `apps/onboarding/lib/coder.ts`, `apps/onboarding/tests/coder.test.ts`
- Result: onboarding now exposes three active Open Mercato presets, stores `preset_id`, and forwards `sandbox_preset` into Coder workspace creation

### 2026-05-17 08:58 CEST

- Changed: `coder/template/main.tf`, `coder/template/files/workspace-startup.sh.tftpl`, `k8s/coder-template/main.tf`, `k8s/coder-template/files/workspace-startup.sh.tftpl`
- Ran: `terraform fmt coder/template/main.tf k8s/coder-template/main.tf`
- Result: pass; both templates now expose the same immutable `sandbox_preset` parameter and use extracted startup scripts instead of inline heredocs

### 2026-05-17 08:59 CEST

- Changed: `.ai/SPEC.md`, `.ai/WORKLIST.md`, `k8s/coder-template/README.md`
- Ran: `npm test`
- Result: pass; 14/14 onboarding tests passed, including the new workspace preset propagation test
- Ran: `npm run build`
- Result: partial pass; Next.js compile + type validation completed, but page-data collection still fails on an existing missing route module for `/api/billing/checkout`
- Ran: `terraform fmt -check coder/template/main.tf k8s/coder-template/main.tf`
- Result: pass
- Ran: `git diff --check`
- Result: pass

## Final Status

- Completed:
  - persisted sandbox preset selection in onboarding
  - forwarded the selected preset to Coder as a rich parameter
  - added the `crm`, `empty`, and `classic` Open Mercato preset options to both Coder templates
  - moved workspace bootstrap logic into dedicated startup script template files
- Not completed:
  - the bare shell workspace preset remains planned only; it is modeled in onboarding but not creatable yet
- Residual risks:
  - `npm run build` is still blocked by an existing `/api/billing/checkout` page-data issue unrelated to the preset-selection change
  - several repo files were already dirty before this run, so final integration should review those concurrent edits before merge
