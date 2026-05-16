terraform {
  required_providers {
    coder = {
      source  = "coder/coder"
      version = "~> 2.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.32"
    }
  }
}

variable "sandbox_domain" {
  type        = string
  default     = "sandbox.lvh.me"
  description = "DNS root used for browser-facing onboarding and Coder routes."
}

variable "proxy_scheme" {
  type        = string
  default     = "https"
  description = "Browser-facing scheme published by the local ingress."
}

variable "proxy_port_suffix" {
  type        = string
  default     = ":8443"
  description = "Port suffix appended to browser-facing URLs."
}

variable "wildcard_apps_domain" {
  type        = string
  default     = "apps.sandbox.lvh.me"
  description = "Wildcard host suffix used by Coder's subdomain app proxy."
}

variable "coder_public_url" {
  type        = string
  default     = "https://coder.sandbox.lvh.me:8443"
  description = "Browser-facing Coder URL used for link generation."
}

variable "agent_coder_url" {
  type        = string
  default     = "http://coder.mercato-sandboxes.svc.cluster.local"
  description = "In-cluster Coder URL used by workspace agents."
}

variable "workspace_namespace" {
  type        = string
  default     = "mercato-sandboxes"
  description = "Namespace where workspace Deployments and PVCs are created."
}

variable "workspace_image" {
  type        = string
  default     = "mercato-workspace:k8s-local"
  description = "Workspace image imported into the local k3d cluster."
}

variable "workspace_storage_class" {
  type        = string
  default     = ""
  description = "Optional storage class name for the workspace PVCs."
}

variable "home_storage_size" {
  type        = string
  default     = "20Gi"
  description = "Persistent storage size for /home/coder."
}

variable "pg_storage_size" {
  type        = string
  default     = "10Gi"
  description = "Persistent storage size for the sidecar PostgreSQL data directory."
}

variable "workspace_node_options" {
  type        = string
  default     = "--max-old-space-size=6144"
  description = "NODE_OPTIONS used inside the workspace container to cap local Mercato dev-memory peaks."
}

provider "kubernetes" {}

data "coder_provisioner" "me" {}
data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

locals {
  ws_name       = lower(data.coder_workspace.me.name)
  owner_name    = lower(data.coder_workspace_owner.me.name)
  id_suffix     = substr(replace(data.coder_workspace.me.id, "-", ""), 0, 8)
  name_prefix   = "coder-${substr(local.owner_name, 0, 20)}-${substr(local.ws_name, 0, 20)}"
  deployment    = "${local.name_prefix}-${local.id_suffix}"
  home_pvc      = "coder-home-${local.id_suffix}"
  pg_pvc        = "coder-pg-${local.id_suffix}"
  code_url      = "${var.proxy_scheme}://13337--main--${local.ws_name}--${local.owner_name}.${var.wildcard_apps_domain}${var.proxy_port_suffix}"
  app_url       = "${var.proxy_scheme}://3000--main--${local.ws_name}--${local.owner_name}.${var.wildcard_apps_domain}${var.proxy_port_suffix}"
  splash_url    = "${var.proxy_scheme}://4000--main--${local.ws_name}--${local.owner_name}.${var.wildcard_apps_domain}${var.proxy_port_suffix}"
  public_coder  = trimsuffix(var.coder_public_url, "/")
  internal_coder = trimsuffix(var.agent_coder_url, "/")
  selector_labels = {
    "app.kubernetes.io/name" = "mercato-workspace"
    "coder.workspace_id"     = data.coder_workspace.me.id
  }
  workspace_labels = merge(local.selector_labels, {
    "app.kubernetes.io/part-of" = "mercato-sandboxes"
    "coder.workspace_name"      = local.ws_name
    "coder.owner"               = local.owner_name
  })
  agent_init_script = replace(coder_agent.main.init_script, local.public_coder, local.internal_coder)
}

resource "coder_agent" "main" {
  os                      = "linux"
  arch                    = data.coder_provisioner.me.arch
  startup_script_behavior = "blocking"

  env = {
    GIT_AUTHOR_NAME     = coalesce(data.coder_workspace_owner.me.full_name, data.coder_workspace_owner.me.name)
    GIT_AUTHOR_EMAIL    = data.coder_workspace_owner.me.email
    GIT_COMMITTER_NAME  = coalesce(data.coder_workspace_owner.me.full_name, data.coder_workspace_owner.me.name)
    GIT_COMMITTER_EMAIL = data.coder_workspace_owner.me.email
  }

  startup_script = <<-EOT
    set -e

    code-server --auth none --trusted-origins '*' --bind-addr 0.0.0.0:13337 >/tmp/code-server.log 2>&1 &

    mkdir -p "$HOME/.codex"
    if [ ! -f "$HOME/.codex/config.toml" ] || grep -q "open-mercato managed openrouter profile" "$HOME/.codex/config.toml"; then
      cat > "$HOME/.codex/config.toml" <<'EOF'
# open-mercato managed openrouter profile
model = "openai/gpt-5"
model_provider = "openrouter"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"
wire_api = "responses"
EOF
    fi

    if [ ! -d "$HOME/app" ]; then
      cd "$HOME"
      npx -y create-mercato-app app --preset crm --skip-agentic-setup
      cd app
      cp .env.example .env
      sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgres://mercato:mercato@127.0.0.1:5432/mercato#" .env
      grep -q '^OM_DEV_AUTO_OPEN=' .env || echo "OM_DEV_AUTO_OPEN=0" >> .env
      grep -q '^OM_DEV_SPLASH_PORT=' .env || echo "OM_DEV_SPLASH_PORT=4000" >> .env
      sed -i "s#^APP_URL=.*#APP_URL=${local.app_url}#" .env || true
      grep -q '^APP_URL=' .env || echo "APP_URL=${local.app_url}" >> .env
      sed -i "s#^NEXT_PUBLIC_APP_URL=.*#NEXT_PUBLIC_APP_URL=${local.app_url}#" .env || true
      grep -q '^NEXT_PUBLIC_APP_URL=' .env || echo "NEXT_PUBLIC_APP_URL=${local.app_url}" >> .env
      sed -i "s#^APP_ALLOWED_ORIGINS=.*#APP_ALLOWED_ORIGINS=${local.app_url}#" .env || true
      grep -q '^APP_ALLOWED_ORIGINS=' .env || echo "APP_ALLOWED_ORIGINS=${local.app_url}" >> .env
      yarn install
      yarn mercato agentic:init >/tmp/mercato-agentic-init.log 2>&1 || true
    fi

    cd "$HOME/app"
    if grep -q "const allowedDevOrigins = isDevelopment ? resolveAllowedDevOrigins() : \\[\\]" next.config.ts 2>/dev/null; then
      perl -0pi -e "s/const allowedDevOrigins = isDevelopment \\? resolveAllowedDevOrigins\\(\\) : \\[\\]/const allowedDevOrigins = resolveAllowedDevOrigins()/g" next.config.ts
    fi

    if grep -q "const localMatch = line.match(/^- Local:\\\\s*(.+)$/)" scripts/dev-runtime.mjs 2>/dev/null \
      && ! grep -q "resolveDisplayedRuntimeBaseUrl" scripts/dev-runtime.mjs 2>/dev/null; then
node <<'NODE'
const fs = require('fs')
const runtimePath = 'scripts/dev-runtime.mjs'
let source = fs.readFileSync(runtimePath, 'utf8')

const helperMarker = `function readNonEmptyEnvValue(key) {
  const value = process.env[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}`

if (!source.includes(helperMarker)) {
  console.warn('[sandbox] unable to patch splash display URL: helper marker not found')
  process.exit(0)
}

const helperReplacement = helperMarker + `

function normalizeRuntimeBaseUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null

  try {
    const parsed = new URL(value)
    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\\/$/, '')
  } catch {
    return null
  }
}

function resolveDisplayedRuntimeBaseUrl(localUrl) {
  return normalizeRuntimeBaseUrl(process.env.APP_URL)
    ?? normalizeRuntimeBaseUrl(process.env.NEXT_PUBLIC_APP_URL)
    ?? normalizeRuntimeBaseUrl(localUrl)
}`
source = source.replace(helperMarker, helperReplacement)

const localStartNeedle = String.raw`  const localMatch = line.match(/^- Local:\s*(.+)$/)`
const localStart = source.indexOf(localStartNeedle)
const readyStart = source.indexOf('  const readyMatch = line.match', localStart)
if (localStart === -1 || readyStart === -1) {
  console.warn('[sandbox] unable to patch splash display URL: local URL block not found')
  process.exit(0)
}

const localReplacement = String.raw`  const localMatch = line.match(/^- Local:\s*(.+)$/)
  if (localMatch) {
    const displayedUrl = resolveDisplayedRuntimeBaseUrl(localMatch[1]) ?? localMatch[1]
    return {
      type: 'status',
      message: '🌐 App runtime at ' + displayedUrl,
      splashPhase: startupSplashPhase,
      splashDetail: 'Dev server is listening at ' + displayedUrl,
      readyUrl: displayedUrl,
      loginUrl: displayedUrl.replace(/\/$/, '') + '/login',
      activity: 'App runtime at ' + displayedUrl,
      progressCurrent: 4,
      progressLabel: 'Precompiling login page',
    }
  }
`

source = source.slice(0, localStart) + localReplacement + source.slice(readyStart)
fs.writeFileSync(runtimePath, source)
NODE
    fi

    export APP_URL="${local.app_url}"
    export NEXT_PUBLIC_APP_URL="${local.app_url}"
    export APP_ALLOWED_ORIGINS="${local.app_url}"
    nohup env APP_URL="${local.app_url}" NEXT_PUBLIC_APP_URL="${local.app_url}" APP_ALLOWED_ORIGINS="${local.app_url}" yarn setup >/tmp/mercato-dev.log 2>&1 &
  EOT

  metadata {
    display_name = "CPU Usage"
    key          = "cpu"
    script       = "coder stat cpu"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "RAM Usage"
    key          = "memory"
    script       = "coder stat mem"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "Home Disk"
    key          = "disk_home"
    script       = "coder stat disk --path /home/coder"
    interval     = 60
    timeout      = 1
  }
}

resource "coder_app" "code_server" {
  agent_id     = coder_agent.main.id
  slug         = "code-server"
  display_name = "VS Code"
  external     = true
  url          = "${local.code_url}/?folder=/home/coder/app"
  icon         = "/icon/code.svg"
  open_in      = "tab"
}

resource "coder_app" "splash" {
  agent_id     = coder_agent.main.id
  slug         = "splash"
  display_name = "Mercato Splash"
  external     = true
  url          = local.splash_url
  icon         = "/icon/widgets.svg"
  open_in      = "tab"
}

resource "coder_app" "app" {
  agent_id     = coder_agent.main.id
  slug         = "app"
  display_name = "Mercato App"
  external     = true
  url          = local.app_url
  icon         = "/icon/widgets.svg"
  open_in      = "tab"
}

resource "kubernetes_persistent_volume_claim_v1" "home" {
  wait_until_bound = false

  metadata {
    name      = local.home_pvc
    namespace = var.workspace_namespace
    labels    = local.workspace_labels
  }

  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = var.workspace_storage_class != "" ? var.workspace_storage_class : null

    resources {
      requests = {
        storage = var.home_storage_size
      }
    }
  }
}

resource "kubernetes_persistent_volume_claim_v1" "pg_data" {
  wait_until_bound = false

  metadata {
    name      = local.pg_pvc
    namespace = var.workspace_namespace
    labels    = local.workspace_labels
  }

  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = var.workspace_storage_class != "" ? var.workspace_storage_class : null

    resources {
      requests = {
        storage = var.pg_storage_size
      }
    }
  }
}

resource "kubernetes_deployment_v1" "workspace" {
  count = data.coder_workspace.me.start_count

  metadata {
    name      = local.deployment
    namespace = var.workspace_namespace
    labels    = local.workspace_labels
  }

  spec {
    replicas = 1

    selector {
      match_labels = local.selector_labels
    }

    template {
      metadata {
        labels = local.workspace_labels
      }

      spec {
        automount_service_account_token = false
        node_selector = {
          "mercato.openmercato.dev/workspace" = "true"
        }

        init_container {
          name              = "init-permissions"
          image             = "busybox:1.36"
          image_pull_policy = "IfNotPresent"
          command = [
            "sh",
            "-c",
            "mkdir -p /workspace-home /workspace-pg && chown -R 1000:1000 /workspace-home && chown -R 999:999 /workspace-pg",
          ]

          volume_mount {
            name       = "home"
            mount_path = "/workspace-home"
          }

          volume_mount {
            name       = "pg-data"
            mount_path = "/workspace-pg"
          }
        }

        container {
          name              = "workspace"
          image             = var.workspace_image
          image_pull_policy = "IfNotPresent"
          command           = ["sh", "-lc", local.agent_init_script]

          security_context {
            run_as_user                = 1000
            run_as_group               = 1000
            allow_privilege_escalation = false
          }

          env {
            name  = "CODER_AGENT_TOKEN"
            value = coder_agent.main.token
          }

          env {
            name  = "ANTHROPIC_BASE_URL"
            value = "https://openrouter.ai/api"
          }

          env {
            name  = "ANTHROPIC_API_KEY"
            value = ""
          }

          env {
            name  = "NODE_OPTIONS"
            value = var.workspace_node_options
          }

          port {
            container_port = 13337
            name           = "code-server"
          }

          port {
            container_port = 3000
            name           = "app"
          }

          port {
            container_port = 4000
            name           = "splash"
          }

          resources {
            requests = {
              cpu    = "1500m"
              memory = "6Gi"
            }

            limits = {
              cpu    = "6"
              memory = "16Gi"
            }
          }

          volume_mount {
            name       = "home"
            mount_path = "/home/coder"
          }
        }

        container {
          name              = "postgres"
          image             = "pgvector/pgvector:pg17-trixie"
          image_pull_policy = "IfNotPresent"

          env {
            name  = "POSTGRES_DB"
            value = "mercato"
          }

          env {
            name  = "POSTGRES_USER"
            value = "mercato"
          }

          env {
            name  = "POSTGRES_PASSWORD"
            value = "mercato"
          }

          env {
            name  = "PGDATA"
            value = "/var/lib/postgresql/data/pgdata"
          }

          port {
            container_port = 5432
            name           = "postgres"
          }

          readiness_probe {
            exec {
              command = ["sh", "-c", "pg_isready -U mercato -d mercato"]
            }
            initial_delay_seconds = 10
            period_seconds        = 5
            timeout_seconds       = 5
            failure_threshold     = 6
          }

          liveness_probe {
            exec {
              command = ["sh", "-c", "pg_isready -U mercato -d mercato"]
            }
            initial_delay_seconds = 30
            period_seconds        = 15
            timeout_seconds       = 5
            failure_threshold     = 6
          }

          resources {
            requests = {
              cpu    = "250m"
              memory = "512Mi"
            }

            limits = {
              cpu    = "1"
              memory = "2Gi"
            }
          }

          volume_mount {
            name       = "pg-data"
            mount_path = "/var/lib/postgresql/data"
          }
        }

        volume {
          name = "home"

          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim_v1.home.metadata[0].name
          }
        }

        volume {
          name = "pg-data"

          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim_v1.pg_data.metadata[0].name
          }
        }
      }
    }
  }
}
