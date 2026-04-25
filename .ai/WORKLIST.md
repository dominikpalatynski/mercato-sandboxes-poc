# Worklist

## Current Status

The primary websocket/routing issue is solved by moving the browser-facing edge
to HTTPS/WSS on standard port 443.

Working surfaces:

- `https://sandbox.lvh.me` loads onboarding.
- `https://coder.sandbox.lvh.me/@<user>/<workspace>/terminal` opens a stable native Coder terminal.
- `https://13337--main--<workspace>--<user>.apps.sandbox.lvh.me/?folder=/home/coder/app` opens VS Code and keeps its websocket channels alive.
- `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me` reaches the Open Mercato app via Coder wildcard routing.
- `https://4000--main--<workspace>--<user>.apps.sandbox.lvh.me` reaches splash via Coder wildcard routing.

## Completed Fixes

- Replaced the local proxy path with one nginx `edge` service.
- Added TLS termination on `:443` and HTTP-to-HTTPS redirects on `:80`.
- Generated local wildcard certs under `.runtime/tls` from `start.sh`.
- Set Coder public/access URLs to `https://coder.sandbox.lvh.me`.
- Set secure cookies for Coder session handoff.
- Kept `CODER_DERP_FORCE_WEBSOCKETS=true`.
- Removed legacy local Traefik/docker-socket-proxy websocket-shim services.
- Normalized existing Coder app URLs to the current public scheme in onboarding status polling.
- Updated e2e defaults to HTTPS/WSS and local self-signed cert handling.
- Split browser-facing Coder URL from workspace-agent bootstrap URL so fresh
  sandboxes can download/connect the Coder agent over the Docker network.
- Moved specs and handoff docs into `.ai/` and added `AGENTS.md`.

## Remaining Follow-Up

- Fix the Open Mercato splash screen target URL:
  - Splash must display the browser-facing app URL, not `localhost:3000` or an
    internal runtime URL.
  - Splash should redirect/open the correct app address:
    `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me`.
  - This may belong upstream in `open-mercato` rather than this repo. Prefer an
    Open Mercato fix if the splash runtime ignores `APP_URL` /
    `NEXT_PUBLIC_APP_URL`; keep only temporary sandbox patches here.
- Add a workspace shell welcome message:
  - Explain that `codex`, `opencode`, and `claude` are available.
  - Show where Open Mercato logs live: `/tmp/mercato-dev.log`,
    `/tmp/code-server.log`, and `/tmp/mercato-agentic-init.log`.
  - Explain that `yarn setup` / dev is started by the Coder startup script.
  - If the dev command is converted from `nohup ... &` to an interactive job,
    document `jobs` and `fg <job>` for bringing `yarn dev` back to the
    foreground; otherwise do not claim `fg` works for the current background
    process model.
- Improve workspace developer bootstrap:
  - Install GitHub CLI `gh` in `mercato-workspace`.
  - Keep `git` installed and verify it is available in fresh workspaces.
  - Initialize `/home/coder/app` as a local git repository after
    `create-mercato-app` if it is not already a repo.
  - Make interactive shells start in `/home/coder/app` by default so users land
    directly in the app folder.
- Trust `.runtime/tls/sandbox-lvh-me.crt` in the local OS/browser keychain to remove privacy warnings.
- For production, replace the generated local cert with a real wildcard cert covering:
  - `${SANDBOX_DOMAIN}`
  - `*.${SANDBOX_DOMAIN}`
  - `*.apps.${SANDBOX_DOMAIN}`
- Re-run the full onboarding e2e when you need a complete fresh-sandbox proof;
  the last interrupted run reached workspace-ready and passed the Coder API
  check, but the final browser click test was stopped while Docker Desktop's
  host port forwarder was being restarted.
