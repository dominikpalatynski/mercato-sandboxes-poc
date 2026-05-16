<p align="center">
  <a href="https://hackon.openmercato.com">
    <img src="https://hackon.openmercato.com/logo.svg" alt="Open Mercato" width="320" />
  </a>
</p>

<h1 align="center">Mercato Sandboxes</h1>

<p align="center">
  <strong>Self-hosted onboarding tool that provisions Open Mercato dev environments<br/>in Coder workspaces — one click per signup.</strong>
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/quick%20start-3%20commands-B4F372?style=flat-square" alt="Quick start"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-BC9AFF?style=flat-square" alt="AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/Coder-self--hosted-EEFB63?style=flat-square" alt="Coder">
  <img src="https://img.shields.io/badge/Open%20Mercato-develop-B4F372?style=flat-square" alt="Open Mercato develop">
</p>

---

## 🌍 What is this

A signup tool that provisions a self-hosted Coder workspace running an Open Mercato dev environment per signup. A user signs up at the onboarding UI, clicks **Create sandbox**, and lands in a fresh workspace with browser-based VS Code, a web terminal, the live build splash, and direct port forwards to the running Mercato app. Every workspace ships with the **opencode**, **codex**, and **claude code** CLIs preinstalled, so AI-assisted edits work out of the box.

## 🧱 Architecture

```text
┌────────────────────── docker compose (host) ──────────────────────┐
│                                                                   │
│  postgres-onboarding   postgres-coder    coder-server             │
│  :5545                 :5432 (internal)  :80 internal             │
│         ▲                     ▲              ▲                    │
│         │                     │              │                    │
│  next-onboarding (3000) ──────┼──────────────┘                    │
│         │ admin API token                                         │
│         │                                                         │
│  nginx edge: :80 redirect-only, :443 HTTPS/WSS                    │
│    sandbox.lvh.me → onboarding, coder.sandbox.lvh.me → Coder,     │
│    *.apps.sandbox.lvh.me → Coder wildcard app proxy               │
│                                                                   │
│  bind-mount: /var/run/docker.sock ──────────────────────────────► │
│         (coder-server uses host Docker daemon to spawn workspaces)│
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
       Workspace container (one per signup, mercato-workspace:latest):
         - node 24, yarn 4, code-server, postgres-client, git
         - opencode + codex + claude code CLIs on PATH
         - sidecar postgres (pgvector pg17) on a private docker network
         - on first start: npx create-mercato-app@develop, yarn setup
         - splash on :4000, app on :3000, code-server on :13337
         - 16 GB RAM, 4 vCPU
```

| Service               | Image                            | Purpose                                                  |
|-----------------------|----------------------------------|----------------------------------------------------------|
| `postgres-onboarding` | `postgres:17-alpine`             | Onboarding app's user + sandbox tables                   |
| `postgres-coder`      | `postgres:17`                    | Coder control-plane metadata DB                          |
| `coder`               | `ghcr.io/coder/coder:latest`     | Coder server on internal `:80`; spawns workspaces via host Docker |
| `onboarding`          | `node:24-alpine` (custom build)  | Next.js 15 signup + dashboard UI on `:3000`              |
| `edge`                | `nginx:alpine`                   | Standard-port HTTPS/WSS edge for onboarding, Coder, and wildcard apps |

## 🎯 What you get per signup

- 🖥️ Browser-based **VS Code** (code-server)
- 💻 Web **terminal**
- ⚙️ Live **build splash** on port 4000
- 🚀 The Mercato **app** on its own subdomain (`<workspace>.lvh.me` locally, `<workspace>.<your-domain>` in prod) — full asset URLs, WebSockets, no path-prefix surprises
- 🤖 **opencode**, **codex**, and **claude code** CLIs preinstalled
- 🐘 Sidecar **PostgreSQL 17 (pgvector)**
- 💪 **16 GB RAM** allocation per workspace

## ⚡ Quick start

```bash
cp .env.example .env
./start.sh                 # ~3 min on first run, ~30 s afterwards
open https://sandbox.lvh.me # sign up and create your sandbox
```

> **First run takes ~3 min** — Coder has to boot, the workspace image has to build, and the template has to be pushed. Subsequent `./start.sh` runs are idempotent and finish in ~30 s.

## 🔑 Logging in

- **Onboarding** (your users) — `https://sandbox.lvh.me` — any email + 8+ character password.
- **Coder admin** (operators) — `https://coder.sandbox.lvh.me` — `admin@local.dev` / `Sup3rSecret!`.

## 🧭 End-user flow

1. Sign up at `https://sandbox.lvh.me`.
2. Land on the dashboard.
3. Click **Create sandbox**, give it a name, submit.
4. Wait ~30–60 s for status to flip to **ready**.
5. Click into **VS Code**, **Terminal**, **Splash**, or **App**.

## 🌐 Networking

The stack is published by one nginx edge proxy on standard ports. HTTP on
`:80` redirects to HTTPS on `:443`; all interactive traffic uses HTTPS/WSS.

- Onboarding: `https://sandbox.lvh.me`
- Coder: `https://coder.sandbox.lvh.me`
- App: `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me`
- Splash: `https://4000--main--<workspace>--<user>.apps.sandbox.lvh.me`
- VS Code: `https://13337--main--<workspace>--<user>.apps.sandbox.lvh.me/?folder=/home/coder/app`
- Terminal: `https://coder.sandbox.lvh.me/@<user>/<workspace>/terminal`

Local dev uses `SANDBOX_DOMAIN=sandbox.lvh.me`, which wildcards every
subdomain to `127.0.0.1`; no `/etc/hosts` edits are required. `./start.sh`
generates `.runtime/tls/sandbox-lvh-me.crt` and
`.runtime/tls/sandbox-lvh-me.key` if they are missing. Trust the certificate in
your OS/browser keychain to remove privacy warnings.

Fresh workspace agents do not use the browser-facing HTTPS URL to bootstrap.
The template rewrites Coder's generated agent script to the internal Docker
network URL `http://coder.${SANDBOX_DOMAIN}` by default (`AGENT_CODER_URL` can
override this). This is required locally because `coder.sandbox.lvh.me` resolves
to the Coder container on Docker DNS, where `:443` is intentionally not open.

For production:

```
SANDBOX_DOMAIN=sandbox.example.com
WILDCARD_APPS_DOMAIN=apps.sandbox.example.com
CODER_ACCESS_URL=https://coder.sandbox.example.com
CODER_PUBLIC_URL=https://coder.sandbox.example.com
CODER_WILDCARD_ACCESS_URL=*.apps.sandbox.example.com
PROXY_SCHEME=https
COOKIE_SECURE=true
```

Production TLS must cover `${SANDBOX_DOMAIN}`, `*.${SANDBOX_DOMAIN}`, and
`*.apps.${SANDBOX_DOMAIN}`.

## ⏱️ "Ready" semantics

The Coder agent reports `ready` as soon as the startup script returns, so the **splash** and **VS Code** are usable immediately. The Mercato **app** on port 3000 takes another **3–7 minutes** on first start while `yarn install`, `generate`, `db migrate`, `initialize`, and the Next.js compile finish — the app URL returns 502 until Next.js prints `Ready in Xms`. Watch the splash for live progress.

## 🤖 AI CLIs

`opencode`, `codex`, and `claude` are on PATH inside every workspace terminal. Sandbox billing now provisions per-user OpenRouter-backed Coder secrets from the onboarding app, so shared `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` template variables are no longer required for Codex and Claude. After template changes, rerun:

```bash
bash scripts/push-template.sh
```

Workspaces created **before** the template update will still have the old shared-key behavior until they are recreated.

## 🚀 Deploying to production

Production deploys go to a single Hetzner VPS under `*.sandbox.openmercato.com`
with a wildcard Let's Encrypt cert (DNS-01 via Cloudflare). The deploy is
**idempotent** and **safe to re-run** — every named docker volume (Coder DB,
onboarding DB, issued certs, workspace homes, sidecar postgres data) is
preserved across redeploys.

```bash
# On the VPS:
git clone https://github.com/<org>/dokploy-sandboxes-poc.git /opt/mercato-sandboxes
cd /opt/mercato-sandboxes
cp .env.production.example .env.production
$EDITOR .env.production         # CLOUDFLARE_API_TOKEN, JWT_SECRET, passwords
./scripts/deploy-hetzner.sh
```

See **[.ai/SPEC-PROD.md](./.ai/SPEC-PROD.md)** for the canonical production spec —
DNS prerequisites, the wildcard-TLS architecture, the data-preservation
contract, and the operational runbook.

## 🛠️ Development

```bash
make ps      # show stack containers
make logs    # tail compose logs
make stop    # docker compose down (preserves volumes)
make reset   # docker compose down -v + wipe .runtime/ (irreversible)
make test    # run the Playwright happy-path suite
```

### Mock PayByLink

To test `POST /api/billing/checkout` without the real provider:

```bash
node scripts/mock-paybylink.js
```

Then point onboarding at the mock:

```bash
export PAYBYLINK_API_BASE_URL=http://127.0.0.1:9999/api/v1
export PAYBYLINK_SHOP_ID=123
export PAYBYLINK_PRIVATE_KEY=test-private-key
```

The mock only implements `POST /api/v1/transfer/generate`, which is enough for
checkout-link generation. It does not simulate the paid webhook.

## 🧪 Tests

`make test` runs the Playwright happy-path suite in `e2e/`. The stack must already be up (`./start.sh`). Takes ~50 s with warm caches.

## 🩺 Troubleshooting

- **Coder restart-looping** → `docker logs coder` (usually `host.docker.internal` resolution).
- **Workspace stuck on "building"** → `docker logs coder-<owner>-<workspace>` and `docker logs coder-<workspace_id>-postgres`.
- **Port 5544 in use** → we now default to **5545** (orphan postgres detection); override via `ONBOARDING_DB_PORT` in `.env`.
- **Disk full** → `./reset.sh && docker system prune -a --volumes`.

## 📁 Project layout

```text
.
├── apps/onboarding/      Next.js 15 signup + dashboard + sandbox UI
├── coder/
│   ├── template/         Terraform: agent + sidecar pgvector + workspace
│   └── workspace-image/  Dockerfile for mercato-workspace:latest
├── scripts/              bootstrap-coder, build-workspace-image, push-template, migrate-onboarding
├── e2e/                  Playwright happy-path suite
├── proxy/                nginx edge config template
├── .ai/                  specs, worklist, handoff notes
├── AGENTS.md             coding standards + operational lessons for agents
├── docker-compose.yml    postgres-onboarding, postgres-coder, coder, onboarding, edge
├── start.sh / stop.sh / reset.sh
├── Makefile
└── README.md
```

## 🚫 Out of scope (POC)

- Email delivery (we surface the temp Coder password on screen rather than emailing).
- Multi-tenancy / orgs in Coder (single default org).
- Certificate automation for production TLS. The stack expects cert/key files mounted under `.runtime/tls`.
- Production hardening (TLS, secret management, OIDC).

## 📜 License

This project is licensed under the [AGPL-3.0](LICENSE) — the same license as [Coder](https://github.com/coder/coder). [Open Mercato](https://github.com/open-mercato/open-mercato) itself is licensed by its maintainers separately.

## 🙏 Credits

- [Coder](https://github.com/coder/coder) — workspace runtime
- [Open Mercato](https://github.com/open-mercato/open-mercato) — modular ERP foundation
- [Next.js](https://nextjs.org/) + [shadcn/ui](https://ui.shadcn.com/) — onboarding UI
- [Playwright](https://playwright.dev/) — E2E tests

---

<p align="center">
  <sub>Built for learning AI-assisted engineering at scale. Powered by <a href="https://hackon.openmercato.com">Open Mercato</a>.</sub>
</p>
