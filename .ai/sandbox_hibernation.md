# Workspace Hibernation Mechanism — MVP

## Overview

Workspace hibernation should be controlled by the Runtime API, while the actual workspace lifecycle is managed by Coder.

Architecture responsibilities:

```text
Runtime API
  ├── tracks workspace activity
  ├── decides when workspace should hibernate
  ├── calls Coder API to stop/start workspace
  ├── manages workspace metadata
  └── manages ingress / hostname state

Coder
  ├── creates workspace Pod
  ├── removes workspace Pod
  ├── mounts workspace PVC
  └── runs startup/bootstrap scripts

Longhorn
  └── persists workspace filesystem
```

---

# High-Level Flow

```text
User active
    |
Workspace Pod running
    |
No activity detected
    |
Runtime API triggers hibernation
    |
Coder stops workspace Pod
    |
Longhorn PVC remains
    |
User returns later
    |
Runtime API wakes workspace
    |
Coder recreates Pod
    |
PVC reattached
    |
Workspace restored
```

---

# Workspace Lifecycle States

```text
creating
active
idle
hibernating
hibernated
waking
failed
deleting
deleted
```

---

# Activity Tracking

Runtime API should store:

```text
workspaceId
userId
sandboxId
hostname
lastActiveAt
status
coderWorkspaceId
```

Activity detection for MVP:

```text
- frontend heartbeat every 30-60 seconds
- websocket activity
- API requests from workspace UI
```

---

# Hibernation Strategy

When inactivity timeout is exceeded:

```text
1. Runtime API marks workspace as "hibernating"
2. Runtime API calls Coder API to stop workspace
3. Coder removes workspace Pod
4. Longhorn PVC remains attached to workspace
5. Runtime API marks workspace as "hibernated"
```

Important:

```text
Compute is removed
Storage remains persistent
```

---

# Wake-Up Strategy

When user wants to reopen workspace:

```text
1. User opens workspace from platform UI
2. Runtime API marks workspace as "waking"
3. Runtime API calls Coder API to start workspace
4. Coder recreates workspace Pod
5. Existing Longhorn PVC is mounted
6. Startup script detects existing workspace
7. Application starts
8. Runtime API marks workspace as "active"
```

---

# Recommended MVP Approach

For MVP:

```text
Wake-up should happen only via Runtime API / platform UI.
```

Do NOT implement automatic wake-up directly from ingress requests initially.

Avoid:

```text
Auto wake proxy
Ingress interception
Dynamic request buffering
```

Keep the flow explicit and predictable.

---

# Persistent Workspace Storage

Workspace filesystem should be mounted from Longhorn PVC:

```text
/workspace
```

Example architecture:

```text
Workspace Pod
├── app container
├── coder agent
└── Longhorn PVC mounted at /workspace
```

PVC must survive Pod deletion.

---

# Startup / Resume Mechanism

Coder startup script should detect whether workspace is booting for the first time or resuming after hibernation.

This should be handled using a marker file stored on persistent storage.

Example marker path:

```text
/workspace/.runtime/initialized.json
```

---

# Startup Script Logic

```bash
#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="/workspace/.runtime"
MARKER_FILE="$RUNTIME_DIR/initialized.json"

mkdir -p "$RUNTIME_DIR"

if [ ! -f "$MARKER_FILE" ]; then
  echo "First workspace bootstrap"

  git clone "$REPO_URL" /workspace/app

  cd /workspace/app
  pnpm install

  cat > "$MARKER_FILE" <<EOF
{
  "initialized": true,
  "workspaceId": "$WORKSPACE_ID",
  "sandboxId": "$SANDBOX_ID",
  "repoUrl": "$REPO_URL",
  "branch": "$BRANCH",
  "commitSha": "$COMMIT_SHA",
  "initializedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

else
  echo "Workspace resume"

  cd /workspace/app

  pnpm install --prefer-offline
fi

cd /workspace/app
pnpm dev
```

---

# Marker File Responsibilities

The marker file should:

```text
- indicate workspace was already initialized
- persist bootstrap metadata
- survive Pod recreation
- allow resume logic after hibernation
```

The marker file must be created only after successful bootstrap.

Do NOT store secrets in marker files.

Avoid storing:

```text
- API keys
- GitHub tokens
- database passwords
- private credentials
```

---

# Runtime API Responsibilities

The Runtime API should:

```text
- track activity heartbeats
- decide when to hibernate
- call Coder API
- expose wake/sleep APIs
- manage workspace metadata
- manage ingress and hostname mapping
```

The Runtime API should NOT:

```text
- manipulate workspace filesystem directly
- create initialization markers
- bootstrap repositories
```

Those responsibilities belong to the startup script running inside the workspace.

---

# MVP Technical Decisions

## Hibernation

```text
Coder API stop workspace
```

## Wake-Up

```text
Coder API start workspace
```

## Persistence

```text
Longhorn PVC
```

## Bootstrap Detection

```text
Marker file stored on PVC
```

## Activity Tracking

```text
Frontend heartbeat
```

## Orchestration

```text
Runtime API in Hono + TypeScript
```