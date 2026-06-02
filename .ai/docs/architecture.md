# System Architecture — Mercato Sandboxes

Reference document: components, responsibility boundaries, and data flows.

---

## 1. High-level view

```mermaid
flowchart LR
    User([User / browser])

    subgraph Edge["Edge (HTTPS)"]
        Ingress[Traefik<br/>TLS, wildcard]
    end

    subgraph Control["Control plane"]
        Onboarding[Onboarding<br/>Next.js 15]
        Coder[Coder<br/>workspace orchestrator]
        Gitea[Gitea<br/>user repositories]
    end

    subgraph Runtime["User runtime"]
        Workspace[Coder Workspace<br/>mercato-workspace image]
    end

    subgraph Data["Persistence"]
        PgOnb[(Postgres<br/>onboarding)]
        PgCoder[(Postgres<br/>coder)]
        PgGitea[(Postgres<br/>gitea)]
        PVCs[(PVC<br/>user code)]
    end

    subgraph External["External services"]
        OM[Open Mercato<br/>billing + CRM]
        OR[OpenRouter<br/>LLM gateway]
        Stripe[Stripe]
        CF[Cloudflare DNS]
    end

    User -->|HTTPS / WSS| Ingress
    Ingress --> Onboarding
    Ingress --> Coder
    Ingress -->|wildcard *.apps.*| Workspace

    Onboarding --> PgOnb
    Onboarding -->|REST| Coder
    Onboarding -->|REST| Gitea
    Onboarding -->|customers, subscriptions| OM
    Onboarding -.->|webhook /api/billing/om/webhook| OM
    OM --> Stripe

    Coder --> PgCoder
    Coder -->|provision| Workspace
    Gitea --> PgGitea
    Gitea --> PVCs

    Workspace -->|git push/pull| Gitea
    Workspace -->|inference| OR
    Onboarding -->|provision key| OR

    Ingress -.->|cert DNS-01| CF
```

---

## 2. Components

| Component | Role | Tech | Location |
|---|---|---|---|
| **onboarding** | Signup, dashboard, sandbox provisioning, billing integration | Next.js 15, Postgres 17 | `apps/onboarding` |
| **crm** (OM module) | Customer profile synced with OM | — | `apps/crm` |
| **Coder** | Workspace orchestration, wildcard app proxy | Coder OSS | `infra/helm/values/coder.yaml` |
| **mercato-workspace** | Runtime image: code-server, Node 24, yarn, opencode, codex, claude CLI | Docker image | `coder/workspace-image/Dockerfile` |
| **Gitea** | Backing repository for user code (only option) | Gitea + Postgres | `infra/helm/values/gitea.yaml` |
| **Traefik** | Single ingress, TLS, wildcard routing | Traefik | `infra/hetzner-k3s/manifests/traefik/` |
| **Open Mercato** | Source of truth for billing / subscriptions / CRM | Next.js app | `infra/helm/charts/openmercato` |
| **PostgreSQL (×3)** | State: onboarding / coder / gitea | Postgres 17 | per-service PVC (Hetzner CSI) |

External services: **OpenRouter** (LLM), **Stripe** (via OM), **Cloudflare** (DNS-01 for wildcard cert), **Hetzner** (k3s + CSI + LB).

---

## 3. Routing (single edge, wildcard)

```mermaid
flowchart TB
    Edge[Traefik<br/>:443]

    Edge -->|sandbox.example.com| Onb[Onboarding]
    Edge -->|coder.sandbox.example.com| Coder
    Edge -->|gitea.sandbox.example.com| Gitea
    Edge -->|*.apps.sandbox.example.com<br/>port--agent--ws--user| WS[Coder app proxy → Workspace]
```

Wildcard format: `{port}--{agent}--{workspace}--{user}.apps.<domain>`. WebSocket/HTTP1.1 preserved for PTY and terminal traffic.

---

## 4. Flow: signup → running sandbox

```mermaid
sequenceDiagram
    actor U as User
    participant Onb as Onboarding
    participant OM as Open Mercato
    participant G as Gitea
    participant C as Coder
    participant W as Workspace
    participant OR as OpenRouter

    U->>Onb: Sign up (email, plan)
    Onb->>OM: POST /api/customers/people
    Onb->>OM: POST /api/subscriptions/checkout
    OM-->>Onb: webhook (HMAC) → /api/billing/om/webhook
    Onb->>G: createUserOrg + createRepo
    Onb->>G: createRepoDeployToken
    Onb->>OR: provision per-user key
    Onb->>C: createWorkspace(template, env)
    C->>W: spawn container (env: MERCATO_REPO_URL, TOKEN, OPENROUTER_KEY)
    W->>W: workspace-startup.sh<br/>git config + clone/init
    W->>W: npx create-mercato-app (preset)
    W->>W: yarn setup && yarn dev
    U->>W: HTTPS via wildcard app proxy
```

---

## 5. Workspace lifecycle

```mermaid
stateDiagram-v2
    [*] --> Provisioning
    Provisioning --> FirstStart: container created
    FirstStart --> Running: scaffold + yarn dev
    Running --> Stopped: idle timeout / user stop
    Stopped --> Resuming: user opens
    Resuming --> Running: git pull + yarn dev
    Running --> [*]: delete
```

**Bootstrap** (`coder/template/files/workspace-startup.sh.tftpl`):
- first start: `git config` as `mercato-agent`, `create-mercato-app`, `yarn setup`, `yarn dev`
- subsequent starts: `git pull`, `yarn dev`
- ports: app `:3000`, splash `:4000`, code-server `:13337`

---

## 6. User code persistence

```mermaid
flowchart LR
    WS[Workspace] -->|origin| Gitea[(Gitea repo<br/>&lt;email-local&gt;-&lt;hmac4&gt;/&lt;projectId&gt;)]
    Gitea --> PG[(Postgres<br/>gitea metadata)]
    Gitea --> PVC[(PVC<br/>Hetzner CSI<br/>git objects)]
```

**Rules**:
- Each user gets a backing Gitea **user** (not org — namespaces are shared) named `<email-local>-<hmac4>` (e.g. `john-a3f2`), deterministic per `userId`.
- Sandbox repo name = sanitized `projectId`; full path `<owner>/<projectId>`.
- Deploy token scope `write:repository`, minted per-repo and injected into workspace by Coder as env var.
- All PVCs on **Hetzner CSI** (not Longhorn).
- HTTP-only access (SSH disabled).

---

## 7. Per-workspace secrets

Each sandbox has a dedicated Kubernetes Secret `mercato-workspace-creds-<sandboxId>` in the `mercato-sandboxes` namespace, mounted into the workspace pod via `envFrom`. Onboarding creates/patches/deletes it directly through the Kubernetes API using its in-cluster ServiceAccount.

```mermaid
flowchart LR
    subgraph Onb["Onboarding"]
        SS[sandbox-service]
        BM[om-billing]
    end

    subgraph K8s["Kubernetes API"]
        Sec[(Secret<br/>mercato-workspace-creds-&lt;id&gt;)]
    end

    subgraph WS["Workspace pod"]
        Env[envFrom → process env]
        CLI[codex / claude CLI]
        Git[git remote]
    end

    SS -->|upsert: repo creds| Sec
    BM -->|patch: AI tokens| Sec
    Sec -->|envFrom| Env
    Env --> Git
    Env --> CLI
```

| Key | Source | Used by |
|---|---|---|
| `MERCATO_REPO_URL` | Gitea clone URL | `git` in workspace |
| `MERCATO_REPO_TOKEN` | Gitea per-repo deploy token (`write:repository`) | `git` push/pull |
| `MERCATO_GH_USER_NAME` | committer name (optional) | `git config` |
| `MERCATO_GH_USER_EMAIL` | committer email (optional) | `git config` |
| `OPENROUTER_API_KEY` | per-user OpenRouter key | `codex`, `claude` CLI |
| `ANTHROPIC_AUTH_TOKEN` | mirrors OpenRouter key (or override) | `claude` CLI |

**Lifecycle**:
- Repo credentials written by `sandbox-service` on sandbox create (`upsertWorkspaceCredsSecret`, see [`apps/onboarding/lib/k8s/workspace-secrets.ts`](../../apps/onboarding/lib/k8s/workspace-secrets.ts)).
- AI tokens patched in by `om-billing` after a successful Open Mercato entitlement webhook — same Secret, separate keys.
- Secret deleted with the sandbox; tokens revoked on Gitea / OpenRouter side.

---

## 8. Billing & entitlements

```mermaid
sequenceDiagram
    participant Onb as Onboarding
    participant OM as Open Mercato
    participant S as Stripe
    participant W as Workspace
    participant OR as OpenRouter

    Onb->>OM: /api/billing/checkout
    OM->>S: create Checkout Session
    S-->>OM: payment_intent.succeeded
    OM-->>Onb: webhook (HMAC) — entitlements
    Onb->>OR: update per-user limits
    W->>OR: inference (CLI: codex / claude)
    OR-->>Onb: usage sync (billing cron)
```

Open Mercato is the source of truth for subscriptions. Onboarding never talks to Stripe directly.

---

## 9. Infrastructure

- **Platform**: k3s on Hetzner Cloud, provisioned via OpenTofu (`infra/hetzner-k3s/`).
- **TLS**: Let's Encrypt + Cloudflare DNS-01 for wildcard certs.
- **Storage**: Hetzner CSI volumes for every stateful component.
- **Deployments**: Helm releases from `infra/helm/values/` (onboarding, coder, services-bootstrap, gitea, openmercato).

---

## 10. Key files

**Specs**: [`.ai/SPEC.md`](../SPEC.md), [`.ai/SPEC-CODER-PROXY.md`](../SPEC-CODER-PROXY.md), [`.ai/SPEC-PROD.md`](../SPEC-PROD.md), [`.ai/SPEC-OPENROUTER-ONBOARDING.md`](../SPEC-OPENROUTER-ONBOARDING.md)

**Infra**: [`infra/USER-CODE-PERSISTENCE-PLAN.md`](../../infra/USER-CODE-PERSISTENCE-PLAN.md), [`infra/hetzner-k3s/README.md`](../../infra/hetzner-k3s/README.md), [`infra/helm/README.md`](../../infra/helm/README.md), [`.ai/docs/cluster_provisioning.md`](cluster_provisioning.md)

**Code**:
- [`apps/onboarding/lib/coder.ts`](../../apps/onboarding/lib/coder.ts) — Coder API
- [`apps/onboarding/lib/gitea/client.ts`](../../apps/onboarding/lib/gitea/client.ts) — Gitea API
- [`apps/onboarding/lib/sandbox-service.ts`](../../apps/onboarding/lib/sandbox-service.ts) — provisioning orchestration
- [`coder/template/main.tf`](../../coder/template/main.tf) — workspace template
- [`coder/template/files/workspace-startup.sh.tftpl`](../../coder/template/files/workspace-startup.sh.tftpl) — agent bootstrap
- [`coder/workspace-image/Dockerfile`](../../coder/workspace-image/Dockerfile) — runtime image
