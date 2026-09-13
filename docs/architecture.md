# Single-story modular monolith

The project retains React, FastAPI, PostgreSQL, and Deep Agents. Only one API process runs. Model calls use the existing factory; daily verification uses mock transport with the real Agent graph.

## Modules and resource lifecycle

- `app/game_types.py`, `app/domain.py`: typed state, actions, permissions, and pure rules. Rules do not read databases or story files.
- `app/services.py`: transaction boundaries, turn admission, tool facts, unified terminal commits, legacy-save validation, and consistent page reads. Uses concrete SQLAlchemy sessions without a generic repository framework.
- `app/runner.py`: background execution, admission slots, timeouts, usage, and execution metrics. HTTP connections subscribe to tasks; disconnection does not cancel them.
- `app/storage.py`, `app/agents.py`: connection pools and the Deep Agents adapter. Agents receive `AgentTurn` and `AgentContext`, depend only on restricted `GameTools`, and receive no ORM objects.
- `app/routes/`, `app/auth.py`: identity, parameters, response DTOs, errors, and SSE. `create_app(settings, dependencies)` creates resources during lifespan. Tests inject reply/epilogue dependencies rather than replacing business-module globals. OpenAPI export neither starts lifespan nor connects to the database.

Startup acquires a PostgreSQL advisory lock before recovering leftover running turns; a second process refuses to start. Restart commits leftover turns as failed without rerunning tools. Shutdown stops admission, waits for tasks, and closes checkpoint/database pools. The model phase defaults to 60 seconds, with separate database-command timeouts. The container entry point uses exec to deliver signals to Uvicorn. Uvicorn allows 75 seconds for graceful shutdown; Compose allows 90. Persistence failures are logged, and the cleanup service finishes leftover turns.

## Transaction and turn invariants

The admission transaction locks the user and save, checks request_id and the original payload first, then validates quota, concurrency, and version for a new turn. Replaying a terminal request returns its stored result without another model call or added execution usage. Reusing an ID with a different payload produces a conflict. Only one running turn is allowed; a partial unique database index is the final safeguard.

Model calls do not hold business transactions. Tools use separate short transactions to recheck turn status and role permissions, with operation-ID deduplication. Successfully committed facts must survive later model failures. Success, failure, timeout, and restart recovery all call `finish_turn`; only running can transition to terminal, and repeated finalization returns the stored terminal state. Dialogue is sent only after it is complete and committed; failures do not save partial dialogue.

The storage boundary validates `state_schema_version=1` and `GameState`. Migration 0003 only adds fields, constraints, and indexes; it does not rewrite state, original turn payloads, events, or checkpoint identifiers. Missing retryable in legacy results defaults to false; `TurnUsage` explicitly supplies missing usage fields. These read-time defaults do not change idempotency comparison data. Events are ordered stably by `(created_at, id)`.

## Public protocol and story

`GET /api/saves/{id}/play-state` returns `{save, events, active_turn}` in one REPEATABLE READ, READ ONLY transaction. active_turn includes the internal turn ID and request_id for discovering in-progress turns across devices. Existing save, event, and result-query endpoints remain available.

Turn states are running, completed, and failed. SSE retains status (`StatusEvent`), dialogue (`DialogueEvent`), and done (`TurnResult`), all declared in OpenAPI components. done must be completed or failed. Terminal HTTP queries and SSE both supply legacy defaults.

In this refactor, `app/story.json` is the single story-presentation definition: acts, scenes, characters, default dialogue, interludes, and action buttons. Pydantic validates structure, character references, and asset paths; tests check that assets exist. Internal `StoryDefinition` contains persona; public `StoryOut` projects fields explicitly instead of spreading internal objects. Frontend story fixtures are generated from the public projection, not maintained as a second copy. Python continues to adjudicate story values.

## Frontend recovery

Home and save entry points live in `features/Home.tsx`. The game is split into Play, GameStage, Conversation, and GameDrawer. React Query manages server data; UI state is isolated by user/save mounting, and components collaborate through data and callbacks.

`useTurnController` unifies submission, subscription, and recovery. Before sending, it saves a versioned sessionStorage record with user, save, original request_id, and complete payload; storage failures fall back to memory. Leaving the page cancels only the subscription. Asynchronous results must pass lifecycle signal checks before updating caches.

Network interruptions, 5xx responses, and invalid/truncated SSE retain pending. Explicit business errors proving non-admission clear it. Recovery queries the original ID at 1, 2, 4, and 5-second intervals, pausing after 90 seconds while preserving manual and network-restoration entry points. Only explicit turn_not_found with a complete original request permits one automatic resend with the same ID and payload. Legacy ID-only records are query-only. Failed terminal turns require the player to continue explicitly.

SSE decoding supports UTF-8 across chunks, LF/CRLF, and multiline data, validating terminal structures before they enter the state machine. Business pages call concrete `gameApi` methods using generated OpenAPI types.

## Engineering commands

`make contract-generate` explicitly generates OpenAPI, TypeScript, and public story fixtures. `make contract` regenerates in a temporary directory and compares without modifying the workspace. `make deps-update` updates locks; `make lock-check` only checks. `make migrate` applies migrations; `make migrate-check` checks model drift without writes.

Retain the existing Miniconda interpreter and pinned pnpm; do not create virtual environments. Preserve coverage thresholds instead of excluding moved modules. See [verification](verification.md) and [operations](operations.md).

## Error contracts and recovery hardening

See [API errors and turn recovery](error-handling.md) for HTTP error catalogs, structured turn failures, subscription error events, and client waiting budgets. Validate requests and responses at boundaries. Unknown outcomes must not trigger new business actions. Save-list caches are isolated by user; expired sessions pause recovery. Cache-refresh failure after a confirmed terminal state does not resubmit the turn.
