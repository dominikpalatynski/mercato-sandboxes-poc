# GitHub App: mercato-agent

This document covers the one-time setup needed to wire onboarding to a real
GitHub App. The App is the bridge that lets a user "Take it to GitHub" —
onboarding mints an installation token against this App, creates a repo on
the user's account, pushes Gitea's history over, and rewires the workspace.

## 1. Create the App

1. Go to https://github.com/settings/apps/new (personal account) or
   https://github.com/organizations/&lt;org&gt;/settings/apps/new (org).
2. Fill in:
   - **GitHub App name:** `mercato-agent` (must be globally unique; if taken,
     pick `mercato-agent-&lt;suffix&gt;` and use it everywhere below as the
     "slug").
   - **Homepage URL:** `https://sandbox.<yourdomain>.com`
   - **Callback URL:** `https://sandbox.<yourdomain>.com/dashboard`
     (used only for the install-confirmation redirect; the real binding
     happens via the webhook)
   - **Setup URL:** `https://sandbox.<yourdomain>.com/dashboard`
   - **Webhook URL:** `https://sandbox.<yourdomain>.com/api/github/webhook`
   - **Webhook secret:** generate a long random string and stash it; you'll
     paste it into the `github-app-credentials` Secret below.
3. **Permissions** (repository):
   - **Administration:** Read & write (needed to create repos)
   - **Contents:** Read & write (needed for push-mirror)
   - **Metadata:** Read
4. **Permissions** (organization, if installs on orgs are expected):
   - **Administration:** Read & write (create repos under orgs)
5. **Subscribe to events:** `Installation`.
6. **Where can this GitHub App be installed?** Any account.
7. Save. Note the **App ID** shown on the App's settings page.
8. **Generate a private key** — GitHub will download a PEM. Keep this file
   safe; it's the only credential that proves you control the App.

## 2. Create the cluster Secrets

The onboarding deployment expects two Secrets in `mercato-sandboxes`:

- `github-app-credentials`: App ID, slug, webhook secret (envs)
- `github-app-private-key`: the PEM (mounted as a file)

```bash
$EDITOR infra/manifests/onboarding/github-app-credentials.template.yaml
kubectl apply -f infra/manifests/onboarding/github-app-credentials.template.yaml

# private-key Secret: load directly from the downloaded PEM.
kubectl create secret generic github-app-private-key \
  --namespace mercato-sandboxes \
  --from-file=private-key.pem=/path/to/mercato-agent.YYYY-MM-DD.private-key.pem
```

The onboarding pod mounts `github-app-private-key` at
`/run/secrets/github-app/private-key.pem`. It reads the App ID and webhook
secret from `github-app-credentials` as envs.

## 3. Verify

```bash
kubectl rollout restart deployment/onboarding -n mercato-sandboxes
kubectl logs deploy/onboarding -n mercato-sandboxes --tail=50

# Open `https://sandbox.<yourdomain>.com/api/github/install/start` while
# signed in as a Mercato user; you should be redirected to the GitHub
# install page. After installing, the webhook is delivered to
# /api/github/webhook and the installation_id is persisted on the user row.
```

Then trigger a migration for a sandbox:

```bash
curl -X POST -b "$SESSION_COOKIE" \
  https://sandbox.<yourdomain>.com/api/sandboxes/<sandbox-id>/migrate-to-github
```

## 4. MVP Caveats

- Installation access tokens live ~1 hour. The migration uses one in the
  in-cluster mirror Job and then writes a fresh one into the workspace's
  credentials Secret. After it expires the workspace can no longer push to
  GitHub until the user re-runs migration or a follow-up implements
  installation-token rotation. See the plan's Phase 5 non-goals.
- No "rollback to Gitea" path. The Gitea repo is archived, not deleted, so
  the data is recoverable, but the workspace's origin is GitHub from that
  point on.
- The webhook binds an installation to the user whose `github_login`
  matches `sender.login`. A user who hasn't recorded their GitHub login
  yet ends up in a pending state; a follow-up UI is expected to claim it.
