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
- Added an additive Kubernetes local path under `k8s/` with dedicated manifests,
  scripts, Helm values, and a separate Kubernetes-specific Coder template.
- Implemented OpenRouter billing and key provisioning in `apps/onboarding`,
  including billing tables, PayByLink checkout/webhook routes, OpenRouter key
  orchestration, per-user Coder secret sync, dashboard billing summary, and a
  sandbox entitlement guard. Both Coder templates now bootstrap Codex +
  Claude from non-secret OpenRouter settings plus per-user secrets instead of
  shared template API keys.
- Added a minimal manual pause/resume flow in onboarding:
  - sandbox detail pages can pause a ready workspace and resume a stopped one
  - the same `coder_workspace_id` is reused for resume instead of creating a
    new workspace
  - status polling now maps Coder stop transitions to the existing `stopped`
    status so paused workspaces stop rendering provisioning progress

## Remaining Follow-Up

- Run the full Kubernetes local path on a machine with `docker`, `k3d`,
  `kubectl`, and `helm` installed:
  - create the cluster, import local images, install Coder, bootstrap the admin
    token, push the Kubernetes template, and verify onboarding plus the
    wildcard workspace routes on `:8443`
  - record any ingress, PVC, or template RBAC gaps discovered during the first
    real cluster smoke
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
- Create a security-hardening spec for the whole onboarding app and sandbox
  runtime:
  - Review personal-data handling and decide whether database fields containing
    personal data should be encrypted at rest in the onboarding database.
  - Review impersonation risks between onboarding users, Coder users, and
    workspace owners.
  - Verify auth cookies and session checks on every app route, API route, and
    Coder-login handoff path.
  - Verify users cannot access, delete, start, stop, or view logs/stats for
    another user's sandbox.
  - Verify Coder session token creation cannot be abused for cross-user access.
  - Review cookie domain, `HttpOnly`, `Secure`, `SameSite`, expiry, logout, and
    stale-token clearing behavior.
  - Review sandbox isolation boundaries: Coder workspace ownership, workspace
    container names/networks, per-workspace Postgres, volumes, wildcard app
    access, and terminal/VS Code access.
  - Add tests for every hardening change: unit tests for authorization helpers,
    API tests for cross-user denial, and Playwright checks for user isolation
    where practical.
- Trust `.runtime/tls/sandbox-lvh-me.crt` in the local OS/browser keychain to remove privacy warnings.
- For production, replace the generated local cert with a real wildcard cert covering:
  - `${SANDBOX_DOMAIN}`
  - `*.${SANDBOX_DOMAIN}`
  - `*.apps.${SANDBOX_DOMAIN}`
- Re-run the full onboarding e2e when you need a complete fresh-sandbox proof;
  the last interrupted run reached workspace-ready and passed the Coder API
  check, but the final browser click test was stopped while Docker Desktop's
  host port forwarder was being restarted.
- Run a live OpenRouter / PayByLink / Coder smoke after provider credentials are
  configured:
  - create an activation checkout and confirm the paid webhook creates
    `llm_accounts`, usage snapshots, and per-user Coder secrets
  - confirm repeated webhook delivery is harmless and a top-up reuses the same
    account/key rather than creating a second active account
  - recreate a paid workspace and verify Codex plus Claude authenticate inside
    the workspace through the OpenRouter-backed secret flow
  - note the current local verification already covers automated tests plus
    `next build` through compile/type/static generation; the final standalone
    trace copy is blocked locally by `ENOSPC`
- Implement GitHub account sync and workspace bootstrap per
  `.ai/SPEC-GITHUB-WORKSPACE-BOOTSTRAP.md`:
  - add encrypted GitHub account storage in `apps/onboarding/db/schema.sql`
  - add GitHub connect/callback/status/disconnect routes in `apps/onboarding`
  - install `gh` in the workspace image and configure git plus `gh auth
    setup-git` during workspace startup
  - extend sandbox creation to mint per-sandbox bootstrap tokens and pass
    bootstrap parameters to Coder workspace creation
  - add an internal onboarding bootstrap endpoint consumed by the workspace
    startup script
  - verify with API coverage for connect/bootstrap/disconnect logic and a
    manual smoke for `gh auth status`, private `git clone`, and VS Code push
