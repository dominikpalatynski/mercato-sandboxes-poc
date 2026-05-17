###############################################################################
# Mercato Sandbox — Coder template (per .ai/SPEC.md §3 / §7, .ai/SPEC-CODER-PROXY.md)
#
# One workspace = one sidecar postgres + one mercato-workspace container on a
# private docker network. The agent's startup script scaffolds the Mercato
# app on first boot and runs `yarn setup` on every boot.
#
# Networking model:
#   * Each workspace container is attached to the shared `mercato-proxy`
#     docker network so the Coder agent can reach the Coder server directly
#     via the `coder.<SANDBOX_DOMAIN>` Docker DNS alias over internal HTTP.
#   * Workspace ports are exposed via Coder's native wildcard access URL:
#         3000--main--<ws>--<user>.apps.<SANDBOX_DOMAIN>   → app   on :3000
#         4000--main--<ws>--<user>.apps.<SANDBOX_DOMAIN>   → splash on :4000
#         13337--main--<ws>--<user>.apps.<SANDBOX_DOMAIN>  → code-server :13337
#     Coder proxies the browser → workspace port hop itself. The nginx edge
#     adds one wildcard vhost (`*.apps.<SANDBOX_DOMAIN>` → Coder) — no
#     per-workspace labels.
#   * For local dev SANDBOX_DOMAIN defaults to `sandbox.lvh.me` (any subdomain
#     of `lvh.me` resolves to 127.0.0.1 — no /etc/hosts hacks). For prod set
#     `apps.<your-domain>` as `wildcard_apps_domain`, plus a wildcard
#     certificate covering `*.apps.<your-domain>` on the HTTPS edge.
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
# AI access is configured per user through Coder user secrets. The template
# only publishes non-secret provider defaults for Codex + Claude.
#
# Networking vars: drive the user-facing URLs the edge proxy publishes for
# each workspace. Defaults match the local-dev setup (lvh.me on HTTPS :443).
###############################################################################

variable "sandbox_domain" {
  type        = string
  default     = "lvh.me"
  description = "DNS root under which each workspace gets its own subdomain (e.g. lvh.me for local, sandbox.openmercato.com for prod). lvh.me wildcards to 127.0.0.1, so no DNS / /etc/hosts work needed locally."
}

variable "proxy_scheme" {
  type        = string
  default     = "https"
  description = "Scheme the edge proxy publishes URLs on. Local dev uses HTTPS on lvh.me with a generated certificate; prod should use ACME."
}

variable "proxy_port_suffix" {
  type        = string
  default     = ""
  description = "Optional port suffix appended to user-facing URLs (e.g. ':8080' if you can't bind 80). Empty for standard 80/443."
}

variable "wildcard_apps_domain" {
  type        = string
  default     = "apps.sandbox.lvh.me"
  description = "Wildcard apex Coder publishes port-forwarded workspace ports under. Format: {port}--{agent}--{workspace}--{user}.<this>. Default `apps.sandbox.lvh.me` matches the dev nginx wildcard vhost. Set to `apps.<your-domain>` in prod."
}

variable "coder_public_url" {
  type        = string
  default     = ""
  description = "Browser-facing Coder URL. Used only to rewrite Coder's generated agent bootstrap script to the internal agent URL."
}

variable "agent_coder_url" {
  type        = string
  default     = ""
  description = "URL workspace containers use to download/connect the Coder agent. Defaults to http://coder.<sandbox_domain> on the shared Docker network."
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

###############################################################################
# Locals — build the public URLs Coder publishes for each listening port via
# its native wildcard access URL feature. Format:
#   {port}--{agent}--{workspace}--{user}.{wildcard_apps_domain}
# Coder serves these under CODER_WILDCARD_ACCESS_URL = *.{wildcard_apps_domain}.
# The shared session cookie at .{sandbox_domain} authenticates the request, so
# clicking from the onboarding dashboard skips Coder's login form.
#
# Workspace names are constrained to [a-z0-9-]{3,32}; usernames are constrained
# the same way by Coder. Both are DNS-label-safe.
###############################################################################

locals {
  ws_name    = lower(data.coder_workspace.me.name)
  owner_name = data.coder_workspace_owner.me.name

  # Coder wildcard URLs for the workspace services. The edge proxy only needs
  # a single `*.apps.<DOMAIN>` route that forwards to Coder.
  code_url   = "${var.proxy_scheme}://13337--main--${local.ws_name}--${local.owner_name}.${var.wildcard_apps_domain}${var.proxy_port_suffix}"
  app_url    = "${var.proxy_scheme}://3000--main--${local.ws_name}--${local.owner_name}.${var.wildcard_apps_domain}${var.proxy_port_suffix}"
  splash_url = "${var.proxy_scheme}://4000--main--${local.ws_name}--${local.owner_name}.${var.wildcard_apps_domain}${var.proxy_port_suffix}"

  public_coder_url        = var.coder_public_url != "" ? trimsuffix(var.coder_public_url, "/") : "${var.proxy_scheme}://coder.${var.sandbox_domain}${var.proxy_port_suffix}"
  agent_coder_url         = var.agent_coder_url != "" ? trimsuffix(var.agent_coder_url, "/") : "http://coder.${var.sandbox_domain}"
  selected_sandbox_preset = local.sandbox_preset_options[data.coder_parameter.sandbox_preset.value]

  # Coder generates the bootstrap script from CODER_ACCESS_URL, which is the
  # browser-facing HTTPS URL. Local workspace containers resolve lvh.me names
  # on Docker DNS, so they should use the internal HTTP listener instead of
  # trying HTTPS on the Coder container's :443.
  agent_init_script = replace(coder_agent.main.init_script, local.public_coder_url, local.agent_coder_url)
  workspace_startup_script = templatefile("${path.module}/files/workspace-startup.sh.tftpl", {
    sandbox_preset      = data.coder_parameter.sandbox_preset.value
    sandbox_preset_name = local.selected_sandbox_preset.display_name
    bootstrap_command   = local.selected_sandbox_preset.bootstrap_command
    app_url             = local.app_url
    database_host       = "workspace-pg"
  })
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

###############################################################################
# coder_app links — surfaced in the Coder UI and in our onboarding app.
###############################################################################

resource "coder_app" "code-server" {
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
  # Browser hits the wildcard URL on port 4000; Coder proxies into the
  # workspace container.
  external = true
  url      = local.splash_url
  icon     = "/icon/widgets.svg"
  open_in  = "tab"
}

resource "coder_app" "app" {
  agent_id     = coder_agent.main.id
  slug         = "app"
  display_name = "Mercato App"
  # Browser hits the wildcard URL on port 3000; Coder proxies into the
  # workspace container.
  external = true
  url      = local.app_url
  icon     = "/icon/widgets.svg"
  open_in  = "tab"
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

# Persistent volume for the sidecar postgres data dir. Without this, every
# `docker container restart` (e.g. workspace stop/start cycle, or a `docker
# compose up -d` on the host that recreates the container) would lose all
# Mercato app data — products, orders, tenants, the whole DB.
#
# Naming mirrors the home volume (`coder-<workspace_id>-pg-data`) so that
# `docker volume ls` makes the relationship obvious to operators. The
# `lifecycle.ignore_changes` block means terraform will NEVER destroy this
# volume on a template upgrade — only an explicit `docker volume rm` (or
# `coder workspace delete`, which Coder runs through its own cleanup) can
# remove it.
resource "docker_volume" "pg_data" {
  name = "coder-${data.coder_workspace.me.id}-pg-data"

  lifecycle {
    ignore_changes = all
  }
}

# Private network for the workspace ↔ sidecar postgres traffic.
resource "docker_network" "workspace" {
  name = "coder-${data.coder_workspace.me.id}-net"
}

# Pre-existing shared network (created by docker-compose.yml as
# `mercato-proxy`). The shared edge proxy and Coder both live on it.
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

  # Persistent data dir — survives container recreate / template upgrade.
  # See docker_volume.pg_data above for the lifecycle guarantee.
  volumes {
    container_path = "/var/lib/postgresql/data"
    volume_name    = docker_volume.pg_data.name
    read_only      = false
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
# entrypoint = agent init script.
#
# Two networks:
#   * docker_network.workspace  → talks to sidecar postgres (workspace-pg)
#   * mercato-proxy             → agent reaches Coder via the
#                                 `coder.<sandbox_domain>` Docker DNS alias
#                                 directly over the docker network
#
# No edge-proxy labels are emitted on this container. Workspace ports are reached
# through Coder's wildcard access URL (`*.{wildcard_apps_domain}`); Coder
# itself proxies the browser → workspace port hop. The edge proxy only routes the
# `*.apps.<DOMAIN>` host header to Coder — it does not need to know
# anything per-workspace.
###############################################################################

resource "docker_container" "workspace" {
  count = data.coder_workspace.me.start_count

  image    = "mercato-workspace:latest"
  name     = "coder-${data.coder_workspace_owner.me.name}-${lower(data.coder_workspace.me.name)}"
  hostname = data.coder_workspace.me.name
  memory   = 16384

  # Browser traffic uses HTTPS via nginx, but the agent bootstrap runs inside
  # Docker. Rewriting the generated script to local.agent_coder_url lets fresh
  # workspaces download/connect the agent over the shared Docker network.
  entrypoint = ["sh", "-c", local.agent_init_script]

  env = [
    "CODER_AGENT_TOKEN=${coder_agent.main.token}",
    "ANTHROPIC_BASE_URL=https://openrouter.ai/api",
    "ANTHROPIC_API_KEY=",
  ]

  # Private network for postgres sidecar.
  networks_advanced {
    name    = docker_network.workspace.name
    aliases = ["workspace"]
  }

  # Shared proxy network — the edge proxy reaches us by container name.
  networks_advanced {
    name    = data.docker_network.proxy.name
    aliases = [data.coder_workspace.me.name]
  }

  host {
    host = "host.docker.internal"
    ip   = "host-gateway"
  }

  # NOTE: do NOT pin coder.<sandbox_domain> in /etc/hosts here. The workspace
  # is on the shared `mercato-proxy` network where the coder service has the
  # alias `coder.<sandbox_domain>` (set in docker-compose.yml). Letting Docker
  # DNS resolve the name means the agent reaches Coder directly via the docker
  # network, independent of browser-facing TLS termination.

  volumes {
    container_path = "/home/coder"
    volume_name    = docker_volume.home.name
    read_only      = false
  }

  # Coder bookkeeping labels.
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
