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

- Trust `.runtime/tls/sandbox-lvh-me.crt` in the local OS/browser keychain to remove privacy warnings.
- For production, replace the generated local cert with a real wildcard cert covering:
  - `${SANDBOX_DOMAIN}`
  - `*.${SANDBOX_DOMAIN}`
  - `*.apps.${SANDBOX_DOMAIN}`
- Re-run the full onboarding e2e when you need a complete fresh-sandbox proof;
  the last interrupted run reached workspace-ready and passed the Coder API
  check, but the final browser click test was stopped while Docker Desktop's
  host port forwarder was being restarted.
