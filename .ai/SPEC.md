# Mercato Sandboxes POC Spec

## Purpose

Provide an onboarding app that creates Coder workspaces for Mercato development.
Each workspace exposes:

- browser VS Code
- native Coder web terminal
- Open Mercato app on port 3000
- splash/status page on port 4000

All user-facing routes must use standard HTTPS subdomain routing. Non-standard
browser ports are not acceptable for the primary flow.

## Onboarding Navigation

Authenticated onboarding separates sandbox management from AI billing:

- `/dashboard` is the sandbox-focused landing page with the create-sandbox CTA
  and the user's current sandbox list.
- `/billing` owns AI entitlement activation, top-ups, and the current usage
  snapshot.

When sandbox creation is blocked because AI access is inactive, onboarding
should send the user to `/billing` instead of embedding the full billing UI on
the main dashboard.

## Billing Backend

`apps/onboarding` delegates subscription and payment state to Open Mercato.
There is a single billing path:

- signup and billing flows sync the onboarding user into Open Mercato CRM
- signup creates or reuses a CRM person through `/api/customers/people`
  using `OPENMERCATO_CUSTOMER_TENANT_ID` and
  `OPENMERCATO_CUSTOMER_ORGANIZATION_ID`
- `/api/billing/checkout` calls Open Mercato `/api/subscriptions/checkout`
  with the user's CRM person id as `subjectEntityId` and the onboarding
  `users.id` (UUID) as `externalAccountId`. Selected price code defaults to
  `BASIC_PLAN_PRICE_CODE` (`basic-monthly-pln-v1`).
- payments are handled by Open Mercato's Stripe gateway. Onboarding never
  talks to Stripe directly.
- onboarding trusts only `/api/billing/om/webhook` for state changes. The
  endpoint validates an HMAC signature (`OM_BILLING_WEBHOOK_SECRET`) sent in
  the `x-om-webhook-signature` header and dedupes deliveries by the
  `x-om-webhook-delivery-id` header.
- the source of truth for access state is Open Mercato. `/billing` and the
  sandbox guard always call `GET /api/subscriptions/access` and reconcile the
  local OpenRouter key + Coder secrets against the returned `entitlements`.
- refund/chargeback/cancelled events arrive as `accessState='blocked'` and
  cause onboarding to disable the OpenRouter key and mark the local
  `llm_accounts` row `suspended`.

Onboarding remains the source of truth for:

- local login/session
- sandbox lifecycle
- OpenRouter key lifecycle (limit = `entitlements.openRouterTokensUsageUsd`)
- usage snapshots shown on `/billing`
- Coder secret synchronization

## Current Local Topology

The local stack is published by one nginx `edge` container:

| Public URL | Backend |
| --- | --- |
| `https://sandbox.lvh.me` | onboarding Next.js app |
| `https://app.sandbox.lvh.me` | redirect to `https://sandbox.lvh.me` |
| `https://coder.sandbox.lvh.me` | Coder control plane |
| `https://*.apps.sandbox.lvh.me` | Coder wildcard app proxy |

Port `80` redirects to HTTPS. Port `443` terminates TLS and proxies to Docker
services on the `mercato-proxy` network.

`start.sh` generates a local wildcard certificate at
`.runtime/tls/sandbox-lvh-me.crt` and `.runtime/tls/sandbox-lvh-me.key` if
missing. Trust the certificate locally to avoid browser privacy warnings.

## Additive Kubernetes Local Path

The Docker Compose flow remains the default local path. An additive Kubernetes
path lives under `k8s/` and must not mutate the Compose stack or the existing
Docker template.

The Kubernetes local path uses:

- one `k3d` cluster
- `ingress-nginx` for host-based routing
- `kubectl port-forward` to expose ingress locally on `:8443`
- the same onboarding app contract for `CODER_URL`, `CODER_PUBLIC_URL`,
  `CODER_ADMIN_TOKEN_FILE`, and `CODER_TEMPLATE_ID_FILE`
- a separate Kubernetes-specific Coder template under `k8s/coder-template/`

The local Kubernetes URLs are:

- `https://sandbox.lvh.me:8443`
- `https://coder.sandbox.lvh.me:8443`
- `https://13337--main--<workspace>--<user>.apps.sandbox.lvh.me:8443`
- `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me:8443`
- `https://4000--main--<workspace>--<user>.apps.sandbox.lvh.me:8443`

## Additive Hetzner OpenTofu Path

An additive Hetzner Cloud bootstrap path lives under `infra/terraform`.

That OpenTofu root provisions only the infrastructure needed for a minimal k3s
sandbox cluster:

- one private Hetzner network and subnet
- one firewall
- one SSH key upload
- one control-plane server: `master-01`
- one or more sandbox worker servers, defaulting to `worker-sandbox-01`

k3s installation, worker join, and sandbox node labels/taints are intentionally
kept outside Terraform and are handled manually or via the helper scripts under
`infra/terraform/scripts/`.

In this mode, each workspace is provisioned as one Kubernetes `Deployment`
containing:

- one `mercato-workspace` container running the Coder agent, code-server, and
  the Mercato app
- one sidecar PostgreSQL container
- one PVC for `/home/coder`
- one PVC for PostgreSQL data

The `infra/` Kubernetes bootstrap path uses the built-in k3s `local-path`
storage class for workspace PVCs and two simple in-cluster PostgreSQL
`StatefulSet`s. `infra/helm` must stay free of storage or database operators in
this default path.

The same `infra/helm` path also ships an optional standalone `openmercato`
release for cluster-local CRM experiments. That release stays intentionally
simple too: one app `Deployment`, one PVC for `/app/apps/mercato/storage`, and
single-replica PostgreSQL plus Redis `StatefulSet`s with no external operator
dependencies.

The Kubernetes path reuses the local TLS certificate files under `.runtime/tls`
by projecting them into a Kubernetes TLS secret for ingress termination.

## Runtime Services

| Service | Role |
| --- | --- |
| `postgres-coder` | Coder metadata database |
| `coder` | Coder control plane, listening on internal port 80 |
| `postgres-onboarding` | onboarding app database |
| `onboarding` | Next.js signup/dashboard app |
| `openmercato` | standalone Open Mercato app on Kubernetes |
| `edge` | nginx HTTPS edge for onboarding, Coder, and Coder wildcard apps |

The local Traefik/docker-socket-proxy/shim path has been removed.

## Workspace Model

One Coder workspace provisions:

- one `mercato-workspace` container
- one sidecar Postgres container
- one persistent home volume
- one persistent Postgres data volume
- one private Docker network for workspace-to-Postgres traffic
- attachment to the shared `mercato-proxy` network so the agent can reach Coder

The onboarding app supports a minimal manual pause/resume flow for existing
workspaces:

- `pause` stops the running Coder workspace compute
- `resume` starts the same Coder workspace again
- `resume` must relaunch the Mercato dev process with `yarn dev` instead of
  rerunning first-boot `yarn setup`
- the existing workspace identity and persistent storage must be reused
- the sandbox UI exposes this flow from the sandbox detail page

Sandbox creation persists a `preset_id` in onboarding and forwards an immutable
`sandbox_preset` rich parameter into Coder workspace creation. Both Coder
templates must support the same active Open Mercato presets:

- `crm`
- `empty`
- `classic`

The bare shell workspace remains a planned follow-up and must stay
non-creatable until onboarding and Coder app links support a non-Mercato UX.

Workspace ports are exposed through Coder's native wildcard access URL:

| Surface | URL shape |
| --- | --- |
| VS Code | `https://13337--main--<workspace>--<user>.apps.sandbox.lvh.me/?folder=/home/coder/app` |
| App | `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me` |
| Splash | `https://4000--main--<workspace>--<user>.apps.sandbox.lvh.me` |
| Terminal | `https://coder.sandbox.lvh.me/@<user>/<workspace>/terminal` |

The Kubernetes Coder template must define VS Code, app, and splash as
Coder-managed subdomain apps:

- `url` points at the in-workspace listener such as `http://localhost:3000`
- `subdomain = true`
- `share = "owner"`

The onboarding app must consume Coder's subdomain app metadata instead of
reconstructing wildcard hosts locally:

- use `subdomain_name` as the browser-facing host for subdomain apps
- if `subdomain_name` is only a bare host label, append `WILDCARD_APPS_DOMAIN`
- preserve any path and query fragment from the proxied `url`
- for local Kubernetes port-forwarding, normalize the final scheme and port to
  match `CODER_PUBLIC_URL`

## Required Environment

```env
SANDBOX_DOMAIN=sandbox.lvh.me
WILDCARD_APPS_DOMAIN=apps.sandbox.lvh.me
PROXY_SCHEME=https
CODER_ACCESS_URL=https://coder.sandbox.lvh.me
CODER_PUBLIC_URL=https://coder.sandbox.lvh.me
CODER_WILDCARD_ACCESS_URL=*.apps.sandbox.lvh.me
COOKIE_DOMAIN=.sandbox.lvh.me
COOKIE_SECURE=true
```

`CODER_DERP_FORCE_WEBSOCKETS=true` is enabled to force ordinary WebSocket DERP
transport through reverse proxies.

When onboarding should create or reuse CRM people during signup, also set:

```env
OPENMERCATO_CUSTOMER_TENANT_ID=<open-mercato-tenant-uuid>
OPENMERCATO_CUSTOMER_ORGANIZATION_ID=<open-mercato-organization-uuid>
```

## Acceptance Criteria

1. `./start.sh` starts Coder, onboarding, databases, and nginx edge.
2. `https://sandbox.lvh.me` loads onboarding.
3. `http://sandbox.lvh.me` redirects to HTTPS.
4. Creating a sandbox reaches `ready`.
5. `Open in VS Code` opens a usable workbench on the Coder wildcard app host.
6. `Open Terminal` opens a stable native Coder shell.
7. `Open Mercato App` loads and hydrates on the wildcard app host.
8. `Open Splash` loads on the wildcard app host.
9. All links are wrapped by `/api/coder-login` when leaving onboarding so the
   browser has a `coder_session_token` before reaching Coder.
10. `k8s/` provides an additive local Kubernetes workflow that keeps the same
    onboarding contract and exposes onboarding, Coder, and wildcard apps
    through ingress on `:8443` via `kubectl port-forward`.
11. A ready sandbox can be paused from the sandbox detail page and later
    resumed without creating a new Coder workspace or reinitializing its
    persistent storage.
12. Sandbox creation offers the `crm`, `empty`, and `classic` Open Mercato
    presets and first boot runs the matching `create-mercato-app --preset ...`
    command inside the selected template.
13. Authenticated onboarding exposes a dedicated `/billing` page for AI usage
    and checkout actions, while `/dashboard` stays focused on sandbox
    management.
14. `BILLING_BACKEND=openmercato` switches `/billing` to Open Mercato-managed
    plan selection, creates or reuses the signup CRM person with the scoped
    Open Mercato API credential, creates checkout sessions through the bridge,
    trusts only signed Open Mercato outbound webhooks, and blocks sandbox
    create/resume after refund/chargeback entitlement suspension.

## Production Notes

Production should use the same nginx-edge topology with a real certificate
covering:

- `${SANDBOX_DOMAIN}`
- `*.${SANDBOX_DOMAIN}`
- `*.apps.${SANDBOX_DOMAIN}`

All persistent state must remain on named volumes. Deployment scripts must not
run `docker compose down -v`, `docker volume rm`, or
`docker system prune --volumes`.
