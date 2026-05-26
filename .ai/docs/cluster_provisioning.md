# Cluster Provisioning Guide

## Prerequisites

- [`hetzner-k3s`](https://github.com/vitobotta/hetzner-k3s)
- `kubectl`
- `docker` with the `buildx` plugin

## Initial Setup

1. Fill in the `.template` secret files with your own values in `/infra/manifests/*`.
   All of them are listed in `.gitignore` to prevent accidental exposure of sensitive data.

2. Find and replace every occurrence of `<yourdomain>.com` with your actual domain name.

3. Build the workload Docker images and reference them from the appropriate Helm values files.
   Set the proper tags and Docker registry to match your environment.

   Each script reads its tag, registry owner, and platform from environment variables
   (see the script source for the full list). After pushing, update the matching values file
   with the new `image.repository` / `image.tag` (or equivalent) — the script prints the exact
   lines to copy.

   | Workload         | Build script                                  | Helm values file                          |
   | ---------------- | --------------------------------------------- | ----------------------------------------- |
   | Coder workspace  | `scripts/build-and-push-workspace-image.sh`   | `infra/helm/values/coder-bootstrap.yaml`  |
   | Onboarding app   | `scripts/build-and-push-onboarding-image.sh`  | `infra/helm/values/onboarding.yaml`       |
   | OpenMercato CRM  | `scripts/build-and-push-openmercato-image.sh` | `infra/helm/values/openmercato.yaml`      |

   Run them as needed, for example:

   ```bash
   bash scripts/build-and-push-workspace-image.sh
   bash scripts/build-and-push-onboarding-image.sh
   bash scripts/build-and-push-openmercato-image.sh
   ```

   > The OpenMercato script must be executed from the root of the OpenMercato CRM repository
   > (the directory that contains its `Dockerfile`), since the build context defaults to `.`.
   > Override `OPENMERCATO_CONTEXT` / `OPENMERCATO_DOCKERFILE` if your layout differs.

---

## 1. Create the Cluster

Create a `cluster.yaml` file and configure the appropriate machine types.

Export your Hetzner API key:

```bash
export HCLOUD_TOKEN="xxx"
```

Create the cluster:

```bash
hetzner-k3s create --config infra/hetzner-k3s/cluster.yaml
```

## 2. Apply the Traefik Addon Override

```bash
kubectl apply -f infra/hetzner-k3s/manifests/traefik/helmchartconfig.yaml
```

## 3. Configure DNS Records

- Check the Load Balancer IP address in the Hetzner console.
- Create `A` records in your Cloudflare DNS panel for the following domains:

  ```
  sandbox.<yourdomain>.com
  coder.sandbox.<yourdomain>.com
  gitea.sandbox.<yourdomain>.com
  *.apps.sandbox.<yourdomain>.com
  ```

## 4. Create Namespaces

```bash
kubectl apply -f infra/manifests/coder/namespace-mercato-sandboxes.yaml
kubectl apply -f infra/manifests/gitea/namespace-gitea.yaml
```

## 5. Apply the GHCR Pull Secret

Required for pulling images from the remote registry:

```bash
kubectl apply -f infra/manifests/foundation/ghcr-pull-secret.yaml
```

## 6. Install the Foundation Release

```bash
helmfile -f infra/helm/helmfile.yaml -l phase=foundation apply
```

## 7. Install Platform Postgres Secrets

```bash
kubectl apply -f infra/manifests/postgres/postgres-coder-app-secret.yaml
kubectl apply -f infra/manifests/postgres/postgres-onboarding-app-secret.yaml
kubectl apply -f infra/manifests/postgres-gitea-app-secret.yaml
```

## 8. Install Platform Postgres Instances

```bash
kubectl apply -f infra/manifests/postgres/postgres-coder-cluster.yaml
kubectl apply -f infra/manifests/postgres/postgres-onboarding-cluster.yaml
kubectl apply -f infra/manifests/postgres/postgres-gitea-cluster.yaml
```

## 9. Apply Coder Secrets

```bash
kubectl apply -f infra/manifests/coder/coder-db-url.yaml
kubectl apply -f infra/manifests/coder/coder-bootstrap-admin.yaml
```

## 10. Deploy Coder

```bash
helmfile -f infra/helm/helmfile.yaml -l phase=coder apply
helmfile -f infra/helm/helmfile.yaml -l phase=coder-bootstrap apply
```

## 11. Apply Gitea Secrets

```bash
kubectl apply -f infra/manifests/gitea/gitea-admin-credentials.yaml
kubectl apply -f infra/manifests/gitea/gitea-db-url.yaml
```

## 12. Deploy the Gitea Instance

```bash
helmfile -f infra/helm/helmfile.yaml -l phase=gitea apply
```

## 13. Apply OpenMercato CRM Secrets

```bash
kubectl apply -f infra/manifests/openmercato/openmercato-app-secrets.yaml
```

## 14. Deploy the OpenMercato CRM Instance

```bash
helmfile -f infra/helm/helmfile.yaml -l phase=openmercato apply
```

## 15. Configure Stripe

Configure Stripe inside the OpenMercato integrations module.

## 16. Sync Stripe Plans

Run the subscription plan sync inside the OpenMercato pod. Replace the `--tenant` and `--org`
values with the IDs from your OpenMercato instance:

```bash
kubectl -n mercato-sandboxes exec deploy/openmercato -- \
  yarn mercato subscriptions sync-plans \
  --tenant 15758a43-5687-4988-946d-54809f2b589c \
  --org 42519861-9754-44f6-93ce-9901bc2998ed \
  --manifest /app/src/plans.ts
```

## 17. Configure the Onboarding App

Paste the tenant and organization IDs into:

```
infra/manifests/onboarding/onboarding-app-secrets.yaml
```

## 18. Apply Onboarding App Secrets

```bash
kubectl apply -f infra/manifests/onboarding/onboarding-app-secrets.yaml
kubectl apply -f infra/manifests/onboarding/onboarding-coder-admin.yaml
kubectl apply -f infra/manifests/onboarding/gitea-onboarding-admin-token.yaml
kubectl apply -f infra/manifests/onboarding/onboarding-coder-template.yaml
```

## 19. Deploy the Onboarding App Instance

```bash
helmfile -f infra/helm/helmfile.yaml -l phase=onboarding apply
```

## 20. Enable TLS

Apply the fixed-host HTTP issuer:

```bash
kubectl apply -f infra/manifests/cert-manager/clusterissuer-letsencrypt-http.yaml
```

Apply the Cloudflare API token secret:

```bash
kubectl apply -f infra/manifests/cert-manager/cloudflare-api-token-secret.yaml
```

Apply the wildcard DNS issuer:

```bash
kubectl apply -f infra/manifests/cert-manager/clusterissuer-letsencrypt-dns-cloudflare.yaml
```

Apply the Coder wildcard ingress:

```bash
kubectl apply -f infra/hetzner-k3s/manifests/traefik/coder-wildcard-ingress.yaml
```
