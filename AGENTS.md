# Agent Notes

This repo is a local Docker/Coder onboarding POC for Open Mercato sandboxes.
Treat this file as the entry point for future coding agents. Detailed specs and
handoff notes live in `.ai/`.

## Canonical Docs

- Current product/spec: [.ai/SPEC.md](.ai/SPEC.md)
- HTTPS Coder proxy details: [.ai/SPEC-CODER-PROXY.md](.ai/SPEC-CODER-PROXY.md)
- Production notes: [.ai/SPEC-PROD.md](.ai/SPEC-PROD.md)
- Active worklist: [.ai/WORKLIST.md](.ai/WORKLIST.md)
- Last handoff/root-cause notes: [.ai/HANDOFF.md](.ai/HANDOFF.md)
- Repo-vendored Codex skill: [.codex/skills/continue-development/SKILL.md](.codex/skills/continue-development/SKILL.md)

## Operating Rules

- Keep routing subdomain-based on standard ports: `https://sandbox.lvh.me`,
  `https://coder.sandbox.lvh.me`, and
  `https://{port}--main--{workspace}--{user}.apps.sandbox.lvh.me`.
- Do not reintroduce per-workspace proxy containers, Traefik labels, path-based
  app routing, or non-standard browser ports as the primary UX.
- Browser traffic must go through the nginx edge on `:443`; `:80` is
  redirect-only.
- Coder itself listens on HTTP `:80` inside Docker. Workspace agents use the
  internal URL `http://coder.<SANDBOX_DOMAIN>` on the shared Docker network,
  while browser links use `https://coder.<SANDBOX_DOMAIN>`.
- Preserve the self-signed local TLS certificate flow unless replacing it with
  a clearly better local-dev trust story. The generated files under
  `.runtime/tls/` are intentionally not committed.
- Do not commit `.env`, `.runtime/`, Playwright test artifacts, or local TLS
  keys.

## Lessons Learned

- The original websocket failures were proxy/transport related on plain HTTP
  port 80. Moving browser traffic to HTTPS/WSS on standard `:443` stabilized
  native Coder terminal and VS Code websockets.
- `101 Switching Protocols` is not enough. A proxy can accept the websocket
  handshake and still break the upgraded stream. Keep `proxy_http_version 1.1`,
  Upgrade/Connection headers, disabled buffering, long timeouts, and stripped
  `Sec-WebSocket-Extensions` in `proxy/edge.conf.template`.
- Fresh workspaces can fail differently from existing workspaces. Existing
  containers may already have a running agent; a new container must download
  the agent from a URL it can reach from inside Docker.
- Do not point workspace agent bootstrap at browser-facing HTTPS unless the
  workspace can resolve and trust that endpoint. Locally, it resolves to the
  Coder container where `:443` is not open, so the template rewrites the Coder
  generated init script to `AGENT_CODER_URL`.
- Open Mercato’s first `yarn setup` can take several minutes after Coder marks
  the agent connected. VS Code and terminal should be usable before the app on
  port 3000 finishes compiling.
- The splash screen URL handling may need an upstream Open Mercato fix. The
  sandbox already sets `APP_URL`, `NEXT_PUBLIC_APP_URL`, and
  `APP_ALLOWED_ORIGINS` to the Coder wildcard app URL; if splash still shows or
  redirects to localhost/internal addresses, fix Open Mercato's splash/runtime
  URL resolution instead of adding more brittle generated-file patches here.
- Shell onboarding should be explicit: future work should add a workspace
  login banner with the available AI CLIs and log locations. Only mention
  `fg <job>` if the workspace actually starts the dev process as an interactive
  shell job rather than with `nohup`.

## Verification

- Start/refresh stack: `./start.sh`
- Validate compose syntax: `docker compose config --quiet`
- Push template after template/env changes: `bash scripts/push-template.sh`
- Run e2e: `make test`
- Manual smoke targets:
  - `https://sandbox.lvh.me/workspaces`
  - `https://coder.sandbox.lvh.me/@<user>/<workspace>/terminal`
  - `https://13337--main--<workspace>--<user>.apps.sandbox.lvh.me/?folder=/home/coder/app`
  - `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me/login?role=admin`
  - `https://4000--main--<workspace>--<user>.apps.sandbox.lvh.me/`
