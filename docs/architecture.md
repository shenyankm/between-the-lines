# Runtime boundaries

## Player turn

1. Authenticate the cookie and resolve the save against the authenticated user.
2. Reserve a process-wide slot; lock the user then save in PostgreSQL. Check daily quota, request identity, active turn and optimistic version.
3. Commit the player's action and event before calling the Agent. A duplicate request returns its recorded outcome; the same ID with different content is rejected.
4. Select the NPC requested by the valid game action. Build a Deep Agent with a fixed `ChatDeepSeek(deepseek-flash)` and `thinking.type=disabled`.
5. Rebase conversation input from current role-visible facts and events. The thread identifier is derived on the server from user, save and NPC; clients cannot choose checkpoint IDs.
6. Every game tool rechecks the active turn and role under a save lock. Its `(turn_id, operation)` event is unique. Tool success is authoritative even if a later model call fails.
7. Commit completed dialogue and usage before exposing it to the browser. Internal graph events, tool arguments and reasoning never enter the client event stream.

## State ownership

- SQLAlchemy business tables own game outcomes, actions, authentication and usage.
- The `agent_checkpoints` schema is owned by the LangGraph checkpointer and keeps NPC execution state and virtual notes.
- Failed executions are not blindly resumed. Their incomplete message chains are cleared on the next turn; committed business facts are loaded again. This avoids repeating partially completed tools.
- Startup recovers unfinished turns immediately, under the supported single API process model. A periodic sweep fences expired turns. Scaling to multiple API processes requires explicit lease ownership and a shared capacity limiter first.
- New game saves have new NPC thread identifiers. A player's private chat with one NPC is not supplied to another NPC.

## Model and tool budgets

There is one model factory. Live calls use DeepSeek's official API only. Mock calls use the same ChatDeepSeek class, Deep Agents graph, tools and checkpointer, with an in-process HTTPX transport providing DeepSeek-format SSE chunks. Test token usage is synthetic.

Deep Agents' default general-purpose subagent is disabled through its locked harness profile; `task` and `execute` are excluded and blocked at dispatch. Filesystem tools operate only on `StateBackend`, with no host filesystem or shell backend. Request deadlines and model/tool call middleware bound each run.

The model may request an operation that its NPC lacks; the domain service denies it. Only Li can approve a complete procurement request. Zhang can support a reported project, but cannot approve financial requests.

Ending labels are chosen by domain rules. Ending prose uses the same fixed model and can be retried without changing the ending. It is stored as a player-only event, not as a statement known by all NPCs.

## Authentication and deployment

Zhihu is a configurable OAuth adapter pending partner documentation. Its protocol fixture verifies state rejection, stable external identity mapping and revocable local sessions; it does not verify real Zhihu access. Development login issues a fresh random identity and is forbidden in production.

Nginx serves the SPA and same-origin API. Mutations require JSON, and supplied browser Origins must match `PUBLIC_ORIGIN`. The database has a loopback-only port in the development override and no host port in deployment.

Local Python runs directly from Miniconda; no project virtual environment is created. Docker is used for PostgreSQL and for the optional production application deployment. Both deployment images and dependency graphs are version-locked.
