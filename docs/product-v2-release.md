# Between the Lines v2 product upgrade and release guide

This iteration retains React, FastAPI, PostgreSQL, Deep Agents, existing DeepSeek configuration, and one API process. New stories default to v2; existing stories continue as v1. Production launch separately requires real Zhihu OAuth, real-model semantic evaluation, off-host deployment, and target-player testing. Mock tests cannot replace these.

## Implementation map

| Deliverable                                                                        | Main implementation                                                                                                           |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Free story actions, legacy request_id replay, recently played                      | `backend/app/services.py`, `routes/game.py`                                                                                   |
| Three-act action catalog, consequential-choice confirmation, relationship branches | `actions.py`, `intents.py`, `story-v2.json`, `story.py`                                                                       |
| Guests, server-side OAuth state binding, deferred migration                        | `auth.py`, `product.py`, `factory.py`                                                                                         |
| Key-point snapshots and independent replay history                                 | `services.py:capture_snapshot`, `product.py:branch_save`                                                                      |
| Independent reflection and reviewed-perspective tasks                              | `jobs.py`, `content.py`, `routes/product.py`                                                                                  |
| Drafts, proposal recovery, history, and takeaway cards                             | `frontend/src/features/game/`                                                                                                 |
| Images, logs, diagnostics, and maintenance                                         | `scripts/build-images.py`, `logging_setup.py`, `deploy/nginx*`, `scripts/product-admin.py`                                    |
| Acceptance                                                                         | `backend/tests/test_product*.py`, `frontend/e2e/product-v2.spec.ts`, frontend product tests, `backend/evals/semantic-v2.json` |

The service layer adjudicates rules. Models cannot submit arbitrary state. Each turn accepts at most one ordinary player intent; subsequent NPC work operations still check role permissions and material prerequisites. Public confrontation, severing relationships, partner choices, and departure first persist a proposal, then confirm with a new request_id. Other valid actions invalidate older proposals. Private chat does not automatically submit experiments, publish clarification, or contact others. Tool facts commit first and survive dialogue-generation failure.

In v2, partner decisions require an explicit choice after Act 2 work is complete; closing an interlude makes no decision. Temporary distance is not reconciliation. Li Jie always owns procurement review; Engineer Zhang coordinates only. Notice disputes describe verified records without inferring who was responsible. Determine the ending before generating a separate reflection. All three acts remain completable without AI.

## Data versions and migrations

| Migration | Content                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0004      | Identity, guests, story version, last_played_at, independent namespace, archive/recycle-bin fields; legacy namespace backfilled with original user:save identifiers |
| 0005      | Proposals, v2 snapshots, branch idempotency records, copied history without original turns                                                                          |
| 0006      | AI tasks, review fields, OAuth bindings, product events, rate limits, and aggregates                                                                                |
| 0007      | Historical AI accounting ledger; removed by migration 0009                                                                                                          |
| 0008      | Reading positions and public search cache                                                                                                                           |
| 0009      | Remove AI accounting and obsolete request-rate buckets; retain valid turn duration in elapsed_ms                                                                    |

Migration 0009 deletes accounting data without rewriting v1 state JSON or existing turn payload/result. Legacy five-field inputs still compare their original fields for idempotency; omitted new fields do not participate. v1 cannot upgrade mid-story or gain fabricated historical snapshots. Branches copy facts, dialogue, and private narrative within the snapshot boundary using new event IDs, history groups, and checkpoint namespaces. They do not copy tool checkpoints or later content. Parent saves are provenance only; deleting one does not delete independent branches.

Locally, retain Miniconda without creating a virtual environment; invoke pinned pnpm 11.19.0 from frontend:

```sh
export DATABASE_URL=postgresql+asyncpg://btl:btl@localhost:54329/btl_upgrade_test_20260913
export CHECKPOINT_URL=postgresql://btl:btl@localhost:54329/btl_upgrade_test_20260913
cd backend
/Users/sheny/miniconda3/bin/python -m alembic upgrade head
/Users/sheny/miniconda3/bin/python -m alembic check
```

Create this dedicated verification database first. pytest and disconnection/restart scripts use `BTL_TEST_DATABASE_URL`. Tests clear data; never point them at a business database.

## Feature flags and rollout order

1. Back up the database, checkpoint schema, and application configuration; verify restoration into an independent database.
2. For schema 0009, stop the old application before migrating and release the backend and frontend together. Retain one instance and one API worker. Never run incompatible old writers simultaneously. Back up before migration: deleted accounting data cannot be recovered by downgrade. Downgrade recreates empty accounting structures; production rollback requires the pre-migration backup and matching application build.
3. Initially deploy with `STORY_V2_ENABLED=false`, `GUEST_ENABLED=false`, `AUTOMATIC_INTENTS_ENABLED=false`, and `DISCUSSIONS_ENABLED=false`. Check v1 continuation and legacy-request recovery.
4. Release the new frontend, then enable v2 creation, automatic intents, and reviewed perspectives individually. Enable guests only after real OAuth integration.
5. `ENVIRONMENT=production` requires full OAuth configuration, production origin, and session secret, alongside existing safety checks. Set `DEV_LOGIN_ENABLED=false`.
6. Configure `TRUSTED_PROXY_NETWORKS` for the Nginx private network, such as an explicit JSON list of Docker CIDRs. Do not expose the API publicly. Nginx rewrites X-Real-IP; the application trusts only direct proxies in configured networks. An empty list safely uses direct IPs but makes all proxied guests share a quota.
7. Perform off-host smoke checks in order: health, login, save continuation, free three-act completion, legacy terminal queries, confirmation-card refresh, and result recovery.

Disabling automatic intents returns to buttons. Disabling new v2 stories blocks creation only; existing v2 saves can continue. Disabling perspective generation shows editorial advice. Roll back only to an application build compatible with the current schema; do not destructively downgrade the database. Migration-test downgrades are only for dedicated empty databases. Retain historical migration files and fix forward when necessary.

## Identity and progress

Guest cookies are HttpOnly and SameSite=Lax, plus Secure in production; identities last seven days. Limits are five new identities per IP per hour and one trial save including archived/recycled saves. AI tasks have no guest or daily quota. Act 2 requires member login. Denying authorization does not erase guest progress.

At authorization initiation, the source guest is stored in server-side OAuthBinding associated with Authlib state. The callback does not infer it from the browser's current cookie. Linking either new or existing Zhihu accounts transfers ownership of saves, turns, and AI tasks without overwriting target saves or changing namespaces. Running turns/tasks defer migration, with a pending indication on Home. Restart resumes pending migrations; completion revokes guest sessions.

## AI execution and recovery

The application has no daily, guest, monthly-spend, per-turn model/tool-call, input-byte, or output-token quota. AI submission does not reserve money, write usage/cost records, or acquire a global billing lock. Turns and generated artifacts are also exempt from the former per-minute mutation limit. Model calls run outside database transactions. DeepSeek's own service limits still apply.

Keep execution capacity, timeouts, bounded provider retries, the graph recursion guard, and one structural/factual repair attempt. Role-filtered recent history, input validation, editorial length requirements, ownership checks and story permissions still apply. Other endpoint protections, including guest creation limits, remain active. Missing model configuration disables AI availability but deterministic story actions remain playable.

AI tasks persist identity, request_id, payload, status and result. Failures and interrupted generation end as failed with saved-fact fallback. Repeating request_id returns the original result without rerunning generation. Historical unknown task states and persisted execution_budget_exhausted failures remain readable, but new executions do not produce accounting states. Card cache hits and editorial advice reuse existing content.

The APIs no longer return TurnOut.usage, UserOut.ai_remaining or AIAvailability.remaining. Operational metrics retain outcomes, duration and active executions; token counts, model-call totals and cost estimates are removed. Migration 0009 extracts valid historical elapsed_ms values before dropping usage storage.

## Reviewed content and operations commands

Commands use the PostgreSQL database addressed by `CHECKPOINT_URL`. Set both DATABASE_URL and CHECKPOINT_URL to avoid accidentally using the default database. Imported material remains candidate content; the v2 game does not search online at runtime.

```sh
python scripts/product-admin.py review-export --file candidates.json
# Manually check sources, applicable act topics (act_1/act_2/act_3), titles, and authors.
# Set review_status to approved/rejected, fill review_note, and append act tags to topics.
# Do not edit exported content_hash; the server validates content and rehashes reviewed topics.
python scripts/product-admin.py review-import --file candidates.json
python scripts/product-admin.py review-import --file candidates.json --apply
python scripts/product-admin.py metrics
python scripts/product-admin.py cleanup
python scripts/product-admin.py cleanup --apply
```

Changed source content invalidates the old hash and requires a new review export. Card caches are isolated by story version, act, content, prompt version, and model/runtime configuration, without private player context. Models return only supplied content IDs; the server fills authors, titles, and URLs. Unknown, cross-save, cross-act, revoked-review, and changed-content references are rejected.

Archiving frees slots from the member limit of twenty active saves. Recycled saves are retained for thirty days; expired unbound guests receive seven additional days. cleanup reports counts by default. Explicit apply removes expired saves, derived business data, and each NPC's checkpoint records. Running or pending-binding saves are excluded. Minimal identity tombstones remain for identity lifecycle handling; accounting ledgers no longer exist. Proactive checkpoint compaction for normally completed stories is not enabled.

Raw product events are retained thirty days, aggregates 180 days. Diagnostics accept only allowlisted fields and static-asset stack locations; raw chats, names, and OAuth code/state are not collected by default. Feedback is explicitly submitted player text. metrics reports funnels, failures and mean/p95 execution durations.

After reviewing a low-traffic dry-run on the deployment host, consider adding `python scripts/product-admin.py cleanup --apply` to the existing scheduling and alerting system. Configure the deployment account, working directory, and correct DSNs. This implementation does not modify local cron/launchd.

## Assets and performance

Retain source PNGs. WebP backgrounds use widths 768/1280/1672, characters 256/512/1024, with content-hashed filenames. Regenerate assets and `frontend/src/assets.json` using `scripts/build-images.py` (requires Pillow). Initial loading fetches only the current scene and character, prefetching the next act near progression. Nginx caches hashed WebP/JS/CSS long-term; story responses use ETag, while identity/save responses remain no-store. The conversation area displays the latest three groups; history pages contain at most fifty entries.

Release targets: critical first-screen images total <=800KB and gzipped JS <=150KB. Check image decoding, overflow, and confirmation interactions on desktop/mobile; a successful build alone does not validate the UI.

## Verification and public-launch gates

```sh
# Set a dedicated test database from the repository root.
export BTL_TEST_DATABASE_URL=postgresql+asyncpg://btl:btl@localhost:54329/btl_upgrade_test_20260913
(cd backend && python -m pytest -q --cov=app --cov-report=term-missing)
(cd backend && python -m mypy app)
python -m ruff check --config backend/pyproject.toml backend scripts
python -m ruff format --config backend/pyproject.toml --check backend scripts
python scripts/check-generated.py contract
(cd frontend && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:coverage && pnpm build)
# After starting an independent mock API and Web:
(cd frontend && PLAYWRIGHT_BASE_URL=http://127.0.0.1:18732 pnpm test:e2e)
python scripts/test-disconnect.py
python scripts/test-restart.py
python scripts/test-log-redaction.py
python scripts/evaluate-semantics.py
python scripts/check-product-assets.py
# Rehearse restore/maintenance on a dedicated preview DB after E2E; the script deletes its own copies.
python scripts/test-product-operations.py --source btl_upgrade_preview_20260913
# Real models require explicit opt-in; the evaluation runs the full fixture set without a spending cap.
python scripts/evaluate-semantics.py --real --output artifacts/semantic-v2-real.json
```

The fixed real semantic suite contains ninety cases: three characters × five situations × six expressions. Rule accuracy must be at least 95%. Automatic commitment of major choices, unauthorized changes, private-data leakage, and fabricated success each have zero tolerance; do not hide failures in a composite score. Sample persona and reflection quality using the report's rubric. Mock validates tooling and rules, not real semantic quality.

Separately validate partner flows for new/existing Zhihu accounts, authorization denial, repeated callbacks, expiry, multiple tabs, binding during execution, and interrupted binding; off-host TLS, proxy IPs, logs, and restoration; and trials with 10–15 target players. Targets are at least 80% completing Act 1 without guidance and 70% explaining one choice consequence, while recording willingness to continue. Until these gates are complete, report “Engineering mock verification passed; public-launch validation pending.”
