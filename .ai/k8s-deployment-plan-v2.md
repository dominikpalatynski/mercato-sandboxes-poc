# Kubernetes Sandbox Platform Stack — MVP

## 1. Core Infrastructure

| Area | Tool / Approach | Notes |
|---|---|---|
| Kubernetes Distribution | k3s | Lightweight Kubernetes cluster |
| Ingress Controller | Traefik | Main HTTP/HTTPS routing layer |
| Load Balancer | Hetzner Cloud Load Balancer | Single public entrypoint for the cluster |
| TLS Certificates | cert-manager | Automatic TLS certificate management |
| DNS | Manual wildcard DNS | No external-dns for MVP |
| Persistent Storage | Longhorn | Persistent workspace storage |
| GitOps | Skipped | No Argo CD / Flux for MVP |
| Helm Management | Helmfile | Centralized Helm releases management |

---

# 2. Repository Structure

```text
k8s/
└── helm/
    ├── helmfile.yaml
    ├── traefik/
    │   └── values.yaml
    ├── cert-manager/
    │   └── values.yaml
    ├── longhorn/
    │   └── values.yaml
    ├── coder/
    │   └── values.yaml
    ├── runtime-api/
    │   ├── Chart.yaml
    │   ├── values.yaml
    │   └── templates/
    └── sandbox-templates/
        └── values.yaml
```

Each Helm chart should have its own dedicated directory and `values.yaml`.

---

# 3. Helmfile Management

`helmfile.yaml` will contain information about:

- which Helm charts are installed
- chart repositories
- chart versions
- namespaces
- values files

Example:

```yaml
repositories:
  - name: traefik
    url: https://traefik.github.io/charts

  - name: jetstack
    url: https://charts.jetstack.io

  - name: coder
    url: https://helm.coder.com/v2

  - name: longhorn
    url: https://charts.longhorn.io

releases:
  - name: traefik
    namespace: traefik
    chart: traefik/traefik
    version: 36.2.0
    values:
      - ./traefik/values.yaml

  - name: cert-manager
    namespace: cert-manager
    chart: jetstack/cert-manager
    version: v1.16.2
    values:
      - ./cert-manager/values.yaml

  - name: longhorn
    namespace: longhorn-system
    chart: longhorn/longhorn
    version: 1.8.0
    values:
      - ./longhorn/values.yaml

  - name: coder
    namespace: coder
    chart: coder/coder
    version: 2.18.4
    values:
      - ./coder/values.yaml

  - name: runtime-api
    namespace: runtime-system
    chart: ./runtime-api
    values:
      - ./runtime-api/values.yaml
```

Deployment command:

```bash
helmfile -f k8s/helm/helmfile.yaml apply
```

---

# 4. Longhorn MVP Configuration

Longhorn will be used for persistent workspace volumes.

MVP assumptions:

```text
- replica count = 1
- no backup integration
- no snapshot automation
- single StorageClass for workspace PVCs
- optimized for simplicity instead of HA
```

Main use cases:

```text
- workspace persistence after pod restart
- sandbox sleep/wake flow
- moving pods between nodes
- storing code and workspace state
```

---

# 5. Networking Flow

```text
Internet
    |
Wildcard DNS (*.sandbox.example.com)
    |
Hetzner Cloud Load Balancer
    |
Traefik Ingress Controller
    |
Kubernetes Ingress
    |
Service
    |
Workspace / Sandbox Pod
```

Example DNS record:

```text
*.sandbox.example.com -> Hetzner Load Balancer Public IP
```

---

# 6. Workspace / Sandbox Layer

| Area | Tool / Approach | Notes |
|---|---|---|
| Dev Workspaces | Coder | Remote development environments |
| Sandbox Runtime | Hono + TypeScript | Custom runtime API |
| Image Builds | Custom scripts | No BuildKit for MVP |
| Container Registry | GitHub Container Registry | Docker image storage |
| Secrets Management | Raw Kubernetes Secrets | No external secret manager |

---

# 7. Runtime API Responsibilities

The Hono-based runtime service should handle:

```text
- creating sandbox/workspace resources
- generating sandbox hostnames
- creating Kubernetes Ingress objects
- creating Kubernetes Services if needed
- connecting sandbox URLs with Coder workspaces
- cleaning up resources after sandbox deletion
- exposing internal API endpoints for platform actions
- handling workspace sleep/wake lifecycle
```

---

# 8. Example Workspace Architecture

```text
Namespace: workspace-user-pr123

Workspace Pod
├── app container
├── code-server / coder agent
├── AI agent container
└── Persistent Volume Claim (Longhorn)
      └── /workspace
```

---

# 9. Example Workspace Storage Flow

```text
User inactive
    |
Runtime API deletes pod
    |
Longhorn PVC remains
    |
User returns later
    |
New pod created
    |
PVC reattached
    |
Workspace restored
```

---

# 10. Observability

Skipped for MVP.

Planned later:

```text
- Prometheus
- Grafana
- Loki
- Fluent Bit
- Alertmanager
```

---

# 11. Security

For MVP only basic Kubernetes RBAC.

Skipped for now:

```text
- Kyverno
- Trivy
- Falco
- NetworkPolicies / Cilium / Calico hardening
```

---

# 12. Backups

Skipped for initial phase.

No initial setup for:

```text
- Velero
- Longhorn backups
- etcd snapshot automation
- object storage backups
```

---

# 13. Recommended MVP Stack

```text
k3s
Hetzner Cloud Load Balancer
Traefik
cert-manager
Longhorn
Coder
Hono TypeScript Runtime API
GitHub Container Registry
Raw Kubernetes Secrets
Basic Kubernetes RBAC
Helmfile
```

---

# 14. Suggested Deployment Order

```text
1. Create Hetzner VMs
2. Install k3s cluster
3. Configure Hetzner Cloud Load Balancer
4. Install Traefik
5. Configure wildcard DNS
6. Install cert-manager
7. Install Longhorn
8. Configure Longhorn StorageClass
9. Install Coder
10. Deploy Hono Runtime API
11. Add sandbox/workspace templates
12. Configure Helmfile
13. Test workspace persistence flow
14. Test full networking flow:
    DNS -> LB -> Traefik -> Ingress -> Service -> Pod
```

---

# 15. Later Phases

## Phase 2 — Observability

```text
Prometheus
Grafana
Loki
Fluent Bit
Alertmanager
```

## Phase 3 — GitOps

```text
Argo CD or Flux
Environment-specific values
Automated cluster reconciliation
```

## Phase 4 — Security

```text
External Secrets Operator
Kyverno
Trivy
Falco
NetworkPolicies
```

## Phase 5 — Backups

```text
Velero
k3s etcd snapshots
Longhorn backups
S3-compatible object storage
```