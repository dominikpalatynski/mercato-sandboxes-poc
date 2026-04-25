# Mercato Sandboxes — POC Spec

A self-hosted onboarding tool that lets a user sign up, click "create sandbox", and receive
a fresh **Open Mercato** dev environment running inside a **Coder** workspace, with
clickable links to open it in browser-based VS Code and a web terminal.

---

## 1. User stories

### End user (developer signing up)
1. Visit `http://localhost:3000`, click **Sign up**, enter email + password, submit.
2. Land on a dashboard. Click **Create sandbox**, give it a name.
3. See a "provisioning…" page. Within ~2–4 minutes, get four buttons:
   - **Open in VS Code** — opens code-server in a new tab, file tree showing the scaffolded Mercato app.
   - **Open Terminal** — opens Coder's web terminal in the workspace.
   - **Open App (port 3000)** — the running Mercato app.
   - **Open Splash (port 4000)** — Mercato's build-progress splash screen.

### Admin (operator)
- Has a separate Coder admin login (`http://localhost:7080`) and can see every workspace,
  every user, every build log; can stop/delete workspaces.

---

## 2. Architecture

```
                           ▼ host :80 / :443 / :8080 (dashboard)
┌──────────────────────────┴────────────────────────────────────────┐
│  traefik (single edge proxy, label-driven)                        │
│    coder.<DOMAIN>           → coder:7080                          │
│    <DOMAIN>, app.<DOMAIN>   → onboarding:3000                     │
│    <ws>.<DOMAIN>            → workspace :3000  (app)              │
│    <ws>-splash.<DOMAIN>     → workspace :4000  (splash)           │
│    <ws>-code.<DOMAIN>       → workspace :13337 (code-server)      │
└──────────────────────────┬────────────────────────────────────────┘
                           │ (mercato-proxy network — labels discovered
                           │  via docker-socket-proxy that rewrites
                           │  /v1.NN/* → /v1.45/* for Docker Desktop
                           │  4.57+ MinAPIVersion compatibility)
                           ▼
┌────────────────────── docker compose (host) ──────────────────────┐
│                                                                   │
│  postgres-onboarding   postgres-coder    coder                    │
│  :5544 (host)          (internal)        (internal)               │
│         ▲                     ▲              ▲                    │
│         │                     │              │                    │
│  onboarding (next.js) ────────┼──────────────┘                    │
│         │ admin API token                                         │
│         │                                                         │
│  bind-mount: /var/run/docker.sock ──────────────────────────────► │
│         (coder uses host Docker daemon to spawn workspaces)       │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
       Workspace container (one per signup, mercato-workspace:latest):
         - node 24, yarn 4, code-server, postgres-client, git
         - sidecar postgres (pgvector pg17) on a private docker network
         - on first start: npx create-mercato-app@develop, yarn setup
         - splash on :4000, app on :3000, code-server on :13337
         - 16 GB RAM, 4 vCPU
         - Traefik labels emit by terraform → app/splash/code subdomains
```

### Components

| Service                | Image / Tech                                | Purpose                                                                                  |
|------------------------|---------------------------------------------|------------------------------------------------------------------------------------------|
| `traefik`              | `traefik:v3.5`                              | Single edge proxy for the whole stack (replaces the old caddy + nginx-coder pair). Discovers routes from docker labels. Dashboard at `:8080/dashboard/` in dev. |
| `docker-socket-proxy`  | `nginx:alpine` + `proxy/docker-api-shim.conf` | Rewrites `/v1.NN/*` → `/v1.45/*` so Traefik's go-docker client (which hardcodes `v1.24`) works against Docker Desktop 4.57+ engine 29.x (MinAPIVersion 1.44). |
| `postgres-onboarding`  | `postgres:17-alpine`                        | Onboarding app's user + sandbox tables                                                   |
| `postgres-coder`       | `postgres:17`                               | Coder's metadata DB                                                                      |
| `coder`                | `ghcr.io/coder/coder:latest`                | Coder control plane. Internal `:7080`; published by Traefik at `coder.<SANDBOX_DOMAIN>`. |
| `onboarding`           | `node:24-alpine` (custom build)             | Next.js + TypeScript onboarding UI. Internal `:3000`; published by Traefik at `<SANDBOX_DOMAIN>` and `app.<SANDBOX_DOMAIN>`. |
| `mercato-workspace`    | custom (`node:24-bookworm-slim`)            | Image for each sandbox; built by start script                                            |

### Data model (onboarding postgres)

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  coder_user_id uuid,                -- once provisioned in Coder
  coder_username text,               -- mirror of Coder username (== email local part)
  created_at timestamptz default now()
);

create table sandboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,                -- workspace name in Coder
  coder_workspace_id uuid,
  status text not null default 'pending',  -- pending|building|ready|failed|stopped
  status_message text,
  vscode_url text,
  terminal_url text,
  app_url text,
  splash_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

---

## 3. Coder template

Path: `coder/template/`

- `Dockerfile` — `node:24-bookworm-slim` + python3/make/g++/postgresql-client/git/curl + corepack yarn 4.12 + code-server + non-root `coder` user.
- `main.tf` — Terraform definition:
  - `coder_agent.main` runs the startup script on container boot.
  - `docker_volume.home` for `/home/coder` (persistent across stop/start).
  - `docker_volume.pg_data` for the sidecar postgres (persistent across stop/start, with `lifecycle.ignore_changes = all` so a template upgrade can never destroy it).
  - `docker_network.workspace` private network so the workspace container and its
    sidecar postgres can reach each other.
  - `docker_container.postgres` — `pgvector/pgvector:pg17-trixie`, attached to the network,
    `POSTGRES_DB=mercato`, `POSTGRES_USER=mercato`, `POSTGRES_PASSWORD=mercato`.
  - `docker_container.workspace` — image `mercato-workspace:latest`, attached to **two** networks (private `workspace` for the postgres sidecar, shared `mercato-proxy` for Traefik), memory 16384 MiB, mounts the home volume, gets the agent token, runs the init script with `localhost`→`host.docker.internal` rewrite (mac gotcha). Also adds an `extra_hosts` alias `coder.<SANDBOX_DOMAIN> → host-gateway` so the agent can dial home through Traefik on the host even from inside the workspace's container-loopback world.
  - **Traefik labels** (built once into `local.workspace_labels` and emitted via a `dynamic "labels"` block) publish three subdomains per workspace: `<ws>.<DOMAIN>` → :3000 (app), `<ws>-splash.<DOMAIN>` → :4000 (splash), `<ws>-code.<DOMAIN>` → :13337 (code-server). The `code` route attaches a per-workspace middleware that strips `Accept-Encoding` upstream + `Sec-WebSocket-Extensions` downstream so neither gzip nor permessage-deflate get negotiated (otherwise code-server's extension host hits `Z_DATA_ERROR`).
  - `coder_app` resources: `code-server` (path-based via Coder's dashboard, healthcheck on 13337), `splash` (`external = true`, points at the Traefik-published splash subdomain), `app` (`external = true`, points at the Traefik-published app subdomain).

### Startup script (inside workspace)

```bash
set -e
# 1. start code-server right away
code-server --auth none --bind-addr 0.0.0.0:13337 >/tmp/code-server.log 2>&1 &

# 2. on first boot only: scaffold + setup
if [ ! -d "$HOME/app" ]; then
  cd "$HOME"
  npx -y create-mercato-app@develop app --skip-agentic-setup
  cd app
  cp .env.example .env
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgres://mercato:mercato@postgres:5432/mercato#" .env
  echo "OM_DEV_AUTO_OPEN=0" >> .env
  echo "OM_DEV_SPLASH_PORT=4000" >> .env
  yarn install
fi

# 3. always: launch dev (yarn setup is idempotent — runs migrate + initialize, then dev)
cd "$HOME/app"
nohup yarn setup >/tmp/mercato-dev.log 2>&1 &
```

The `yarn setup` script (open-mercato's own orchestrator) starts the splash on 4000
immediately, then progresses through install/generate/migrate/initialize/dev. The user
sees the splash within seconds; the app on 3000 becomes ready within a few minutes.

---

## 4. Onboarding app (Next.js)

Path: `apps/onboarding/`

- **Stack**: Next.js 15 (App Router) + TypeScript + React + Tailwind + `pg` driver +
  `bcryptjs` for password hashing + `jose` for JWT session cookies.
- **Routes**:
  - `GET /` → redirect to `/dashboard` (or `/login` if not signed in)
  - `GET /signup`, `POST /api/signup` → create user + cookie
  - `GET /login`, `POST /api/login` → cookie
  - `POST /api/logout`
  - `GET /dashboard` → list user's sandboxes
  - `GET /sandboxes/new`, `POST /api/sandboxes` → create
  - `GET /sandboxes/[id]` → status page; polls `GET /api/sandboxes/[id]/status` every 3s
- **`coder.ts` lib** — small typed wrapper over Coder API using `CODER_ADMIN_TOKEN`:
  - `createUser(email, password)` → returns Coder user UUID + username
  - `createWorkspace(userId, username, name, templateId)` → returns workspace UUID
  - `getWorkspaceStatus(id)` → returns `{ jobStatus, agentStatus, lifecycleState }`
  - `buildLinks(username, name)` → the four URLs
- **Sandbox creation flow** (server action / API route):
  1. Create Coder user with random temp password (per-signup; one Coder user maps 1:1 to one onboarding user; created on first sandbox creation).
  2. Create workspace with `name` from form, `template_id` from `CODER_TEMPLATE_ID` env.
  3. Persist row with status `building`.
  4. Background poll loop (`setInterval` on the API route or a `/api/sandboxes/[id]/poll`
     called by the client) updates the row to `ready` once `agent.lifecycle_state == 'ready'`.
  5. Status page reads URLs once row is `ready`.

---

## 5. Single-script orchestration

Path: `./start.sh` (and `./stop.sh`)

```
./start.sh          # idempotent; brings up everything and prints URLs
./stop.sh           # docker compose down (preserves volumes)
./reset.sh          # docker compose down -v (nukes data)
```

`start.sh` steps:

1. `docker compose up -d postgres-onboarding postgres-coder coder` (and wait for healthchecks).
2. Run `scripts/bootstrap-coder.sh` — idempotent: creates first admin if none exists,
   logs in, mints a long-lived API token, writes it to `./.runtime/coder-admin-token`.
3. `docker build -t mercato-workspace:latest ./coder/workspace-image` (only if missing or `--rebuild-image`).
4. Run `scripts/push-template.sh` — packages `./coder/template/`, uploads via Coder's
   `POST /api/v2/files`, creates a template version, polls until `succeeded`, promotes
   to template `mercato`. Writes the template ID to `./.runtime/coder-template-id`.
5. Run onboarding DB migrations (`scripts/migrate-onboarding.sh` — `psql` + `db/schema.sql`).
6. Build + start onboarding container with the admin token + template ID injected as env.
7. Print the URLs:
   - Onboarding: http://localhost:3000
   - Coder admin: http://localhost:7080  (admin@local.dev / Sup3rSecret!)

---

## 6. End-to-end test (Playwright)

Path: `e2e/`

- `test('full onboarding flow')`:
  1. Go to `http://localhost:3000`, sign up with `e2e+<ts>@example.com`.
  2. From dashboard, click **Create sandbox**, name it `e2e-<ts>`.
  3. Wait up to 6 minutes for status to become `ready`.
  4. Assert all four links visible.
  5. Click VS Code link, expect Coder login page or code-server iframe (since we land on
     `/@user/workspace/apps/code-server`, Coder will issue a redirect; we just confirm
     200 OK and that the URL host is `localhost:7080`).

- A second admin-side check: `gh-style` API call to `http://localhost:7080/api/v2/workspaces`
  with admin token, asserting the workspace exists and is owned by the new user.

---

## 7. macOS/Apple Silicon notes

- All images used (`ghcr.io/coder/coder`, `node:24-bookworm-slim`, `pgvector/pgvector`,
  `postgres:17-alpine`) have `linux/arm64` variants — confirmed.
- `CODER_ACCESS_URL=http://host.docker.internal:7080` and the `localhost`→`host.docker.internal`
  rewrite in the workspace `entrypoint` are mandatory.
- `CODER_HTTP_ADDRESS=0.0.0.0:7080` — bind on all interfaces.
- We use **path-based** `coder_app` URLs (`subdomain = false`) so no wildcard DNS is needed.

---

## 8. Disk / RAM budget

- Coder image: ~200 MB
- Coder Postgres data dir: <100 MB
- mercato-workspace image (with code-server + node + build deps baked in): ~1.5 GB
- pgvector image: ~250 MB
- Per-workspace home volume after first scaffold: ~3–5 GB (`node_modules` + yarn cache + `.next`)

**Heads-up**: only ~8 GB free on this Mac. Free at least 15 GB before running end-to-end,
or be prepared for one workspace at a time.

---

## 9. Out of scope (POC)

- Email delivery (we surface the temp Coder password on screen rather than emailing).
- Multi-tenancy / orgs in Coder (single default org).
- Wildcard subdomain URLs (we use path-based; HMR may be flaky for the Mercato app, but
  the splash and code-server work fine and the app loads).
- Production hardening (TLS, secret management, OIDC).
