# Verification status

Living summary of what this project verifies, how to reproduce it, and the limits of each claim. Earlier per-iteration acceptance reports are consolidated here. Reproducible gates below are authoritative; treat any specific test count as a snapshot of one run, never as a current result (see the rule in [CONTRIBUTING](../CONTRIBUTING.md)).

## Code gates

`make check` runs from the repository root and covers: backend Ruff (lint/format) and strict mypy, Alembic migration and read-only drift checks, and pytest; frontend ESLint, TypeScript, Prettier, Vitest, and the Vite build; contract regeneration-and-compare; and dependency-lock checks. Frontend coverage is run separately with `make coverage`. See [ci](ci.md) for the Actions wiring.

Coverage floors must not be lowered:

- Backend: 82% branch coverage (`fail_under` in `backend/pyproject.toml`), including modules moved during the refactor.
- Frontend: statements/lines 70.85%, functions 71.79%, branches 90.9% (`frontend/vitest.config.ts`).
- HTTP boundary `src/api.ts`: 100% across all four metrics.

Contracts: `make contract-generate` writes OpenAPI, generated TypeScript, and public story fixtures; `make contract` regenerates into a temporary directory and diffs without touching the workspace. Schema: `make migrate` then `make migrate-check`; migration history and save compatibility are in [product-v2-release](product-v2-release.md).

## Integration gates

Browser, disconnection, restart, load, and backup-restore checks are independent of `make check`:

- Full-flow browser suites under `frontend/e2e/` (desktop and a 390px mobile viewport) cover the three acts, the relationship and six fact-based endings, drafts, refresh/recovery, save management, role permissions, and error injection against a mock backend.
  ```sh
  make ci-stack
  (cd frontend && CI=true PLAYWRIGHT_BASE_URL=http://localhost:18080 corepack pnpm test:e2e)
  ```
- Turn recovery over real transport: `python scripts/test-disconnect.py` (TCP drop mid-turn) and `python scripts/test-restart.py` (forced kill after tool commit). Run these sequentially against the disposable `btl_test` database; never share it concurrently.
- Capacity: `python scripts/load-test.py` replays 10/20/30 concurrent mock turns and refuses to run against a real model.
- Restore mechanics: `sh scripts/verify-restore.sh` restores into a temporary database and never overwrites the source.
- AI content and ending quality against real DeepSeek: `python scripts/audit-real-endings.py --real` (localhost only, may incur model cost).

## Boundaries of these claims

- Mock is the default and proves transport, rules, and UI behavior only. Real-model semantics, latency, and billing require the explicit `--real` runs above; local results do not substitute for the Actions run.
- Real Zhihu OAuth and DeepSeek integration are separate public-launch gates; see [zhihu-oauth-deployment](zhihu-oauth-deployment.md) and [product-v2-release](product-v2-release.md).
- Playwright and WebKit simulate viewports. Physical iOS/Android keyboards and VoiceOver/TalkBack remain open; see [mobile-reading-validation](mobile-reading-validation.md).
- Semantic checks prove the reproduced cases, not that arbitrary natural language can never contradict saved facts.
- Generated reports (load, disconnect/restart, E2E, ending-audit JSON) are written to the Git-ignored `artifacts/` tree and contain only synthetic dialogue.

## Dated evidence highlights

Historical snapshots kept for traceability; not current gates.

- 2026-09-13 — full-flow E2E across desktop/mobile with zero failures; committed-fact recovery and match-only draft clearing fixed.
- 2026-09-14 — six endings completed on real `deepseek-flash` (desktop Chrome); four confirmed defects (ending text denying a completed repair, attended-farewell remedy wording, submitted-exit status label, and the NPC protagonist name) fixed and re-run green. E01–E06 poster layout shipped; see [ui-components](ui-components.md) and the provenance in [assets/ending-posters](assets/ending-posters/README.md).

## Visual acceptance screenshots

Representative desktop/mobile captures grouped by area. These illustrate states; they are not automated assertions.

| Area | Captures |
| --- | --- |
| Stage layout and landscape | [1440](screenshots/stage-layout/1440.jpg) · [900](screenshots/stage-layout/900.jpg) · [390](screenshots/stage-layout/390.jpg) · [landscape](screenshots/responsive/landscape.jpg) |
| Saves | [desktop](screenshots/saves-layout/desktop.jpg) · [mobile](screenshots/saves-layout/mobile.jpg) |
| Panels (work / relations) | [desktop work](screenshots/panels-layout/desktop-work.jpg) · [desktop relations](screenshots/panels-layout/desktop-relations.jpg) · [mobile work](screenshots/panels-layout/mobile-work.jpg) · [mobile relations](screenshots/panels-layout/mobile-relations.jpg) |
| Ending and poster | [ending desktop](screenshots/ending-layout/desktop.jpg) · [ending mobile](screenshots/ending-layout/mobile.jpg) · [E03 desktop](screenshots/ending-posters/desktop-E03.jpg) · [E03 mobile](screenshots/ending-posters/mobile-E03.jpg) |
| Legacy UI, confirmation, interlude, error | [legacy desktop](screenshots/legacy-ui/desktop.jpg) · [legacy mobile](screenshots/legacy-ui/mobile.jpg) · [confirmation 390](screenshots/responsive/confirmation-390.jpg) · [interlude](screenshots/responsive/interlude-844.jpg) · [hr error](screenshots/responsive/hr-error.jpg) |
| Story return | [desktop](screenshots/story-return/desktop.jpg) · [mobile](screenshots/story-return/mobile.jpg) |
