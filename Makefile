# Mercato Sandboxes POC — convenience targets.
# All real logic lives in start.sh / stop.sh / reset.sh.

.PHONY: start stop reset ps logs config test help

help:
	@echo "Targets:"
	@echo "  make start   - bring up control plane (coder + postgres)"
	@echo "  make stop    - stop services (preserves volumes)"
	@echo "  make reset   - stop services AND wipe volumes (destructive)"
	@echo "  make ps      - docker compose ps"
	@echo "  make logs    - tail compose logs"
	@echo "  make config  - validate docker-compose.yml"
	@echo "  make test    - run Playwright e2e suite (stack must be up)"

start:
	./start.sh

stop:
	./stop.sh

reset:
	./reset.sh

ps:
	docker compose ps

logs:
	docker compose logs -f --tail=100

config:
	docker compose config

# Playwright e2e — assumes ./start.sh has already brought up the full stack.
# `playwright install chromium` only fetches the browser binary; system deps
# (--with-deps) are skipped because we don't need apt-get on macOS.
test:
	cd e2e && npm install --silent && npx playwright install chromium && npx playwright test
