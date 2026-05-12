# Kubernetes Workspace Template

This template is the Kubernetes counterpart to `coder/template/`. It keeps the
workspace UX the same while replacing Docker resources with Kubernetes ones.

## Workspace Shape

- one `Deployment` per workspace
- one `mercato-workspace` container
- one sidecar PostgreSQL container
- one PVC mounted at `/home/coder`
- one PVC mounted for PostgreSQL data

## Behavior

- Coder agent bootstrap is rewritten from the browser-facing public URL to the
  in-cluster Coder service URL.
- The Mercato app still runs `yarn setup`, exposes the same ports, and writes
  the same public app URLs into `.env`.
- PVCs are kept outside the `start_count` gate so workspace stop/start cycles
  preserve home and database state.
