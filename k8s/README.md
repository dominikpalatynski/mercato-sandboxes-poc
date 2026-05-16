# Kubernetes Local Path

This directory adds a parallel Kubernetes workflow for the sandbox stack. It is
additive only: the Docker Compose path remains the default local flow, and the
existing root scripts and Docker template stay untouched.

This first phase intentionally keeps the local namespace and hostnames aligned
with `k8s/PLAN.md`: `mercato-sandboxes`, `sandbox.lvh.me`,
`coder.sandbox.lvh.me`, and `*.apps.sandbox.lvh.me`. The scripts expose a few
overrides for images and runtime paths, but the manifests themselves are not
fully templatized yet.

## Requirements

- `docker`
- `k3d`
- `kubectl`
- `helm`
- `openssl`
- local TLS files at `.runtime/tls/sandbox-lvh-me.crt` and
  `.runtime/tls/sandbox-lvh-me.key`

For the hybrid flow where onboarding runs outside Kubernetes, you also need:

- `node`
- `npm`

If the TLS files do not exist yet, `k8s/scripts/cluster-create.sh` generates
them automatically in `.runtime/tls/`, reusing the same local certificate path
as the Docker Compose flow.

## Quick Start

```bash
cp k8s/env/local.env.example k8s/env/local.env
$EDITOR k8s/env/local.env

bash k8s/scripts/setup-local.sh
```

Keep the ingress port-forward running in a separate shell before the bootstrap
and browser steps:

```bash
bash k8s/scripts/port-forward.sh
```

Then finish the Coder bootstrap and template push:

```bash
bash k8s/scripts/bootstrap-coder.sh
bash k8s/scripts/push-template.sh
bash k8s/scripts/refresh-onboarding-secrets.sh
```

## Hybrid Flow: Coder + Postgres in K8s, Onboarding Local

Use this when you want:

- `coder` in Kubernetes
- `postgres-coder` in Kubernetes
- `postgres-onboarding` in Kubernetes
- the onboarding app locally for fast Next.js iteration

This flow skips the Kubernetes onboarding deployment entirely. The cluster only
hosts Coder, both PostgreSQL instances, and ingress for `coder.sandbox.lvh.me`
plus the wildcard workspace apps.

### 1. Prepare the cluster

```bash
cp k8s/env/local.env.example k8s/env/local.env
$EDITOR k8s/env/local.env

bash k8s/scripts/setup-local-hybrid.sh
```

What this does:

- creates or reuses the `k3d` cluster
- imports only the workspace image into `k3d`
- deploys `postgres-coder` and `postgres-onboarding`
- installs `coder`
- creates the TLS secret
- applies a Coder-only ingress for:
  - `https://coder.sandbox.lvh.me:8443`
  - `https://*.apps.sandbox.lvh.me:8443`

### 2. Keep the hybrid port-forwards open

Run this in a dedicated shell and leave it running:

```bash
bash k8s/scripts/port-forward-hybrid.sh
```

This exposes:

- ingress HTTPS on `https://coder.sandbox.lvh.me:8443`
- direct local Coder API on `http://127.0.0.1:18080`
- onboarding Postgres on `127.0.0.1:5545`
- Coder Postgres on `127.0.0.1:5546`

The direct `http://127.0.0.1:18080` forward is intentional. The local
onboarding Node process uses it for server-to-server Coder API calls so you do
not have to make Node trust the self-signed ingress certificate.

### 3. Bootstrap Coder and publish the K8s template

In another shell:

```bash
bash k8s/scripts/bootstrap-coder.sh
bash k8s/scripts/push-template.sh
```

That writes:

- `.runtime/k8s/coder-admin-token`
- `.runtime/k8s/coder-template-id`

The local onboarding helper reads those files directly, so
`refresh-onboarding-secrets.sh` is not needed in this hybrid mode.

### 4. Install onboarding dependencies once

```bash
cd apps/onboarding
npm ci
cd ../..
```

### 5. Run onboarding locally

```bash
bash k8s/scripts/run-onboarding-local.sh
```

The helper:

- points `POSTGRES_URL` at `postgres-onboarding` through the local forward
- points `CODER_URL` at the local direct Coder API forward
- keeps `CODER_PUBLIC_URL=https://coder.sandbox.lvh.me:8443`
- reuses `.runtime/k8s/coder-admin-token` and `.runtime/k8s/coder-template-id`
- sets `COOKIE_DOMAIN=.sandbox.lvh.me`
- sets `COOKIE_SECURE=false` so the local HTTP dev server can issue cookies

Open the local app at:

- `http://sandbox.lvh.me:3000`

Do not use `http://localhost:3000` in this flow. The onboarding app sets
shared cookies for `.sandbox.lvh.me`, so using `sandbox.lvh.me` keeps the
one-click login bridge into `coder.sandbox.lvh.me` working.

### 6. What should work

- onboarding UI: `http://sandbox.lvh.me:3000`
- coder: `https://coder.sandbox.lvh.me:8443`
- terminal: `https://coder.sandbox.lvh.me:8443/@<user>/<workspace>/terminal`
- VS Code:
  `https://13337--main--<workspace>--<user>.apps.sandbox.lvh.me:8443/?folder=/home/coder/app`
- app:
  `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me:8443`
- splash:
  `https://4000--main--<workspace>--<user>.apps.sandbox.lvh.me:8443`

### 7. Useful operator commands

Rebuild and reimport only the workspace image:

```bash
bash k8s/scripts/import-images.sh --workspace-only
```

Reconnect to the onboarding database locally:

```bash
psql postgres://onboarding:onboarding@127.0.0.1:5545/onboarding
```

Reconnect to the Coder database locally:

```bash
psql postgres://coder:coder@127.0.0.1:5546/coder
```

## Local URLs

- `https://sandbox.lvh.me:8443`
- `https://coder.sandbox.lvh.me:8443`
- `https://13337--main--<workspace>--<user>.apps.sandbox.lvh.me:8443/?folder=/home/coder/app`
- `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me:8443`
- `https://4000--main--<workspace>--<user>.apps.sandbox.lvh.me:8443`

## Notes

- The onboarding app keeps the existing `CODER_URL`, `CODER_PUBLIC_URL`,
  `CODER_ADMIN_TOKEN_FILE`, and `CODER_TEMPLATE_ID_FILE` contract.
- `setup-local-hybrid.sh` applies
  [ingress-coder-only.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/k8s/manifests/local/ingress-coder-only.yaml)
  so the hybrid flow does not depend on an onboarding Service inside the
  cluster.
- If `setup-local.sh` reports a `0.0.0.0:<port>` connection refusal while
  `cluster-create.sh` says it is reusing an existing cluster, the saved `k3d`
  context is stale. The script now recreates the cluster automatically when it
  finds stale metadata without any matching `k3d-*` Docker containers. If the
  old containers still exist but the API is unhealthy, inspect Docker Desktop
  first or reset the local cluster explicitly with
  `k3d cluster delete mercato-sandboxes`.
- `deploy-onboarding.sh` now creates an `onboarding-schema` ConfigMap from
  [apps/onboarding/db/schema.sql](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/apps/onboarding/db/schema.sql)
  and runs that schema through an init container before the app starts.
- Runtime artifacts for this path are stored under `.runtime/k8s/`.
- The Kubernetes workspace template lives under `k8s/coder-template/` and is
  separate from `coder/template/`.
- Local image builds are imported into the `k3d` cluster with
  `imagePullPolicy: IfNotPresent`.
- `bash k8s/scripts/import-images.sh` is not optional: `deploy-onboarding.sh`
  and the Kubernetes workspace template both reference local images that do not
  exist in the cluster until they are explicitly imported into `k3d`.
- The existing root workspace-image helper still honors the repo-root `.env`.
  If that pins `MERCATO_WORKSPACE_IMAGE=mercato-workspace:latest`,
  `k8s/scripts/import-images.sh` will retag the locally built image to the
  Kubernetes tag before importing it into `k3d`.
- The local `k3d` path assumes the default K3s storage class `local-path`.
  The Kubernetes workspace template passes that explicitly unless you override
  `WORKSPACE_STORAGE_CLASS`.
- Workspace PVCs are created without Terraform waiting for them to become
  `Bound`. This avoids spurious provider timeouts during local provisioning;
  actual pod scheduling still depends on Kubernetes binding the claims.
- The local `ingress-nginx` install intentionally enables snippet annotations.
  The ingress manifest uses `configuration-snippet` to strip
  `Sec-WebSocket-Extensions`, matching the websocket hardening already required
  by the Docker path.
- Because `configuration-snippet` is classified by `ingress-nginx` as a
  `Critical`-risk annotation, the local controller install also raises
  `annotations-risk-level` to `Critical`. This is intentional for the
  single-user local cluster only.
