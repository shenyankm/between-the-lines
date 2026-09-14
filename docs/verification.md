# Single-story engineering refactor verification

2026-09-13: local Miniconda Python 3.13.15, pinned pnpm 11.19.0, and Docker PostgreSQL. All model tests in this initial section use mock.

| Check                                         | Result for this iteration                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend pytest, unit and database integration | 136 passed; branch coverage 85.73%, floor 82%                                                                                                    |
| Frontend Vitest                               | 147 passed; statements/lines 82.73%, branches 94.40%, functions 80%; HTTP boundary 100% in all four metrics; existing thresholds retained        |
| Types, lint, formatting, build                | mypy, TypeScript, Ruff, ESLint, Prettier, and Vite passed                                                                                        |
| Contracts and locks                           | Temporary regeneration/comparison passed without workspace writes                                                                                |
| Database schema                               | Alembic 0003 applied; drift check proposed no operations                                                                                         |
| Docker                                        | Isolated db/api/web healthy; Nginx configuration passed                                                                                          |
| Playwright                                    | 6 desktop/mobile tests passed: complete playthrough, assets, interlude cancellation, drawer Escape, original-turn recovery after refresh         |
| Graceful container shutdown                   | exec makes Uvicorn PID 1; shutdown and lifespan cleanup completed in 0.91 seconds; CI gate added                                                 |
| Real TCP disconnection                        | Accepted turn completed; zero duplicate tools/dialogue                                                                                           |
| Forced exit and restart                       | Committed tool facts and session retained; zero duplicate tools; no partial dialogue saved                                                       |
| Legacy demo database                          | 77 saves migrated/validated in an isolated copy; all table hashes checked again after actual migration, with business data/checkpoints unchanged |
| Legacy public protocol                        | 490 events and 335 turns passed new DTO compatibility checks                                                                                     |
| Backup restoration                            | Isolated CI database restored with 62 saves and 768 checkpoint records; source not overwritten                                                   |

Story tests cover the four existing endings, core action values, and procurement prerequisites. Permission tests cover users, saves, NPCs, private contexts, and checkpoints. Recovery tests cover repeated requests, same ID with different payloads, stale versions, concurrent races, replay at full execution capacity, timeouts, and failure after tool commit. Frontend tests cover unknown outcomes, invalid SSE, one-time 404 reconciliation/resend, storage exceptions, legacy pending records, save switching, late results, and unsubscribe.

Desktop/mobile screenshots were inspected without missing assets or horizontal overflow. Refresh testing interrupted the response after backend completion but before the browser received it. Real TCP tests separately cover disconnection during execution.

## Mock load tests

| Concurrency | Completed | Failure rate | p50    | p95    | Model calls |
| ----------- | --------- | ------------ | ------ | ------ | ----------- |
| 10          | 10        | 0%           | 0.374s | 0.380s | 20          |
| 20          | 20        | 0%           | 1.632s | 1.679s | 40          |
| 30          | 30        | 0%           | 2.402s | 2.500s | 60          |

These are local simulated-load results, not real-model latency or production capacity. Git-ignored artifacts include load-test.json, disconnect-test.json, restart-test.json, shutdown-test.json, and legacy-migration.json. The pre-migration backup, artifacts/before-runtime-migration.dump, contains original data and is not version-controlled.

This iteration did not call real DeepSeek, integrate real Zhihu OAuth, or publish/deploy externally. Local verification does not replace remote CI results.

## API and error-handling improvements (2026-09-13)

This section records subsequent reliability changes. Earlier deployment, load, and backup checks were not repeated in this iteration.

| Check                               | Result                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Backend unit/PostgreSQL integration | 159 passed; branch coverage 87.14%, 82% floor retained                                                               |
| Frontend Vitest                     | 189 passed; statements/lines 93.91%, branches 93.55%, functions 86.50%; HTTP client 100% in all four metrics         |
| Browser                             | 14 isolated mock desktop/mobile tests passed; 8 error scenarios retested after error-detail wrapping                 |
| Static checks                       | mypy, TypeScript, Ruff, ESLint, Prettier, production build passed                                                    |
| Generated contracts                 | No OpenAPI, TypeScript, or public-story drift                                                                        |
| Data compatibility                  | Legacy failures receive read-time defaults only; payloads, facts, and idempotency IDs preserved; no schema migration |

New database cases verify stable timeout codes with retained player actions, and terminal persistence failure emitting only a subscription error rather than fabricated done, followed by recovery committing an interrupted terminal state. Client cases cover proxy 404, expired sessions, wait times, stream timeouts, corrupt responses, cancellation, structured failures, logout failure, and post-terminal refresh failure.

Browser tests used temporary database `btl_reliability_20260913`, API port 18001, and frontend port 15173. An initial attempt on default ports stopped at login because the existing service configuration differed; no turn flow ran. Dedicated ports and explicit mock verification enabled all scenarios. A new global mock check prevents future tests from writing to real-model services. The original port-8000 service was unchanged.

Terminal-failure browser cases replace responses after real mock commits to exercise UI branches. Backend integration verifies actual failure persistence and committed facts. Disconnection/query recovery continues to use real API submissions. No real OAuth, deployment, or existing business-database modification occurred.

### Uncommitted-change review fixes (2026-09-13)

- Transport errors while reading successful JSON responses are treated as network failures, retaining GET retries after 1 and 2 seconds. JSON syntax/structure errors and writes do not retry. Response-header request IDs are preserved.
- Framework body-parsing 400 errors map to `request_body_invalid`, with a fixed Chinese message and `edit` recovery. Development-login and turn-submission responses are declared in synchronized generated contracts.
- Regression: 193 frontend and 78 backend unit tests passed; three direct error-catalog/contract checks also passed. Types, lint, formatting, frontend build, and contract synchronization passed.
- No database integration or browser tests ran in this iteration. New request-encoding tests use actual routes and reject during body parsing, without lifespan, database, or model access.

## Relationship full-flow E2E (2026-09-13)

The workspace passed 60 desktop/mobile browser checks, thirty per viewport, with zero failures, skips, or flakes. Coverage includes both relationship endings, early departure in each act, all opening options, procurement permissions/prerequisites, multiple saves, private messages/reflections, interlude cancellation, multi-tab conflicts, and network/error recovery. Fixes addressed repeated completed actions, an unnamed mobile save entry, and failure to clear the original draft after recovery.

All 199 frontend tests and 59 relevant backend unit/PostgreSQL integration tests passed, alongside types, lint, formatting, and production build. See [full-flow E2E](e2e-flows.md) for scope and fault-injection boundaries. Deployment, load, and restoration were not rerun; real Zhihu OAuth and DeepSeek were not tested in this iteration.

## Real DeepSeek integration (2026-09-13)

Using a key from a local ignored file, the existing `ChatDeepSeek` / Deep Agents chain verified `deepseek-flash` with thinking disabled. After minimal connectivity, independent player saves in `btl_test` exercised real-model lifespan, HTTP routes, SSE turns, and PostgreSQL persistence. The existing preview service's mode was unchanged.

Initially, finance listed materials verbally without registering requirements. Further investigation found Li Jie processing historical material requests instead of the current review request. The fix clarified tool conditions and supplied the current player message separately, marking historical dialogue as reference only. Backend permissions and prerequisites remained authoritative.

The repaired main route completed all 14 steps: Sun Miao dialogue, material registration/submission, project report, Engineer Zhang support, Li Jie review, Act 3 clarification/delivery, ending private contact, and AI reflection. `requirements`, `supported`, `procurement=approved`, the final ending, and refreshed reads were verified. The historical figures below predate accounting removal in schema 0009. Five AI turns made ten model requests, with 29,650 input and 443 output tokens; AI turns took approximately 1.46–2.79 seconds. The application estimated 0.0094266 USD for this route, excluding preliminary probes and failed reproductions; this is not provider billing.

Details are in ignored `artifacts/ai-smoke.json`. This is one real-service smoke test, not proof of reliable behavior for arbitrary wording. Desktop/mobile frontend evidence remains the mock E2E results above.

Related regressions passed: four Agent tests and 31 domain/relationship/API tests, plus Ruff and diff whitespace checks.

## v2 product upgrade acceptance (2026-09-13)

See the [v2 release guide](product-v2-release.md) for implementation and rollout. New behavior is evaluated separately from the earlier v1 real-model smoke test; that run does not count as v2 semantic acceptance.

- v1 save/turn compatibility retained; new stories use v2. AI quotas and accounting are removed; deterministic actions remain model-independent, with proposal confirmation, three-act relationship branches, private interludes, guest state-bound migration, independent replay, reflections, and reviewed perspectives.
- All 66 desktop/mobile browser tests passed against independent containers with a production Web build, Nginx, mock Agent, and PostgreSQL. Coverage includes legacy main routes/recovery and v2 partner branches, drafts, confirmation, and guest gates.
- All ninety fixed mock semantic samples passed, with 100% rule accuracy and zero automatic major commitments, private leaks, or fabricated successes. The ninety real-model cases had not run.
- TCP disconnection and forced-process-restart drills passed: facts retained, no duplicate tools/dialogue, no partial dialogue saved. Real HTTP OAuth success/failure callback logs through Uvicorn/Nginx were redacted, using a partner fixture.
- An independent restore recovered 153 saves, eight branches, 74 snapshots, and 1044 checkpoint records. Review dry-run, stale-hash rejection, expiry cleanup, and checkpoint deletion passed; 137 cost records remained after cleanup. Source and existing user databases were not cleared.
- Mock Agent load tests completed at 10/20/30 concurrency with zero failures and local-container p95 approximately 0.63/1.09/1.49 seconds. This does not represent real-model speed.
- Thirty hashed WebP assets; conservative critical first-screen image bound 367,064 bytes; production JS approximately 115KB gzip. Non-root TLS, HTTP redirects, static pages, and API proxy checks passed.
- Existing coverage floors were not lowered. Final checks and aggregate results are in local `artifacts/product-verification.json`, reproducible using the release guide.

Generated reports are in ignored artifacts (semantic samples contain synthetic dialogue and must not overwrite older real-call reports). This iteration did not run real DeepSeek, real Zhihu OAuth, off-host deployment, or target-user research; these remain separate public-launch gates. No scheduled task, commit, or push was created, and pre-existing uncommitted changes were preserved.
