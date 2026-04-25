###############################################################################
# Mercato Sandbox — Coder template (per SPEC.md §3 / §7)
#
# One workspace = one sidecar postgres + one mercato-workspace container on a
# private docker network. The agent's startup script scaffolds the Mercato
# app on first boot and runs `yarn setup` on every boot.
#
# Networking model (task #14):
#   * Each workspace container is also attached to the shared `mercato-proxy`
#     docker network so caddy-docker-proxy can reach :3000 and :4000 by
#     container alias.
#   * caddy-docker-proxy reads docker labels to publish two subdomains per
#     workspace on the host's standard 80/443:
#         <workspace>.<SANDBOX_DOMAIN>          → app on :3000
#         <workspace>-splash.<SANDBOX_DOMAIN>   → splash on :4000
#     For local dev SANDBOX_DOMAIN defaults to `lvh.me` (resolves to 127.0.0.1
#     for any subdomain — no /etc/hosts hacks). For prod set it to e.g.
#     `sandbox.openmercato.com` with a wildcard DNS A record.
###############################################################################

terraform {
  required_providers {
    coder = {
      source  = "coder/coder"
      version = "~> 2.0"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

###############################################################################
# Template-level variables — forwarded from .env via push-template.sh
# (`user_variable_values`).
#
# AI keys: surfaced inside each workspace container as OPENAI_API_KEY /
# ANTHROPIC_API_KEY for the preinstalled AI CLIs.
#
# Networking vars: drive the user-facing URLs that caddy publishes for each
# workspace. Defaults match the local-dev setup (lvh.me on plain http:80).
###############################################################################

variable "openai_api_key" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Forwarded to each workspace as OPENAI_API_KEY for opencode/codex CLIs"
}

variable "anthropic_api_key" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Forwarded as ANTHROPIC_API_KEY for the claude CLI"
}

variable "sandbox_domain" {
  type        = string
  default     = "lvh.me"
  description = "DNS root under which each workspace gets its own subdomain (e.g. lvh.me for local, sandbox.openmercato.com for prod). lvh.me wildcards to 127.0.0.1, so no DNS / /etc/hosts work needed locally."
}

variable "caddy_scheme" {
  type        = string
  default     = "http"
  description = "Scheme caddy publishes URLs on (http for local lvh.me dev, https in prod with ACME)."
}

variable "caddy_port_suffix" {
  type        = string
  default     = ""
  description = "Optional port suffix appended to user-facing URLs (e.g. ':8080' if you can't bind 80). Empty for standard 80/443."
}

# Default docker provider talks to whatever socket the coder container has
# mounted (we mount /var/run/docker.sock from the host in docker-compose.yml).
provider "docker" {}

###############################################################################
# Coder data sources
###############################################################################

data "coder_provisioner" "me" {}
data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

###############################################################################
# Locals — build the public URLs caddy will serve. Each workspace gets two
# subdomains: "<name>" for the app and "<name>-splash" for the splash screen.
# Coder workspace names are already constrained to [a-z0-9-]{3,32}, which is
# DNS-label-safe.
###############################################################################

locals {
  app_host    = "${lower(data.coder_workspace.me.name)}.${var.sandbox_domain}"
  splash_host = "${lower(data.coder_workspace.me.name)}-splash.${var.sandbox_domain}"
  app_url     = "${var.caddy_scheme}://${local.app_host}${var.caddy_port_suffix}"
  splash_url  = "${var.caddy_scheme}://${local.splash_host}${var.caddy_port_suffix}"
  # Caddy site address. Including the explicit scheme + port disables auto-HTTPS
  # when CADDY_SCHEME=http (otherwise caddy tries to obtain LetsEncrypt certs
  # for lvh.me etc.). For prod set CADDY_SCHEME=https and ACME just works.
  app_site_addr    = var.caddy_scheme == "http" ? "http://${local.app_host}:80" : "https://${local.app_host}"
  splash_site_addr = var.caddy_scheme == "http" ? "http://${local.splash_host}:80" : "https://${local.splash_host}"
}

###############################################################################
# Agent — installed in the workspace container; the init script gets injected
# by Coder as the container entrypoint via `coder_agent.main.init_script`.
###############################################################################

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
    # 1. start code-server
    code-server --auth none --bind-addr 0.0.0.0:13337 >/tmp/code-server.log 2>&1 &

    # 2. on first boot only: scaffold mercato app + patch .env + install deps
    if [ ! -d "$HOME/app" ]; then
      cd "$HOME"
      npx -y create-mercato-app@develop app --skip-agentic-setup
      cd app
      cp .env.example .env
      sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgres://mercato:mercato@workspace-pg:5432/mercato#" .env
      grep -q '^OM_DEV_AUTO_OPEN=' .env || echo "OM_DEV_AUTO_OPEN=0" >> .env
      grep -q '^OM_DEV_SPLASH_PORT=' .env || echo "OM_DEV_SPLASH_PORT=4000" >> .env
      yarn install
    fi

    # 3. always: launch dev (yarn setup is idempotent — runs migrate + initialize, then dev)
    cd "$HOME/app"
    nohup yarn setup >/tmp/mercato-dev.log 2>&1 &
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

###############################################################################
# coder_app links — surfaced in the Coder UI and in our onboarding app.
###############################################################################

resource "coder_app" "code-server" {
  agent_id     = coder_agent.main.id
  slug         = "code-server"
  display_name = "VS Code"
  url          = "http://localhost:13337/?folder=/home/coder/app"
  icon         = "/icon/code.svg"
  subdomain    = false
  share        = "authenticated"
  open_in      = "tab"

  healthcheck {
    url       = "http://localhost:13337/healthz"
    interval  = 5
    threshold = 6
  }
}

resource "coder_app" "splash" {
  agent_id     = coder_agent.main.id
  slug         = "splash"
  display_name = "Mercato Splash"
  # `external = true` means Coder doesn't proxy — the user's browser hits the
  # caddy-published subdomain directly. caddy reverse-proxies into the
  # container's :4000 over the shared mercato-proxy network.
  external = true
  url      = local.splash_url
  icon     = "/icon/widgets.svg"
  open_in  = "tab"
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

###############################################################################
# Per-workspace docker primitives
###############################################################################

resource "docker_volume" "home" {
  name = "coder-${data.coder_workspace.me.id}-home"

  lifecycle {
    ignore_changes = all
  }
}

# Private network for the workspace ↔ sidecar postgres traffic.
resource "docker_network" "workspace" {
  name = "coder-${data.coder_workspace.me.id}-net"
}

# Pre-existing shared network (created by docker-compose.yml as
# `mercato-proxy`). caddy-docker-proxy listens on it; every workspace joins
# so caddy can reach the workspace by container alias.
data "docker_network" "proxy" {
  name = "mercato-proxy"
}

###############################################################################
# Sidecar postgres — pgvector pg17 — reachable inside the network as
# `workspace-pg` (matches DATABASE_URL written by the startup script).
###############################################################################

resource "docker_container" "postgres" {
  count = data.coder_workspace.me.start_count

  image   = "pgvector/pgvector:pg17-trixie"
  name    = "coder-${data.coder_workspace.me.id}-postgres"
  memory  = 2048
  restart = "unless-stopped"

  env = [
    "POSTGRES_DB=mercato",
    "POSTGRES_USER=mercato",
    "POSTGRES_PASSWORD=mercato",
  ]

  networks_advanced {
    name    = docker_network.workspace.name
    aliases = ["workspace-pg"]
  }

  healthcheck {
    test     = ["CMD-SHELL", "pg_isready -U mercato -d mercato"]
    interval = "10s"
    timeout  = "5s"
    retries  = 5
  }

  labels {
    label = "coder.workspace_id"
    value = data.coder_workspace.me.id
  }
  labels {
    label = "coder.workspace_name"
    value = data.coder_workspace.me.name
  }
}

###############################################################################
# Workspace container — mercato-workspace:latest, agent token injected as env,
# entrypoint = agent init script with localhost rewrites for macOS host.
#
# Two networks:
#   * docker_network.workspace  → talks to sidecar postgres (workspace-pg)
#   * mercato-proxy             → caddy-docker-proxy reaches :3000 / :4000
#
# Caddy labels (read by lucaslorentz/caddy-docker-proxy):
#   caddy_0           = <name>.<sandbox_domain>          → reverse_proxy :3000
#   caddy_1           = <name>-splash.<sandbox_domain>   → reverse_proxy :4000
# We use indexed `caddy_N` keys so two independent vhosts can be configured on
# one container. caddy auto-handles WebSocket upgrade — Next.js HMR works.
###############################################################################

resource "docker_container" "workspace" {
  count = data.coder_workspace.me.start_count

  image    = "mercato-workspace:latest"
  name     = "coder-${data.coder_workspace_owner.me.name}-${lower(data.coder_workspace.me.name)}"
  hostname = data.coder_workspace.me.name
  memory   = 16384

  # localhost / 127.0.0.1 inside the agent init script need to point at the
  # mac host (where Coder is published on :7080), not the container's loopback.
  entrypoint = ["sh", "-c", replace(coder_agent.main.init_script, "/localhost|127\\.0\\.0\\.1/", "host.docker.internal")]

  env = [
    "CODER_AGENT_TOKEN=${coder_agent.main.token}",
    "OPENAI_API_KEY=${var.openai_api_key}",
    "ANTHROPIC_API_KEY=${var.anthropic_api_key}",
  ]

  # Private network for postgres sidecar.
  networks_advanced {
    name    = docker_network.workspace.name
    aliases = ["workspace"]
  }

  # Shared proxy network — caddy reaches us by container name.
  networks_advanced {
    name    = data.docker_network.proxy.name
    aliases = [data.coder_workspace.me.name]
  }

  host {
    host = "host.docker.internal"
    ip   = "host-gateway"
  }

  volumes {
    container_path = "/home/coder"
    volume_name    = docker_volume.home.name
    read_only      = false
  }

  # ---- caddy-docker-proxy labels (subdomain reverse proxy on 80/443) ------
  # App on :3000 → <name>.<domain>
  labels {
    label = "caddy_0"
    value = local.app_site_addr
  }
  labels {
    label = "caddy_0.reverse_proxy"
    value = "{{upstreams 3000}}"
  }
  # Splash on :4000 → <name>-splash.<domain>
  labels {
    label = "caddy_1"
    value = local.splash_site_addr
  }
  labels {
    label = "caddy_1.reverse_proxy"
    value = "{{upstreams 4000}}"
  }

  labels {
    label = "coder.owner"
    value = data.coder_workspace_owner.me.name
  }
  labels {
    label = "coder.owner_id"
    value = data.coder_workspace_owner.me.id
  }
  labels {
    label = "coder.workspace_id"
    value = data.coder_workspace.me.id
  }
  labels {
    label = "coder.workspace_name"
    value = data.coder_workspace.me.name
  }
}
