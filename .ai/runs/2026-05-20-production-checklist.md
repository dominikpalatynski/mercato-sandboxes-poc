# Run: production-checklist

Date: 2026-05-20
Branch: k8s-workspaces-poc
Start commit: f482e90
Request: Przygotowac kompletna checklistę startową potrzebną do wystawienia systemu na produkcję

## Assumptions

- The intended path is `infra/hetzner-k3s`, not the older `infra/terraform` bootstrap.
- The user wants one concrete checklist to execute, not a high-level architecture note.
- The repo already contains the necessary deployment artifacts, but several of them still require operator-supplied secrets, image refs, DNS records, and production sizing.

## Spec Updates

- No product spec changes were required.
- Added a dedicated production rollout checklist under `infra/hetzner-k3s/`.

## Tasks

- [x] Gather the current rollout prerequisites from cluster, Helm, storage, DB, TLS, and image docs — verify with file review
- [x] Create one repo-native checklist covering the full first-production rollout order — verify with manual review of `infra/hetzner-k3s/PRODUCTION-CHECKLIST.md`
- [x] Link the new checklist from the existing Hetzner and Helm docs — verify with manual review

## Execution Log

### 2026-05-20 18:25 Europe/Warsaw

- Changed: none yet
- Ran: `sed -n '1,240p' infra/hetzner-k3s/cluster.example.yaml`, `sed -n '1,260p' infra/helm/helmfile.yaml`, `sed -n '1,260p' infra/helm/README.md`, `sed -n '1,260p' infra/IMAGES.md`, `sed -n '1,260p' infra/manifests/postgres/README.md`, `sed -n '1,260p' infra/hetzner-k3s/PLAN.md`, `sed -n '1,260p' infra/manifests/cert-manager/route53-credentials-secret.template.yaml`, `sed -n '1,260p' infra/hetzner-k3s/manifests/traefik/helmchartconfig.yaml`, `sed -n '1,260p' infra/hetzner-k3s/manifests/traefik/coder-wildcard-ingress.yaml`
- Result: confirmed the repo had most deployment artifacts but lacked one consolidated production rollout checklist

### 2026-05-20 18:33 Europe/Warsaw

- Changed: `infra/hetzner-k3s/PRODUCTION-CHECKLIST.md`, `infra/hetzner-k3s/README.md`, `infra/helm/README.md`
- Ran: `sed -n '1,320p' infra/hetzner-k3s/PRODUCTION-CHECKLIST.md`, `bash -n scripts/build-and-push-workspace-image.sh`, `git diff --stat -- infra/hetzner-k3s/PRODUCTION-CHECKLIST.md infra/hetzner-k3s/README.md infra/helm/README.md`
- Result: added the rollout checklist, linked it from the existing docs, and verified the supporting image-build helper script still parses successfully

### 2026-05-20 18:40 Europe/Warsaw

- Changed: `infra/hetzner-k3s/PRODUCTION-CHECKLIST.md`
- Ran: `sed -n '1,520p' infra/hetzner-k3s/PRODUCTION-CHECKLIST.md`, `sed -n '1,220p' infra/hetzner-k3s/README.md`, `sed -n '1,220p' infra/manifests/postgres/README.md`, `rg -n "CloudNativePG|cloudnative-pg|cnpg|Longhorn|longhorn|StatefulSet|local-path" infra/hetzner-k3s/PRODUCTION-CHECKLIST.md`
- Result: upgraded the checklist to match the simple PostgreSQL `StatefulSet` plus `local-path` path, including explicit DB service checks, credential-rotation caveats, and a go/no-go gate that no longer assumes implicit HA

## Final Status

- Completed: one concrete first-production rollout checklist, doc links from the Hetzner and Helm entrypoints, and a follow-up upgrade aligning the checklist with the simple PostgreSQL `StatefulSet` path
- Not completed: live execution of the checklist against a real Hetzner project
- Residual risks: the checklist intentionally surfaces current repo limitations such as small default cluster sizing, single-replica PostgreSQL `StatefulSet`s on `local-path`, and missing backup/restore automation rather than hiding them
