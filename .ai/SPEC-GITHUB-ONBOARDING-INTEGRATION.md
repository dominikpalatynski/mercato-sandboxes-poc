# Spec: GitHub Onboarding Integration and Repo Auto-Connect

Date: 2026-05-21
Status: Proposed
Scope: Alpha
Host application: `apps/onboarding`

## Purpose

Enable a sandbox user to connect GitHub once in onboarding and create a new
sandbox whose freshly scaffolded `/home/coder/app` repository is already:

- initialized as a local git repository
- connected to a newly created GitHub repository owned by that user or one of
  their organizations
- pushed to `origin` on first boot
- usable from terminal and VS Code Source Control without a separate login step

This spec extends the older GitHub bootstrap minispec and makes one additional
product decision explicit:

- alpha should not stop at "GitHub auth inside the workspace"
- alpha should also create and attach a remote GitHub repository during sandbox
  creation when the user opts into the GitHub flow

## Relationship to Existing Docs

- The older background document is
  `.ai/SPEC-GITHUB-WORKSPACE-BOOTSTRAP.md`.
- This document is the implementation target for the repo-connected onboarding
  flow.
- If the two documents disagree, this document wins for alpha behavior.

## Product Outcome

When a GitHub-connected user creates a sandbox with the GitHub option enabled,
the expected first-boot result is:

- `/home/coder/app/.git` exists
- `git remote get-url origin` points at `https://github.com/<owner>/<repo>.git`
- the initial branch is pushed to GitHub
- subsequent `git fetch`, `git pull`, and `git push` do not prompt for
  credentials
- `gh api /user` works in the terminal
- VS Code Source Control can stage, commit, pull, and push over the same HTTPS
  credential path

## Current Repo Facts

- Sandbox provisioning is still owned by `apps/onboarding`.
- `POST /api/sandboxes` currently creates the sandbox row, provisions the Coder
  user if needed, and calls `createWorkspace(...)`.
- `apps/onboarding/lib/coder.ts` currently sends only the `sandbox_preset`
  rich parameter into Coder workspace creation.
- The workspace startup script scaffolds the app under `/home/coder/app` and
  currently does not perform any GitHub-specific bootstrap.
- The workspace image includes `git` but does not yet install `gh`.
- `create-mercato-app` already supports `--init-git`.
- The standalone dev splash inside generated apps already contains an
  interactive GitHub publish flow, but that flow is local-to-workspace and not
  connected to onboarding identity or sandbox creation.

## Alpha Decisions

- `apps/onboarding` remains the only backend for GitHub connect, token storage,
  repository creation, bootstrap issuance, and disconnect flows.
- Alpha uses a GitHub OAuth App, not a GitHub App.
- Alpha stores one GitHub-linked credential per onboarding user in encrypted
  form in the onboarding database.
- Alpha requests the following OAuth scopes:
  - `repo`
  - `read:user`
  - `user:email`
  - `read:org`
- Alpha creates a new empty GitHub repository for the sandbox when the GitHub
  option is enabled.
- Alpha does not create repositories from GitHub templates.
- Alpha does not attach existing repositories.
- Alpha does not use SSH as the primary transport. The default path is HTTPS
  git plus a workspace-local credential helper.
- Alpha should default the new sandbox form to "Create and connect GitHub
  repository" when the user already has an active GitHub connection, but the
  user must be able to turn the option off.
- Creating a sandbox without GitHub remains allowed.

## Why OAuth App for Alpha

GitHub Apps are the preferred long-term security model because they support
fine-grained permissions and short-lived user tokens. However, they introduce a
material alpha complexity cost for this product:

- installation management per user or organization
- short-lived token refresh during long-running workspace sessions
- a stronger need for a credential broker or refresh-aware git helper

For alpha, the repo-connected onboarding flow benefits more from a simpler
end-to-end path:

- onboarding web OAuth connect
- encrypted per-user token storage
- sandbox bootstrap that materializes credentials locally in the workspace

The accepted alpha tradeoff is that the stored token is broader than a
repository-scoped GitHub App installation token.

## Why Empty Repo Instead of Template Repo

The workspace already scaffolds the local project via `create-mercato-app` in
the Coder startup script. Creating the GitHub repository from a remote template
would introduce avoidable drift between:

- what GitHub generates remotely
- what the sandbox generates locally

Alpha should therefore:

- create an empty remote repository
- initialize or reuse the local git repository in `/home/coder/app`
- create the initial commit locally
- push the local state to the empty remote

## In Scope

- GitHub connect, callback, status, owner-list, and disconnect routes in
  `apps/onboarding`
- encrypted storage of the user GitHub token and identity metadata
- GitHub-aware sandbox creation UI and API contract
- GitHub repository creation during sandbox creation
- sandbox-specific bootstrap token issuance
- Coder template parameters for GitHub bootstrap
- workspace installation of `gh`
- workspace configuration of git identity, git credentials, `origin`, and
  first push
- dashboard and sandbox detail UI for GitHub connection and repo status

## Out of Scope

- GitHub Enterprise Server support
- attaching an existing repository to a sandbox
- importing a repository from another host
- GitHub template repositories as the primary alpha path
- SSH key management
- GitHub Copilot features
- repository deletion or automated cleanup of remotes created before a failed
  workspace bootstrap
- multi-repository sandboxes
- the longer-term migration into `apps/control-plane`

## Recommended UX Flow

### 1. Connect GitHub

1. A logged-in onboarding user opens the dashboard.
2. The dashboard shows a GitHub integration card.
3. Clicking `Connect GitHub` redirects to GitHub OAuth.
4. On successful callback, onboarding stores the encrypted token and the GitHub
   identity.
5. Onboarding fetches:
   - `/user`
   - `/user/emails`
   - `/user/orgs`
6. The dashboard shows:
   - connected login
   - available owners for repo creation
   - last connection timestamp

### 2. Create Sandbox

1. The user opens the new sandbox form.
2. If GitHub is connected, the form shows a GitHub section with:
   - `Create and connect GitHub repository`
   - `Owner`
   - `Repository name`
   - `Visibility`
3. Recommended defaults:
   - GitHub option enabled
   - owner = the user's GitHub login
   - repo name = sandbox name
   - visibility = `private`
4. On submit, onboarding:
   - validates the GitHub integration state
   - inserts the sandbox row
   - inserts GitHub repo/bootstrap rows for the sandbox
   - creates the remote GitHub repository
   - creates the Coder workspace with GitHub bootstrap parameters

### 3. First Workspace Boot

1. The workspace startup script scaffolds the app as today.
2. The startup script ensures the local git repository exists.
3. The startup script calls the onboarding internal bootstrap endpoint.
4. Onboarding validates the bootstrap token and returns the minimal GitHub
   payload.
5. The workspace:
   - writes the token to a root-owned-or-user-owned 0600 file under the coder
     home directory
   - configures a git credential helper for `https://github.com`
   - configures git identity
   - configures `origin`
   - creates the initial commit when no commit exists yet
   - pushes the current branch to `origin`
   - exposes `GH_TOKEN` to interactive shells for `gh` API usage
6. The sandbox detail page eventually shows the repo as connected.

### 4. Later Sessions

On subsequent starts, the workspace should not recreate the repository or force
another initial push. It should only:

- rematerialize local GitHub credentials if the bootstrap is still valid
- keep `origin` configured
- keep `GH_TOKEN` available in shell sessions

### 5. Disconnect GitHub

1. The user clicks `Disconnect GitHub`.
2. Onboarding marks the GitHub account row revoked.
3. Onboarding revokes all pending or active sandbox bootstrap rows for that
   user.
4. Already-running workspaces may keep local credentials until restarted. This
   is an accepted alpha limitation.

## API and Route Surface

### Public integration routes

- `GET /api/integrations/github/connect`
  - redirects the signed-in user to GitHub OAuth
- `GET /api/integrations/github/callback`
  - exchanges the code for an access token
  - fetches user metadata
  - stores or updates the encrypted account row
  - redirects back to the dashboard
- `GET /api/integrations/github/status`
  - returns integration summary for the signed-in user
- `GET /api/integrations/github/owners`
  - returns the available repo owners for the signed-in user
  - alpha should return the user login plus visible organizations
- `POST /api/integrations/github/disconnect`
  - revokes the onboarding-side integration state

### Sandbox provisioning route changes

`POST /api/sandboxes` should accept additional optional GitHub input:

```json
{
  "name": "my-sandbox",
  "preset_id": "crm",
  "github": {
    "enabled": true,
    "owner_login": "example-org",
    "repo_name": "my-sandbox",
    "visibility": "private"
  }
}
```

Rules:

- if `github.enabled = false`, provisioning behaves as today
- if `github.enabled = true`, onboarding requires an active GitHub account row
- `owner_login` must match one of the onboarding-fetched owner options
- `repo_name` must pass GitHub repository-name validation
- `visibility` is `private | public`

### Internal bootstrap route

- `POST /api/internal/sandboxes/[id]/github-bootstrap`

Request body:

```json
{
  "bootstrap_token": "<opaque token>"
}
```

Response body:

```json
{
  "github_login": "pkarw",
  "git_user_name": "Example User",
  "git_user_email": "user@example.com",
  "github_access_token": "<raw oauth token>",
  "repo": {
    "owner_login": "example-org",
    "repo_name": "my-sandbox",
    "clone_url": "https://github.com/example-org/my-sandbox.git",
    "default_branch": "main"
  }
}
```

The internal route must be callable from workspace containers over the shared
`mercato-proxy` network using `http://onboarding:3000`.

## Data Model

### `github_accounts`

Stores the user-linked GitHub identity and encrypted token.

- `id uuid primary key`
- `user_id uuid not null unique references users(id) on delete cascade`
- `provider text not null default 'github'`
- `auth_type text not null default 'oauth_app'`
- `github_user_id bigint not null`
- `github_login text not null`
- `github_name text null`
- `github_email text null`
- `default_owner_login text null`
- `token_ciphertext text not null`
- `token_nonce text not null`
- `token_scopes text not null`
- `status text not null`
- `connected_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `revoked_at timestamptz null`

Statuses:

- `active`
- `revoked`
- `error`

### `sandbox_github_repos`

Stores the desired and observed repository state for a sandbox.

- `id uuid primary key`
- `sandbox_id uuid not null unique references sandboxes(id) on delete cascade`
- `user_id uuid not null references users(id) on delete cascade`
- `provider text not null default 'github'`
- `owner_login text not null`
- `repo_name text not null`
- `repo_full_name text not null`
- `visibility text not null`
- `github_repo_id bigint null`
- `repo_url text null`
- `clone_url text null`
- `default_branch text null`
- `status text not null`
- `create_error text null`
- `remote_created_at timestamptz null`
- `initial_push_at timestamptz null`
- `connected_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Statuses:

- `pending`
- `created`
- `connected`
- `failed`
- `revoked`

### `sandbox_github_bootstraps`

Stores the sandbox-specific bootstrap grant used by the workspace startup
script.

- `id uuid primary key`
- `sandbox_id uuid not null unique references sandboxes(id) on delete cascade`
- `user_id uuid not null references users(id) on delete cascade`
- `token_hash text not null unique`
- `status text not null`
- `last_used_at timestamptz null`
- `expires_at timestamptz not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Statuses:

- `pending`
- `active`
- `expired`
- `revoked`

## Provisioning Sequence

### Onboarding side

Recommended order for `POST /api/sandboxes` when GitHub is enabled:

1. validate the sandbox input
2. validate the GitHub integration state
3. ensure the Coder user exists
4. insert the sandbox row in `building`
5. insert `sandbox_github_repos(status='pending')`
6. insert `sandbox_github_bootstraps(status='pending')`
7. create the remote GitHub repository
8. update `sandbox_github_repos(status='created')`
9. create the Coder workspace with GitHub bootstrap parameters
10. update the sandbox row with `coder_workspace_id`

Failure handling:

- if remote repository creation fails, mark the sandbox failed and store the
  repo error
- if Coder workspace creation fails after the remote repo already exists, keep
  the repo row and sandbox row for recovery visibility
- alpha does not auto-delete the remote repo after a downstream failure

## Workspace Bootstrap Design

### Installation and shell prerequisites

Both Docker and Kubernetes workspace images/templates must support:

- `gh` installed in `coder/workspace-image/Dockerfile`
- interactive shells landing in `/home/coder/app`
- local git repository initialization on first boot if the scaffolded app is
  not already a repo
- predictable GitHub log file location, recommended:
  - `/tmp/github-bootstrap.log`

### Credential model

Alpha should not depend on an interactive `gh auth login` inside the workspace.

The recommended bootstrap model is:

1. write the GitHub token into a workspace-local file with mode `0600`
2. write a small git credential helper script that reads that file
3. configure git globally to use that helper for `https://github.com`
4. expose `GH_TOKEN` to shells by sourcing it from the same file

Why this is the preferred alpha path:

- it works for terminal git
- it works for VS Code Source Control because VS Code shells out to git
- it avoids depending on browser-based re-auth in the workspace
- it avoids assumptions about storing `gh` auth state during bootstrap

### First-boot git behavior

On first boot, after app scaffolding:

1. ensure `/home/coder/app/.git` exists
2. set:
   - `git config --global user.name`
   - `git config --global user.email`
3. ensure `origin` points at the created GitHub repository
4. if no commit exists yet:
   - `git add -A`
   - `git commit -m "Initial commit"`
5. push the current branch to `origin`
6. update onboarding state so `sandbox_github_repos.status = 'connected'`

### Resume behavior

On later starts:

- do not recreate the repo
- do not force a second initial commit
- do not force-push
- keep the credential helper and `origin` valid

## Coder Template Parameters

`createWorkspace(...)` must start passing additional GitHub parameters when the
sandbox GitHub flow is enabled.

Recommended hidden parameters:

- `sandbox_id`
- `github_bootstrap_token`
- `onboarding_internal_url`
- `github_enabled`

Recommended `onboarding_internal_url` value:

- Docker local: `http://onboarding:3000`
- Kubernetes local: cluster-internal onboarding service URL

The raw GitHub OAuth token must never be embedded directly into:

- rich parameters
- Coder template variables
- browser-visible app URLs
- Coder metadata

## UI Surfaces

### Dashboard

Add a GitHub integration card that shows:

- disconnected / connected state
- connected login
- connect / disconnect action
- short description of what enabling GitHub changes during sandbox creation

### New sandbox form

Add a GitHub card or section with:

- enable/disable toggle
- owner select
- repo name input
- visibility select
- short note that the repository will be created empty and then populated from
  the workspace bootstrap

### Sandbox detail page

Add a GitHub panel that shows:

- connection state
- repo URL when created
- provisioning/bootstrap status
- last error when remote create or bootstrap failed

## Security Notes

- The GitHub OAuth token must never be stored in plaintext in Postgres.
- The token must never be returned to browser UI routes.
- The token must only be returned by the internal workspace bootstrap endpoint.
- Bootstrap tokens must be opaque, hashed at rest, and time-limited.
- Logs must redact GitHub tokens, OAuth codes, and bootstrap tokens.
- The local credential file inside the workspace is an accepted alpha risk.
  A compromised sandbox can exfiltrate it.
- The repo creation route must validate `owner_login` against the connected
  user's allowed owner list. Do not trust arbitrary owner input from the
  browser.

## Runtime Configuration

Required environment:

- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_CALLBACK_URL`
- `GITHUB_TOKEN_ENCRYPTION_KEY`
- `ONBOARDING_INTERNAL_URL`

Recommended defaults:

- `ONBOARDING_INTERNAL_URL=http://onboarding:3000`
- `GITHUB_BOOTSTRAP_TOKEN_TTL_SECONDS=1800`
- `GITHUB_DEFAULT_REPO_VISIBILITY=private`

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
- `apps/onboarding/app/api/integrations/github/owners/route.ts`
- `apps/onboarding/app/api/integrations/github/disconnect/route.ts`
- `apps/onboarding/app/api/internal/sandboxes/[id]/github-bootstrap/route.ts`
- `apps/onboarding/app/api/sandboxes/route.ts`

### New or updated UI

- `apps/onboarding/app/dashboard/page.tsx`
- `apps/onboarding/app/dashboard/github-integration-card.tsx`
- `apps/onboarding/app/sandboxes/new/form.tsx`
- `apps/onboarding/app/sandboxes/[id]/page.tsx`
- `apps/onboarding/app/sandboxes/[id]/status-poller.tsx`

### New or updated workspace/bootstrap files

- `apps/onboarding/db/schema.sql`
- `apps/onboarding/db/migrate.ts`
- `coder/workspace-image/Dockerfile`
- `coder/template/main.tf`
- `coder/template/files/workspace-startup.sh.tftpl`
- `k8s/coder-template/main.tf`
- `k8s/coder-template/files/workspace-startup.sh.tftpl`

## Verification Plan

### Automated checks

- unit tests for GitHub OAuth state validation and token encryption helpers
- unit tests for GitHub owner-list parsing and repo-name validation
- route tests for:
  - connect/callback/status/disconnect
  - owner list
  - sandbox creation validation when GitHub is enabled
  - internal bootstrap endpoint token validation
- unit tests for `createWorkspace(...)` parameter expansion

### Manual or integration checks

1. Connect GitHub from the dashboard.
2. Create a sandbox with GitHub enabled and visibility `private`.
3. Wait for workspace readiness.
4. Open terminal and verify:
   - `pwd` starts in `/home/coder/app`
   - `git remote get-url origin`
   - `git rev-parse --is-inside-work-tree`
   - `git ls-remote origin`
   - `gh api /user`
5. Open VS Code Source Control and verify:
   - repo is detected
   - commit can be created
   - push succeeds without a credential prompt
6. Confirm the remote repository contains the scaffolded files on GitHub.

## Acceptance Criteria

1. A logged-in user can connect GitHub from onboarding and see connected-state
   UI on the dashboard.
2. The new sandbox form can optionally create and connect a GitHub repository.
3. Creating a sandbox with GitHub enabled creates an empty remote GitHub repo
   before workspace bootstrap.
4. A fresh workspace initializes or reuses `/home/coder/app` as a git repo and
   connects it to `origin`.
5. The first workspace boot pushes the scaffolded project to the remote
   repository.
6. Terminal git operations against `origin` work without a new credential
   prompt.
7. `gh api /user` works inside the workspace terminal after bootstrap.
8. VS Code Source Control can pull and push without a separate browser login in
   code-server.
9. Creating a sandbox without GitHub still succeeds.
10. The raw GitHub token is not stored in plaintext in the onboarding
    database, Coder template variables, or repository files.

## Later Improvements

- move to a GitHub App plus installation-scoped permissions
- support existing-repo attach flow
- support template-repo create flow once the local bootstrap contract is
  aligned with it
- add repo cleanup tooling for the case where remote create succeeds but
  workspace creation later fails
- add a retry action from sandbox detail for failed GitHub bootstrap without
  recreating the sandbox
