# Infra Helm

This directory contains the first Helmfile-managed system component for the
Hetzner k3s path: `cert-manager`.

## Assumptions

- system nodes are labeled with `node-pool=system`
- sandbox nodes stay unlabeled for this selector and therefore do not receive
  `cert-manager` workloads
- if system nodes are tainted with `dedicated=system:NoSchedule`, the included
  tolerations already cover that
- the default k3s control-plane taint is also tolerated

Example system-node labeling:

```bash
bash infra/terraform/scripts/configure-master-node.sh
```

## Apply

```bash
helmfile -f infra/helm/helmfile.yaml apply
```

## Verify

```bash
kubectl get pods -n cert-manager -o wide
kubectl get crds | grep cert-manager
```

## ClusterIssuer

Examples for Traefik HTTP-01 live in `infra/manifests/`:

- `clusterissuer-letsencrypt-http-staging.yaml`
- `clusterissuer-letsencrypt-http.yaml`

Start with staging to validate HTTP-01 flow without hitting Let's Encrypt rate
limits, then switch to production.

## Smoke Test

An end-to-end staging test manifest lives in
`infra/manifests/nginx-acme-smoke-test-staging.yaml`.

Before applying it:

- replace `nginx-test.sandbox.example.com` with a real DNS name pointing at the
  cluster load balancer
- replace `twoj-email@example.com` in the `ClusterIssuer` manifest with a real
  email address

Then run:

```bash
kubectl apply -f infra/manifests/clusterissuer-letsencrypt-http-staging.yaml
kubectl apply -f infra/manifests/nginx-acme-smoke-test-staging.yaml
kubectl get pods,svc,ingress,certificate -n acme-smoke-test
kubectl describe certificate nginx-test-tls -n acme-smoke-test
kubectl describe challenge -n acme-smoke-test
```

Once the certificate is issued, verify:

```bash
curl -I https://nginx-test.sandbox.example.com
```
