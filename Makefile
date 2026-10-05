# AeroPulse — one-command developer workflow
PY      := backend/.venv/bin/python
UV      := $(shell command -v uv 2>/dev/null)
NPM     := npm --prefix frontend

.PHONY: dev setup seed train test test-backend test-frontend lint screenshots smoke demo clean-data

dev: setup ## Run API (:8000) + web app (:5173); seeds and trains on first run
	@bash scripts/dev.sh

setup: backend/.venv/.ok frontend/node_modules/.ok

backend/.venv/.ok: backend/pyproject.toml
	@echo "▸ Creating Python environment"
	@if [ -n "$(UV)" ]; then cd backend && uv venv .venv -p 3.11 -q && uv pip install -q -p .venv/bin/python -e ".[dev]"; \
	else python3 -m venv backend/.venv && backend/.venv/bin/pip install -q -e "backend[dev]"; fi
	@touch $@

frontend/node_modules/.ok: frontend/package.json
	@echo "▸ Installing web dependencies"
	@$(NPM) install --no-audit --no-fund --silent
	@touch $@

seed: setup ## (Re)generate the simulated fleet database
	@cd backend && .venv/bin/python -m app.seed.generate

train: setup ## Train RUL quantile models + anomaly detector on C-MAPSS
	@cd backend && .venv/bin/python -m app.ml.train_rul

test: test-backend test-frontend ## Run all checks

test-backend: setup
	@cd backend && .venv/bin/ruff check . && .venv/bin/python -m pytest -q

test-frontend: setup
	@$(NPM) run -s typecheck && $(NPM) run -s lint && $(NPM) run -s test

lint: setup
	@cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	@$(NPM) run -s lint

screenshots: setup ## Playwright screenshots of every page at 1440x900 and 390x844
	@bash scripts/screenshots.sh

smoke: setup ## Playwright: every route renders with no console errors; every role sees exactly its pages
	@bash scripts/screenshots.sh --smoke
	@node frontend/scripts/roles-smoke.mjs

demo: setup ## Run the Guided Demo end-to-end in a headless browser (needs `make dev` running)
	@node frontend/scripts/demo-run.mjs

clean-data:
	rm -f data/aeropulse.db data/aeropulse.db-*
