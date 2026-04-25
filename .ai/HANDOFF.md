# Handoff: Coder Subdomain Websocket Fix

Updated: 2026-04-25

## Summary

The VS Code and native Coder terminal websocket failures were fixed by moving
the browser-facing route from HTTP on Docker-published port 80 to HTTPS/WSS on
standard port 443.

The final local route is:

- `https://sandbox.lvh.me` -> onboarding
- `https://coder.sandbox.lvh.me` -> Coder
- `https://*.apps.sandbox.lvh.me` -> Coder wildcard app proxy

## Root Cause

The failing requests successfully completed the websocket handshake:

- browser request reached Coder
- response was `101 Switching Protocols`
- shell bytes were received briefly
- the upgraded stream then closed and retried

Controlled comparisons showed:

- `http://coder.sandbox.lvh.me` on Docker-published port 80 failed.
- raw TCP forwarding to Coder on port 80 with the same host also failed.
- the same Coder websocket on Docker-published `:7081` stayed open.
- the same Coder websocket on Docker-published `:443` stayed open.

So this was not a missing nginx `Upgrade` header and not simply Coder origin
validation. Docker Desktop's host-port-80 path was breaking long-lived Coder
upgraded streams. HTTPS/WSS on standard 443 avoids that path and matches Coder's
documented deployment shape.

## Current Implementation

- `docker-compose.yml`
  - one nginx `edge` service publishes `80` and `443`
  - `edge` is pinned to `nginx:stable-alpine`
  - `80` redirects to HTTPS
  - `443` terminates TLS with `.runtime/tls/sandbox-lvh-me.{crt,key}`
  - local Traefik/docker-socket-proxy shim services were removed

- `proxy/edge.conf.template`
  - routes onboarding, Coder, and Coder wildcard apps by Host header
  - sets websocket upgrade headers
  - disables buffering
  - strips `Sec-WebSocket-Extensions`
  - sends `X-Forwarded-Proto: https` and `X-Forwarded-Port: 443`

- `start.sh`
  - generates a local wildcard cert when missing
  - prints HTTPS URLs and the cert path

- Coder/onboarding env
  - `CODER_ACCESS_URL=https://coder.sandbox.lvh.me`
  - `CODER_PUBLIC_URL=https://coder.sandbox.lvh.me`
  - `PROXY_SCHEME=https`
  - `COOKIE_SECURE=true`

## Verified

- Native Coder terminal stays connected on `wss://coder.sandbox.lvh.me/.../pty`.
- VS Code opens and keeps code-server websocket channels alive on
  `https://13337--main--...apps.sandbox.lvh.me`.
- HTTP redirects to HTTPS.
- Onboarding and Coder health checks return 200 over HTTPS.

## Notes

- Chrome will show a privacy warning until `.runtime/tls/sandbox-lvh-me.crt`
  is trusted locally.
- Existing browser tabs opened on old `http://...` routes should be closed or
  reloaded after the redirect.
- Existing workspace app URLs are normalized by onboarding status polling, but
  pushing the updated Coder template is still required for newly published
  Coder app URLs to be HTTPS from the source.
- If host requests to both `http://sandbox.lvh.me` and
  `https://sandbox.lvh.me` connect but hang while the same requests work inside
  the `edge` container, Docker Desktop's host port forwarder is wedged. A
  Docker Desktop restart fixed this without deleting volumes or workspaces.
- Fresh workspaces must use the internal agent bootstrap URL
  `http://coder.<SANDBOX_DOMAIN>`; using browser-facing HTTPS from inside the
  workspace resolves to the Coder container where port 443 is not open.
- Last applied Coder template version during this handoff: `v-1777145987`.
