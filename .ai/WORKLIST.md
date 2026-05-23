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
- Added an additive Hetzner/OpenTofu infrastructure bootstrap under
  `infra/terraform` for a minimal k3s topology with a private network/subnet,
  firewall, SSH key, one control-plane VPS, one or more sandbox worker VPSs,
  and helper scripts for explicit k3s install, worker join, and sandbox
  labels/taints outside Terraform.
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
  - workspace startup now reruns `yarn dev` on resume instead of replaying
    first-boot `yarn setup`
- Switched the Kubernetes Coder template from manually composed external app
  URLs to Coder-managed subdomain apps with `share = "owner"`, and updated
  onboarding to consume `subdomain_name` plus the proxied app path/query for
  those apps while preserving the local `:8443` port-forward scheme/port
  normalization and appending `WILDCARD_APPS_DOMAIN` when Coder returns only a
  bare subdomain label.
- Standardized sandbox preset selection across onboarding and both Coder
  templates:
  - onboarding now stores `preset_id` and sends `sandbox_preset` as a Coder
    rich parameter during workspace creation
  - both templates expose the same `crm`, `empty`, and `classic` Open Mercato
    variants from one template instead of hardcoding a single bootstrap path
  - the workspace bootstrap logic now lives in dedicated
    `files/workspace-startup.sh.tftpl` files instead of inline Terraform
    heredocs
- Split billing away from the main onboarding dashboard:
  - `/dashboard` now stays focused on sandbox creation and sandbox state
  - AI entitlement, top-up, and usage details live on a dedicated `/billing`
    page
  - blocked sandbox creation on the dashboard now points users to billing
- Switched the `infra/` Kubernetes path from Longhorn to the built-in k3s
  `local-path` storage class:
  - removed the Longhorn Helm release and values from `infra/helm`
  - updated workspace/bootstrap and simple PostgreSQL StatefulSet manifests to
    request
    `local-path`
  - removed Longhorn node-label assumptions from Hetzner configs, scripts, and
    operational runbooks
- Added an additive `infra/helm/charts/openmercato` release for standalone Open
  Mercato deployment on the cluster:
  - app runtime uses the upstream production image with the same
    `yarn mercato init` / migrate-on-start bootstrap contract as
    `docker-compose.fullapp.yml`
  - PostgreSQL and Redis are kept intentionally simple as single-replica
    `StatefulSet`s with `local-path` PVCs
  - fulltext search remains optional until an external Meilisearch endpoint is
    configured
- Implemented the Open Mercato-backed sandbox billing bridge on the onboarding
  side:
  - added `BILLING_BACKEND=onboarding|openmercato` runtime selection
  - added Open Mercato CRM sync persistence on `users` plus checkout/order
    correlation fields on `billing_orders`
  - signup now creates or reuses a CRM person through `/api/customers/people`
    when `OPENMERCATO_CUSTOMER_TENANT_ID` and
    `OPENMERCATO_CUSTOMER_ORGANIZATION_ID` are configured, and stores the
    returned CRM entity/profile ids on `users`
  - `/billing` now renders Open Mercato-managed activation/top-up plans when
    the Open Mercato backend is active, while the direct onboarding path keeps
    the raw credits entry flow
  - onboarding now creates Open Mercato-backed hosted checkout URLs and trusts
    only the signed `/api/billing/openmercato/webhook` route for that backend
  - completed Open Mercato events reuse the existing OpenRouter entitlement
    provisioning path, while refund/chargeback events suspend entitlement and
    block sandbox create/resume
  - automated verification now covers the Open Mercato webhook signature check,
    plan-based checkout creation, idempotent completed delivery, and refund
    suspension behavior
- Implemented the vendored Open Mercato-side sandbox billing bridge under
  `external/openmercato/apps/mercato/src/modules/sandbox_billing`:
  - added app-local module metadata, ACL, setup, validators, bridge libs,
    route handlers, subscribers, and outbound webhook worker
  - added `GET /api/sandbox-billing/plans` backed by sandbox-tagged
    `catalog_products` plus checkout-link pricing resolution
  - added idempotent `POST /api/sandbox-billing/customer-sync` backed by
    `customer_entities` / `customer_people`
  - `POST /api/sandbox-billing/checkout` now returns an Open Mercato-hosted pay
    URL plus encrypted correlation token without editing vendored checkout core
  - the public OM pay page receives sandbox correlation through the
    `checkout.pay-page:form` injection seam and app-local success/cancel page
    overrides redirect back to onboarding after pay-page submit
  - normalized checkout lifecycle plus refund events into
    `sandbox.payment.completed|failed|cancelled|expired|refunded`
  - signed outbound OM webhooks with the Standard Webhooks helper and kept
    legacy `x-openmercato-*` headers during transition so onboarding can
    verify both formats
  - added `mercato sandbox_billing seed-plans --tenant <tenantId> --org <organizationId> [--provider <providerKey>]`
    to seed a local sandbox product catalog plus hosted-checkout links,
    defaulting to the built-in `mock` provider for UI smoke tests
  - added env-gated auto-seeding hooks so the same plans can be initialized on
    `mercato init`, `mercato seed:defaults --module sandbox_billing`,
    `yarn dev`, and `yarn start` via
    `OM_SANDBOX_BILLING_AUTO_SEED=true` plus optional
    `OM_SANDBOX_BILLING_AUTO_SEED_PROVIDER=<providerKey>`
  - added standalone `apps/crm` mock gateway support for sandbox billing:
    `sandbox_billing/di.ts` now registers `mock`, `mock_usd`, and
    `mock_processing` descriptors/adapters/webhook handlers, gated by
    `OM_SANDBOX_BILLING_ENABLE_MOCK_GATEWAYS`, and the `crm` app now enables
    the required `integrations`, `catalog`, `checkout`, `payment_gateways`,
    and `api_keys` modules for local bridge smoke tests
  - updated the k8s Helm path for the standalone `apps/crm` deployment:
    `infra/helm/charts/openmercato` now mounts `/app/storage`, keeps the init
    marker under `/app/storage/.initialized`, exposes generic inline app
    secret keys for sandbox billing envs, and the release values now wire
    hosted-checkout bridge envs plus mock-provider auto-seeding
  - onboarding Helm values and secret templates now support the Open Mercato
    billing backend through `BILLING_BACKEND=openmercato`,
    `OPENMERCATO_BILLING_BASE_URL`,
    `OPENMERCATO_BILLING_API_KEY`, and
    `OPENMERCATO_BILLING_WEBHOOK_SECRET`
  - fixed the standalone `apps/crm` production image regression for k8s:
    the final runner stage now copies `/app/scripts`, and `cross-spawn` moved
    to runtime dependencies so `node ./scripts/start.mjs` can execute after
    `yarn start`
  - added targeted verification for plans/customer-sync/checkout routes,
    hosted-checkout token handling, outbound signing, vendored checkout route
    regression, and the onboarding Standard Webhooks verifier

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
- Implement the GitHub onboarding repo-connect flow per
  `.ai/SPEC-GITHUB-ONBOARDING-INTEGRATION.md`:
  - Add GitHub OAuth connect/status/owner-list/disconnect routes in
    `apps/onboarding` and verify with route/unit tests plus a manual OAuth
    browser path.
- Automate the remaining k8s sandbox-billing bootstrap seam:
  - mint the scoped Open Mercato bridge `x-api-key` after first CRM init and
    persist it back into the onboarding secret automatically
  - verify with a live `helmfile ... apply` plus browser/API smoke on the
    deployed cluster
  - Add encrypted `github_accounts`, `sandbox_github_repos`, and
    `sandbox_github_bootstraps` persistence in onboarding and verify with
    schema review plus route/unit tests.
  - Extend sandbox creation so a GitHub-connected user can request automatic
    empty-repo creation and verify with API tests for validation and state
    transitions.
  - Install GitHub CLI `gh` in `mercato-workspace`, keep `git` available,
    initialize `/home/coder/app` as a repo when needed, and make shells land in
    `/home/coder/app`; verify in a fresh workspace terminal.
  - Pass GitHub bootstrap parameters into both Coder templates and verify with
    unit tests for `createWorkspace(...)` plus manual first-boot inspection.
  - Bootstrap `origin`, local credentials, and initial push inside the
    workspace startup script and verify with `git remote get-url origin`,
    `git ls-remote origin`, `gh api /user`, and a VS Code Source Control push.
- Implement the planned bare shell preset end-to-end:
  - decide how onboarding should render non-Mercato links and labels
  - expose at least ports `3000` and `8080` through Coder apps
  - add a first-boot bootstrap path that does not assume `/home/coder/app` is
    an Open Mercato project
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
- Run a live Open Mercato billing smoke against a configured bridge instance:
  - confirm signup/customer sync creates or updates the expected CRM contact
  - confirm `/billing` loads real Open Mercato plans and creates a working
    payment URL for both activation and top-up
  - confirm a real `sandbox.payment.completed` event provisions exactly one
    OpenRouter account/key and a repeated delivery stays idempotent
  - confirm `sandbox.payment.refunded` suspends entitlement and blocks sandbox
    resume before any manual reactivation
  - document whether the live OM environment exposes a provider/core
    chargeback event; alpha code currently treats chargeback as deferred
- Decide and document the long-term PayByLink boundary:
  - `apps/onboarding/lib/paybylink.ts` is an onboarding-only OpenRouter budget
    flow, not an Open Mercato-native checkout/payment-gateway provider.
  - If sandbox billing must align with Open Mercato checkout/pay links, add a
    real `gateway_paybylink` provider package upstream or in a maintained fork
    and route payments through `paymentGatewayService` plus
    `/api/payment_gateways/webhook/paybylink`.
  - The current vendored OM bridge did not need a dedicated PayByLink adapter
    for local tests; it still needs an explicit live-provider contract before
    production rollout.
- Run the first real Hetzner bootstrap from `infra/terraform`:
  verify `tofu apply` against a real Hetzner project, then verify manual k3s
  install on `master-01`, worker join on `worker-sandbox-01`, kubeconfig
  export, worker labels, and optional taints on the live cluster.
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
