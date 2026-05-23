# Keep this file in sync with `k8s/coder-template/README.md`.

# Kubernetes Workspace Template

This template is the Kubernetes counterpart to `coder/template/`. It keeps the
workspace UX the same while replacing Docker resources with Kubernetes ones.

## Workspace Shape

- one `Deployment` per workspace
- one `mercato-workspace` container
- one sidecar PostgreSQL container
- one PVC mounted at `/home/coder`
- one PVC mounted for PostgreSQL data
- optional pod-level `imagePullSecrets` for private workspace registries

## Behavior

- Coder agent bootstrap is rewritten from the browser-facing public URL to the
  in-cluster Coder service URL.
- One Kubernetes Coder template now exposes a `sandbox_preset` parameter with
  the active Open Mercato variants `crm`, `empty`, and `classic`.
- The workspace startup logic lives in
  `k8s/coder-template/files/workspace-startup.sh.tftpl` instead of an inline
  Terraform heredoc, so preset bootstrap commands and first-boot behavior stay
  readable.
- The Mercato app runs `yarn setup` on first boot, then `yarn dev` on later
  start/resume cycles, while still exposing the same ports and writing the same
  public app URLs into `.env`.
- PVCs are kept outside the `start_count` gate so workspace stop/start cycles
  preserve home and database state.
