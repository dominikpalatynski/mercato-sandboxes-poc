# Mercato Sandboxes POC — convenience targets.
# All real logic lives in start.sh / stop.sh / reset.sh.

.PHONY: start stop reset ps logs config help

help:
	@echo "Targets:"
	@echo "  make start   - bring up control plane (coder + postgres)"
	@echo "  make stop    - stop services (preserves volumes)"
	@echo "  make reset   - stop services AND wipe volumes (destructive)"
	@echo "  make ps      - docker compose ps"
	@echo "  make logs    - tail compose logs"
	@echo "  make config  - validate docker-compose.yml"

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
