# Mini-Spec: GitHub Account Sync and Workspace Bootstrap

Date: 2026-05-16
Status: Proposed
Scope: Alpha

## Purpose

Enable a sandbox user to connect GitHub once in onboarding and then use GitHub
from both the browser terminal and browser VS Code inside each sandbox without
manual re-authentication on first boot.

This spec covers:

- GitHub account connection in `apps/onboarding`
- secure storage of the user-linked GitHub credential
- sandbox bootstrap of GitHub access for CLI and VS Code Source Control
- workspace developer-experience improvements required to make GitHub usage
  predictable

## Current Constraints

- `apps/onboarding` is the only backend currently orchestrating users,
  sandboxes, and Coder provisioning.
- Coder user secrets are user-scoped, not workspace-scoped.
- `apps/onboarding/lib/coder.ts` currently creates workspaces with an empty
  `rich_parameter_values` array.
- The workspace image already includes `git`, but does not yet install `gh`.
- The current template/bootstrap flow does not configure GitHub credentials,
  git identity, or a workspace-specific credential exchange.

## Alpha Decisions

- `apps/onboarding` remains the only backend for GitHub connect, storage,
  bootstrap, and disconnect flows.
- Alpha uses one GitHub-linked credential per onboarding user, stored only in
  encrypted form in the onboarding database.
- Alpha does not sync the raw GitHub credential into shared template
  variables or long-lived Coder user secrets.
- Each sandbox gets its own bootstrap token and local credential
  materialization, but not its own independently minted GitHub-native root
  token.
- Workspace GitHub access is configured for HTTPS + `gh auth setup-git`,
  because this works for both `gh` and VS Code Source Control without SSH-only
  special cases.
- Creating a sandbox without a connected GitHub account remains allowed. Such a
  workspace starts in a disconnected GitHub state and can still be used
  manually.

## Important Product Clarification

Alpha provides:

- one GitHub connection per user in onboarding
- one bootstrap flow per sandbox
- one local GitHub credential setup per sandbox

Alpha does not guarantee a unique long-lived GitHub-issued credential for every
sandbox. GitHub does not provide a simple API for fully generic per-sandbox git
credentials across arbitrary user repositories without introducing either:

- a credential-broker/proxy operated by onboarding
- or a repo-scoped GitHub App installation model

Those stricter isolation models are deferred beyond alpha.

## In Scope

- GitHub connect/disconnect/status UI and routes in `apps/onboarding`
- encrypted storage of the GitHub user token and related metadata
- sandbox-specific bootstrap token issuance during workspace creation
- template changes so the workspace startup script can fetch GitHub bootstrap
  payload from onboarding
- installation of GitHub CLI `gh` in the workspace image
- startup-time git and `gh` configuration in the workspace
- making terminal and VS Code Source Control work on first boot

## Out of Scope

- GitHub Copilot or other GitHub AI features
- VS Code Settings Sync with GitHub
- GitHub Enterprise Server support
- repo import/mirroring workflows
- a generic credential-broker proxy for all git operations
- true per-sandbox GitHub-native credentials for arbitrary repositories
- team/org policy automation beyond what the connected user already has access
  to

## Implementation Locations

### New or updated backend modules

- `apps/onboarding/lib/github.ts`
- `apps/onboarding/lib/crypto.ts`
- `apps/onboarding/lib/coder.ts`
- `apps/onboarding/lib/db.ts`

### New or updated route handlers

- `apps/onboarding/app/api/integrations/github/connect/route.ts`
- `apps/onboarding/app/api/integrations/github/callback/route.ts`
- `apps/onboarding/app/api/integrations/github/status/route.ts`
- `apps/onboarding/app/api/integrations/github/disconnect/route.ts`
- `apps/onboarding/app/api/internal/sandboxes/[id]/github-bootstrap/route.ts`
- `apps/onboarding/app/api/sandboxes/route.ts`

### New or updated UI surfaces

- `apps/onboarding/app/dashboard/page.tsx`
- `apps/onboarding/app/dashboard/github-integration-card.tsx`
- sandbox detail UI where bootstrap/connect status should be visible

### Database and workspace changes

- `apps/onboarding/db/schema.sql`
- `apps/onboarding/db/migrate.ts`
- `coder/workspace-image/Dockerfile`
- `coder/template/main.tf`
- `k8s/coder-template/main.tf`

## Data Model

### `github_accounts`

Stores the user-linked GitHub identity and encrypted credential.

- `id uuid primary key`
- `user_id uuid not null unique references users(id) on delete cascade`
- `provider text not null`
- `github_user_id bigint not null`
- `github_login text not null`
- `github_name text null`
- `github_email text null`
- `token_ciphertext text not null`
- `token_nonce text not null`
- `token_scopes text not null`
- `status text not null`
- `connected_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `revoked_at timestamptz null`

Expected alpha statuses:

- `active`
- `revoked`
- `error`

### `sandbox_github_bootstraps`

Stores sandbox-specific bootstrap state used to materialize GitHub access in a
workspace at startup.

- `id uuid primary key`
- `sandbox_id uuid not null unique references sandboxes(id) on delete cascade`
- `user_id uuid not null references users(id) on delete cascade`
- `token_hash text not null unique`
- `status text not null`
- `last_used_at timestamptz null`
- `expires_at timestamptz not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Expected alpha statuses:

- `pending`
- `active`
- `expired`
- `revoked`

## GitHub Auth Model

Alpha should use a standard GitHub OAuth web flow that grants a user token
usable for:

- `gh` CLI API calls
- HTTPS git clone/fetch/push through `gh auth setup-git`
- repository creation for repos the user is allowed to create

Recommended alpha scopes:

- `read:user`
- `user:email`
- `repo`

Optional only if required by real workflows:

- `workflow`

The onboarding backend must fetch the GitHub identity after token exchange and
persist both the identity metadata and encrypted token.

## Encryption Requirements

- The GitHub access token must never be stored in plaintext in Postgres.
- The token must never be returned to the browser UI after connect.
- A dedicated server-side encryption key must be provided via environment
  variable, for example `GITHUB_TOKEN_ENCRYPTION_KEY`.
- Logs must redact tokens, OAuth codes, and bootstrap tokens.

## User Flow

### 1. Connect GitHub

1. A logged-in onboarding user clicks `Connect GitHub`.
2. Onboarding creates an OAuth state value and redirects the user to GitHub.
3. GitHub redirects back to onboarding callback with `code`.
4. Onboarding exchanges `code` for a GitHub access token.
5. Onboarding fetches `/user` and the primary email from GitHub.
6. Onboarding encrypts the token and upserts `github_accounts`.
7. Dashboard shows `Connected as <login>`.

### 2. Create Sandbox

1. User creates a sandbox from onboarding as usual.
2. If the user has an active GitHub connection, onboarding creates a
   `sandbox_github_bootstraps` row with a bootstrap token hash and expiry.
3. Onboarding passes sandbox bootstrap values into Coder workspace creation
   through `rich_parameter_values`.
4. If the user has no GitHub connection, onboarding skips bootstrap creation
   and the workspace starts disconnected.

### 3. Workspace Bootstrap

1. The startup script receives:
   - sandbox id
   - bootstrap token
   - onboarding internal URL
2. The script calls the internal onboarding bootstrap endpoint.
3. The endpoint validates:
   - sandbox exists
   - bootstrap token hash matches
   - token is active and not expired
   - the linked `github_accounts` row is still active
4. The endpoint returns a minimal bootstrap payload:
   - `github_login`
   - `git_user_name`
   - `git_user_email`
   - `github_access_token`
5. The workspace configures:
   - `git config --global user.name`
   - `git config --global user.email`
   - `GH_TOKEN` for the shell session
   - `gh auth setup-git`
6. The workspace records a local marker that bootstrap succeeded.

### 4. Disconnect GitHub

1. User clicks `Disconnect GitHub` in onboarding.
2. Onboarding marks `github_accounts.status = 'revoked'`.
3. Onboarding revokes or deletes all active `sandbox_github_bootstraps` for
   that user.
4. Existing running workspaces may keep already-materialized local access until
   restart. New bootstrap attempts must fail immediately.

## Workspace Bootstrap Requirements

The workspace image and startup script must also implement the following DX
basics because GitHub auth is not useful without them:

- install `gh` globally in `coder/workspace-image/Dockerfile`
- make interactive shells start in `/home/coder/app`
- keep `git` available in every workspace
- initialize `/home/coder/app` as a git repository if scaffolding did not
  already do so
- show a short shell banner telling the user whether GitHub bootstrap succeeded
- write `gh`/git/bootstrap logs to predictable local paths

Recommended log locations:

- `/tmp/github-bootstrap.log`
- `/tmp/code-server.log`
- `/tmp/mercato-dev.log`

## Template and Provisioning Changes

The Docker and Kubernetes Coder templates must add support for hidden bootstrap
parameters exposed only to the startup script. The template must not expose raw
GitHub credentials in browser-visible URLs, user-facing metadata, or shared
template variables.

The onboarding-side `createWorkspace` call must start passing non-empty
`rich_parameter_values` for GitHub-enabled sandboxes.

Recommended bootstrap parameters:

- `sandbox_id`
- `github_bootstrap_token`
- `onboarding_internal_url`

## VS Code Behavior

After successful bootstrap:

- `git clone https://github.com/...` must work in the terminal without an extra
  login prompt
- VS Code Source Control must be able to fetch, stage, commit, pull, and push
  over the same HTTPS credential flow
- `gh auth status` must show an authenticated session for `github.com`

If bootstrap fails:

- the workspace must stay usable
- terminal and VS Code must show a disconnected GitHub state
- the user must be able to reconnect GitHub from onboarding and retry by
  restarting or recreating the sandbox

## Security Notes

- Never expose the GitHub token in onboarding HTML, browser JavaScript, or API
  responses intended for the frontend.
- Never log the bootstrap token or the GitHub token.
- The bootstrap endpoint must return only the minimal fields needed by the
  startup script.
- Bootstrap tokens must be hashed at rest.
- Bootstrap tokens must expire automatically.
- A compromised sandbox can still exfiltrate the materialized GitHub token from
  its own runtime environment. This is an accepted alpha risk and must be
  documented.

## Acceptance Criteria

1. A logged-in user can connect GitHub from onboarding and see connected-state
   UI on the dashboard.
2. Creating a sandbox for a GitHub-connected user provisions a sandbox bootstrap
   record and passes bootstrap parameters to Coder.
3. A fresh workspace installs or already has `gh`, configures git identity, and
   completes GitHub bootstrap without manual login.
4. `gh auth status` succeeds inside the workspace terminal after first boot.
5. `git clone` of a private repository the user can access succeeds from the
   workspace terminal without a credential prompt.
6. VS Code Source Control can pull and push to a repository the user can access
   without a separate browser login inside code-server.
7. Creating a sandbox without a connected GitHub account still succeeds and
   produces a usable workspace with a clearly disconnected GitHub state.
8. Disconnecting GitHub prevents bootstrap for newly created or restarted
   sandboxes.
9. The raw GitHub token is not stored in plaintext in the onboarding database,
   template variables, or repository files.

## Later Improvements

- replace the shared per-user GitHub token model with a stricter brokered
  credential model
- support repo-scoped GitHub App installation flow for organization-managed
  repositories
- optionally add per-sandbox SSH keys for git-over-SSH flows
- add workspace self-check command such as `mercato doctor github`
- add automated API tests and browser smoke coverage for connect/bootstrap flow
