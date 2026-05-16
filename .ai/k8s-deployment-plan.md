# Kubernetes Sandbox Platform Stack (k3s + Hetzner)

## 1. Core Infrastructure

| Area | Tool | Purpose |
|---|---|---|
| Kubernetes Distribution | k3s | Lightweight Kubernetes cluster |
| Load Balancer Integration | Hetzner Cloud Controller Manager | Integrates Hetzner Load Balancers with Kubernetes |
| Ingress Controller | Traefik | HTTP routing and ingress management |
| TLS Certificates | cert-manager | Automatic Let's Encrypt certificate management |
| DNS Automation | external-dns | Automatically manages DNS records |
| Persistent Storage | Longhorn | Distributed persistent storage for workspaces |
| GitOps | Argo CD | GitOps deployments and cluster state management |

---

# 2. Workspace / Sandbox Layer

| Area | Tool | Purpose |
|---|---|---|
| Dev Workspaces | Coder | Remote development environments |
| Sandbox Runtime | Custom Runtime API / Operator | Workspace orchestration and lifecycle |
| Image Builds | BuildKit | Fast container image builds |
| Container Registry | GHCR / Harbor / ECR | Docker image storage |
| Secrets Management | External Secrets Operator | Sync secrets from external providers |

---

# 3. Observability Stack

| Area | Tool | Purpose |
|---|---|---|
| Metrics | Prometheus | Metrics collection |
| Dashboards | Grafana | Metrics visualization |
| Logs | Loki + Promtail | Centralized log aggregation |
| Alerts | Alertmanager | Alert routing and notifications |
| Kubernetes Events | Fluent Bit kubernetes-events input | Kubernetes event collection |
| Error Tracking | Sentry | Application error monitoring |

---

# 4. Security & Governance

| Area | Tool | Purpose |
|---|---|---|
| Network Isolation | Cilium / Calico | Network policies and traffic control |
| Policy Engine | Kyverno | Kubernetes policy enforcement |
| Image Scanning | Trivy | Vulnerability scanning |
| Runtime Security | Falco | Runtime threat detection |
| Access Control | Kubernetes RBAC | Cluster permissions management |

---

# 5. Backup & Disaster Recovery

| Area | Tool | Purpose |
|---|---|---|
| Cluster Backups | Velero | Kubernetes resource backups |
| Persistent Volume Backups | Longhorn Backup | Volume snapshots and recovery |
| etcd Backups | k3s snapshots | Cluster state recovery |
| Object Storage | Hetzner Storage Box / S3 | Backup storage backend |

---

# 6. Networking Flow

```text
Internet
    |
Wildcard DNS (*.sandbox.example.com)
    |
Hetzner Load Balancer
    |
Traefik Ingress Controller
    |
Kubernetes Ingress
    |
Service
    |
Workspace Pod
```

---

# 7. Workspace Architecture

```text
Namespace: workspace-user-pr123

Workspace Pod
├── app container
├── code-server / coder agent
├── AI agent container
└── shared persistent volume
```

---

# 8. Suggested Deployment Order

## Phase 1 — Core Cluster

1. k3s
2. Hetzner Cloud Controller Manager
3. Traefik
4. cert-manager
5. external-dns

---

## Phase 2 — Storage & GitOps

6. Longhorn
7. Argo CD

---

## Phase 3 — Workspaces

8. Coder
9. Runtime API / Operator

---

## Phase 4 — Observability

10. Prometheus
11. Grafana
12. Loki
13. Fluent Bit
14. Alertmanager

---

## Phase 5 — Security & Backups

15. External Secrets Operator
16. Velero
17. Kyverno
18. Trivy
19. Falco

---

# 9. Example DNS Setup

```text
*.sandbox.example.com -> Hetzner Load Balancer Public IP
```

---

# 10. Example Sandbox URLs

```text
https://pr-123.sandbox.example.com
https://feature-login.sandbox.example.com
https://workspace-dominik.sandbox.example.com
```

---

# 11. Recommended MVP Stack

```text
k3s
Traefik
cert-manager
external-dns
Longhorn
Coder
Argo CD
Prometheus
Grafana
Loki
Custom Runtime API
```

---

# 12. Future Scaling Considerations

## Around 5–20 active sandboxes

- Single k3s cluster is enough
- Longhorn acceptable
- Manual scaling acceptable

## Around 50+ active sandboxes

Need to improve:

- resource quotas
- namespace isolation
- autoscaling
- observability
- build pipelines
- storage performance

## Around 100+ active sandboxes

Need to consider:

- multi-cluster architecture
- dedicated storage layer
- node autoscaling
- advanced scheduling
- platform engineering practices
- managed Kubernetes