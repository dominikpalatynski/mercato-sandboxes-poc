###############################################################################
# Mercato Sandbox — Coder template (per SPEC.md §3 / §7)
#
# One workspace = one sidecar postgres + one mercato-workspace container on a
# private docker network. The agent's startup script scaffolds the Mercato
# app on first boot and runs `yarn setup` on every boot.
#
# Networking model:
#   * Each workspace container is attached to the shared `mercato-proxy`
#     docker network so Traefik (the single edge proxy declared in
#     docker-compose.yml) can reach :3000 / :4000 / :13337 by container alias.
#   * Traefik discovers each workspace via docker labels and publishes:
#         <workspace>.<SANDBOX_DOMAIN>           → app on :3000
#         <workspace>-splash.<SANDBOX_DOMAIN>    → splash on :4000
#         <workspace>-code.<SANDBOX_DOMAIN>      → code-server on :13337
#     For local dev SANDBOX_DOMAIN defaults to `lvh.me` (resolves to 127.0.0.1
#     for any subdomain — no /etc/hosts hacks). For prod set it to e.g.
#     `sandbox.openmercato.com` with a wildcard DNS A record + DNS-01 wildcard
#     cert via Traefik's cloudflare resolver.
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

variable "proxy_scheme" {
  type        = string
  default     = "http"
  description = "Scheme Traefik publishes URLs on (http for local lvh.me dev, https in prod with ACME)."
}

variable "proxy_port_suffix" {
  type        = string
  default     = ""
  description = "Optional port suffix appended to user-facing URLs (e.g. ':8080' if you can't bind 80). Empty for standard 80/443."
}

variable "traefik_entrypoint" {
  type        = string
  default     = "web"
  description = "Traefik entrypoint name to expose workspace services on. `web` for HTTP-only dev; `websecure` in prod (TLS terminated by Traefik via the cloudflare DNS-01 wildcard cert configured on the entrypoint)."
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
  ws_name     = lower(data.coder_workspace.me.name)
  app_host    = "${local.ws_name}.${var.sandbox_domain}"
  splash_host = "${local.ws_name}-splash.${var.sandbox_domain}"
  code_host   = "${local.ws_name}-code.${var.sandbox_domain}"
  app_url     = "${var.proxy_scheme}://${local.app_host}${var.proxy_port_suffix}"
  splash_url  = "${var.proxy_scheme}://${local.splash_host}${var.proxy_port_suffix}"
  code_url    = "${var.proxy_scheme}://${local.code_host}${var.proxy_port_suffix}"

  # Traefik labels for this workspace. We build a single map and emit it via a
  # `dynamic "labels"` block on docker_container.workspace below so the schema
  # stays readable. Naming convention: <ws>-<svc> for routers and services.
  workspace_labels = {
    "traefik.enable"             = "true"
    "traefik.docker.network"     = "mercato-proxy"

    # ---- App on :3000 → <ws>.<domain> -------------------------------------
    # NB: with >1 service on a single container Traefik can't auto-link the
    # router → service, so each router must explicitly name its service.
    "traefik.http.routers.${local.ws_name}-app.rule"                              = "Host(`${local.app_host}`)"
    "traefik.http.routers.${local.ws_name}-app.entrypoints"                       = var.traefik_entrypoint
    "traefik.http.routers.${local.ws_name}-app.service"                           = "${local.ws_name}-app"
    "traefik.http.services.${local.ws_name}-app.loadbalancer.server.port"         = "3000"

    # ---- Splash on :4000 → <ws>-splash.<domain> ---------------------------
    "traefik.http.routers.${local.ws_name}-splash.rule"                           = "Host(`${local.splash_host}`)"
    "traefik.http.routers.${local.ws_name}-splash.entrypoints"                    = var.traefik_entrypoint
    "traefik.http.routers.${local.ws_name}-splash.service"                        = "${local.ws_name}-splash"
    "traefik.http.services.${local.ws_name}-splash.loadbalancer.server.port"      = "4000"

    # ---- code-server on :13337 → <ws>-code.<domain> -----------------------
    # Strip Accept-Encoding upstream + Sec-WebSocket-Extensions downstream so
    # neither gzip nor permessage-deflate get negotiated. Without this,
    # code-server's extension-host WS stream gets corrupted (Z_DATA_ERROR).
    "traefik.http.routers.${local.ws_name}-code.rule"                             = "Host(`${local.code_host}`)"
    "traefik.http.routers.${local.ws_name}-code.entrypoints"                      = var.traefik_entrypoint
    "traefik.http.routers.${local.ws_name}-code.service"                          = "${local.ws_name}-code"
    "traefik.http.routers.${local.ws_name}-code.middlewares"                      = "${local.ws_name}-code-noenc@docker"
    "traefik.http.services.${local.ws_name}-code.loadbalancer.server.port"        = "13337"
    "traefik.http.middlewares.${local.ws_name}-code-noenc.headers.customrequestheaders.Accept-Encoding"   = ""
    # Strip Sec-WebSocket-Extensions in BOTH directions: stripping only the
    # response confirmation isn't enough — the upstream still encodes frames
    # as permessage-deflate and the browser barfs (Z_DATA_ERROR / RSV1).
    "traefik.http.middlewares.${local.ws_name}-code-noenc.headers.customrequestheaders.Sec-WebSocket-Extensions"  = ""
    "traefik.http.middlewares.${local.ws_name}-code-noenc.headers.customresponseheaders.Sec-WebSocket-Extensions" = ""

    # ---- Coder bookkeeping (preserved from the previous template) ---------
    "coder.owner"          = data.coder_workspace_owner.me.name
    "coder.owner_id"       = data.coder_workspace_owner.me.id
    "coder.workspace_id"   = data.coder_workspace.me.id
    "coder.workspace_name" = data.coder_workspace.me.name
  }
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
      # Public URL of THIS sandbox served via Caddy. Setting APP_URL and
      # NEXT_PUBLIC_APP_URL lets Mercato:
      #   1. derive Next 15's allowedDevOrigins (PR #1592) so HMR + font
      #      requests from open-mercato-1.sandbox.lvh.me aren't blocked
      #      cross-origin
      #   2. show the right external URL in the splash ("Aktualny adres")
      #      and any user-visible links — instead of localhost:3000
      sed -i "s#^APP_URL=.*#APP_URL=${local.app_url}#" .env || true
      grep -q '^APP_URL=' .env || echo "APP_URL=${local.app_url}" >> .env
      sed -i "s#^NEXT_PUBLIC_APP_URL=.*#NEXT_PUBLIC_APP_URL=${local.app_url}#" .env || true
      grep -q '^NEXT_PUBLIC_APP_URL=' .env || echo "NEXT_PUBLIC_APP_URL=${local.app_url}" >> .env
      yarn install
      # Bootstrap the agentic AI tooling (Claude Code / Codex / opencode wiring)
      # so the dev box is ready for prompt-driven coding from the first start.
      yarn mercato agentic:init >/tmp/mercato-agentic-init.log 2>&1 || true
    fi

    # 3. always: launch dev (yarn setup is idempotent — runs migrate + initialize, then dev)
    # Export APP_URL/NEXT_PUBLIC_APP_URL into the dev process's shell env so
    # next.config.ts (PR open-mercato#1592) sees them at config-load time —
    # .env alone isn't enough because mercato's dev launcher spawns next in a
    # child process whose process.env lacks the .env-only vars at that phase.
    cd "$HOME/app"
    export APP_URL="${local.app_url}"
    export NEXT_PUBLIC_APP_URL="${local.app_url}"
    nohup env APP_URL="${local.app_url}" NEXT_PUBLIC_APP_URL="${local.app_url}" yarn setup >/tmp/mercato-dev.log 2>&1 &
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
  # external = true → Coder doesn't proxy code-server's WS at all; the browser
  # hits the workspace directly via Traefik on `<ws>-code.<domain>`. This is
  # the same model Codespaces uses (VS Code talks directly to the workspace,
  # not through the control plane), and it avoids permessage-deflate / yamux
  # double-framing problems that plague any WS-through-proxy chain.
  external = true
  url      = "${local.code_url}/?folder=/home/coder/app"
  icon     = "/icon/code.svg"
  open_in  = "tab"
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

  # The agent's init script uses CODER_ACCESS_URL (= http://coder.sandbox.lvh.me)
  # which Docker DNS resolves to the coder container's IP on mercato-proxy.
  # Coder listens on :80 inside that container (see CODER_HTTP_ADDRESS in
  # docker-compose.yml), so the agent reaches it directly without going through
  # Traefik. No localhost rewrite needed.
  entrypoint = ["sh", "-c", coder_agent.main.init_script]

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

  # Shared proxy network — Traefik reaches us by container name.
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
  # DNS resolve the name means the agent reaches Coder DIRECTLY via the docker
  # network, bypassing Traefik. This is critical: Traefik can't reliably strip
  # `Sec-WebSocket-Extensions`, and Coder's nhooyr.io/websocket negotiates
  # permessage-deflate → RSV1 frames → yamux "unexpected rsv bits" → agent
  # dies seconds after connecting.

  volumes {
    container_path = "/home/coder"
    volume_name    = docker_volume.home.name
    read_only      = false
  }

  # All Traefik + bookkeeping labels are defined in `local.workspace_labels`
  # above; emit them via a single dynamic block.
  dynamic "labels" {
    for_each = local.workspace_labels
    content {
      label = labels.key
      value = labels.value
    }
  }
}
