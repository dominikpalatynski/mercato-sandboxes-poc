# Production Spec

Production uses the same shape as local development:

- nginx `edge` publishes `:80` and `:443`
- `:80` redirects to HTTPS
- `:443` terminates TLS
- Coder serves dashboard, terminal, and wildcard app proxy behind the edge
- onboarding is served behind the same edge

## Required DNS

For `SANDBOX_DOMAIN=sandbox.example.com`, configure:

- `sandbox.example.com`
- `coder.sandbox.example.com`
- `app.sandbox.example.com`
- `*.apps.sandbox.example.com`

All should resolve to the host running the stack.

## Required Certificate

Place a real certificate and key at:

- `.runtime/tls/sandbox-lvh-me.crt`
- `.runtime/tls/sandbox-lvh-me.key`

The certificate must cover:

- `${SANDBOX_DOMAIN}`
- `*.${SANDBOX_DOMAIN}`
- `*.apps.${SANDBOX_DOMAIN}`

The filenames are intentionally stable so the same nginx mount works locally
and in production.

## Required Environment

```env
SANDBOX_DOMAIN=sandbox.example.com
WILDCARD_APPS_DOMAIN=apps.sandbox.example.com
PROXY_SCHEME=https
CODER_ACCESS_URL=https://coder.sandbox.example.com
CODER_PUBLIC_URL=https://coder.sandbox.example.com
CODER_WILDCARD_ACCESS_URL=*.apps.sandbox.example.com
COOKIE_DOMAIN=.sandbox.example.com
COOKIE_SECURE=true
```

## Data Preservation

Persistent state lives in named volumes:

- `postgres-coder-data`
- `postgres-onboarding-data`
- `coder-data`
- per-workspace home volumes
- per-workspace Postgres volumes

Deployment automation must not run:

- `docker compose down -v`
- `docker volume rm`
- `docker system prune --volumes`
