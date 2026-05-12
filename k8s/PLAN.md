# Kubernetes Local Plan

## Scope and Constraints

- This path is additive only.
- Do not change the current Docker Compose flow or existing repo logic.
- Keep the current files and scripts as-is for the Docker-based workflow.
- Put all Kubernetes-specific manifests and scripts under `k8s/`.
- Put the Kubernetes-specific Coder workspace template in a separate folder.
- For this phase, build images locally and import them into `k3d`.
- For this phase, use `kubectl port-forward`.
- For this phase, do not add DNS automation yet.
- Use `lvh.me` for local wildcard hostname resolution.

## Target Structure

```text
k8s/
├── README.md
├── PLAN.md
├── env/
│   └── local.env.example
├── manifests/
│   └── local/
│       ├── namespace.yaml
│       ├── postgres-coder.yaml
│       ├── postgres-onboarding.yaml
│       ├── onboarding-deployment.yaml
│       ├── onboarding-service.yaml
│       ├── ingress.yaml
│       ├── onboarding-secrets.template.yaml
│       └── tls-secret.template.yaml
├── helm/
│   └── coder.local.values.yaml
├── scripts/
│   ├── cluster-create.sh
│   ├── import-images.sh
│   ├── create-local-tls-secret.sh
│   ├── deploy-postgres.sh
│   ├── install-coder.sh
│   ├── deploy-onboarding.sh
│   ├── port-forward.sh
│   ├── bootstrap-coder.sh
│   ├── push-template.sh
│   └── refresh-onboarding-secrets.sh
└── coder-template/
    ├── main.tf
    └── README.md
```

## Non-Goals for This Phase

- No change to `start.sh`, `docker-compose.yml`, or the current root scripts.
- No change to the existing Docker-based Coder template in `coder/template/`.
- No production DNS handling.
- No registry integration yet.
- No replacement of the current local Docker workflow.

## Current Repo Logic to Preserve

- The current Docker flow remains the default path.
- The onboarding app keeps the same API logic and the same contract for:
  - `CODER_URL`
  - `CODER_PUBLIC_URL`
  - `CODER_ADMIN_TOKEN_FILE`
  - `CODER_TEMPLATE_ID_FILE`
- The onboarding app should continue reading the Coder admin token and template id from mounted files.
- The current Docker-based workspace template remains untouched.

## Local Addressing Model

For this local Kubernetes phase:

```env
SANDBOX_DOMAIN=sandbox.lvh.me
WILDCARD_APPS_DOMAIN=apps.sandbox.lvh.me
PROXY_SCHEME=https
PROXY_PORT_SUFFIX=:8443
CODER_ACCESS_URL=https://coder.sandbox.lvh.me:8443
CODER_PUBLIC_URL=https://coder.sandbox.lvh.me:8443
CODER_WILDCARD_ACCESS_URL=*.apps.sandbox.lvh.me
COOKIE_DOMAIN=.sandbox.lvh.me
COOKIE_SECURE=true
```

Notes:

- `lvh.me` resolves wildcard subdomains to `127.0.0.1`, which is enough for the local phase.
- Traffic should go through an ingress controller and then be exposed locally via `kubectl port-forward`.
- The local URLs should be:
  - `https://sandbox.lvh.me:8443`
  - `https://coder.sandbox.lvh.me:8443`
  - `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me:8443`

## High-Level Workstreams

### 1. Add a parallel Kubernetes path under `k8s/`

- Create a complete Kubernetes-only path in `k8s/`.
- Keep it fully separate from the Compose path.
- All manifests, scripts, and local environment examples should live there.

### 2. Create a local `k3d` cluster workflow

- Add a script to create a local `k3d` cluster.
- Disable default Traefik if present.
- Install `ingress-nginx`.
- Create a dedicated namespace for the stack, for example `mercato-sandboxes`.
- Do not expose the apps via host-published ports yet.
- Use `kubectl port-forward` to expose ingress locally.

### 3. Build and import local images

- Build the onboarding image locally.
- Build the `mercato-workspace` image locally.
- Import both into `k3d` using `k3d image import`.
- Set `imagePullPolicy: IfNotPresent` in Kubernetes manifests and templates.

### 4. Deploy control plane services to Kubernetes

- Deploy `postgres-coder`.
- Deploy `postgres-onboarding`.
- Deploy `Coder` via Helm.
- Deploy `onboarding` as `Deployment + Service`.
- Use in-cluster services for internal communication.

### 5. Replace the local edge with Kubernetes ingress

- Do not reuse the Compose edge path for the Kubernetes mode.
- Add ingress rules for:
  - `sandbox.lvh.me` -> onboarding
  - `coder.sandbox.lvh.me` -> coder
  - `*.apps.sandbox.lvh.me` -> coder
- Use local TLS via a Kubernetes TLS secret.

### 6. Keep onboarding logic unchanged

- Mount Coder token and template id into onboarding as files.
- Preserve the file paths expected by the current app:
  - `/run/secrets/coder-admin-token`
  - `/run/secrets/coder-template-id`
- Preserve the current environment variable contract used by the app.

### 7. Add Kubernetes-specific bootstrap and template-push scripts

- Add `k8s/scripts/bootstrap-coder.sh` to bootstrap the first Coder admin token.
- Add `k8s/scripts/push-template.sh` to push the Kubernetes-specific template.
- Add `k8s/scripts/refresh-onboarding-secrets.sh` to refresh mounted Kubernetes secrets after bootstrap/template push.
- Keep the existing root scripts untouched.

### 8. Create a Kubernetes-specific Coder workspace template

- Add a new workspace template under `k8s/coder-template/`.
- Do not modify `coder/template/`.
- The new template should use Kubernetes resources instead of Docker resources.

## Template Migration Plan

The current template is Docker-specific and should remain unchanged. The Kubernetes version should be implemented separately.

### Docker resources to replace

- `provider "docker"` -> Kubernetes provider
- `docker_container.workspace` -> `kubernetes_deployment` or `kubernetes_pod`
- `docker_container.postgres` -> sidecar container in the same Pod
- `docker_volume.home` -> PVC mounted at `/home/coder`
- `docker_volume.pg_data` -> PVC for PostgreSQL data
- `docker_network.*` -> remove and rely on native Kubernetes networking

### First-phase workspace model

For the first Kubernetes phase, use one workspace Deployment with:

- one container for the Coder agent, code-server, and the Mercato app
- one sidecar PostgreSQL container
- one PVC for `/home/coder`
- one PVC for PostgreSQL data

This is intentionally close to the current Docker model and simpler than introducing separate Services and StatefulSets per workspace on day one.

### First-phase runtime assumptions

- `code-server` remains on port `13337`
- Mercato app remains on port `3000`
- splash remains on port `4000`
- `yarn setup` still runs in the workspace container
- `DATABASE_URL` should be adapted to use the sidecar-local database connection
- `agent_coder_url` should point to the internal Kubernetes Service for Coder, not the Docker-network alias

## Planned Kubernetes Artifacts

### `k8s/manifests/local/namespace.yaml`

- Namespace definition for the local stack.

### `k8s/manifests/local/postgres-coder.yaml`

- PostgreSQL deployment or StatefulSet for Coder metadata.
- Persistent storage for Coder DB.
- ClusterIP service.

### `k8s/manifests/local/postgres-onboarding.yaml`

- PostgreSQL deployment or StatefulSet for onboarding data.
- Persistent storage for onboarding DB.
- ClusterIP service.

### `k8s/helm/coder.local.values.yaml`

- Helm values for local Coder installation.
- Coder DB URL.
- `CODER_ACCESS_URL`.
- `CODER_WILDCARD_ACCESS_URL`.
- resource sizing suitable for local development.

### `k8s/manifests/local/onboarding-deployment.yaml`

- Deployment for onboarding app.
- Mount secret files for Coder admin token and template id.
- Set app env vars to match the Kubernetes local path.

### `k8s/manifests/local/onboarding-service.yaml`

- ClusterIP service exposing onboarding internally.

### `k8s/manifests/local/ingress.yaml`

- Ingress rules for:
  - `sandbox.lvh.me`
  - `coder.sandbox.lvh.me`
  - `*.apps.sandbox.lvh.me`

### `k8s/manifests/local/onboarding-secrets.template.yaml`

- Template manifest for the secret carrying:
  - `coder-admin-token`
  - `coder-template-id`

### `k8s/manifests/local/tls-secret.template.yaml`

- Template manifest or helper-driven secret creation for local TLS.

## Planned Scripts

### `k8s/scripts/cluster-create.sh`

- Create the `k3d` cluster.
- Install `ingress-nginx`.
- Create namespace.

### `k8s/scripts/import-images.sh`

- Build the onboarding image locally.
- Build the `mercato-workspace` image locally.
- Import both images into `k3d`.

### `k8s/scripts/create-local-tls-secret.sh`

- Create a Kubernetes TLS secret from local cert and key files.

### `k8s/scripts/deploy-postgres.sh`

- Apply manifests for both PostgreSQL instances.

### `k8s/scripts/install-coder.sh`

- Install or upgrade Coder using Helm and the local values file.

### `k8s/scripts/deploy-onboarding.sh`

- Apply onboarding deployment, service, and related config.

### `k8s/scripts/port-forward.sh`

- Port-forward ingress locally.
- Expected ports:
  - `8443:443`
  - optionally `8080:80`

### `k8s/scripts/bootstrap-coder.sh`

- Bootstrap first Coder admin account and generate admin token.
- Target the local ingress URL via port-forward.
- Persist the token in a local runtime file for the Kubernetes flow.

### `k8s/scripts/push-template.sh`

- Push the Kubernetes-specific template from `k8s/coder-template/`.
- Persist the resolved template id in a local runtime file for the Kubernetes flow.

### `k8s/scripts/refresh-onboarding-secrets.sh`

- Turn the locally generated token and template id into a Kubernetes Secret.
- Roll the onboarding deployment if needed.

## Suggested Local Runtime Files

Keep Kubernetes-local runtime artifacts separate from the current Docker flow. For example:

```text
.runtime/k8s/coder-admin-token
.runtime/k8s/coder-template-id
```

The secret-refresh script can then project those values into Kubernetes without changing current repo behavior.

## Implementation Order

1. Create the `k8s/` directory structure.
2. Add local environment example and Kubernetes README.
3. Add cluster bootstrap script for `k3d` and ingress-nginx.
4. Add image build/import script.
5. Add PostgreSQL manifests.
6. Add Coder Helm values and install script.
7. Add onboarding manifests.
8. Add ingress and TLS handling for local use.
9. Add Kubernetes-specific bootstrap and template-push scripts.
10. Add `k8s/coder-template/main.tf`.
11. Push the Kubernetes template into Coder.
12. Verify end-to-end sandbox creation.

## Acceptance Criteria for This Phase

- `https://sandbox.lvh.me:8443` loads onboarding.
- `https://coder.sandbox.lvh.me:8443` loads Coder.
- The onboarding app can create or reuse a Coder user.
- The onboarding app can create a workspace from the Kubernetes-specific template.
- Workspace status reaches `ready`.
- The following open successfully via the wildcard ingress host:
  - VS Code
  - Terminal
  - Mercato app
  - splash

## Risks to Watch

- If ingress is skipped and only direct service port-forwards are used, wildcard workspace app routing will be awkward or broken.
- If the Docker-based template is accidentally reused, Coder on Kubernetes will still expect host-Docker behavior and fail to provision workspaces.
- If onboarding does not get the token/template files mounted exactly where it expects them, sandbox creation will fail.
- If locally built images are not imported into `k3d`, workspace startup will fail on image pull.
- If the internal Coder URL used by the workspace agent still points at the Docker-era alias model, new workspaces will fail to connect.

## Explicit Preservation Rules

- Do not edit the existing Compose manifests for this phase.
- Do not replace the current Docker template.
- Do not remove any current script.
- Do not merge the Kubernetes template into the current Docker template.
- Keep the Kubernetes path as an additional mode under `k8s/`.
