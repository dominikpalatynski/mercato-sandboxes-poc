# Production Checklist

This checklist is the start-to-finish runbook for the first production
deployment of the Hetzner k3s path in this repo.

It is intentionally concrete and repo-specific. Treat it as the canonical
"what do I actually need to do" list.

## 0. Scope

This checklist assumes:

- `hetzner-k3s` is the cluster bootstrap path
- k3s builtin `traefik` addon is used
- one public Hetzner Load Balancer sits in front of Traefik
- `infra/helm` installs `cert-manager`, `coder`, `coder-bootstrap`, and
  `onboarding`
- platform PostgreSQL is applied from `infra/manifests/postgres/` as two simple
  single-replica `StatefulSet`s with matching `-rw` Services
- images are public in GHCR and Helm values are updated manually

## 1. Operator Machine Prerequisites

- [ ] `kubectl` is installed and works
- [ ] `helm` is installed
- [ ] `helmfile` is installed
- [ ] `docker` is installed
- [ ] `docker buildx` is available
- [ ] `hetzner-k3s` is installed
- [ ] `git` is installed
- [ ] `docker login ghcr.io` is done
- [ ] You know the public IP/CIDR that should be allowed for:
  - SSH access to nodes
  - Kubernetes API access

## 2. External Credentials And Provider Access

- [ ] Hetzner Cloud API token is ready
- [ ] Cloudflare API token with DNS edit access for `<yourdomain>.com` is ready
- [ ] `<yourdomain>.com` DNS zone is managed in Cloudflare
- [ ] SSH keypair for cluster nodes exists:
  - public key path
  - private key path
- [ ] GHCR repository owner and image naming are confirmed

## 3. Finalize Cluster Shape

Do not use [cluster.example.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/hetzner-k3s/cluster.example.yaml:1) unchanged.

- [ ] Copy it to `infra/hetzner-k3s/cluster.yaml`
- [ ] Fill `hetzner_token`
- [ ] Fill SSH key paths
- [ ] Replace placeholder IP/CIDRs in `networking.allowed_networks`
- [ ] Confirm `cluster_name`
- [ ] Confirm Hetzner location, currently `fsn1`
- [ ] Set `addons.csi_driver.enabled: true`
  This is the default storage backend for all durable PVCs (workspace home,
  workspace sidecar PostgreSQL, `postgres-coder`, `postgres-onboarding`,
  Gitea). Provided by the Hetzner Cloud CSI driver as the
  `hcloud-volumes` storage class with native Hetzner replication inside the
  DC.
- [ ] Set `addons.local_path_storage_class.enabled: true`
  Kept for non-durable scratch / cache PVCs only — never for user state.

Recommended minimum for a first real deployment:

- [ ] Raise `system` workers from `1` to at least `2`
- [ ] Raise `sandbox` workers from `1` to at least `2`

Recommended stronger production shape:

- [ ] `3` control-plane nodes
- [ ] `2` or `3` system workers
- [ ] `2+` sandbox workers

Why this matters:

- `coder`, `onboarding`, and both platform PostgreSQL `StatefulSet`s are pinned to
  `node-pool=system`
- current example shape is operationally too small for resilient production

## 4. Finalize Storage Decisions

- [ ] Confirm that the Hetzner Cloud CSI driver is the default storage backend
  for all durable PVCs and that the `hcloud-volumes` storage class exists
  after addon install
- [ ] Confirm `local-path` is only used for non-durable scratch / cache PVCs
- [ ] Confirm the team relies on native Hetzner volume replication inside the
  `fsn1` DC and accepts that as the only durability layer in MVP
- [ ] Decide whether production should later add an off-DC backup tier
  (e.g. S3 `pg_dump` and `gitea dump`)

Before real user traffic:

- [ ] Decide on backup and restore strategy for `hcloud-volumes` PVCs beyond
  the in-DC replication that ships with the CSI driver

## 5. Finalize PostgreSQL Topology

Current manifests create one PostgreSQL `StatefulSet` plus matching headless
and `-rw` Services for:

- [postgres-coder-cluster.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/manifests/postgres/postgres-coder-cluster.yaml:1)
- [postgres-onboarding-cluster.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/manifests/postgres/postgres-onboarding-cluster.yaml:1)

Before the first serious production rollout:

- [ ] Confirm the intentionally simple single-replica PostgreSQL topology is
  acceptable for the initial rollout
- [ ] Confirm app connection strings continue to use `postgres-coder-rw` and
  `postgres-onboarding-rw`
- [ ] Review storage sizes for both DBs
- [ ] Document how credentials will be rotated, noting that changing the
  bootstrap Secret alone does not rotate an already initialized database
- [ ] Decide on PostgreSQL backup automation and a restore drill
- [ ] Decide when to replace the simple `StatefulSet` path with an HA
  PostgreSQL design

## 6. Build And Push Images

Follow [infra/IMAGES.md](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/IMAGES.md:1).

- [ ] Build and push workspace image:

  ```bash
  bash scripts/build-and-push-workspace-image.sh
  ```

- [ ] Build and push onboarding image:

  ```bash
  bash scripts/build-and-push-onboarding-image.sh
  ```

- [ ] Update workspace image ref in
  [infra/helm/values/coder-bootstrap.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/helm/values/coder-bootstrap.yaml:27)
- [ ] If the workspace image is private, create the `ghcr-pull` registry
  Secret in `mercato-sandboxes` and set
  `template.workspaceImagePullSecrets` in
  [infra/helm/values/coder-bootstrap.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/helm/values/coder-bootstrap.yaml:27)
- [ ] Update onboarding image repository and tag in
  [infra/helm/values/onboarding.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/helm/values/onboarding.yaml:1)

## 7. Fill Runtime Values

- [ ] Confirm public Coder URL in
  [infra/helm/values/coder.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/helm/values/coder.yaml:1)
- [ ] Confirm onboarding env values in
  [infra/helm/values/onboarding.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/helm/values/onboarding.yaml:1)
- [ ] Confirm workspace template values in
  [infra/helm/values/coder-bootstrap.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/helm/values/coder-bootstrap.yaml:1)

Pay special attention to:

- `CODER_ACCESS_URL`
- `CODER_WILDCARD_ACCESS_URL`
- `CODER_PUBLIC_URL`
- `WILDCARD_APPS_DOMAIN`
- `template.workspaceStorageClass`
- `template.workspaceImagePullSecrets` when the workspace image is private

## 8. Fill Secret Templates

### PostgreSQL App Credentials

- [ ] Edit [postgres-coder-app-secret.template.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/manifests/postgres/postgres-coder-app-secret.template.yaml:1)
- [ ] Edit [postgres-onboarding-app-secret.template.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/manifests/postgres/postgres-onboarding-app-secret.template.yaml:1)

### Coder Runtime Secrets

- [ ] Edit [coder-db-url.template.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/manifests/coder/coder-db-url.template.yaml:1)
- [ ] Confirm the Coder DB URL still targets
  `postgres-coder-rw.mercato-sandboxes.svc.cluster.local:5432/coder`
- [ ] Edit [coder-bootstrap-admin.template.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/manifests/coder/coder-bootstrap-admin.template.yaml:1)

### Onboarding Runtime Secrets

- [ ] Edit [onboarding-app-secrets.template.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/manifests/onboarding/onboarding-app-secrets.template.yaml:1)
- [ ] Confirm `POSTGRES_URL` still targets
  `postgres-onboarding-rw.mercato-sandboxes.svc.cluster.local:5432/onboarding`

### Cloudflare / ACME

- [ ] Edit [cloudflare-api-token-secret.template.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/manifests/cert-manager/cloudflare-api-token-secret.template.yaml:1)
- [ ] Edit [clusterissuer-letsencrypt-http.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/manifests/cert-manager/clusterissuer-letsencrypt-http.yaml:1)
- [ ] Edit [clusterissuer-letsencrypt-dns-cloudflare.template.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/manifests/cert-manager/clusterissuer-letsencrypt-dns-cloudflare.template.yaml:1)

## 9. Create The Cluster

- [ ] Export the Hetzner token:

  ```bash
  export HCLOUD_TOKEN="YOUR_HETZNER_CLOUD_API_TOKEN"
  ```

- [ ] Create the cluster:

  ```bash
  hetzner-k3s create --config infra/hetzner-k3s/cluster.yaml
  ```

- [ ] Export kubeconfig:

  ```bash
  export KUBECONFIG="$PWD/infra/hetzner-k3s/kubeconfig"
  ```

- [ ] Verify nodes:

  ```bash
  kubectl get nodes -o wide
  ```

## 10. Configure The Public Edge

- [ ] Apply Traefik addon overrides:

  ```bash
  kubectl apply -f infra/hetzner-k3s/manifests/traefik/helmchartconfig.yaml
  kubectl rollout status deployment/traefik -n kube-system
  ```

- [ ] Verify Traefik Service has an external IP:

  ```bash
  kubectl get svc traefik -n kube-system
  ```

- [ ] Verify Traefik is the only public `LoadBalancer` Service for app traffic:

  ```bash
  kubectl get svc -A
  ```

## 11. Configure DNS

Point all of these at the Traefik LB IP:

- [ ] `sandbox.<yourdomain>.com`
- [ ] `coder.sandbox.<yourdomain>.com`
- [ ] `*.apps.sandbox.<yourdomain>.com`

## 12. Install Foundation Components

- [ ] Create namespace:

  ```bash
  kubectl apply -f infra/manifests/coder/namespace-mercato-sandboxes.yaml
  ```

- [ ] Install foundation releases:

  ```bash
  helmfile -f infra/helm/helmfile.yaml -l phase=foundation apply
  ```

- [ ] Verify:

  ```bash
  kubectl get pods -n cert-manager -o wide
  kubectl get storageclass hcloud-volumes
  kubectl get storageclass local-path
  ```

## 13. Install Platform PostgreSQL

- [ ] Apply app-user secrets:

  ```bash
  kubectl apply -f infra/manifests/postgres/postgres-coder-app-secret.template.yaml
  kubectl apply -f infra/manifests/postgres/postgres-onboarding-app-secret.template.yaml
  ```

- [ ] Apply PostgreSQL manifests:

  ```bash
  kubectl apply -f infra/manifests/postgres/postgres-coder-cluster.yaml
  kubectl apply -f infra/manifests/postgres/postgres-onboarding-cluster.yaml
  ```

- [ ] Wait until both `StatefulSet`s are ready, their PVCs are bound, and the
  `-rw` Services exist:

  ```bash
  kubectl rollout status statefulset/postgres-coder -n mercato-sandboxes
  kubectl rollout status statefulset/postgres-onboarding -n mercato-sandboxes
  kubectl get statefulset,pods,pvc -n mercato-sandboxes -l app.kubernetes.io/component=database
  kubectl get svc -n mercato-sandboxes | grep postgres-
  ```

- [ ] Confirm both database pods answer `pg_isready`:

  ```bash
  kubectl exec -n mercato-sandboxes postgres-coder-0 -- pg_isready -U coder -d coder
  kubectl exec -n mercato-sandboxes postgres-onboarding-0 -- pg_isready -U onboarding -d onboarding
  ```

If the bootstrap Secret values were wrong on first init, fix the credentials
inside PostgreSQL or recreate the affected PVC before retrying. Reapplying the
Secret alone is not enough once the data directory already exists.

## 14. Apply App Secrets

- [ ] Apply Coder DB URL secret:

  ```bash
  kubectl apply -f infra/manifests/coder/coder-db-url.template.yaml
  ```

- [ ] Apply onboarding app secret:

  ```bash
  kubectl apply -f infra/manifests/onboarding/onboarding-app-secrets.template.yaml
  ```

- [ ] Apply first-user bootstrap credentials:

  ```bash
  kubectl apply -f infra/manifests/coder/coder-bootstrap-admin.template.yaml
  ```

## 15. Deploy Coder And Onboarding

- [ ] Install Coder:

  ```bash
  helmfile -f infra/helm/helmfile.yaml -l phase=coder apply
  ```

- [ ] Run the in-cluster Coder bootstrap:

  ```bash
  helmfile -f infra/helm/helmfile.yaml -l phase=coder-bootstrap apply
  ```

- [ ] Verify the bootstrap Job succeeded:

  ```bash
  kubectl get jobs -n mercato-sandboxes
  kubectl logs job/coder-bootstrap -n mercato-sandboxes
  ```

- [ ] Install onboarding:

  ```bash
  helmfile -f infra/helm/helmfile.yaml -l phase=onboarding apply
  ```

- [ ] Verify `coder` and `onboarding` become Ready without obvious DB auth
  failures:

  ```bash
  kubectl get deploy,pods -n mercato-sandboxes
  kubectl logs deployment/coder -n mercato-sandboxes --tail=100
  kubectl logs deployment/onboarding -n mercato-sandboxes --tail=100
  ```

## 16. Enable TLS

- [ ] Apply fixed-host HTTP issuer:

  ```bash
  kubectl apply -f infra/manifests/cert-manager/clusterissuer-letsencrypt-http.yaml
  ```

- [ ] Apply Cloudflare API token secret:

  ```bash
  kubectl apply -f infra/manifests/cert-manager/cloudflare-api-token-secret.template.yaml
  ```

- [ ] Apply wildcard DNS issuer:

  ```bash
  kubectl apply -f infra/manifests/cert-manager/clusterissuer-letsencrypt-dns-cloudflare.template.yaml
  ```

- [ ] Apply Coder wildcard ingress:

  ```bash
  kubectl apply -f infra/hetzner-k3s/manifests/traefik/coder-wildcard-ingress.yaml
  ```

- [ ] Verify certificates and ingress:

  ```bash
  kubectl get certificate -A
  kubectl get ingress -n mercato-sandboxes
  kubectl describe certificate -n mercato-sandboxes
  ```

## 17. End-To-End Smoke Test

- [ ] `https://sandbox.<yourdomain>.com` loads onboarding
- [ ] Login/signup flow works
- [ ] Sandbox creation succeeds
- [ ] `coder-bootstrap` produced:
  - `onboarding-coder-admin`
  - `onboarding-coder-template`
- [ ] `coder` and `onboarding` stay Ready after their DB-backed startup
- [ ] `https://coder.sandbox.<yourdomain>.com` loads
- [ ] A workspace lands on `node-pool=sandbox`
- [ ] Workspace PVCs bind to `hcloud-volumes`
- [ ] Coder terminal works
- [ ] VS Code via wildcard URL works
- [ ] App on port `3000` works
- [ ] Splash / secondary app on port `4000` works

Useful commands:

```bash
kubectl get pods -n mercato-sandboxes -o wide
kubectl get pvc -n mercato-sandboxes
kubectl get nodes -L node-pool,node-type,workload-type
kubectl get svc,ingress -n mercato-sandboxes
```

## 18. Must-Do Before Real User Traffic

- [ ] Decide secret management story for production:
  - SOPS
  - External Secrets
  - Vault
- [ ] Add monitoring and alerting for:
  - cluster health
  - PostgreSQL health
  - ingress / edge
  - onboarding app
  - Coder app
- [ ] Confirm restore procedure for:
  - Coder DB `StatefulSet`
  - onboarding DB `StatefulSet`
  - workspace PVC data
- [ ] Decide whether manual restore plus downtime is acceptable until an HA
  PostgreSQL/storage path exists

## 19. Go / No-Go Gate

Do not call this production-ready if any of these are still false:

- [ ] DNS resolves correctly for all three public host patterns
- [ ] TLS is issued and trusted for onboarding and wildcard Coder apps
- [ ] Both platform PostgreSQL `StatefulSet`s are Ready, their PVCs are bound,
  and the apps connect through the `postgres-*-rw` Services
- [ ] Coder bootstrap Job completed successfully
- [ ] Onboarding can create and pause/resume a workspace
- [ ] Workspace terminal and VS Code both work
- [ ] Backup plan exists for PostgreSQL and workspace PVC data
- [ ] Either HA is in place for critical PVC-backed services or the manual
  restore path and acceptable downtime window are explicitly signed off
