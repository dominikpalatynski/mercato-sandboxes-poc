# Initial Cluster Plan

## Goal

Bootstrap the first Hetzner-hosted k3s cluster for this repo using
`hetzner-k3s`, the builtin k3s `traefik` addon, and one public Hetzner Load
Balancer in front of the cluster.

## Planned Shape

- one control-plane node
- one `system` worker for cluster services
- one `sandbox` worker for workspace workloads
- Traefik exposed as the single `LoadBalancer` Service
- `coder` exposed only as `ClusterIP`
- wildcard workspace traffic routed through Coder, not through per-workspace
  Kubernetes Services of type `LoadBalancer`

## Phases

### Phase 1: Bootstrap the raw cluster

- create the cluster from `cluster.yaml`
- confirm node creation and kubeconfig export
- verify private networking and external API access from the operator machine

### Phase 2: Pin the single-LB edge

- apply the Traefik `HelmChartConfig`
- verify the Traefik Service remains the only public `LoadBalancer` Service
- confirm the Hetzner LB talks to nodes over private IPs

### Phase 3: DNS and ingress

- point `sandbox.<domain>`, `coder.<domain>`, and `*.apps.<domain>` to the
  Traefik LB
- apply the Coder wildcard Ingress
- confirm the `coder` Service stays `ClusterIP`

### Phase 4: System components

- install `cert-manager`
- apply the `postgres-coder` and `postgres-onboarding` simple PostgreSQL
  manifests
- create the `coder-db-url` Secret and onboarding app Secret after the `-rw`
  Services exist
- install `coder`
- run `coder-bootstrap` to create the first admin token and push the template
- install `onboarding`
- apply the `letsencrypt-http` `ClusterIssuer` for fixed-host TLS
- apply the `letsencrypt-dns` `ClusterIssuer` for the Coder + wildcard app TLS

### Phase 5: Workspace readiness

- publish the Kubernetes Coder template
- ensure workspace PVCs and platform PostgreSQL use `local-path`
- verify the workspace pods land only on the sandbox pool

### Phase 6: First smoke

- `https://coder.<domain>`
- `https://coder.<domain>/@<user>/<workspace>/terminal`
- `https://13337--main--<workspace>--<user>.apps.<domain>/?folder=/home/coder/app`
- `https://3000--main--<workspace>--<user>.apps.<domain>`

## Guardrails

- keep `servicelb` disabled
- do not create additional `LoadBalancer` Services unless a new public edge is
  explicitly required
- do not add taints to the system or sandbox pools until all affected charts
  have matching tolerations

## Open Questions

- whether production should keep the simple PostgreSQL `StatefulSet`s or move
  to an HA PostgreSQL path before real traffic
