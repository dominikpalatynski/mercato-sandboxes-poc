# User Code Persistence Plan

## Goal

Make user code in `mercato-sandboxes` survive node loss, PVC accidents, and
full infra rebuilds. Current setup writes workspace homes to node-local
`local-path` PVCs — losing a sandbox node loses the code on it.

Target experience: v0 / Lovable feel. User edits land in a real git repo
without ceremony, history is browsable, and the user can later "Take it to
GitHub" with a single action that hands the repo over to their own account.

## Architecture

- **Default origin:** in-cluster Gitea. Per-user organization `user-<id>`,
  one repo per project.
- **When user links GitHub:** full handover. Push history from Gitea to a new
  repo on the user's GitHub via a GitHub App, switch workspace `origin` to
  GitHub, archive (not delete) the Gitea repo.
- **`mercato-agent` identity:** a GitHub bot account used as the git commit
  author. Not a custom binary. Codex / Claude running inside the workspace
  invoke standard `git` with that identity. When the user has linked GitHub,
  every commit gets a `Co-Authored-By: <user>` trailer.
- **Storage:** Hetzner Cloud CSI for all stateful PVCs. Native Hetzner volume
  replication inside the `fsn1` DC. Chosen over Longhorn because the system
  pool is 3× `cpx22` (2 vCPU / 4 GB RAM) and Longhorn's per-node overhead
  would eat too much of that.
- **Backup:** Hetzner CSI replication only in MVP. No S3 `gitea dump` yet.
- **Commit trigger:** manual only. No auto-commit or debouncer in MVP.

## Phases

### Phase 1: Storage backend — Hetzner CSI

- flip `addons.csi_driver.enabled: true` in
  `infra/hetzner-k3s/cluster.yaml`
- set `template.workspaceStorageClass: "hcloud-volumes"` in
  `infra/helm/values/coder-bootstrap.yaml`
- set `storageClassName: hcloud-volumes` in
  `infra/manifests/postgres/postgres-coder-cluster.yaml` and
  `infra/manifests/postgres/postgres-onboarding-cluster.yaml`
- keep `addons.local_path_storage_class.enabled: true` for non-durable
  scratch / cache PVCs
- update `infra/helm/README.md` and
  `infra/hetzner-k3s/PRODUCTION-CHECKLIST.md` to describe the new default

No PVC migration needed — cluster is greenfield.

### Phase 2: Gitea Helm release

- add the `gitea-charts` repo
  (`https://dl.gitea.com/charts/`) to `infra/helm/helmfile.yaml`
- add a `gitea` release in a new `phase: gitea`, depending on
  `cert-manager/cert-manager`
- new values file `infra/helm/values/gitea.yaml`:
  - `persistence.storageClass: hcloud-volumes`, `size: 50Gi`
  - `postgresql.enabled: false` — use the existing PostgreSQL operator
  - `gitea.config.database.*` points at a new `postgres-gitea` cluster
  - `gitea.admin.*` sourced from a `gitea-admin-credentials` Secret
  - `service.ssh.type: ClusterIP` (push over HTTPS only in MVP)
  - Ingress: `gitea.sandbox.palatynskicloud.com`, annotated with
    `cluster-issuer: letsencrypt-dns`
  - `service.DISABLE_REGISTRATION: true`
  - `repository.DEFAULT_PRIVATE: private`
- add `infra/manifests/postgres/postgres-gitea-cluster.yaml` and
  `postgres-gitea-app-secret.template.yaml`
- add `infra/manifests/gitea/gitea-admin-credentials.template.yaml` and
  `gitea-db-url.template.yaml`

### Phase 3: Gitea API client in onboarding

- new module `apps/onboarding/src/gitea/client.ts`:
  - `createUserOrg(userId)` — `POST /api/v1/admin/users` plus
    `POST /api/v1/orgs`
  - `createRepo(orgName, projectId)` —
    `POST /api/v1/orgs/{org}/repos`, returns `{ cloneUrl, sshUrl }`
  - `createRepoDeployToken(orgName, repoName)` — token scoped to a single
    repo with `write:repository`
  - `archiveRepo(orgName, repoName)` — used during GitHub handover
- hook into signup → `createUserOrg`
- hook into create-workspace → `createRepo` + `createRepoDeployToken`,
  expose `cloneUrl` and `token` as env to the Coder workspace
- new Secret `gitea-onboarding-admin-token` (admin PAT for onboarding)

### Phase 4: Workspace git wiring

No custom binary. The workspace image just configures git so Codex / Claude
can use it normally.

- update the workspace image (`mercato-workspace`) startup script:
  - `git config --global user.name "mercato-agent"`
  - `git config --global user.email "agent@palatynskicloud.com"`
  - credential helper backed by `$MERCATO_REPO_TOKEN`
  - on first start: `git clone $MERCATO_REPO_URL /home/coder/project`
    (or `git init` + initial commit if the repo is empty)
  - install a `commit-msg` hook that appends
    `Co-Authored-By: $MERCATO_GH_USER_NAME <$MERCATO_GH_USER_EMAIL>`
    when those env vars are set
- update the Coder template (`infra/helm/charts/coder-bootstrap`) so the
  template passes `MERCATO_REPO_URL`, `MERCATO_REPO_TOKEN`, and the optional
  `MERCATO_GH_USER_*` env into the workspace pod

### Phase 5: GitHub App + handover

Out-of-repo setup (documented in a new `infra/GITHUB-APP.md`):

- create a GitHub App `mercato-agent`
- permissions: `Administration: write`, `Contents: write`,
  `Metadata: read`
- store the private key as Secret `github-app-private-key`
- point the App webhook at the onboarding service

In-repo work:

- `apps/onboarding/src/github/app.ts` — JWT signing and short-lived
  installation token minting
- `GET /api/github/install/start` — redirect to the GitHub install URL
- `POST /api/github/webhook` — persist `installation_id` per user
- `migrateRepoToGitHub(userId, projectId)`:
  1. mint installation token
  2. create repo on the user's GitHub account or org
  3. spawn a `git clone --mirror` + `git push --mirror` Job in cluster
  4. update workspace env so `MERCATO_REPO_URL` and `MERCATO_REPO_TOKEN`
     point at GitHub
  5. restart the workspace pod so origin is re-read
  6. archive (not delete) the Gitea repo

## Explicit Non-Goals (MVP)

- auto-commit or debouncer
- UI for "Connect GitHub" / "Migrate to GitHub" — API first, UI later
- installation-token rotation (tokens live ~1h; first iteration restarts the
  workspace on handover and accepts re-auth flows are needed for long-lived
  workspaces after the switch)
- S3 backup of Gitea
- rollback from GitHub back to Gitea
- exposing Gitea SSH publicly

## Open Questions

- final email / GitHub handle for the `mercato-agent` bot account
- whether onboarding orgs in Gitea should map 1:1 to GitHub org names users
  pick at signup, or stay as opaque `user-<id>`
- where the GitHub App lives administratively (personal account, dedicated
  org)

## Sequencing

Execute strictly in order: Phase 1 must be in place before Gitea, Gitea must
be in place before the onboarding client and workspace wiring, and the
GitHub App phase only makes sense once the default Gitea flow works end to
end.
