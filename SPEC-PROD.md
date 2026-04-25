# Mercato Sandboxes — PRODUCTION Spec

Canonical spec for deploying Mercato Sandboxes to a single-node Hetzner VPS
(or any equivalent Linux box with Docker 24+) under
`*.sandbox.openmercato.com`.

This document supersedes `SPEC.md` for production concerns. `SPEC.md` remains
the authoritative spec for the local-development POC and for the application
behavior shared by both modes.

---

## 1. Goals

- Single VPS, single docker compose stack — no Kubernetes, no managed services.
- A user signing up at `https://app.sandbox.openmercato.com` gets a personal
  Coder workspace with the same UX as the local POC, but on a public HTTPS
  hostname.
- One **wildcard** Let's Encrypt certificate for `*.sandbox.openmercato.com`,
  issued via DNS-01 (Cloudflare). Each new workspace gets HTTPS instantly,
  with no per-subdomain ACME round-trip and no risk of LE rate-limit bursts.
- The deploy script is **idempotent** and **safe to re-run**: data (Coder
  metadata, onboarding DB, workspace home dirs, sidecar postgres dirs, issued
  certs) is preserved across redeploys.

## 2. Topology

```
                        Internet
                            │
                ┌───────────┴────────────┐
                │  Cloudflare DNS         │
                │  *.sandbox.openmercato  │
                │     A → 49.x.x.x        │
                └───────────┬─────────────┘
                            │ :80, :443
              ┌─────────────▼────────────────┐
              │   Hetzner VPS (Ubuntu 24.04) │
              │                              │
              │   docker network: control    │
              │   docker network: mercato-proxy
              │                              │
              │   ┌─────────────────────┐    │
              │   │ caddy (custom build)│    │  ← single wildcard cert
              │   │ + docker-proxy +    │    │     issued via DNS-01
              │   │   caddy-dns/cf      │    │
              │   └──┬──────────────┬───┘    │
              │      │              │        │
              │   coder         onboarding   │
              │      │              │        │
              │   postgres-coder  postgres-onboarding
              │                              │
              │   workspaces (one per user): │
              │     mercato-workspace + sidecar pg
              │     each with TWO named volumes:
              │       coder-<id>-home        │
              │       coder-<id>-pg-data     │
              └──────────────────────────────┘
```

## 3. Components

| Layer        | Image / Source                                           | Notes |
|--------------|----------------------------------------------------------|-------|
| Reverse proxy | `mercato-caddy:latest` (built from `./caddy/Dockerfile`) | caddy-docker-proxy + caddy-dns/cloudflare baked in |
| Coder server | `ghcr.io/coder/coder:v2.21.3` (pinned)                   | spawns workspaces via host docker socket |
| Onboarding   | `apps/onboarding` (built locally)                        | Next.js 15 |
| Postgres (Coder) | `postgres:17`                                          | named volume `postgres-coder-data` |
| Postgres (Onboarding) | `postgres:17-alpine`                              | named volume `postgres-onboarding-data` |
| Workspace    | `mercato-workspace:latest` (built locally)               | per-signup container |
| Sidecar PG   | `pgvector/pgvector:pg17-trixie`                          | per-workspace, named volume `coder-<id>-pg-data` |

## 4. Wildcard TLS via DNS-01

We use a **single** wildcard cert for `*.sandbox.openmercato.com` because:

1. Every workspace lives at `<name>.sandbox.openmercato.com` and
   `<name>-splash.sandbox.openmercato.com`. Per-subdomain HTTP-01 would mean
   one ACME round-trip per workspace creation, plus a delay before the first
   HTTPS request succeeds.
2. Let's Encrypt rate-limits to 50 certs/registered-domain/week and 5
   duplicate certs/week. A burst of sandbox creations would trip the limit.
3. DNS-01 is the only ACME challenge that supports wildcards.

### Implementation

- **Custom caddy image** (`./caddy/Dockerfile`): two-stage build using
  `caddy:builder` + `xcaddy` to compile in:
  - `github.com/lucaslorentz/caddy-docker-proxy/v2` (label-driven vhosts)
  - `github.com/caddy-dns/${DNS_PROVIDER}` (default `cloudflare`)
- **Caddyfile snippet** (`./caddy/Caddyfile.prod`) declares:
  ```caddy
  *.{$SANDBOX_DOMAIN}, {$SANDBOX_DOMAIN} {
      tls {
          dns cloudflare {env.CLOUDFLARE_API_TOKEN}
      }
  }
  ```
- **Docker compose override** (`docker-compose.prod.yml`) mounts the snippet
  at `/etc/caddy/Caddyfile` and sets `CADDY_DOCKER_CADDYFILE_PATH` so caddy
  merges it with the dynamic per-container directives.
- Each workspace container's labels emit a `https://<name>.<domain>` site
  block; caddy matches it against the pre-issued wildcard cert and serves
  HTTPS on first hit — no per-subdomain ACME.

### Cloudflare API token

Required scope: **Zone → DNS → Edit** on the `sandbox.openmercato.com` zone
(or its parent). Generate at <https://dash.cloudflare.com/profile/api-tokens>
using the "Edit zone DNS" template. Paste into `.env.production` as
`CLOUDFLARE_API_TOKEN`. The token is only used for the DNS-01 challenge —
caddy creates and removes a single `_acme-challenge` TXT record per renewal.

## 5. DNS prerequisites (operator must set up)

```
sandbox.openmercato.com.        A   <VPS public IP>
*.sandbox.openmercato.com.      A   <VPS public IP>
```

Both records are mandatory: the apex is what users see in the address bar
(e.g. `https://app.sandbox.openmercato.com`), the wildcard handles every
workspace subdomain. TTL 300 s is enough; caddy handles propagation.

## 6. URL scheme in production

| URL                                                       | Backend          |
|-----------------------------------------------------------|------------------|
| `https://app.sandbox.openmercato.com`                     | onboarding (Next.js) |
| `https://coder.sandbox.openmercato.com`                   | Coder admin UI |
| `https://<workspace>.sandbox.openmercato.com`             | workspace app on `:3000` |
| `https://<workspace>-splash.sandbox.openmercato.com`      | workspace splash on `:4000` |
| `https://coder.sandbox.openmercato.com/@<user>/<ws>/...`  | code-server / web terminal (path-based, served by Coder itself) |

## 7. Data preservation contract

This is **the** safety property of the production deploy: re-running the
deploy script does not destroy any user data.

### What is persistent

All persistent state lives in **named docker volumes**:

| Volume                                  | Holds                                       |
|-----------------------------------------|---------------------------------------------|
| `postgres-coder-data`                   | Coder metadata DB                           |
| `postgres-onboarding-data`              | onboarding users + sandbox table            |
| `coder-data`                            | Coder server config / state                 |
| `caddy-data`                            | issued certs, ACME account key              |
| `caddy-config`                          | caddy generated config cache                |
| `coder-<workspace_id>-home`             | workspace `/home/coder` (per workspace)     |
| `coder-<workspace_id>-pg-data`          | sidecar postgres data dir (per workspace)   |

The last one is **new in this prod spec** (POC was using anonymous volumes
that were lost on container recreate). See the change to
`coder/template/main.tf` (`docker_volume.pg_data`).

### What the deploy script promises

`scripts/deploy-hetzner.sh` includes a **runtime self-assertion**:

```bash
grep -E '(down -v|volume rm|prune.*--volumes|prune.*-a)' "$SELF" \
  | grep -vE '^\s*#|grep -E' >/dev/null && exit 1
```

If anyone ever adds `docker compose down -v`, `docker volume rm`,
`docker system prune --volumes`, or `docker system prune -a` to the script,
the script aborts on its next run before doing anything destructive.

The CI guard in this repo (`grep -E '(down -v|volume rm|prune.*--volumes|prune.*-a)' scripts/deploy-hetzner.sh`)
must return empty.

### What deploy DOES touch

- Builds a fresh `mercato-caddy` image (the `caddy-data` and `caddy-config`
  volumes are re-attached, so the wildcard cert survives).
- Builds a fresh `onboarding` image and recreates that container.
- Pushes a new Coder template version. Existing workspaces continue running
  on their previous version until an operator triggers an upgrade in the
  Coder UI.

### Intentional destruction

Use `./reset.sh` MANUALLY on the box. It runs `docker compose down -v` and
WILL wipe every workspace, every cert, and the onboarding user table. It is
deliberately not wired into any CI / deploy path.

## 8. Deploy procedure

### First deploy

```bash
# On the VPS, as root or a docker-group user:
git clone https://github.com/<org>/dokploy-sandboxes-poc.git /opt/mercato-sandboxes
cd /opt/mercato-sandboxes
cp .env.production.example .env.production
$EDITOR .env.production         # fill in CLOUDFLARE_API_TOKEN, JWT_SECRET, passwords
./scripts/deploy-hetzner.sh
```

First run takes ~10 min (caddy build, workspace image build, Coder boot,
DNS-01 challenge, template push).

### Re-deploy after a code change

```bash
cd /opt/mercato-sandboxes
git pull
./scripts/deploy-hetzner.sh
```

Subsequent runs take ~2 min (image cache hits, no DNS-01 unless renewal is
due, template push only creates a new version).

### Validation

The script smoke-checks `https://app.${SANDBOX_DOMAIN}/login` over HTTPS at
the end. If the cert isn't valid yet (DNS-01 still propagating), the check
times out and the script exits non-zero — **but** all volumes are still
intact and a re-run will succeed once propagation completes.

## 9. End-to-end test in production

`e2e/playwright.config.ts` ships a `production` project that hits
`https://${SANDBOX_DOMAIN}` instead of localhost. Run from a workstation:

```bash
cd e2e
BASE_URL=https://app.sandbox.openmercato.com npx playwright test --project=production
```

Skip the test on PRs that only touch infra — running it against prod creates
a real workspace and consumes ~5 GB of disk for ~10 minutes.

## 10. Operational runbook

- **Renew cert**: nothing to do. Caddy handles renewal automatically ~30 days
  before expiry via the Cloudflare API token. Logs: `docker logs mercato-caddy`.
- **Bump Coder version**: edit `CODER_IMAGE_TAG` in `.env.production`,
  re-run `./scripts/deploy-hetzner.sh`. Coder pulls the new image, restarts.
  Workspaces are unaffected (they're separate containers).
- **Bump workspace image**: `docker rmi mercato-workspace:latest && ./scripts/deploy-hetzner.sh`.
  New workspaces use the new image; existing workspaces keep their built one
  until they're recreated.
- **Promote a new template version**: the deploy script pushes a new
  template version on every run. To force existing workspaces onto it, go to
  Coder UI → Templates → mercato → Workspaces → select all → Update.
- **Backup**: snapshot the docker volumes (Hetzner snapshot of the whole
  disk works). All state is in `/var/lib/docker/volumes/<name>/_data`.
- **Disaster recovery**: restore the snapshot, run `./scripts/deploy-hetzner.sh`
  — caddy reuses the restored cert, Coder reuses its DB, all workspaces come
  back up.

## 11. Out of scope (still — same as POC)

- Multi-node / HA. Single VPS only.
- OIDC / SSO for the onboarding app.
- Email delivery. The temp Coder password is shown on screen.
- Multi-region.
- Per-user resource quotas beyond the 16 GB / 4 vCPU cap baked into the
  template.

## 12. File map

| Path                                | Purpose                                |
|-------------------------------------|----------------------------------------|
| `caddy/Dockerfile`                  | Custom caddy build (DNS-01 + docker-proxy) |
| `caddy/Caddyfile.prod`              | Wildcard TLS site block                 |
| `docker-compose.prod.yml`           | Production compose override             |
| `.env.production.example`           | Template for the prod env file          |
| `scripts/deploy-hetzner.sh`         | Idempotent, data-preserving deploy script |
| `coder/template/main.tf`            | Adds `docker_volume.pg_data` for sidecar PG |
| `e2e/playwright.config.ts`          | Adds the `production` project           |
| `SPEC-PROD.md`                      | This document                          |
