# Mercato Sandboxes POC

See [SPEC.md](./SPEC.md) for the design rationale.

## What this is

A sign-up tool that provisions a self-hosted Coder workspace running an Open Mercato dev environment per signup. A user signs up at `http://localhost:3000`, clicks **Create sandbox**, and gets a workspace with browser-based VS Code, a web terminal, the Mercato app, and the Mercato build splash.

## Architecture

```
┌────────────────────── docker compose (host) ──────────────────────┐
│                                                                   │
│  postgres-onboarding   postgres-coder    coder-server             │
│  :5545                 :5432 (internal)  :7080                    │
│         ▲                     ▲              ▲                    │
│         │                     │              │                    │
│  next-onboarding (3000) ──────┼──────────────┘                    │
│         │ admin API token                                         │
│         │                                                         │
│         │                                                         │
│  bind-mount: /var/run/docker.sock ──────────────────────────────► │
│         (coder-server uses host Docker daemon to spawn workspaces)│
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
       Workspace container (one per signup, mercato-workspace:latest):
         - node 24, yarn 4, code-server, postgres-client, git
         - sidecar postgres (pgvector pg17) on a private docker network
         - on first start: npx create-mercato-app@develop, yarn setup
         - splash on :4000, app on :3000, code-server on :13337
         - 16 GB RAM, 4 vCPU
```

- `postgres-onboarding` — postgres:17-alpine; stores the onboarding app's user + sandbox tables.
- `postgres-coder` — postgres:17; Coder control-plane metadata DB.
- `coder` — ghcr.io/coder/coder; Coder server on `:7080`, drives Docker via the host socket.
- `onboarding` — Next.js 15 app on `:3000`; signup, dashboard, sandbox provisioning UI.
- `mercato-workspace:latest` — built locally; per-signup workspace image with code-server, node 24, yarn 4, build deps.

## Prereqs

- Docker Desktop with at least **16 GB RAM** allocated and **~15 GB** free disk.
- bash, jq, curl on the host shell.
- macOS or Linux. Apple Silicon supported — every image used has a `linux/arm64` variant.

## Quick start

```
cp .env.example .env
./start.sh
```

Then open `http://localhost:3000`.

The **first** run takes ~3 minutes (Coder boots, the workspace image builds, the template gets uploaded and pushed). Subsequent `./start.sh` runs are idempotent and finish in ~30 seconds.

## Logging in

- **Coder admin** — http://localhost:7080 — `admin@local.dev` / `Sup3rSecret!`
- **Onboarding** — http://localhost:3000 — sign up with any email and any 8+ character password.

## End-user flow

- Open `http://localhost:3000`, click **Sign up**, enter email + password.
- Land on `/dashboard`. Click **Create sandbox**, give it a name, submit.
- Land on the sandbox status page. It polls every 3 seconds.
- Within ~30–60 seconds the status flips to **ready** and four buttons appear:
  - **Open in VS Code** — code-server with the scaffolded Mercato project.
  - **Open Terminal** — Coder's web terminal inside the workspace.
  - **Open Mercato Splash** — port 4000, the live build-progress page.
  - **Open Mercato App** — port 3000, the running Mercato app.

## What "ready" means

The Coder workspace agent reports `lifecycle_state: ready` as soon as the startup script returns. We launch `yarn setup` in the background, so:

- **VS Code** (code-server on :13337) — usable the moment the sandbox shows ready (~30–60s).
- **Mercato Splash** (port 4000) — the Mercato build-progress page; available immediately when the sandbox shows ready.
- **Mercato App** (port 3000) — takes another **3–7 minutes** on first start while `yarn install`, `generate`, `db migrate`, `initialize`, and the Next.js compile finish. The button will return **502** until Next.js prints `Ready in Xms`. Watch the splash for live progress.

## Resetting

- `./stop.sh` — `docker compose down`. Containers are removed; volumes (Coder DB, onboarding DB, every workspace home) are preserved. `./start.sh` afterwards is fast.
- `./reset.sh` — `docker compose down -v` plus removal of `.runtime/`. **Wipes all data** including every provisioned sandbox. Irreversible.

## Tests

```
make test
```

Runs the Playwright suite in `e2e/`. The stack must already be up (`./start.sh`). The suite signs up a fresh user, creates a sandbox, and waits for `ready`; takes 1–3 minutes.

## Troubleshooting

- **`coder` container restart-loops** — `docker logs coder`. Usually `host.docker.internal` resolution; the compose file sets `extra_hosts: host.docker.internal:host-gateway` to fix this on Linux.
- **Workspace stuck "building" forever** — find the workspace and sidecar containers and check their logs:
  ```
  docker ps --format '{{.Names}}' | grep coder-
  docker logs coder-<owner>-<workspace>
  docker logs coder-<workspace_id>-postgres
  ```
- **Port 5544 in use** — the spec mentions 5544 but we expose `postgres-onboarding` on **5545** to avoid the collision. If 5545 is also taken, change `ONBOARDING_DB_PORT` in `.env`.
- **Port 3000 in use** — the onboarding container claims host `:3000`. The Mercato app inside each workspace also listens on `:3000` but is reached through the Coder reverse proxy (`/@user/<workspace>/apps/app`), so there is no host conflict.
- **`tar -- no such option` on Linux** — install GNU tar. macOS BSD tar works fine because we run `tar` inside containers via `docker exec`, so this should not bite in practice.
- **Disk full** — `./reset.sh` then `docker system prune -a --volumes`.

## Project layout

```
.
├── SPEC.md                  Design spec
├── README.md                This file
├── docker-compose.yml       postgres-onboarding, postgres-coder, coder, onboarding
├── start.sh / stop.sh / reset.sh   Lifecycle scripts
├── Makefile                 start | stop | reset | ps | logs | config | test
├── .env.example             Copy to .env before first start
├── .runtime/                Generated: coder admin token, template id (gitignored)
├── scripts/
│   ├── bootstrap-coder.sh   First admin + long-lived API token
│   ├── build-workspace-image.sh   Builds mercato-workspace:latest
│   ├── push-template.sh     Uploads coder/template, promotes to `mercato`
│   └── migrate-onboarding.sh   Applies apps/onboarding/db/schema.sql
├── coder/
│   ├── workspace-image/Dockerfile   node 24 + code-server + build deps
│   └── template/main.tf     Terraform: agent + sidecar pgvector + workspace
├── apps/onboarding/         Next.js 15 + TS + Tailwind + pg + jose + bcryptjs
│   ├── app/                 Routes (signup, login, dashboard, sandboxes)
│   ├── lib/                 db, auth, coder API wrapper
│   └── db/schema.sql        users + sandboxes tables
└── e2e/                     Playwright suite (`make test`)
```

## Out of scope (POC)

- Email delivery (we surface the temp Coder password on screen rather than emailing).
- Multi-tenancy / orgs in Coder (single default org).
- Wildcard subdomain URLs (we use path-based; HMR may be flaky for the Mercato app, but the splash and code-server work fine and the app loads).
- Production hardening (TLS, secret management, OIDC).
