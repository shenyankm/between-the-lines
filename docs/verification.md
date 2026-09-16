# Verification

This is the reference for local checks and their CI coverage. [CONTRIBUTING](../CONTRIBUTING.md) covers setup and the development database. Results apply only to the tested commit and environment; a past passing run is not evidence for a new change.

## Code gates

`make check` runs lock/export and version checks, Ruff lint/format, mypy, TypeScript, backend and frontend tests, the frontend build, generated-contract comparisons, and read-only schema drift checks. It does not apply migrations: run `make migrate` first. Backend tests collect coverage; use `make coverage` for both backend and frontend coverage gates.

Coverage thresholds are defined in [backend configuration](../backend/pyproject.toml) and [Vitest configuration](../frontend/vitest.config.ts):

- Backend: 82% overall coverage with branch measurement enabled.
- Frontend: lines/statements 70.85%, functions 71.79%, branches 90.9%.
- HTTP boundary `src/api.ts`: 100% for all four metrics.

Do not lower thresholds or exclude business modules to make a change pass. `make contract` regenerates OpenAPI, TypeScript types, and public story fixtures in a temporary directory for comparison; `make contract-generate` updates the tracked outputs. `make lock-check` is also read-only.

## GitHub Actions

[CI](../.github/workflows/ci.yml) runs for PRs, pushes to `main`, and manual dispatch. It uses Python 3.13, Node 22.23.2, pinned pnpm, locked dependencies, and mock model transport.

| Job                            | Coverage                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend and API contract       | Locks, Ruff, mypy, fresh migrations/schema drift, pytest coverage, V2 semantic fixtures, deployment/audit gate tests, TCP disconnect, process restart, generated contracts |
| Frontend checks and build      | ESLint, Prettier, TypeScript, Vitest coverage, production build, asset/payload budgets                                                                                     |
| Docker and browser integration | Isolated Compose stack, non-root TLS smoke test, desktop/mobile E2E, Chromium/Firefox/WebKit responsive checks, load, backup restore, graceful shutdown                    |
| CI required                    | Requires all three jobs to succeed                                                                                                                                         |

[Audit](../.github/workflows/audit.yml) checks full Git history for secrets, dependency vulnerabilities, and filesystem findings. Container scans also run on `main`, schedules, and manual dispatch; they are intentionally skipped for PR events. HIGH/CRITICAL findings fail the audit. Its aggregate accepts skipped image checks only when image scanning was not scheduled. Do not expand secret or vulnerability exceptions to bypass a finding.

Images use the pinned Dockerfiles and distribution security updates. The API image removes pip and ensurepip after installing hashed dependencies; changing dependencies requires rebuilding. Audit packages scanned images only for pushes to `main`. Deployment requires successful CI and Audit for the same current `main` commit; see [operations](operations.md). CI reports are retained for seven days; release bundles for three days.

## Browser and container checks

Run these sequentially; the regular Playwright suite clears `frontend/test-results`, which contains the responsive suite's output directory.

```sh
make ci-stack
make test-e2e
(cd frontend && corepack pnpm exec playwright install chromium firefox webkit)
(cd frontend && CI=true PLAYWRIGHT_BASE_URL=http://localhost:18080 corepack pnpm exec playwright test --config=playwright.responsive.config.ts)
```

The full-flow suite verifies mock mode before writing. It covers current V3 stories, draft retention, original-request recovery, saves, permissions, and error injection. Responsive fixtures cover old saves as read-only history, with no legacy gameplay controls. Browser simulations do not establish physical-device or real-model readiness.

For the remaining container checks, use the same isolated stack:

```sh
export COMPOSE_FILE=compose.ci.yaml
export COMPOSE_PROJECT_NAME=btl-ci
export COMPOSE_DISABLE_ENV_FILE=true
mkdir -p artifacts
docker compose exec -T web nginx -t
sh scripts/test-web-runtime.sh
docker compose exec -T -e BTL_LOAD_TEST_REPORT=/tmp/load-test.json api python - < scripts/load-test.py
docker compose cp api:/tmp/load-test.json artifacts/load-test.json
sh scripts/verify-restore.sh
make ci-stack-down
```

Load checks drive 10/20/30 concurrent turns through the actual Agent graph with mock transport, require zero failures, and enforce the configured p95 budget. They refuse real-model targets. The test stack allows 64 concurrent executions; the application default is 30. Restore checks create and remove a separate database without overwriting the source. Always clean up the isolated stack after failures as well as success.

## Recovery and semantics

Run `python scripts/test-disconnect.py` and then `python scripts/test-restart.py` against disposable `btl_test`, after migrations and with no concurrent database tests. These exercise a real TCP disconnect and forced process termination after a tool commit, checking preserved facts without duplicate tools or dialogue.

`python scripts/evaluate-semantics.py --version 2` is the default 90-case mock suite used in CI. The consolidated evaluator also accepts `--version 3`; the V3 fixture initializer still raises a repeated-action `RuleError` (reproduced locally while updating these docs, without database access or model calls), so it is not a passing CI gate. Fix and rerun that fixture before claiming V3 semantic coverage from this command.

Real-model checks require explicit opt-in (`--real`), actual credentials, and may incur provider charges. `scripts/audit-real-endings.py --real` exercises local ending generation; backend artifact output is separate from the player UI's original ending posters. Do not infer real DeepSeek quality or OAuth acceptance from mock results. Record the exact commit, configuration, scenarios, outcomes, and skipped checks; inspect saved facts as well as dialogue. Never publish private reports or credentials.

Before declaring a release validated, separately exercise new/existing Zhihu identities, denial, expiry, repeated/concurrent callbacks, and binding during an active turn; real-model fact consistency and role isolation; and deployed TLS, proxy redaction, readiness, and backup recovery. Existing historical results cover only their recorded cases.

## Physical-device acceptance: still pending

Playwright covers narrow layouts, landscape, long input and keyboard focus. It does not replace these checks:

- [ ] Record device, OS, browser, and assistive-technology versions.
- [ ] iOS Safari and Android Chrome: keyboard open/close, Chinese composition without premature submission, caret editing, rotation, background and return.
- [ ] Verify context, input, send button, and feedback with the keyboard open and at 200% browser zoom.
- [ ] VoiceOver/TalkBack: reading order, recipient labels, status announcements, panel focus/close, return-home and logout confirmations.
- [ ] Observe target players completing Act 1 and explaining a choice consequence; record actual outcomes.

## Historical evidence

- [PR #49 CI at `78cdfc2`](https://github.com/shenyankm/between-the-lines/actions/runs/35035724534): 148 desktop/mobile E2E and 27 cross-browser responsive tests passed on 2026-09-16 (Asia/Shanghai), together with backend, frontend, and container gates. This is a commit-specific baseline, not validation of subsequent edits.
- [OAuth integration record](zhihu-oauth-deployment.md): one real account authorization and guest migration on 2026-09-13; it does not establish the entire acceptance matrix.
- [Ending poster provenance](assets/ending-posters/README.md) preserves the original source artwork. Older screenshots under `docs/screenshots/` are historical captures, not specifications for the current UI.
