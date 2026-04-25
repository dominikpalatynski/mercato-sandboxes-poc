# Mercato Sandboxes POC Spec

## Purpose

Provide an onboarding app that creates Coder workspaces for Mercato development.
Each workspace exposes:

- browser VS Code
- native Coder web terminal
- Open Mercato app on port 3000
- splash/status page on port 4000

All user-facing routes must use standard HTTPS subdomain routing. Non-standard
browser ports are not acceptable for the primary flow.

## Current Local Topology

The local stack is published by one nginx `edge` container:

| Public URL | Backend |
| --- | --- |
| `https://sandbox.lvh.me` | onboarding Next.js app |
| `https://app.sandbox.lvh.me` | redirect to `https://sandbox.lvh.me` |
| `https://coder.sandbox.lvh.me` | Coder control plane |
| `https://*.apps.sandbox.lvh.me` | Coder wildcard app proxy |

Port `80` redirects to HTTPS. Port `443` terminates TLS and proxies to Docker
services on the `mercato-proxy` network.

`start.sh` generates a local wildcard certificate at
`.runtime/tls/sandbox-lvh-me.crt` and `.runtime/tls/sandbox-lvh-me.key` if
missing. Trust the certificate locally to avoid browser privacy warnings.

## Runtime Services

| Service | Role |
| --- | --- |
| `postgres-coder` | Coder metadata database |
| `coder` | Coder control plane, listening on internal port 80 |
| `postgres-onboarding` | onboarding app database |
| `onboarding` | Next.js signup/dashboard app |
| `edge` | nginx HTTPS edge for onboarding, Coder, and Coder wildcard apps |

The local Traefik/docker-socket-proxy/shim path has been removed.

## Workspace Model

One Coder workspace provisions:

- one `mercato-workspace` container
- one sidecar Postgres container
- one persistent home volume
- one persistent Postgres data volume
- one private Docker network for workspace-to-Postgres traffic
- attachment to the shared `mercato-proxy` network so the agent can reach Coder

Workspace ports are exposed through Coder's native wildcard access URL:

| Surface | URL shape |
| --- | --- |
| VS Code | `https://13337--main--<workspace>--<user>.apps.sandbox.lvh.me/?folder=/home/coder/app` |
| App | `https://3000--main--<workspace>--<user>.apps.sandbox.lvh.me` |
| Splash | `https://4000--main--<workspace>--<user>.apps.sandbox.lvh.me` |
| Terminal | `https://coder.sandbox.lvh.me/@<user>/<workspace>/terminal` |

## Required Environment

```env
SANDBOX_DOMAIN=sandbox.lvh.me
WILDCARD_APPS_DOMAIN=apps.sandbox.lvh.me
PROXY_SCHEME=https
CODER_ACCESS_URL=https://coder.sandbox.lvh.me
CODER_PUBLIC_URL=https://coder.sandbox.lvh.me
CODER_WILDCARD_ACCESS_URL=*.apps.sandbox.lvh.me
COOKIE_DOMAIN=.sandbox.lvh.me
COOKIE_SECURE=true
```

`CODER_DERP_FORCE_WEBSOCKETS=true` is enabled to force ordinary WebSocket DERP
transport through reverse proxies.

## Acceptance Criteria

1. `./start.sh` starts Coder, onboarding, databases, and nginx edge.
2. `https://sandbox.lvh.me` loads onboarding.
3. `http://sandbox.lvh.me` redirects to HTTPS.
4. Creating a sandbox reaches `ready`.
5. `Open in VS Code` opens a usable workbench on the Coder wildcard app host.
6. `Open Terminal` opens a stable native Coder shell.
7. `Open Mercato App` loads and hydrates on the wildcard app host.
8. `Open Splash` loads on the wildcard app host.
9. All links are wrapped by `/api/coder-login` when leaving onboarding so the
   browser has a `coder_session_token` before reaching Coder.

## Production Notes

Production should use the same nginx-edge topology with a real certificate
covering:

- `${SANDBOX_DOMAIN}`
- `*.${SANDBOX_DOMAIN}`
- `*.apps.${SANDBOX_DOMAIN}`

All persistent state must remain on named volumes. Deployment scripts must not
run `docker compose down -v`, `docker volume rm`, or
`docker system prune --volumes`.
