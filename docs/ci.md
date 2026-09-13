# Continuous integration

`.github/workflows/ci.yml` defines backend, frontend, Docker integration, and aggregate gates. Daily verification uses mock, requires no real model keys, and does not publish or deploy. The audit workflow is `.github/workflows/audit.yml`; see [verification records](verification.md) for historical results.

## Code gates

- Backend: uv lock/hashed-export consistency, Ruff lint/format, strict mypy, Alembic migration and drift checks, and pytest. The coverage floor is 82%, including modules moved during the refactor.
- Frontend: frozen installation with pinned pnpm, type-aware ESLint, Prettier, TypeScript, Vitest coverage, and Vite build. Global thresholds remain in `vitest.config.ts`; all four metrics for the HTTP boundary `src/api.ts` require 100%.
- Contracts: OpenAPI, generated TypeScript, and public story fixtures are regenerated in a temporary directory and compared. `make contract` does not write to the workspace; use `make contract-generate` for explicit updates.
- Dependencies: `make lock-check` does not write to the workspace and ignores only temporary output paths in uv export comments. Use `make deps-update` for explicit updates.

`make check` runs the Makefile's code gates. Run `make coverage` separately for frontend coverage. Browser, disconnection, restart, load, and backup-restoration checks are independent integration gates. `make migrate-check` is read-only; explicitly migrate the target database first.

## Isolation

Local development uses the existing Miniconda Python 3.13 interpreter without a virtual environment. Run frontend commands from frontend so Corepack selects pnpm 11.19.0. CI uses a separate Python 3.13 installation and locked dependencies.

Non-unit backend tests use dedicated `btl_test`, clearing business and checkpoint tables before each test while retaining migration metadata. Migration tests downgrade to 0002, write legacy records for each act, then upgrade and verify reads, terminal replay, and unchanged original JSON. Never point tests at the demo database.

`scripts/test-disconnect.py` closes a real TCP subscription and verifies background completion without duplicate tools or dialogue. `scripts/test-restart.py` forcibly terminates an independent process after tool commit and verifies that restart recovery preserves facts and sessions. Run these sequentially, not alongside tests sharing btl_test.

## Containers and browsers

`compose.ci.yaml` does not load local .env. It starts PostgreSQL, API, and Nginx as the independent btl-ci project. Browsers access localhost:18080 and cover desktop/mobile completion, scene assets, interlude cancellation, drawer keyboard interaction, and refresh reconciliation. CI retains failure screenshots, traces, and reports.

```sh
make ci-stack
(cd frontend && corepack pnpm exec playwright install chromium)
(cd frontend && CI=true PLAYWRIGHT_BASE_URL=http://localhost:18080 corepack pnpm test:e2e)
export COMPOSE_FILE=compose.ci.yaml
export COMPOSE_PROJECT_NAME=btl-ci
export COMPOSE_DISABLE_ENV_FILE=true
docker compose exec -T web nginx -t
docker compose exec -T -e BTL_LOAD_TEST_REPORT=/tmp/load-test.json api python - < scripts/load-test.py
docker compose cp api:/tmp/load-test.json artifacts/load-test.json
sh scripts/verify-restore.sh
make ci-stack-down
```

Load tests use the real Agent graph with mock model transport, confirm mock mode first, and run 10/20/30 concurrent turns. Failure rate must be zero and p95 below the configured budget. Container tests connect directly to Uvicorn; Playwright covers Nginx. The isolated stack has a concurrency budget of 64; the application default remains 30. Deterministic tests cover quota rejection separately.

The restore script uses a temporary database without overwriting its source. `make ci-stack-down` removes only the isolated test stack and volumes. CI cleans up on success or failure and retains reports for seven days. Remote Actions results require verification of the actual run; local results are not substitutes.

## Audit repairs and runtime images

Historical secret scanning excludes only one verified fingerprint in `.gitleaksignore`: an empty API key falsely matching quota configuration across lines. Default rules and full-history scanning remain enabled; new credentials are not allowlisted by filename. Empty example values use inline comments to prevent multiline false matches.

The API retains Python 3.13 and the original dependency locks, using a digest-pinned Python 3.13.15 / Alpine 3.24 runtime with distribution security updates. Two Debian slim candidates still had unfixed system-package findings; unfixed vulnerabilities were not ignored. After hashed dependency installation, pip and ensurepip, including vendored dependencies, are removed. Runtime dependency installation is unsupported; rebuild the image for dependency changes. Local development continues using the existing Miniconda installation.

Web uses digest-pinned Nginx 1.30.4 / Alpine with security updates, running as UID/GID 101. PID and temporary data use /tmp; internal ports are 8080/8443, with unchanged external Compose ports. See README for TLS key permissions. `scripts/test-web-runtime.sh` uses isolated temporary certificates and volumes to verify non-root operation, HTTP redirects, HTTPS static pages, and API proxying.

Audit blocks HIGH/CRITICAL findings without vulnerability ignore lists. Both images are scanned and reports retained even if the first scan fails. The aggregate waits for all applicable jobs and accepts skipped only for events where image scanning was not scheduled. `scripts/test-audit.py` checks failure propagation and skip logic. Base digests are fixed, but apk security updates vary over time; future vulnerabilities can fail the audit and require another update and verification.

Historical local verification on 2026-09-13: Gitleaks full-history scanning passed; example negative cases and synthetic credential positive cases behaved as expected. Trivy 0.74.0 reported zero HIGH/CRITICAL findings for the filesystem and both final images. The Alpine API installed the original hashed lock successfully; 62 isolated backend unit tests passed, and 10/20/30-concurrency mock load tests had zero failures. Audit-gate tests covered 162 aggregate-state combinations and first/last-image failure propagation. Production TLS checks ran as UID 101.

The same verification found and fixed a game-page draft race: completion of an earlier turn now clears only an unchanged submitted draft, preserving new player input. The regression test failed before the fix and passed afterward. All 148 frontend tests, coverage, type, and lint checks passed. Remote execution results remain those of the Actions run after the push.
