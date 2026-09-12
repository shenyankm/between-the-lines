# Single source of truth for local tasks. CI runs a strict subset of `make check`.
#
# HARD CONSTRAINT: this project uses the host Miniconda interpreter and must not
# create a virtual environment. That rules out `uv sync` and `uv run` -- both
# build one. Dependencies are installed with:
#   uv pip install --python "$(command -v python)" --require-hashes -r backend/requirements.lock
# Do not add a target that creates .venv. `make doctor` fails if one appears.
#
# PNPM CONSTRAINT: the version is pinned by frontend/package.json
# ("packageManager": "pnpm@11.19.0"). corepack resolves that pin from the nearest
# package.json, so every frontend target below runs with `cd frontend`. Invoking
# pnpm from the repository root silently downloads the LATEST pnpm instead --
# measured at 12.4.1 against the pinned 11.19.0 -- which is exactly the toolchain
# drift CI exists to prevent.

SHELL := /bin/sh
.DEFAULT_GOAL := help

PYTHON   ?= python
UV       ?= uv
PNPM     ?= corepack pnpm
FRONTEND := frontend
BACKEND  := backend

# Every frontend invocation goes through this so the pinned pnpm is used.
fe = cd $(FRONTEND) && $(PNPM)

##@ General

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make \033[36m<target>\033[0m\n"} \
		/^[a-zA-Z0-9_.-]+:.*##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2} \
		/^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)}' $(MAKEFILE_LIST)

.PHONY: doctor
doctor: ## Verify the toolchain and enable versioned git hooks
	@echo "== interpreter =="
	@$(PYTHON) -c 'import sys; v=sys.version_info; assert (v.major,v.minor)==(3,13), f"need Python 3.13, got {v.major}.{v.minor}.{v.micro}"; print(f"python {v.major}.{v.minor}.{v.micro} OK")'
	@echo "== no virtual environment =="
	@test ! -e .venv || { echo "FAIL: .venv exists. This project uses the host interpreter; remove it."; exit 1; }
	@test ! -e $(BACKEND)/.venv || { echo "FAIL: backend/.venv exists; remove it."; exit 1; }
	@echo "== tools =="
	@for t in $(UV) node docker git; do \
		command -v $$t >/dev/null 2>&1 && echo "  $$t $$(command -v $$t)" || { echo "  FAIL: $$t not found"; exit 1; }; \
	done
	@command -v corepack >/dev/null 2>&1 || command -v pnpm >/dev/null 2>&1 \
		|| { echo "  FAIL: neither corepack nor pnpm found"; exit 1; }
	@node -v | grep -q '^v22\.' && echo "  node $$(node -v) OK" || echo "  WARN: expected node 22.x, got $$(node -v)"
	@echo "== pnpm resolves to the pinned version =="
	@resolved=$$($(fe) --version); \
	pinned=$$(sed -nE 's/.*"packageManager": *"pnpm@([^"]+)".*/\1/p' $(FRONTEND)/package.json); \
	if [ "$$resolved" = "$$pinned" ]; then echo "  pnpm $$resolved matches packageManager pin"; \
	else echo "  FAIL: pnpm resolved to $$resolved but package.json pins $$pinned"; \
	echo "        frontend targets must run via 'cd frontend' so corepack sees the pin"; exit 1; fi
	@echo "== git hooks =="
	@git rev-parse --git-dir >/dev/null 2>&1 || { echo "FAIL: not a git repository"; exit 1; }
	@current=$$(git config --local core.hooksPath 2>/dev/null || true); \
	if [ "$$current" = "scripts/githooks" ]; then \
		echo "  core.hooksPath already scripts/githooks"; \
	else \
		git config --local core.hooksPath scripts/githooks && echo "  set core.hooksPath=scripts/githooks"; \
	fi
	@test -x scripts/githooks/pre-commit || { echo "FAIL: scripts/githooks/pre-commit is not executable"; exit 1; }
	@echo "== secrets =="
	@test -f .env && { perms=$$(stat -f '%Lp' .env 2>/dev/null || stat -c '%a' .env); \
		[ "$$perms" = "600" ] && echo "  .env is 600 OK" || { echo "  FAIL: .env is $$perms, expected 600"; exit 1; }; } || echo "  .env absent (copy .env.example)"
	@echo "== database =="
	@docker compose ps --status running --services 2>/dev/null | grep -qx db \
		&& echo "  db container running" || echo "  WARN: db not running; start it with 'make dev-up'"
	@echo "doctor: OK"

.PHONY: bootstrap
bootstrap: doctor ## Install locked dependencies for backend and frontend
	$(UV) pip install --python "$$(command -v $(PYTHON))" --require-hashes -r $(BACKEND)/requirements.lock
	$(fe) install --frozen-lockfile
	$(fe) exec playwright install chromium
	@echo "Creating test database btl_test if absent (idempotent)"
	-docker compose exec -T db psql -U btl -d postgres -c 'CREATE DATABASE btl_test OWNER btl' 2>/dev/null
	@echo "bootstrap: OK. Next: make dev-up && make migrate"

##@ Development

.PHONY: dev-up
dev-up: ## Start PostgreSQL with the loopback port used by host-run tests
	docker compose -f compose.yaml -f compose.dev.yaml up -d db

.PHONY: dev-down
dev-down: ## Stop PostgreSQL, keeping the volume
	docker compose -f compose.yaml -f compose.dev.yaml down

# The root .env carries compose-internal DSNs (host "db", port 5432) that resolve
# only inside the compose network. Anything the host runs against that database
# must override them, or it dies mid-SSL-handshake on a hostname it cannot
# resolve. pytest is immune because tests/conftest.py pins both in os.environ
# before import and CI pins DATABASE_URL at job level; these targets need the
# same pin. compose.dev.yaml publishes the database on 54329 for exactly this.
HOST_DATABASE_URL   ?= postgresql+asyncpg://btl:btl@localhost:54329/btl
HOST_CHECKPOINT_URL ?= postgresql://btl:btl@localhost:54329/btl

.PHONY: migrate
migrate: ## Apply Alembic migrations
	cd $(BACKEND) && DATABASE_URL=$(HOST_DATABASE_URL) $(PYTHON) -m alembic upgrade head

.PHONY: migrate-check
migrate-check: ## Fail if the models drift from the committed schema
	cd $(BACKEND) && DATABASE_URL=$(HOST_DATABASE_URL) $(PYTHON) -m alembic upgrade head \
		&& DATABASE_URL=$(HOST_DATABASE_URL) $(PYTHON) -m alembic check

.PHONY: api
api: ## Run the API on the host in mock mode (no real LLM calls)
	cd $(BACKEND) && AGENT_MODE=mock DATABASE_URL=$(HOST_DATABASE_URL) \
		CHECKPOINT_URL=$(HOST_CHECKPOINT_URL) \
		$(PYTHON) -m uvicorn app.main:app --reload

.PHONY: web
web: ## Run the Vite dev server
	$(fe) dev

##@ Quality

.PHONY: lint
lint: lint-py lint-ts ## Lint backend and frontend

.PHONY: lint-py
lint-py:
	$(PYTHON) -m ruff check --config $(BACKEND)/pyproject.toml $(BACKEND)/app $(BACKEND)/tests $(BACKEND)/migrations scripts
	$(PYTHON) -m ruff format --config $(BACKEND)/pyproject.toml --check $(BACKEND)/app $(BACKEND)/tests $(BACKEND)/migrations scripts

.PHONY: lint-ts
lint-ts:
	$(fe) lint
	$(fe) format:check

.PHONY: format
format: ## Rewrite formatting (ruff fix + ruff format + prettier)
	$(PYTHON) -m ruff check --config $(BACKEND)/pyproject.toml --fix $(BACKEND)/app $(BACKEND)/tests $(BACKEND)/migrations scripts
	$(PYTHON) -m ruff format --config $(BACKEND)/pyproject.toml $(BACKEND)/app $(BACKEND)/tests $(BACKEND)/migrations scripts
	$(fe) format

.PHONY: typecheck
typecheck: typecheck-py typecheck-ts ## Type-check backend and frontend

.PHONY: typecheck-py
typecheck-py:
	cd $(BACKEND) && $(PYTHON) -m mypy app

.PHONY: typecheck-ts
typecheck-ts:
	$(fe) typecheck

.PHONY: test
test: test-py test-ts ## Run backend and frontend unit/integration tests

.PHONY: test-py
test-py:
	cd $(BACKEND) && $(PYTHON) -m pytest -q --cov=app --cov-report=term-missing

.PHONY: test-py-unit
test-py-unit: ## Unit tests only; passes with PostgreSQL stopped
	cd $(BACKEND) && $(PYTHON) -m pytest -q -m unit

.PHONY: test-ts
test-ts:
	$(fe) test

.PHONY: test-e2e
test-e2e: ## Playwright against the CI compose stack
	$(fe) exec playwright install chromium
	CI=true PLAYWRIGHT_BASE_URL=http://localhost:18080 $(fe) test:e2e

.PHONY: coverage
coverage: ## Coverage for backend and frontend against the committed floors
	cd $(BACKEND) && $(PYTHON) -m pytest -q --cov=app --cov-report=term-missing
	$(fe) test:coverage

.PHONY: build
build: ## Production frontend build (includes tsc)
	$(fe) build

.PHONY: contract
contract: ## Regenerate the OpenAPI and TypeScript contract; fail on drift
	$(PYTHON) scripts/export-openapi.py
	$(fe) generate:api
	git diff --exit-code -- $(BACKEND)/openapi.json $(FRONTEND)/src/generated/api.d.ts

.PHONY: lock-check
lock-check: ## Fail if uv.lock or the hashed export drift
	$(UV) lock --project $(BACKEND) --check
	$(UV) export --project $(BACKEND) --frozen --no-emit-project --format requirements-txt --output-file $(BACKEND)/requirements.lock --quiet
	git diff --exit-code -- $(BACKEND)/uv.lock $(BACKEND)/requirements.lock

.PHONY: version-check
version-check: ## Fail if backend and frontend versions disagree
	$(PYTHON) scripts/check-version-sync.py

.PHONY: check
check: lock-check version-check lint typecheck test build contract migrate-check ## Everything CI enforces, in CI order
	@echo "check: OK -- CI is a subset of this target"

##@ Dependencies and audit

.PHONY: deps-update
deps-update: ## Deliberately refresh the lockfile and hashed export
	cd $(BACKEND) && $(UV) lock && $(UV) export --frozen --no-emit-project --format requirements-txt --output-file requirements.lock --quiet
	$(UV) pip install --python "$$(command -v $(PYTHON))" --require-hashes -r $(BACKEND)/requirements.lock
	@echo "Review the diff, then run: make check"

.PHONY: audit
audit: ## Dependency vulnerability audit (backend and frontend)
	cd $(BACKEND) && $(UV) audit --frozen
	$(fe) audit --audit-level=high

##@ Operations

.PHONY: stack-up
stack-up: ## Build and start the full local stack (db + api + web)
	docker compose up --build -d --wait --wait-timeout 180

.PHONY: stack-down
stack-down:
	docker compose down

.PHONY: ci-stack
ci-stack: ## Reproduce the isolated CI integration stack locally
	COMPOSE_FILE=compose.ci.yaml COMPOSE_PROJECT_NAME=btl-ci COMPOSE_DISABLE_ENV_FILE=true \
		docker compose up --build -d --wait --wait-timeout 180

.PHONY: ci-stack-down
ci-stack-down:
	COMPOSE_FILE=compose.ci.yaml COMPOSE_PROJECT_NAME=btl-ci \
		docker compose down --volumes --remove-orphans

.PHONY: backup
backup: ## Dump PostgreSQL and copy it off-host (requires BACKUP_REMOTE)
	sh scripts/backup.sh

.PHONY: verify-restore
verify-restore: ## Restore drill; without FROM_BACKUP this validates mechanics only
	sh scripts/verify-restore.sh

.PHONY: load-test
load-test: ## Mock-mode load test; refuses to run against a real model
	$(PYTHON) scripts/load-test.py

##@ Release

.PHONY: release
release: ## Bump both versions and prepend a CHANGELOG stub: make release V=0.2.0
	@test -n "$(V)" || { echo "Usage: make release V=0.2.0"; exit 1; }
	$(PYTHON) scripts/bump-version.py "$(V)"
	@echo "Version set to $(V). Next steps:"
	@echo "  1. edit CHANGELOG.md, turning the stub into a real section"
	@echo "  2. make check"
	@echo "  3. git commit -am 'release: $(V)' && git tag -a v$(V) -m '$(V)'"
