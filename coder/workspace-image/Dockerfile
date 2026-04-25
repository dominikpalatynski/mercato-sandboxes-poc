# mercato-workspace — base image for Coder workspaces (one container per sandbox).
#
# Per SPEC.md §3 / §7: Debian-slim node 24 with the build deps Mercato needs
# (python3/make/g++ for native modules), psql + git + curl, plus code-server
# and corepack-pinned yarn 4.12.
#
# No ENTRYPOINT — Coder rewrites the agent init script as the entrypoint at
# runtime. CMD ["sleep","infinity"] is just a debuggable default for `docker run`.

FROM node:24-bookworm-slim

# OS deps + code-server + corepack/yarn, all as root before we drop privileges.
RUN sed -i 's|http://deb.debian.org|http://cloudfront.debian.net|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
 && sed -i 's|http://deb.debian.org|http://cloudfront.debian.net|g' /etc/apt/sources.list 2>/dev/null || true \
 && apt-get update \
 && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      ca-certificates \
      openssl \
      git \
      curl \
      bash \
      sudo \
      postgresql-client \
      procps \
      file \
 && rm -rf /var/lib/apt/lists/*

# Pin yarn 4.12 system-wide via corepack. We point COREPACK_HOME at a shared
# location so the non-root coder user (and any other user) sees the same
# "last known good" pin instead of falling back to the bundled yarn classic.
ENV COREPACK_HOME=/opt/corepack
RUN mkdir -p "$COREPACK_HOME" \
 && corepack enable \
 && corepack prepare yarn@4.12.0 --activate \
 && chmod -R a+rX "$COREPACK_HOME"

RUN curl -fsSL https://code-server.dev/install.sh | sh

# Non-root coder user (matches Coder agent expectations: uid 1000, passwordless sudo).
# node:24-bookworm-slim ships with a `node` user at uid 1000 — remove it first.
RUN userdel -r node 2>/dev/null || true \
 && useradd -m -u 1000 -s /bin/bash coder \
 && echo "coder ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/coder

USER coder
WORKDIR /home/coder

ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_OPTIONS=--max-old-space-size=8192 \
    OM_DEV_SPLASH_PORT=4000 \
    OM_DEV_AUTO_OPEN=0

EXPOSE 3000 4000 13337

CMD ["sleep", "infinity"]
