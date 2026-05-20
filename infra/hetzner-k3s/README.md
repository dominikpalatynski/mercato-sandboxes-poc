# Hetzner k3s Bootstrap

This directory contains the additive bootstrap path that uses upstream
`hetzner-k3s` instead of the older OpenTofu-first flow in `infra/terraform/`.

The intended model for this repo is:

- `hetzner-k3s` creates the Kubernetes cluster
- the k3s `traefik` addon is enabled
- `servicelb` stays disabled
- Hetzner Cloud Controller Manager provisions one public Hetzner Load Balancer
  for the Traefik `LoadBalancer` Service
- `infra/helm` installs the system components that belong to this repo:
  `cert-manager`, `coder`, `coder-bootstrap`, and `onboarding`
- `coder.sandbox.palatynskicloud.com` and
  `*.apps.sandbox.palatynskicloud.com` are routed to the `coder` ClusterIP
  Service through Traefik Ingress
- the built-in k3s `local-path` provisioner backs both platform and workspace
  PVCs, while system-only application pods remain pinned to `node-pool=system`

## Files

- `cluster.example.yaml`: initial example cluster config for `hetzner-k3s`
- `PRODUCTION-CHECKLIST.md`: step-by-step first production rollout checklist
- `PLAN.md`: staged bootstrap plan and open questions
- `manifests/traefik/helmchartconfig.yaml`: Traefik addon overrides for the
  single-LB model
- `manifests/traefik/coder-wildcard-ingress.yaml`: Ingress for Coder and the
  wildcard app proxy

## Initial Topology

- `1x` control-plane node
- `1x` system worker
- `1x` sandbox worker
- `1x` public Hetzner Load Balancer in front of Traefik

Traffic shape:

```text
browser
  -> Hetzner Load Balancer
  -> Traefik Service (LoadBalancer)
  -> Traefik Ingress
  -> coder ClusterIP Service
  -> Coder wildcard app proxy / Coder UI
```

## Why This Path

This keeps the public edge simple:

- one public entrypoint instead of one LB per Service
- no `ServiceLB` host-port exposure on every node
- no per-sandbox Hetzner load balancers
- the existing Coder wildcard app model remains intact

## Bootstrap Flow

1. Copy the example config and fill in your values:

   ```bash
   cp infra/hetzner-k3s/cluster.example.yaml infra/hetzner-k3s/cluster.yaml
   $EDITOR infra/hetzner-k3s/cluster.yaml
   ```

2. Export the Hetzner token and create the cluster:

   ```bash
   export HCLOUD_TOKEN="YOUR_HETZNER_CLOUD_API_TOKEN"
   hetzner-k3s create --config infra/hetzner-k3s/cluster.yaml
   export KUBECONFIG="$PWD/infra/hetzner-k3s/kubeconfig"
   ```

3. Apply the Traefik addon overrides:

   ```bash
   kubectl apply -f infra/hetzner-k3s/manifests/traefik/helmchartconfig.yaml
   kubectl rollout status deployment/traefik -n kube-system
   kubectl get svc traefik -n kube-system
   ```

4. Point DNS for your sandbox domain at the Traefik LB IP:

   - `sandbox.palatynskicloud.com`
   - `coder.sandbox.palatynskicloud.com`
   - `*.apps.sandbox.palatynskicloud.com`

5. Create the application namespace and install the foundation releases:

   ```bash
   kubectl apply -f infra/manifests/coder/namespace-mercato-sandboxes.yaml
   helmfile -f infra/helm/helmfile.yaml -l phase=foundation apply
   ```

6. Create the PostgreSQL app-user secrets and apply the in-cluster PostgreSQL
   manifests:

   ```bash
   $EDITOR infra/manifests/postgres/postgres-coder-app-secret.template.yaml
   $EDITOR infra/manifests/postgres/postgres-onboarding-app-secret.template.yaml
   kubectl apply -f infra/manifests/postgres/postgres-coder-app-secret.template.yaml
   kubectl apply -f infra/manifests/postgres/postgres-onboarding-app-secret.template.yaml
   kubectl apply -f infra/manifests/postgres/postgres-coder-cluster.yaml
   kubectl apply -f infra/manifests/postgres/postgres-onboarding-cluster.yaml
   ```

   Confirm both `StatefulSet`s expose their `-rw` Services before moving on:

   ```bash
   kubectl rollout status statefulset/postgres-coder -n mercato-sandboxes
   kubectl rollout status statefulset/postgres-onboarding -n mercato-sandboxes
   kubectl get svc -n mercato-sandboxes | grep postgres-
   kubectl get pods -n mercato-sandboxes -l app.kubernetes.io/component=database
   ```

7. Create the application secrets:

   ```bash
   $EDITOR infra/manifests/coder/coder-db-url.template.yaml
   kubectl apply -f infra/manifests/coder/coder-db-url.template.yaml
   $EDITOR infra/manifests/onboarding/onboarding-app-secrets.template.yaml
   kubectl apply -f infra/manifests/onboarding/onboarding-app-secrets.template.yaml
   ```

   Also update `infra/helm/values/coder-bootstrap.yaml` with the final
   workspace image and any template-specific overrides such as the workspace
   storage class.

8. Create the first-user credentials for Coder bootstrap and install Coder:

   ```bash
   $EDITOR infra/manifests/coder/coder-bootstrap-admin.template.yaml
   kubectl apply -f infra/manifests/coder/coder-bootstrap-admin.template.yaml
   helmfile -f infra/helm/helmfile.yaml -l phase=coder apply
   ```

9. Run the in-cluster Coder bootstrap job, then install onboarding:

   ```bash
   helmfile -f infra/helm/helmfile.yaml -l phase=coder-bootstrap apply
   helmfile -f infra/helm/helmfile.yaml -l phase=onboarding apply
   ```

10. Apply the `cert-manager` issuers:

   ```bash
   kubectl apply -f infra/manifests/cert-manager/clusterissuer-letsencrypt-http.yaml
   cp infra/manifests/cert-manager/route53-credentials-secret.template.yaml /tmp/route53-credentials-secret.yaml
   $EDITOR /tmp/route53-credentials-secret.yaml
   kubectl apply -f /tmp/route53-credentials-secret.yaml
   cp infra/manifests/cert-manager/clusterissuer-letsencrypt-dns-route53.template.yaml /tmp/clusterissuer-letsencrypt-dns.yaml
   $EDITOR /tmp/clusterissuer-letsencrypt-dns.yaml
   kubectl apply -f /tmp/clusterissuer-letsencrypt-dns.yaml
   ```

   Choose exactly one DNS provider template for `letsencrypt-dns`. The
   Route53 and Cloudflare templates are alternatives and intentionally use the
   same `ClusterIssuer` name.

9. Apply the Coder ingress:

   ```bash
   kubectl apply -f infra/hetzner-k3s/manifests/traefik/coder-wildcard-ingress.yaml
   ```

## Notes

- `infra/helm/values/onboarding.yaml` now requests the onboarding certificate
  automatically through `cert-manager` using the `letsencrypt-http`
  `ClusterIssuer`.
- `manifests/traefik/coder-wildcard-ingress.yaml` now requests the
  `coder.sandbox.palatynskicloud.com` plus `*.apps.sandbox.palatynskicloud.com`
  certificate automatically through `cert-manager` using the
  `letsencrypt-dns` `ClusterIssuer`.
- The in-cluster platform PostgreSQL path is now based on two simple
  single-replica `StatefulSet`s. The manifests live in
  `infra/manifests/postgres/`.
- The Coder admin token and template ID are now produced by the
  `coder-bootstrap` Helm release, not by manual secret editing.
- The repo ships Route53-oriented DNS-01 templates as the default path and
  keeps Cloudflare templates as an optional alternative. If you use another DNS
  provider, replace only the solver block and keep the `ClusterIssuer` name as
  `letsencrypt-dns`.
- `infra/helm` currently sets `local-path` explicitly for workspace PVCs and
  the in-cluster PostgreSQL manifests.
- The existing Kubernetes Coder template now schedules workspaces onto nodes
  with `node-pool=sandbox`, so the sandbox pool in `cluster.example.yaml`
  applies that label from day one.
- `local-path` storage is node-local and non-replicated, so worker loss still
  needs explicit restore/recovery planning.
