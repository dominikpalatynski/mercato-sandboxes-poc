# Run: infra-postgres-statefulset

Date: 2026-05-20
Branch: k8s-workspaces-poc
Start commit: f482e90dc496b9c396d353b361787ae92eed82a3
Request: Zamiast wprowadzać CloudNativePG zrobić prosty PostgreSQL `StatefulSet` w `infra/`.

## Assumptions

- Zakres dotyczy ścieżki `infra/` i dokumentacji repo, bez zmian w aplikacjach.
- Prosta topologia jednego poda PostgreSQL per baza jest akceptowalna na teraz.
- Istniejące connection stringi powinny dalej działać, więc hosty `postgres-coder-rw` i `postgres-onboarding-rw` zostają zachowane.

## Spec Updates

- Updated: `.ai/SPEC.md`
- Updated: `.ai/WORKLIST.md`

## Tasks

- [x] Zastąpić manifesty CNPG prostymi manifestami `Service` + `StatefulSet` — verify with `rg -n "kind: Cluster|postgresql.cnpg.io|kind: StatefulSet|postgres:17" infra/manifests/postgres`
- [x] Usunąć `cloudnative-pg` z `infra/helm` i instrukcji wdrożenia — verify with `rg -n "cloudnative-pg|cnpg-system|clusters.postgresql.cnpg.io" infra/helm infra/hetzner-k3s`
- [x] Zaktualizować spec/worklist i zapisać przebieg pracy — verify with `rg -n "StatefulSet|operators" .ai/SPEC.md .ai/WORKLIST.md .ai/runs/2026-05-20-infra-postgres-statefulset.md`

## Execution Log

### 2026-05-20 13:05 CEST

- Changed: none yet
- Ran: `rg -n "CloudNativePG|cloudnative-pg|cnpg|clusters.postgresql.cnpg.io" .ai infra`
- Result: found active references in PostgreSQL manifests, `infra/helm`, Hetzner runbooks, and `.ai/WORKLIST.md`

### 2026-05-20 13:20 CEST

- Changed: `infra/manifests/postgres/postgres-coder-cluster.yaml`, `infra/manifests/postgres/postgres-onboarding-cluster.yaml`, `infra/manifests/postgres/README.md`, `infra/helm/helmfile.yaml`, `infra/helm/README.md`, `infra/hetzner-k3s/README.md`, `infra/hetzner-k3s/PLAN.md`, `infra/hetzner-k3s/PRODUCTION-CHECKLIST.md`, `.ai/SPEC.md`, `.ai/WORKLIST.md`
- Ran: `sed -n ...`, `git diff -- ...`
- Result: replaced both CNPG `Cluster` resources with simple single-replica PostgreSQL `StatefulSet`s and aligned docs to the new topology

### 2026-05-20 14:25 CEST

- Changed: `.ai/runs/2026-05-20-infra-postgres-statefulset.md`
- Ran: `git diff --check -- ...`, `rg -n "CloudNativePG|cloudnative-pg|cnpg-system|clusters.postgresql.cnpg.io|postgresql.cnpg.io" infra .ai/SPEC.md .ai/WORKLIST.md`, `ruby -e 'require "yaml"; YAML.load_stream(...)'`
- Result: diff whitespace checks passed, no active CNPG references remain in `infra/` plus spec/worklist, and both PostgreSQL manifest files parse as valid YAML streams locally
- Ran: `kubectl apply --dry-run=client --validate=false -f infra/manifests/postgres/postgres-coder-cluster.yaml`
- Result: failed in this environment because `kubectl` still tried to reach the configured API server at `https://0.0.0.0:52062`, so no live Kubernetes validation was completed in-turn

## Final Status

- Completed: replaced CloudNativePG with simple PostgreSQL `StatefulSet`s in `infra/`, removed the operator from `infra/helm`, and updated the related runbooks/spec docs
- Not completed: no live `kubectl apply` or cluster smoke was run in this turn
- Residual risks: this path is intentionally simple and not HA; secret changes do not rotate credentials inside an already initialized database; backups and restore drills still need an explicit plan
