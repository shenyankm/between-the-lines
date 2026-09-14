# Contributing

Contributions to 章外回声 are welcome: report problems, improve the story and interactions, add tests and documentation, or fix engineering issues. The project uses React, FastAPI, PostgreSQL, and Deep Agents. Start with the [README](README.md) for the player experience and product boundaries.

This guide follows the organization of the [Qwen Code contribution guide](https://github.com/QwenLM/qwen-code/blob/main/CONTRIBUTING.md), with commands and conventions adapted to this repository.

## Contribution process

### Issues and proposals

Search existing issues and PRs before starting. A bug report should include reproduction steps, expected and actual behavior, environment details, and redacted logs or screenshots. For save or turn-recovery problems, include the story version, act, and whether a refresh or disconnection occurred. Do not publish private conversations, session cookies, or keys.

Use the [bug report form](.github/ISSUE_TEMPLATE/bug_report.yml) for defects and the [feature or improvement form](.github/ISSUE_TEMPLATE/feature_request.yml) for proposals, including story, interaction, documentation, and refactoring work. A blank issue remains available when neither form fits. Unknown technical details can be marked as such.

Discuss new features, large refactors, story-direction changes, and model-boundary changes in an issue with the maintainer first. Small documentation corrections and clear local fixes can go directly to a PR with an explanation. An already agreed task does not need another round of routine confirmation.

### Pull requests

All changes must be submitted through a GitHub PR for maintainer review before merging, including documentation, tests, configuration, dependency updates, and urgent fixes. Work on a separate branch; do not push changes directly to `main`.

Merge only after CI has passed for the PR's latest commit and all required checks are successful. Pending, failed, cancelled, or missing checks block merging. After adding commits or updating the branch, wait for CI to pass again; an earlier commit's successful run is not sufficient. Do not bypass this process with direct pushes, force pushes, or administrator overrides.

- Keep each PR focused on one problem or complete feature. Separate unrelated formatting, dependency upgrades, and refactors.
- Link an existing issue, or provide enough background and reproduction details in the PR itself.
- Use a Draft PR for unfinished work and describe what remains.
- Explain the observable behavior change, why the approach was chosen, and compatibility implications.
- Include screenshots or a short video for UI, story, or interaction changes, covering relevant desktop or mobile scenarios. Internal changes can state that there is no visible change.
- Update affected documentation, tests, and generated files. Report checks actually run and their results, with reasons for skipped checks. Mock results do not replace real-model or OAuth acceptance.
- Review the final diff for temporary reports, credentials, and unrelated files.

Use descriptive commit messages and PR titles, preferably `type(scope): description`, for example:

```text
fix(game): retain unconfirmed turn requests after disconnection
feat(story): add progress-aware relationship hints
docs(contributing): document local verification
```

The [default PR template](.github/pull_request_template.md) prompts for the problem and resulting behavior, verification, a demo, and compatibility or operational impacts. Keep each section proportional to the change; state when a section does not apply and explain skipped checks.

## Development environment

### Toolchain

- Python 3.13 through the existing Miniconda interpreter. Do not create a `.venv` or a new Conda environment.
- Node.js 22.x is recommended to match project checks; it must satisfy `>=22.23.2` in `frontend/package.json`.
- pnpm 11.19.0, pinned in `frontend/package.json`, preferably invoked through Corepack.
- Git, GNU Make, uv, Docker, and Docker Compose.

Install backend dependencies from the hashed lock export. Do not use `uv sync` or `uv run`, which create virtual environments. Run frontend commands from `frontend/` so Corepack reads the correct version pin. The root [Makefile](Makefile) encapsulates these conventions.

### Initial setup

Clone this repository or your fork, then run:

```sh
git clone https://github.com/shenyankm/between-the-lines.git
cd between-the-lines
conda activate base
python -m pip install uv
make dev-up
make bootstrap
make migrate
```

`make bootstrap` installs locked dependencies and Playwright Chromium, and attempts to create the `btl_test` database. It first runs `make doctor`, which checks the toolchain and sets this repository's `core.hooksPath` to `scripts/githooks`. If you already use custom Git hooks, check whether they need integration. Docker must be running, and uv, Node.js, and Corepack must be available.

Start the services in two terminals at the repository root:

```sh
make api
```

```sh
make web
```

Open <http://localhost:5173>. `make api` uses mock mode and host database addresses. Development PostgreSQL listens on `localhost:54329`; do not use the container-only `db:5432` address with host Python.

See [development and deployment](docs/development.md) for local configuration, real DeepSeek integration, and Zhihu OAuth. Daily development uses mock and needs no real model key. The model is fixed to official `deepseek-flash`; provider, model, or invocation-boundary changes require a separate design discussion.

## Verification and workflow

### Code checks

Run these from the repository root:

| Command             | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `make lint`         | Python and frontend lint and formatting checks                        |
| `make typecheck`    | mypy and TypeScript checks                                            |
| `make test-py-unit` | Backend unit tests without PostgreSQL                                 |
| `make test`         | Backend unit/database tests and frontend tests                        |
| `make coverage`     | Backend and frontend coverage gates                                   |
| `make build`        | Production frontend build                                             |
| `make contract`     | Read-only generated-contract synchronization check                    |
| `make lock-check`   | Read-only backend lock/export consistency check                       |
| `make check`        | Lock, version, lint, types, tests, build, contracts, and schema drift |

Before database tests, confirm that `make bootstrap` created `btl_test`, then explicitly migrate it:

```sh
make migrate HOST_DATABASE_URL=postgresql+asyncpg://btl:btl@localhost:54329/btl_test
make check
make coverage
```

The schema-drift check in `make check` defaults to the development database, which must also have been migrated during setup. `make check` does not include frontend coverage, browser tests, or isolated-process integration checks. Passing it is not equivalent to passing all CI gates.

Backend tests default to the dedicated `btl_test` database. Non-unit tests truncate test tables. Set `BTL_TEST_DATABASE_URL` only to a disposable test database. Do not run tests, disconnection checks, or restart checks concurrently against the same database.

Match verification to the change: documentation-only changes need content, link, and command checks; code changes need relevant tests and applicable code gates before review. Do not lower coverage thresholds, exclude business modules, or weaken type checks to bypass failures.

### Browser and integration checks

For UI, complete story flows, or browser recovery changes, use the isolated stack:

```sh
make ci-stack
make test-e2e
```

Afterward, run `make ci-stack-down`. This deletes the isolated `btl-ci` stack and its volumes; it is not a development or production data cleanup command.

Turn execution, transaction, and recovery changes also require applicable disconnection/restart checks from the [CI guide](docs/ci.md). Capacity, storage, and deployment changes may require mock load tests, backup restoration, and container-runtime checks. See [verification records](docs/verification.md) and [operations](docs/operations.md) for procedures and reporting boundaries.

### Formatting, contracts, and dependencies

`make format` rewrites Python and frontend code. Review its diff to avoid unrelated changes. The versioned pre-commit hook performs only a subset of checks and does not replace tests or CI.

After changing response models, SSE structures, or public story projections, run:

```sh
make contract-generate
make contract
```

Commit affected `backend/openapi.json`, `frontend/src/generated/api.d.ts`, and exported story fixtures together. Regenerate from source definitions instead of patching generated output manually.

Use `make deps-update` for backend upgrades and review both `backend/uv.lock` and `backend/requirements.lock`. Update frontend dependencies inside `frontend/` with the pinned pnpm and commit both `package.json` and `pnpm-lock.yaml`. Run relevant checks and `make audit`; avoid unrelated upgrades.

## Project structure and conventions

| Path                      | Responsibility                                                              |
| ------------------------- | --------------------------------------------------------------------------- |
| `backend/app/`            | FastAPI routes, domain rules, turn execution, Agents, and story definitions |
| `backend/migrations/`     | Alembic database migrations                                                 |
| `backend/tests/`          | Backend unit, API, database, and compatibility tests                        |
| `frontend/src/`           | React pages, state management, and API client                               |
| `frontend/e2e/`           | Playwright browser flows                                                    |
| `frontend/public/assets/` | Scene, character, and other static assets                                   |
| `scripts/`                | Contract generation, verification, dependency, and operations tools         |
| `docs/`                   | Architecture, product, verification, and deployment documentation           |
| `.github/workflows/`      | CI, audit, and deployment workflows                                         |

Follow existing module responsibilities and type constraints. See the [architecture guide](docs/architecture.md). Preserve these invariants:

- Python and PostgreSQL adjudicate story rules, permissions and fact writes. Model output must not decide them directly.
- NPCs receive only role-visible information and have independent checkpoints. Public responses must not leak personas, internal prompts, reasoning, or tool arguments.
- Model calls do not hold long business transactions. Committed tool facts survive later model failures, disconnections, and restarts.
- Preserve request idempotency, per-save concurrency constraints, and terminal-state consistency. Query the original turn when the outcome is unknown; do not create a new request that repeats execution.
- Frontend recovery preserves original requests and player drafts, and isolates late results after navigation or user/save switches.
- Story and state changes account for legacy saves. Add Alembic migrations for schema changes and relevant upgrade/compatibility checks.
- Update documentation for story, relationship, and source-content changes. Distinguish editorial advice from sourced public content.

See the [error contract](docs/error-handling.md) for classification and recovery, and [relationships and endings](docs/story-relationships.md) for narrative compatibility.

## Documentation and debugging

Documentation is Markdown in the root and `docs/`, previewable in an editor or GitHub. Check relative links, code blocks, configuration fields, and command working directories. Do not describe design proposals or historical verification results as current implementation or current passing checks.

Reproduce locally with mock first, then inspect browser Network/Console output, API logs, and turn IDs. `make api` enables hot reload. Inspect Playwright reports and traces for browser failures. Real-model semantics, latency, cost, and OAuth require separate integration testing; mock validates only its simulated paths.

Do not commit `.env`, private keys, access tokens, database backups, or debugging artifacts containing private content. Use empty values or explicit placeholders in configuration examples and explain new settings. Follow [CI/CD documentation](docs/cicd.md) and the applicable release guide for deployment and releases. A PR submission does not itself authorize production deployment.
