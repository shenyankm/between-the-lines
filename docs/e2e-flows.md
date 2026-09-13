# Full-flow E2E acceptance (2026-09-13)

## Final results

- Browser: **60 passed** (30 desktop, 30 mobile), approximately 137 seconds, with zero failures, skips, or flaky results.
- Frontend: **199 passed**; TypeScript, ESLint, Prettier, and production build passed.
- Relevant backend unit/database integration: **59 passed**, covering story, relationships, APIs, private-chat isolation, mock OAuth protocol, concurrency, quotas, and error contracts.
- Screenshots for the repeated-button fix were recaptured with animations disabled and inspected; the two desktop/mobile retests passed.
- Machine reports: `artifacts/e2e-full.json`; the pre-final-fix suite is `artifacts/e2e-before-final-fixes.json` (57 passed and one mobile save-entry failure).

## Environment and boundaries

Desktop Chrome and a 390×844 mobile viewport each ran the same thirty scenarios. The frontend was the workspace Vite build, the backend FastAPI, and PostgreSQL used an independent `btl_story_e2e` database. Each scenario created a separate development identity without changing existing user saves. `/api/config` confirmed `agent_mode=mock` before startup testing.

Normal flows use real HTTP, SSE, Agent tool loops, and the database with local model responses. Error flows inject network failures, HTTP errors, or corrupt responses through browser routing. They do not prove real provider availability. Backend integration tests separately verify real failure persistence, permissions, OAuth protocol, and idempotency.

The service returned `zhihu_login=false`. Real Zhihu OAuth, real DeepSeek calls, and production deployment are outside this acceptance claim.

## Coverage

| Flow                                 | Checks                                                                                                                                                  | Browser scenarios per viewport |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------: |
| Opening and repeated actions         | All three options progress; completed buttons, refreshed state, rapid clicks, blank input                                                               |                              5 |
| Procurement and relationship endings | Prerequisites, complete materials, Sun Miao/Zhang cannot approve, Li Jie approval, project support, both endings, reversed clarification/delivery order |                              3 |
| Phone and interludes                 | Contact switching, Uncle Wang's private reply and reflection, read-only relationship cards, advice, cancellation without submission, asset decoding     |                              2 |
| Early departure                      | Cancel then confirm departure in each act; correct relationship facts, refresh, and save re-entry                                                       |                              3 |
| Saves and identity                   | Independent saves, Home continuation, save list, new identity after logout, multi-tab version conflict                                                  |                              2 |
| Turn recovery                        | Refresh after admission, one same-ID replay before admission, corrupt-SSE query recovery, clearing the original draft after successful recovery         |                              4 |
| Login and read errors                | Identity errors, recovery from config/story/save/list loading failures, explicit retry after login/save-creation failure                                |                              7 |
| Other errors                         | Rate-limit waiting, expired-session recovery, failed turns/logout, explicit generation of missing reflection                                            |                              4 |
| Total                                | Run on both desktop and mobile                                                                                                                          |                             30 |

The missing-reflection scenario hides an existing reflection during reads to test the retry UI; all writes still use the real mock API. The terminal-failure scenario replaces the response of an already committed turn to test UI recovery and is not real model-fault injection.

## Problems found and fixed

1. **Completed options could be clicked again.** A real browser reproduced the boundary button remaining enabled after success. Buttons now use backend flags to disable and mark completed options, leaving unfinished ones available. Related actions are restricted until materials, procurement approval, or final-act facts are ready, with next-step guidance. The backend still validates every request independently.
2. **The mobile save entry had no accessible name.** Mobile CSS hid its text, leaving an unnamed icon link and breaking semantic navigation. A fixed `aria-label="存档"` preserves the same entry on desktop/mobile.
3. **Recovered dialogue remained in the draft.** After a successful original-request query, the input now clears only text matching the submitted draft. Failure retains it; later edits remain untouched. The original turn is still submitted once.

Pre-fix failures, final machine reports, and screenshots are in Git-ignored `artifacts/`. They are acceptance evidence, not runtime dependencies.

## Reproduction

Start the mock backend and Vite as described in [development setup](development.md), then run:

```sh
cd frontend
PLAYWRIGHT_JSON_OUTPUT_NAME=../artifacts/e2e-full.json pnpm exec playwright test --reporter=list,json
```

Use `PLAYWRIGHT_BASE_URL` for another preview entry. Global setup refuses non-mock services. Failed tests retain screenshots and traces by default; inspect traces with `pnpm exec playwright show-trace <trace.zip>`.

Sources under frontend: `e2e/flows.spec.ts`, `e2e/recovery.spec.ts`, `e2e/draft-recovery.spec.ts`, and existing `game.spec.ts`, `errors.spec.ts`, and `scenes.spec.ts`.
