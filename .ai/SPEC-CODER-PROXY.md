# Spec: HTTPS Nginx Edge for Coder Sandboxes

## Goal

All end-user sandbox surfaces use standard subdomain routes, with no
non-standard browser ports:

| Surface | URL shape |
| --- | --- |
| Onboarding | `https://sandbox.lvh.me` |
| Coder dashboard | `https://coder.sandbox.lvh.me/@<user>/<workspace>` |
| Native Coder terminal | `https://coder.sandbox.lvh.me/@<user>/<workspace>/terminal` |
| VS Code | `https://13337--main--<workspace>--<user>.apps.sandbox.lvh.me/?folder=/home/coder/app` |
| Open Mercato app | `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me` |
| Splash | `https://4000--main--<workspace>--<user>.apps.sandbox.lvh.me` |

HTTP on port 80 is redirect-only. All interactive browser traffic runs over
HTTPS/WSS on port 443.

## Current Architecture

The local stack uses one nginx `edge` container:

| Host | Backend |
| --- | --- |
| `sandbox.lvh.me` | `onboarding:3000` |
| `app.sandbox.lvh.me` | redirect to `sandbox.lvh.me` |
| `coder.sandbox.lvh.me` | `coder:80` |
| `*.apps.sandbox.lvh.me` | `coder:80` for Coder wildcard app proxy |

Nginx terminates TLS using `.runtime/tls/sandbox-lvh-me.crt` and
`.runtime/tls/sandbox-lvh-me.key`. `start.sh` generates a local self-signed
wildcard certificate if those files are missing.

## Why HTTPS Is Required Here

The broken behavior was not a missing websocket `Upgrade` header. We observed:

- `http://coder.sandbox.lvh.me/.../pty` returned `101 Switching Protocols`, then the PTY stream closed and retried every ~2 seconds.
- The same Coder PTY websocket stayed stable via Docker-published `:7081`.
- The same hostname also stayed stable via Docker-published `:443`.
- VS Code had the same failure mode on HTTP port 80 and became stable on HTTPS/WSS port 443.

Conclusion: Docker Desktop's published host port 80 path was closing Coder's
upgraded websocket streams after the handshake. The stable standard-port path is
HTTPS/WSS on port 443, which also matches Coder's documented reverse-proxy
topology.

## Required Coder Config

Local defaults:

```env
CODER_ACCESS_URL=https://coder.sandbox.lvh.me
CODER_PUBLIC_URL=https://coder.sandbox.lvh.me
CODER_WILDCARD_ACCESS_URL=*.apps.sandbox.lvh.me
SANDBOX_DOMAIN=sandbox.lvh.me
WILDCARD_APPS_DOMAIN=apps.sandbox.lvh.me
PROXY_SCHEME=https
COOKIE_DOMAIN=.sandbox.lvh.me
COOKIE_SECURE=true
```

`CODER_DERP_FORCE_WEBSOCKETS=true` remains enabled because Coder documents it
for proxies that mishandle non-standard `Upgrade: derp`.

## Acceptance Criteria

The implementation is accepted when these are true from a browser:

- `https://sandbox.lvh.me` loads onboarding.
- `http://sandbox.lvh.me` redirects to HTTPS.
- `https://coder.sandbox.lvh.me/@<user>/<workspace>/terminal` opens a stable native Coder shell.
- `https://13337--main--<workspace>--<user>.apps.sandbox.lvh.me/?folder=/home/coder/app` opens a usable VS Code workbench.
- `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me` loads and hydrates Open Mercato without Next.js cross-origin font/HMR failures.
- `https://4000--main--<workspace>--<user>.apps.sandbox.lvh.me` loads splash.
- Onboarding cards wrap external links through `/api/coder-login`, so users do not see a Coder login form.

## Operational Notes

- Browser privacy warnings mean the local certificate is not trusted. Trust
  `.runtime/tls/sandbox-lvh-me.crt` in the OS/browser trust store, or use a
  real wildcard certificate in production.
- Production should provide a certificate covering `${SANDBOX_DOMAIN}`,
  `*.${SANDBOX_DOMAIN}`, and `*.apps.${SANDBOX_DOMAIN}`.
- The old Traefik/docker-socket-proxy/websocket-shim path is removed from the
  local compose stack. The only local edge is nginx.
