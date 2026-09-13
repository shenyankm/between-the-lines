# Repository Guidelines

## Project Structure & Module Organization

- `backend/app/`: FastAPI routes, domain rules, turn execution, NPC agents, and versioned story JSON.
- `backend/migrations/`: Alembic migrations; `backend/tests/`: pytest suites; `backend/evals/`: semantic evaluation fixtures.
- `frontend/src/`: React/TypeScript UI, state, API client, and colocated tests. `frontend/e2e/` contains Playwright flows; `frontend/public/assets/` holds artwork.
- `scripts/`: contract generation, validation, and operations tools. `docs/` documents architecture and deployment; `.github/workflows/` defines CI.

## Build, Test, and Development Commands

Use existing Miniconda Python 3.13; never create `.venv` or another Conda environment, or run `uv sync`/`uv run`. Use Node 22.x (at least 22.23.2) and pinned pnpm 11.19.0. Run Make targets from the repository root; direct Corepack/pnpm commands belong in `frontend/`.

- `make dev-up`: start local PostgreSQL on port 54329.
- `make bootstrap`: validate tools, configure Git hooks, and install locked dependencies.
- `make migrate`: migrate the development database.
- `make api` / `make web`: run the mock API and Vite in separate terminals.
- `make lint typecheck`: check style and types; `make format` rewrites formatting.
- `make build`: type-check and build production frontend assets.
- `make check`: run code gates, including tests, contracts, and schema drift. Run `make coverage` separately.

## Coding Style & Naming Conventions

Python uses four-space indentation, snake_case functions/modules, typed interfaces, Ruff (100-column formatting), and strict mypy. TypeScript uses two spaces, double quotes, semicolons, Prettier, and ESLint. Use PascalCase React components and camelCase functions/hooks. Regenerate API artifacts with `make contract-generate`; verify with `make contract`.

## Testing Guidelines

Use pytest `test_*.py`, colocated Vitest `*.test.ts(x)`, and Playwright `*.spec.ts`. `make test-py-unit` needs no database. Before `make test`, create and migrate disposable `btl_test`; see [CONTRIBUTING.md](CONTRIBUTING.md). Never share its tests concurrently. Use `make ci-stack` then `make test-e2e` for browser checks.

Preserve coverage floors: backend 82%; frontend lines/statements 70.85%, functions 71.79%, branches 90.9%; `src/api.ts` requires 100% across metrics. Mock results do not establish real-model or OAuth readiness.

## Commit & Pull Request Guidelines

Follow history’s `type(scope): description`, e.g. `fix(api): preserve interrupted turns`. Keep PRs focused; explain behavior, link relevant issues, report validation and skipped checks, and include screenshots for UI changes. Describe migration and save-compatibility impacts.

## Architecture & Security

Python/PostgreSQL own story facts and permissions. Preserve NPC isolation, committed facts, drafts, and old saves. Default to mock; real calls use DeepSeek `deepseek-flash`. Never commit credentials, `.env` files, or private dialogue.
