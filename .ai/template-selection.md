# Sandbox Template Selection — MVP

## Overview

Sandbox types should be selected using a combination of:

```text
- Coder Templates
- Runtime Presets
- Coder Template Parameters
```

The architecture should separate:

```text
Infrastructure shape
    from
Application bootstrap logic
```

---

# Architecture Responsibilities

## Coder Template

Responsible for:

```text
- Pod structure
- containers
- CPU / memory limits
- mounted PVC
- ports
- base Docker image
- workspace agent
- system tooling
```

Examples:

```text
node-web-workspace
python-workspace
generic-workspace
```

---

## Runtime Preset

Responsible for:

```text
- repository bootstrap
- package manager
- install command
- dev/start command
- framework-specific behavior
- runtime environment variables
```

Examples:

```text
nextjs
vite
openmercato
hono-api
generic-node
```

---

# Selection Flow

```text
User selects sandbox type
    |
Runtime API maps sandbox type
    |
Runtime API selects proper Coder template
    |
Runtime API sends parameters to Coder
    |
Coder creates workspace Pod
    |
Startup script reads parameters
    |
Workspace bootstraps application
```

---

# Example Mapping

```text
Sandbox Type: Next.js App

Coder Template:
  node-web-workspace

Runtime Preset:
  nextjs
```

```text
Sandbox Type: Hono API

Coder Template:
  node-web-workspace

Runtime Preset:
  hono-api
```

```text
Sandbox Type: Python ML

Coder Template:
  python-workspace

Runtime Preset:
  python-ml
```

---

# Recommended MVP Templates

Minimal recommended template set:

```text
1. node-web-workspace
2. generic-workspace
3. python-workspace
```

Avoid creating too many Coder templates initially.

---

# Runtime API Template Registry Example

```ts
const sandboxTemplates = {
  "nextjs": {
    coderTemplate: "node-web-workspace",
    port: 3000,
    installCommand: "pnpm install",
    devCommand: "pnpm dev",
  },

  "hono-api": {
    coderTemplate: "node-web-workspace",
    port: 3000,
    installCommand: "pnpm install",
    devCommand: "pnpm dev",
  },

  "python-ml": {
    coderTemplate: "python-workspace",
    port: 8000,
    installCommand: "uv sync",
    devCommand: "python app.py",
  }
}
```

---

# Coder Template Parameters

Runtime API should pass parameters to Coder during workspace creation.

Example parameters:

```text
WORKSPACE_PRESET
REPO_URL
BRANCH
COMMIT_SHA
PORT
PACKAGE_MANAGER
INSTALL_COMMAND
DEV_COMMAND
```

These parameters should be exposed inside the workspace as environment variables.

---

# Example Startup Script Logic

```bash
case "$WORKSPACE_PRESET" in
  nextjs)
    pnpm install
    pnpm dev
    ;;

  hono-api)
    pnpm install
    pnpm dev
    ;;

  python-ml)
    uv sync
    python app.py
    ;;
esac
```

---

# Important Design Rule

Use:

```text
New Coder Template
```

only when infrastructure shape changes.

Examples:

```text
- different containers
- different resource limits
- GPU support
- different system image
- different storage model
```

Use:

```text
Runtime Presets
```

when only bootstrap logic changes.

Examples:

```text
- framework type
- package manager
- startup command
- repository setup
```

---

# Recommended MVP Strategy

```text
Few Coder Templates
+
Many Runtime Presets
```

This keeps the platform simpler and avoids template sprawl.