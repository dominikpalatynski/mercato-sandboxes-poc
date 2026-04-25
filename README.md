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
│  :5545                 :5432 (internal)  :7080                    │
│         ▲                     ▲              ▲                    │
│         │                     │              │                    │
│  next-onboarding (3000) ──────┼──────────────┘                    │
│         │ admin API token                                         │
│         │                                                         │
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
| `coder`               | `ghcr.io/coder/coder:latest`     | Coder server on `:7080`; spawns workspaces via host Docker |
| `onboarding`          | `node:24-alpine` (custom build)  | Next.js 15 signup + dashboard UI on `:3000`              |

## 🎯 What you get per signup

- 🖥️ Browser-based **VS Code** (code-server)
- 💻 Web **terminal**
- ⚙️ Live **build splash** on port 4000
- 🚀 The Mercato **app** on port 3000 (direct port forward — no path-prefix issues)
- 🤖 **opencode**, **codex**, and **claude code** CLIs preinstalled
- 🐘 Sidecar **PostgreSQL 17 (pgvector)**
- 💪 **16 GB RAM** allocation per workspace

## ⚡ Quick start

```bash
cp .env.example .env       # set OPENAI_API_KEY (and optionally ANTHROPIC_API_KEY)
./start.sh                 # ~3 min on first run, ~30 s afterwards
open http://localhost:3000 # sign up and create your sandbox
```

> **First run takes ~3 min** — Coder has to boot, the workspace image has to build, and the template has to be pushed. Subsequent `./start.sh` runs are idempotent and finish in ~30 s.

## 🔑 Logging in

- **Onboarding** (your users) — http://localhost:3000 — any email + 8+ character password.
- **Coder admin** (operators) — http://localhost:7080 — `admin@local.dev` / `Sup3rSecret!`.

## 🧭 End-user flow

1. Sign up at http://localhost:3000.
2. Land on the dashboard.
3. Click **Create sandbox**, give it a name, submit.
4. Wait ~30–60 s for status to flip to **ready**.
5. Click into **VS Code**, **Terminal**, **Splash**, or **App**.

## ⏱️ "Ready" semantics

The Coder agent reports `ready` as soon as the startup script returns, so the **splash** and **VS Code** are usable immediately. The Mercato **app** on port 3000 takes another **3–7 minutes** on first start while `yarn install`, `generate`, `db migrate`, `initialize`, and the Next.js compile finish — the app URL returns 502 until Next.js prints `Ready in Xms`. Watch the splash for live progress.

## 🤖 AI CLIs

`opencode`, `codex`, and `claude` are on PATH inside every workspace terminal. Set `OPENAI_API_KEY` and (optionally) `ANTHROPIC_API_KEY` in `.env` **before** running `./start.sh` so the template picks them up. If you change the keys later, rerun:

```bash
bash scripts/push-template.sh
```

Workspaces created **before** the keys were set will not have them — recreate those workspaces from the onboarding UI.

## 🛠️ Development

```bash
make ps      # show stack containers
make logs    # tail compose logs
make stop    # docker compose down (preserves volumes)
make reset   # docker compose down -v + wipe .runtime/ (irreversible)
make test    # run the Playwright happy-path suite
```

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
├── docker-compose.yml    postgres-onboarding, postgres-coder, coder, onboarding
├── start.sh / stop.sh / reset.sh
├── Makefile
└── SPEC.md               Full design spec
```

## 🚫 Out of scope (POC)

- Email delivery (we surface the temp Coder password on screen rather than emailing).
- Multi-tenancy / orgs in Coder (single default org).
- Wildcard subdomain URLs (we use path-based; HMR may be flaky for the Mercato app, but the splash and code-server work fine and the app loads).
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
