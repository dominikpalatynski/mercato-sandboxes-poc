# Image Build And Push

This repo now assumes a simple GHCR workflow for production images:

- build images manually with `docker buildx`
- push them to public GitHub Container Registry
- update Helm values manually

There is intentionally no automation that rewrites chart values after a push.

## Registry Convention

Default repositories:

- `ghcr.io/palatynskicloud/mercato-workspace`
- `ghcr.io/palatynskicloud/mercato-onboarding`
- `ghcr.io/dominikpalatynski/openmercato`

Default tag convention:

- immutable tags only
- default tag: `git-<shortsha>`

Default target platform:

- `linux/amd64`

That platform matters because the current Hetzner `cpx` node types used in
`infra/hetzner-k3s/cluster.example.yaml` are x86_64.

## Prerequisites

1. Log in to GHCR:

```bash
docker login ghcr.io
```

2. Ensure `docker buildx` is available:

```bash
docker buildx version
```

If needed, create a builder once:

```bash
docker buildx create --use
```

## Workspace Image

Build and push the workspace image:

```bash
bash scripts/build-and-push-workspace-image.sh
```

Optional overrides:

```bash
IMAGE_TAG=v0.1.0 \
GHCR_OWNER=palatynskicloud \
bash scripts/build-and-push-workspace-image.sh
```

After the push, manually update:

- [infra/helm/values/coder-bootstrap.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/helm/values/coder-bootstrap.yaml:1)

Set:

```yaml
template:
  workspaceImage: ghcr.io/palatynskicloud/mercato-workspace:<tag>
```

## Onboarding Image

Build and push the onboarding image:

```bash
bash scripts/build-and-push-onboarding-image.sh
```

Optional overrides:

```bash
IMAGE_TAG=v0.1.0 \
GHCR_OWNER=palatynskicloud \
bash scripts/build-and-push-onboarding-image.sh
```

After the push, manually update:

- [infra/helm/values/onboarding.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/helm/values/onboarding.yaml:1)

Set:

```yaml
image:
  repository: ghcr.io/palatynskicloud/mercato-onboarding
  tag: <tag>
```

## Runtime Config

The onboarding image is now environment-agnostic with respect to the public
Coder URL.

`CODER_PUBLIC_URL` still needs to be present in the deployment environment, but
it is read at runtime by the server-rendered sandbox page instead of being
baked into the image at build time.

That means:

- the workspace image stays environment-agnostic
- the onboarding image also becomes `build once, deploy anywhere`

## Workspace Pull Secrets

If the workspace image is private in GHCR, create a registry secret in the
workspace namespace and point the Coder bootstrap values at it:

```bash
kubectl create secret docker-registry ghcr-pull \
  --namespace mercato-sandboxes \
  --docker-server=ghcr.io \
  --docker-username=<github-user> \
  --docker-password=<github-token>
```

Then set:

```yaml
template:
  workspaceImagePullSecrets:
    - ghcr-pull
```

in [infra/helm/values/coder-bootstrap.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/helm/values/coder-bootstrap.yaml:1).

If the workspace image is public, leave `workspaceImagePullSecrets` empty.

## Recommended Manual Release Flow

1. Build and push `mercato-workspace`.
2. Update `template.workspaceImage` in `infra/helm/values/coder-bootstrap.yaml`.
3. If the workspace image is private, set `template.workspaceImagePullSecrets`.
4. Build and push `mercato-onboarding`.
5. Update `image.repository` and `image.tag` in `infra/helm/values/onboarding.yaml`.
6. Apply the relevant Helmfile phases.

## CRM Image

Preferred path: run the GitHub Actions workflow at
`.github/workflows/build-crm-image.yml`.

The workflow:

- builds `apps/crm/Dockerfile`
- targets `linux/amd64`
- reuses a GitHub Actions Buildx cache
- always pushes `ghcr.io/dominikpalatynski/crm:git-<shortsha>`
- also pushes an explicit release tag when started with `workflow_dispatch`
  `image_tag=<tag>` or from a git tag matching `crm-v*`

If the package owner differs from the repository owner, add repo secrets
`GHCR_USERNAME` and `GHCR_TOKEN`. Otherwise the default `GITHUB_TOKEN` login is
enough for same-owner GHCR pushes.

Manual fallback:

```bash
IMAGE_TAG=git-$(git rev-parse --short HEAD)
docker buildx build \
  --platform linux/amd64 \
  -f apps/crm/Dockerfile \
  -t ghcr.io/dominikpalatynski/crm:${IMAGE_TAG} \
  apps/crm \
  --push
```

After the push, manually update:

- [infra/helm/values/openmercato.yaml](/Users/dpalatynski/Private/OpenMercato/mercato-sandboxes-poc/infra/helm/values/openmercato.yaml:1)

Set:

```yaml
image:
  repository: ghcr.io/dominikpalatynski/crm
  tag: <tag>
```
