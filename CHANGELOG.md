# Changelog

All notable changes are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

Versions in `backend/pyproject.toml` and `frontend/package.json` must match, enforced in CI by `scripts/check-version-sync.py`. Use `make release V=<version>` to update both and insert a stub for the next section.

<!-- next -->

## Unreleased · Story v2

- Coexisting v1/v2 stories, separate free-action and AI-task budgets, recently played saves, draft protection, and redacted request paths.
- Three-act action catalog, explicit automatic intents, confirmation of consequential proposals, notice verification/joint communication, and partner-relationship branches.
- Guest trials, server-side OAuth state binding and deferred migration, independent business snapshots, branch replay, and fact-referenced reflections.
- Reviewed perspective cards, content-hash caching, server-filled sources, editable draft citations, and local takeaway cards.
- Responsive WebP, a persistent budget ledger, recycle-bin/checkpoint cleanup, diagnostics/operations queries, and ninety semantic evaluation cases.
- Migrations 0004–0007, synchronized contracts, and regressions. See `docs/product-v2-release.md` for release, maintenance, and rollback.
- Real-model evaluation for the new version, partner OAuth, off-host deployment, and target-user research remain release gates.

## 0.1.0 - Unreleased

First usable version: a three-act workplace interactive narrative with three independent Deep Agents, SSE turn responses, and PostgreSQL for game facts and Agent checkpoints.

### Added

- Turn submission, idempotency through unique `(save_id, request_id)`, optimistic version checks, and pessimistic row locks.
- Per-turn timeouts, process-local concurrency budgets, and daily per-user quotas.
- Startup cleanup plus 15-second periodic recovery of stale turns; failed turns marked `retryable` while retaining committed game events.
- Public Zhihu data import CLI (`python -m app.zhihu_import`).
- Deterministic DeepSeek-compatible mock (`backend/app/mock_llm.py`) enabling the complete Agent graph offline.
- Single-server Docker Compose deployment, same-origin nginx proxying, and TLS overlay.
- CI gates for lock/hashed-export drift, Alembic migrations/schema drift, OpenAPI→TypeScript contracts, process-crash recovery, backup restoration, and desktop/mobile Playwright E2E.

### Engineering

- Initialized Git. Hardened `.gitignore` before the first commit to exclude `doc-fetch-resources/` (private source-document cache), dotenv files, `artifacts/`, and `*.pem`.
- Tightened root `.env` and `artifacts/tls/*.pem` permissions from 644 to 600; aligned root `.env` and `.env.example` variable sets.
- Resolved `Settings.env_file` relative to `__file__`, removing working-directory-dependent configuration loading.
- Updated `.dockerignore` so the frontend-only build context excludes backend sources and private document caches.
- Added `Makefile` as the source of truth for local tasks, with CI using its relevant gates. `make doctor` checks the toolchain and enables versioned Git hooks.
- Added `SECURITY.md` and `CHANGELOG.md`.
- `scripts/githooks/pre-commit` blocks prefix/suffix dotenv names, private keys, `doc-fetch-resources/`, and blobs over 400 KB, and runs Ruff on staged Python. It uses `core.hooksPath` instead of the pre-commit framework, which conflicts with the no-virtual-environment constraint.
- Added `audit.yml`: full-history Gitleaks scanning, an assertion that `doc-fetch-resources/` never entered Git, `uv audit`, `pnpm audit`, and Trivy filesystem/image scans. Tools use checksum-verified binaries rather than third-party Actions.
- `scripts/check-version-sync.py` enforces matching backend/frontend versions so tags provide unambiguous rollback targets.
- Expanded Ruff rules from `["E","F","I"]` to `["E","F","I","B","UP","SIM","RUF","S","ASYNC","PTH"]`. Globally ignored `RUF001/002/003` because Chinese full-width punctuation is intentional typography, not a homoglyph attack. `extend-immutable-calls` permits FastAPI's `Depends` under `B008`.
- Enabled strict mypy across `app/`; Agent-related third-party libraries use a documented burn-down override list.
- Added frontend `typecheck` and `format:check` scripts that CI already referenced, plus `.prettierrc`, `.prettierignore`, and `.nvmrc`. Enabled type-aware ESLint and jsx-a11y. Included `e2e/`, `vitest.config.ts`, and `playwright.config.ts` in tsconfig and enabled `noUncheckedIndexedAccess`.
- Added return annotations to five previously empty response schemas (`"schema": {}`): health, config, story, events, and auth logout. Regenerated frontend contracts.
- **Fixed a dependency declaration gap:** Authlib's OAuth client prefers `httpx2` and deprecates its `httpx` fallback, but declares neither. Previously `httpx2` arrived only through `deepagents → anthropic / langsmith`, making Zhihu login depend on a fragile transitive dependency. Declared `httpx2>=2.12` directly.
- **Made coverage an actual gate:** `fail_under = 77.0` was configured but neither `make test-py` nor CI used `--cov`. Both now collect coverage, with CI archiving `coverage.xml`. The 77.0 floor, rather than measured 84.9 line coverage, accounted for `branch = true` forcing the settrace core on Python 3.13, which underreports synchronous lines in coroutines repeatedly suspending inside one `async with`. Raw `sys.settrace` probes and coverage's sysmon core confirmed a tool defect rather than missing tests. Analysis is beside the setting in `backend/pyproject.toml`.
- Added structural test isolation: an autouse fixture in `backend/tests/conftest.py` truncates all tables except `alembic_version` and `checkpoint_migrations` before each non-unit test. Random ordering had previously passed because dev_login generated a new identity each time; isolation is now a fixture guarantee instead of an endpoint side effect.
- Split tests with `unit` / `integration` markers (10 + 14). `pytest -m unit` was verified with PostgreSQL completely stopped.
- Made load testing a CI gate. `scripts/load-test.py` accepts environment-configured base URL, concurrency levels, p95 budget, and report path. Integration runs it through stdin inside the API container, which already has locked httpx, without installing host Python. Reports are copied out with `docker compose cp`. Negative checks confirmed exit 1 and named excessive levels with a 0.5-second p95 budget; a `deepseek` target was refused without writing a report.
- Set `MAX_CONCURRENT_TURNS=64` in `compose.ci.yaml`: the default 30 exactly matched the highest load level, leaving no scheduling headroom and causing incidental 429s. Production remains 30. `test_exhausted_admission_budget_rejects_without_reserving` deterministically covers admission rejection with budget zero, asserting 429 without a leftover reservation.
- Unified host DSNs. Like migrations, `make api` could inherit Compose-internal DATABASE_URL/CHECKPOINT_URL from root `.env` and fail during hostname/SSL setup on the host. Generalized `MIGRATE_DATABASE_URL` into overridable `HOST_DATABASE_URL` / `HOST_CHECKPOINT_URL`, shared by both targets. Verified begin/boundary/next/speak and request_id checkpoint replay through `make api`.
- **Fixed silently skipped frontend tests:** `include: ["src/**/*.test.ts"]` omitted `.tsx`. Changed it to `.test.{ts,tsx}` and added jsdom, Testing Library, and MSW. Test count rose from two to **54**, covering Play submission/recovery, SceneInterlude's modal state machine, store, scenes, and every `api()` / `sendTurn()` error branch, including SSE split across chunks and actual `TextDecoder(stream: true)` reassembly.
- Added frontend coverage gates at measured baselines: statements/lines `70.85%`, branches `90.9%`, functions `71.79%`. `src/api.ts` separately requires 100%, preventing new untested HTTP branches from hiding in global averages. CI now runs `pnpm test:coverage`. `src/main.tsx` intentionally remains in the denominator at 0% because the composition root is covered only by Playwright; excluding it would merely improve reported numbers.
- Negatively tested both fallback gates: changing `api()` fallback copy caused five failures and exit 1; changing `sendTurn()` fallback copy caused exactly one. They are independent. Files were restored byte-for-byte and SHA-256 verified.
- Added `coverage/` to `.gitignore`, since `.coverage` and `htmlcov/` do not match Vitest V8 reports. Added `allowBuilds: msw: false` to `pnpm-workspace.yaml`, without which pnpm 11 frozen installation failed with `ERR_PNPM_IGNORED_BUILDS`.
