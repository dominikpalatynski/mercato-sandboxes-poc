# Custom caddy-docker-proxy image with a DNS-01 ACME plugin baked in.
#
# Why a custom build:
#   * caddy-docker-proxy is what we use locally to read docker labels off each
#     workspace container (see docker-compose.yml `caddy` service). The stock
#     image only ships the HTTP-01 / TLS-ALPN-01 challenges.
#   * In production we want a SINGLE wildcard cert (*.sandbox.openmercato.com)
#     so that every new workspace gets HTTPS instantly without ACME round-trips
#     per subdomain — and so we don't get rate-limited by Let's Encrypt when a
#     burst of sandboxes is created.
#   * Wildcard certs require DNS-01, which requires a DNS provider plugin
#     (caddy-dns/cloudflare by default, swappable via DNS_PROVIDER build arg).
#
# Two-stage build:
#   1. builder stage: use the official caddy:builder image to xcaddy-compile
#      caddy + caddy-docker-proxy plugin + DNS provider plugin into one binary.
#   2. runtime stage: drop the binary into the lucaslorentz/caddy-docker-proxy
#      base image so we keep the proxy entrypoint + healthcheck.
#
# Build:
#   docker build --build-arg DNS_PROVIDER=cloudflare -t mercato-caddy ./caddy
#
# Verify both plugins are present:
#   docker run --rm --entrypoint caddy mercato-caddy list-modules | grep -E "(cloudflare|docker)"
# Should print:
#   dns.providers.cloudflare
#   docker_proxy

ARG CADDY_VERSION=2.10.0
ARG DNS_PROVIDER=cloudflare

###############################################################################
# Stage 1 — xcaddy-compile caddy with the docker-proxy + DNS provider plugins.
###############################################################################
FROM caddy:${CADDY_VERSION}-builder AS builder

ARG DNS_PROVIDER
ARG CADDY_DOCKER_PROXY_VERSION=v2.10.0

# Build caddy with:
#   * lucaslorentz/caddy-docker-proxy — reads docker labels (workspace vhosts)
#   * caddy-dns/${DNS_PROVIDER}      — DNS-01 for the wildcard cert
#
# Pinned versions so a CI rebuild doesn't silently bump caddy. To upgrade,
# change the ARG above (and re-run the e2e suite).
RUN xcaddy build \
      --with github.com/lucaslorentz/caddy-docker-proxy/v2@${CADDY_DOCKER_PROXY_VERSION} \
      --with github.com/caddy-dns/${DNS_PROVIDER}

###############################################################################
# Stage 2 — drop the custom binary into the caddy-docker-proxy runtime image.
###############################################################################
FROM lucaslorentz/caddy-docker-proxy:2.10-alpine

# Replace the stock caddy binary with the one built above (same path).
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Sanity-check the new binary at build time — `caddy version` will fail loudly
# if the binary is missing the docker-proxy entrypoint or DNS plugin.
RUN caddy version && caddy list-modules | grep -E "caddy.listeners.http"
