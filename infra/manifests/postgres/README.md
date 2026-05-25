# In-Cluster PostgreSQL

This directory contains the intentionally simple PostgreSQL manifests for the
Hetzner k3s path.

The intended split is:

- `infra/helm` installs the platform apps
- manifests in this directory create one PostgreSQL `StatefulSet` per app
- `coder`, `onboarding`, and `gitea` consume the matching `-rw` Service

Files:

- `postgres-coder-app-secret.template.yaml`: app credentials for the Coder DB
- `postgres-coder-cluster.yaml`: Coder metadata PostgreSQL `StatefulSet`,
  headless Service, and `-rw` Service
- `postgres-onboarding-app-secret.template.yaml`: app credentials for the
  onboarding DB
- `postgres-onboarding-cluster.yaml`: onboarding PostgreSQL `StatefulSet`,
  headless Service, and `-rw` Service
- `postgres-gitea-app-secret.template.yaml`: app credentials for the Gitea DB
- `postgres-gitea-cluster.yaml`: Gitea PostgreSQL `StatefulSet`, headless
  Service, and `-rw` Service. Lives in `mercato-sandboxes` and is reached from
  the `gitea` namespace via FQDN.

Notes:

- The default manifests use the official `postgres:17` image, `hcloud-volumes`,
  and one replica so they can boot on the current small cluster shape. This is
  intentionally simple and not HA, but the volumes are replicated inside the
  Hetzner DC.
- The `postgres-*-app` Secret provides `POSTGRES_USER` and
  `POSTGRES_PASSWORD` during first boot of an empty data volume. Updating the
  Secret later does not rotate credentials inside an already initialized
  database.
- The `-rw` Services are kept so existing app connection strings do not need to
  change.
- Backup automation is intentionally not wired yet. Treat backups and restore
  drills as a required follow-up before calling the platform production-ready.
