# Run: infra-local-path-storage

Date: 2026-05-20
Branch: k8s-workspaces-poc
Start commit: f482e90dc496b9c396d353b361787ae92eed82a3
Request: Przestawić `infra/` z Longhorna na `local-path`, usunąć deployment Helma Longhorna i przejrzeć manifesty pod kątem storage class.

## Assumptions

- Zakres dotyczy ścieżki `infra/` i dokumentacji operacyjnej z nią związanej.
- Wbudowany provisioner k3s `local-path` pozostaje dostępny jako docelowa klasa storage.
- `k8s/` lokalna ścieżka już używa `local-path`, więc nie wymaga zmian funkcjonalnych w tej pracy.

## Spec Updates

- Updated: `.ai/SPEC.md`
- Updated: `.ai/WORKLIST.md`

## Tasks

- [x] Usunąć release i values Longhorna z `infra/helm` — verify with `rg -n "longhorn" infra/helm`
- [x] Ustawić `local-path` dla workspace PVC i platform PostgreSQL w `infra` — verify with `rg -n "local-path|storageClass" infra`
- [x] Usunąć zależności od labeli Longhorna z konfiguracji klastra, skryptów i runbooków `infra` — verify with `rg -n "node.longhorn.io/create-default-disk|Longhorn|longhorn" infra`
- [x] Zweryfikować brak pozostałych referencji do Longhorna w ścieżce `infra` poza świadomymi historycznymi notatkami — verify with `rg -n "longhorn|Longhorn" infra`

## Execution Log

### 2026-05-20 12:07 CEST

- Changed: none yet
- Ran: `rg -n "longhorn|storageClassName|storageClass|local-path|persistentVolumeClaim|PersistentVolumeClaim" infra k8s`
- Result: found active Longhorn references in `infra/helm`, `infra/manifests/postgres`, `infra/hetzner-k3s`, and `infra/terraform/scripts`; confirmed `k8s/` already defaults to `local-path`

### 2026-05-20 12:20 CEST

- Changed: `.ai/SPEC.md`, `.ai/WORKLIST.md`, `infra/helm/helmfile.yaml`, `infra/helm/README.md`, `infra/helm/values/coder-bootstrap.yaml`, `infra/helm/charts/coder-bootstrap/values.yaml`, `infra/helm/charts/coder-bootstrap/files/bootstrap.py`, `infra/manifests/postgres/*`, `infra/hetzner-k3s/*`, `infra/terraform/scripts/configure-*.sh`
- Ran: `rg -n "longhorn|Longhorn|node.longhorn.io/create-default-disk" infra`, `rg -n "local-path|storageClass|workspaceStorageClass|WORKSPACE_STORAGE_CLASS" infra`
- Result: no active Longhorn references left in `infra/`; confirmed `local-path` is now set for workspace and PostgreSQL storage paths

### 2026-05-20 12:22 CEST

- Changed: none
- Ran: `git diff --check -- ...`, `bash -n infra/terraform/scripts/configure-master-node.sh infra/terraform/scripts/configure-sandbox-node.sh`, `env PYTHONPYCACHEPREFIX=/private/tmp/codex-pycache python3 -m py_compile infra/helm/charts/coder-bootstrap/files/bootstrap.py`
- Result: whitespace checks passed, shell syntax checks passed, Python compile check passed after redirecting pycache to `/private/tmp`

## Final Status

- Completed: removed the Longhorn Helm release from `infra/helm`, switched `infra` PVC defaults to `local-path`, and aligned Hetzner configs/runbooks with the new storage model
- Not completed: no live cluster smoke was run in this turn, so binding behavior on an actual k3s cluster remains a manual verification step
- Residual risks: `local-path` is node-local and non-replicated; production resilience and restore strategy still need an explicit decision
