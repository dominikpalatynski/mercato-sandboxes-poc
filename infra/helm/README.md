# Infra Helm

This directory contains Helmfile-managed system components for the Hetzner k3s
path:

- `cert-manager`
- `coder`
- `coder-bootstrap`
- `onboarding`
- `openmercato`

The recommended cluster bootstrap path for this repo now lives under
`infra/hetzner-k3s/` and assumes:

- the k3s `traefik` addon is enabled there
- `servicelb` stays disabled
- Traefik is the only public `LoadBalancer` Service
- the Traefik addon is customized through
  `infra/hetzner-k3s/manifests/traefik/helmchartconfig.yaml`

## Assumptions

- system nodes are labeled with `node-pool=system`
- the built-in k3s `local-path` provisioner is enabled and available as the
  storage class `local-path`
  This requires `addons.local_path_storage_class.enabled: true` in the
  `hetzner-k3s` cluster config because recent `hetzner-k3s` releases do not
  enable it by default.
- sandbox nodes do not carry `node-pool=system` and therefore do not receive
  `cert-manager` workloads
- `postgres-coder` and `postgres-onboarding` are pinned to `node-pool=system`
- if system nodes are tainted with `dedicated=system:NoSchedule`, the included
  tolerations already cover that
- if sandbox nodes are tainted with `dedicated=sandbox:NoSchedule`, the
  workspace template tolerations still allow workspace pods to mount their PVCs
- the default k3s control-plane taint is also tolerated
- `local-path` is node-local and non-replicated, so losing a node can require
  PVC restore or workload recreation

If you are still using the older OpenTofu bootstrap path, equivalent manual
node-pool labeling is done by:

```bash
bash infra/terraform/scripts/configure-master-node.sh
```

## Apply

1. Create the application namespace:

```bash
kubectl apply -f infra/manifests/coder/namespace-mercato-sandboxes.yaml
```

2. Install the foundation releases:

```bash
helmfile -f infra/helm/helmfile.yaml -l phase=foundation apply
```

3. Create the PostgreSQL app-user secrets and apply the in-cluster database
   clusters:

```bash
$EDITOR infra/manifests/postgres/postgres-coder-app-secret.template.yaml
$EDITOR infra/manifests/postgres/postgres-onboarding-app-secret.template.yaml
kubectl apply -f infra/manifests/postgres/postgres-coder-app-secret.template.yaml
kubectl apply -f infra/manifests/postgres/postgres-onboarding-app-secret.template.yaml
kubectl apply -f infra/manifests/postgres/postgres-coder-cluster.yaml
kubectl apply -f infra/manifests/postgres/postgres-onboarding-cluster.yaml
```

4. Wait until both PostgreSQL `StatefulSet`s are ready and expose their `-rw`
   Services:

```bash
kubectl rollout status statefulset/postgres-coder -n mercato-sandboxes
kubectl rollout status statefulset/postgres-onboarding -n mercato-sandboxes
kubectl get svc -n mercato-sandboxes | grep postgres-
kubectl get pods -n mercato-sandboxes -l app.kubernetes.io/component=database
```

5. Create the application secrets that point at those PostgreSQL Services:

```bash
$EDITOR infra/manifests/coder/coder-db-url.template.yaml
kubectl apply -f infra/manifests/coder/coder-db-url.template.yaml
$EDITOR infra/manifests/onboarding/onboarding-app-secrets.template.yaml
kubectl apply -f infra/manifests/onboarding/onboarding-app-secrets.template.yaml
```

When the cluster should use the Open Mercato billing bridge, the onboarding
secret template also needs:

- `OPENMERCATO_API_KEY`
- `OPENMERCATO_CUSTOMER_TENANT_ID`
- `OPENMERCATO_CUSTOMER_ORGANIZATION_ID`
- `OPENMERCATO_BILLING_WEBHOOK_SECRET`

`OPENMERCATO_BILLING_WEBHOOK_SECRET` must match the
`SANDBOX_BILLING_WEBHOOK_SECRET` configured for the `openmercato` Helm release.

6. Create the bootstrap credentials for the first Coder admin user:

```bash
$EDITOR infra/manifests/coder/coder-bootstrap-admin.template.yaml
kubectl apply -f infra/manifests/coder/coder-bootstrap-admin.template.yaml
```

Also update `infra/helm/values/onboarding.yaml` with the final image
repository/tag.

Also update `infra/helm/values/coder-bootstrap.yaml` with the final workspace
image and any template-specific overrides such as `workspaceStorageClass`.

Also update `infra/helm/values/openmercato.yaml` with the final Open Mercato
image tag, ingress host, and deployment secrets before installing that release.
For the sandbox billing bridge, also keep these values aligned:

- `SANDBOX_BILLING_WEBHOOK_URL`
  This can use the internal onboarding service URL
  `http://onboarding.mercato-sandboxes.svc.cluster.local/api/billing/openmercato/webhook`.
- `SANDBOX_BILLING_WEBHOOK_SECRET`
  Must match onboarding's `OPENMERCATO_BILLING_WEBHOOK_SECRET`.
- `OPENMERCATO_BILLING_BASE_URL` in `infra/helm/values/onboarding.yaml`
  Must stay on the public Open Mercato ingress host, not the internal service
  DNS, because hosted checkout URLs derive their origin from the incoming
  request URL.
- `OM_SANDBOX_BILLING_ENABLE_MOCK_GATEWAYS=true` and
  `OM_SANDBOX_BILLING_AUTO_SEED=true`
  Enable the production-cluster smoke path with the app-local mock provider and
  idempotent plan seeding.

The GHCR build/push convention and helper scripts live in
`infra/IMAGES.md`.

For the full first-production rollout order, use
`infra/hetzner-k3s/PRODUCTION-CHECKLIST.md`.

7. Install Coder itself:

```bash
helmfile -f infra/helm/helmfile.yaml -l phase=coder apply
```

8. Run the in-cluster Coder bootstrap Job. This Job:

- creates the first admin user if the deployment is still fresh
- mints or reuses the onboarding admin token
- pushes the Kubernetes workspace template with the configured variables
- writes `onboarding-coder-admin` and `onboarding-coder-template` as cluster
  Secrets

```bash
helmfile -f infra/helm/helmfile.yaml -l phase=coder-bootstrap apply
```

9. Install onboarding after the bootstrap Job succeeds:

```bash
helmfile -f infra/helm/helmfile.yaml -l phase=onboarding apply
```

10. Install the standalone Open Mercato release when you want the cluster to
host a first-party CRM instance next to onboarding:

```bash
helmfile -f infra/helm/helmfile.yaml -l phase=openmercato apply
```

11. After the first Open Mercato pod finishes `yarn initialize`, mint a scoped
billing bridge API key and update the onboarding secret with it:

```bash
kubectl logs deploy/openmercato -n mercato-sandboxes | grep 'RBAC setup complete'
kubectl exec -it deploy/openmercato -n mercato-sandboxes -- \
  sh -lc 'yarn mercato api_keys add --name onboarding-billing --tenantId <tenant-id> --organizationId <org-id>'
kubectl edit secret onboarding-app-secrets -n mercato-sandboxes
kubectl rollout restart deployment/onboarding -n mercato-sandboxes
```

The `kubectl logs` line exposes the tenant/org identifiers created during the
first `initialize` run. Store the printed API-key secret immediately; Open
Mercato shows it only once. Write that secret into
`OPENMERCATO_API_KEY` on `onboarding-app-secrets`, copy the same tenant/org
identifiers into `OPENMERCATO_CUSTOMER_TENANT_ID` and
`OPENMERCATO_CUSTOMER_ORGANIZATION_ID`, then restart the onboarding
deployment so signup and billing CRM sync use the same scoped bridge
credential.

12. After `cert-manager` is installed, apply the certificate issuers:

```bash
kubectl apply -f infra/manifests/cert-manager/clusterissuer-letsencrypt-http.yaml
cp infra/manifests/cert-manager/route53-credentials-secret.template.yaml /tmp/route53-credentials-secret.yaml
$EDITOR /tmp/route53-credentials-secret.yaml
kubectl apply -f /tmp/route53-credentials-secret.yaml
cp infra/manifests/cert-manager/clusterissuer-letsencrypt-dns-route53.template.yaml /tmp/clusterissuer-letsencrypt-dns.yaml
$EDITOR /tmp/clusterissuer-letsencrypt-dns.yaml
kubectl apply -f /tmp/clusterissuer-letsencrypt-dns.yaml
```

Choose exactly one DNS provider template for `letsencrypt-dns`. The Route53
and Cloudflare templates are alternatives and intentionally use the same
`ClusterIssuer` name.

The onboarding ingress uses `HTTP-01` automatically via the
`cert-manager.io/cluster-issuer: letsencrypt-http` annotation in
`infra/helm/values/onboarding.yaml`.

The Coder ingress uses `DNS-01` automatically via the
`cert-manager.io/cluster-issuer: letsencrypt-dns` annotation in
`infra/hetzner-k3s/manifests/traefik/coder-wildcard-ingress.yaml`.

## Verify

```bash
kubectl get nodes -L node-pool,node-type,workload-type
kubectl get pods -n cert-manager -o wide
kubectl get crds | grep cert-manager
kubectl get statefulset -n mercato-sandboxes | grep postgres-
kubectl get storageclass local-path
kubectl get pods -n mercato-sandboxes -o wide
kubectl get jobs -n mercato-sandboxes
kubectl logs job/coder-bootstrap -n mercato-sandboxes
kubectl get svc,ingress -n mercato-sandboxes
kubectl get statefulset,pvc -n mercato-sandboxes | grep openmercato
```

## ClusterIssuer

Examples for Traefik HTTP-01 live in `infra/manifests/cert-manager/`:

- `clusterissuer-letsencrypt-http-staging.yaml`
- `clusterissuer-letsencrypt-http.yaml`
- `clusterissuer-letsencrypt-dns-route53-staging.template.yaml`
- `clusterissuer-letsencrypt-dns-route53.template.yaml`
- `route53-credentials-secret.template.yaml`
- `clusterissuer-letsencrypt-dns-cloudflare-staging.template.yaml`
- `clusterissuer-letsencrypt-dns-cloudflare.template.yaml`
- `cloudflare-api-token-secret.template.yaml`

Start with staging to validate HTTP-01 flow without hitting Let's Encrypt rate
limits, then switch to production.

Wildcard certificates for `*.apps.sandbox.palatynskicloud.com` require
`DNS-01`; the repo now ships Route53-oriented templates as the default path and
keeps Cloudflare templates as an optional alternative. For either provider,
keep the `ClusterIssuer` name as `letsencrypt-dns` and change only the solver
block plus the credential secret.

## Smoke Test

An end-to-end staging test manifest lives in
`infra/manifests/cert-manager/nginx-acme-smoke-test-staging.yaml`.

Before applying it:

- replace `nginx-test.sandbox.example.com` with a real DNS name pointing at the
  cluster load balancer
- replace `twoj-email@example.com` in the `ClusterIssuer` manifest with a real
  email address

Then run:

```bash
kubectl apply -f infra/manifests/cert-manager/clusterissuer-letsencrypt-http-staging.yaml
kubectl apply -f infra/manifests/cert-manager/nginx-acme-smoke-test-staging.yaml
kubectl get pods,svc,ingress,certificate -n acme-smoke-test
kubectl describe certificate nginx-test-tls -n acme-smoke-test
kubectl describe challenge -n acme-smoke-test
```

Once the certificate is issued, verify:

```bash
curl -I https://nginx-test.sandbox.example.com
```
