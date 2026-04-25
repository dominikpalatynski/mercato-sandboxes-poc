###############################################################################
# Mercato Sandbox — Coder template (per SPEC.md §3 / §7)
#
# One workspace = one sidecar postgres + one mercato-workspace container on a
# private docker network. The agent's startup script scaffolds the Mercato
# app on first boot and runs `yarn setup` on every boot.
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
  url          = "http://localhost:4000"
  icon         = "/icon/widgets.svg"
  subdomain    = false
  share        = "authenticated"
  open_in      = "tab"
}

resource "coder_app" "app" {
  agent_id     = coder_agent.main.id
  slug         = "app"
  display_name = "Mercato App"
  url          = "http://localhost:3000"
  icon         = "/icon/widgets.svg"
  subdomain    = false
  share        = "authenticated"
  open_in      = "tab"

  healthcheck {
    url       = "http://localhost:3000/"
    interval  = 10
    threshold = 30
  }
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

resource "docker_network" "workspace" {
  name = "coder-${data.coder_workspace.me.id}-net"
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
  ]

  networks_advanced {
    name    = docker_network.workspace.name
    aliases = ["workspace"]
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
