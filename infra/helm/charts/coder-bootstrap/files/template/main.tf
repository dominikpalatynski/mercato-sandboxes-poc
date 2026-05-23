// Keep this file in sync with k8s/coder-template/main.tf.
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

variable "workspace_image_pull_secrets" {
  type        = string
  default     = ""
  description = "Comma-separated imagePullSecret names attached to workspace pods for private registry auth."
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
  sandbox_preset_options = {
    crm = {
      display_name      = "CRM Open Mercato"
      bootstrap_command = "npx -y create-mercato-app app --preset crm --skip-agentic-setup"
    }
    empty = {
      display_name      = "Empty Open Mercato"
      bootstrap_command = "npx -y create-mercato-app app --preset empty --skip-agentic-setup"
    }
    classic = {
      display_name      = "Classic Open Mercato"
      bootstrap_command = "npx -y create-mercato-app app --preset classic --skip-agentic-setup"
    }
  }
  default_sandbox_preset = "crm"
}

data "coder_parameter" "sandbox_preset" {
  name         = "sandbox_preset"
  display_name = "Sandbox preset"
  description  = "Choose which Open Mercato starter should be bootstrapped on first workspace start."
  type         = "string"
  mutable      = false
  default      = local.default_sandbox_preset
  order        = 1

  dynamic "option" {
    for_each = local.sandbox_preset_options
    content {
      name  = option.value.display_name
      value = option.key
    }
  }
}

locals {
  ws_name        = lower(data.coder_workspace.me.name)
  owner_name     = lower(data.coder_workspace_owner.me.name)
  id_suffix      = substr(replace(data.coder_workspace.me.id, "-", ""), 0, 8)
  name_prefix    = "coder-${substr(local.owner_name, 0, 20)}-${substr(local.ws_name, 0, 20)}"
  deployment     = "${local.name_prefix}-${local.id_suffix}"
  home_pvc       = "coder-home-${local.id_suffix}"
  pg_pvc         = "coder-pg-${local.id_suffix}"
  app_url        = "${var.proxy_scheme}://3000--main--${local.ws_name}--${local.owner_name}.${var.wildcard_apps_domain}${var.proxy_port_suffix}"
  public_coder   = trimsuffix(var.coder_public_url, "/")
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
  workspace_image_pull_secrets = toset(compact([
    for value in split(",", var.workspace_image_pull_secrets) : trimspace(value)
  ]))
  selected_sandbox_preset = local.sandbox_preset_options[data.coder_parameter.sandbox_preset.value]
  agent_init_script       = replace(coder_agent.main.init_script, local.public_coder, local.internal_coder)
  workspace_startup_script = templatefile("${path.module}/files/workspace-startup.sh.tftpl", {
    sandbox_preset      = data.coder_parameter.sandbox_preset.value
    sandbox_preset_name = local.selected_sandbox_preset.display_name
    bootstrap_command   = local.selected_sandbox_preset.bootstrap_command
    app_url             = local.app_url
    database_host       = "127.0.0.1"
  })
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

  startup_script = local.workspace_startup_script

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
  url          = "http://localhost:13337/?folder=/home/coder/app"
  icon         = "/icon/code.svg"
  subdomain    = true
  share        = "owner"
  open_in      = "tab"
}

resource "coder_app" "splash" {
  agent_id     = coder_agent.main.id
  slug         = "splash"
  display_name = "Mercato Splash"
  url          = "http://localhost:4000"
  icon         = "/icon/widgets.svg"
  subdomain    = true
  share        = "owner"
  open_in      = "tab"
}

resource "coder_app" "app" {
  agent_id     = coder_agent.main.id
  slug         = "app"
  display_name = "Mercato App"
  url          = "http://localhost:3000"
  icon         = "/icon/widgets.svg"
  subdomain    = true
  share        = "owner"
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
          "node-pool" = "sandbox"
        }

        dynamic "image_pull_secrets" {
          for_each = local.workspace_image_pull_secrets
          content {
            name = image_pull_secrets.value
          }
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
