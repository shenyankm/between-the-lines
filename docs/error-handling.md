# API errors and turn-recovery contract

Endpoint paths and existing success fields remain unchanged; deploy backend and frontend together. `backend/app/error_catalog.py` defines the error catalog, and OpenAPI exports the error-code enum used by generated frontend types. Unknown additional fields may be ignored. Unknown error codes produce a safe message, not an assumption that a turn was never accepted.

## HTTP errors

Except for the independent `/api/ready` probe response, errors use this structure. User-facing strings remain Chinese in the application:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "请求格式不正确。",
    "request_id": "server-request-trace-id",
    "recovery": "edit",
    "details": [
      {
        "field": "body.text",
        "code": "string_too_long",
        "message": "文字长度超出限制。"
      }
    ]
  }
}
```

`code` is stable; `message` can change. `request_id` matches `X-Request-Id` and is distinct from the idempotency `request_id` in a turn submission. Validation details are capped at 20 entries and expose only public field paths, rule codes, and fixed messages. Unknown field names become `unknown`; values, raw exceptions, and validation context are not echoed. Validation logs use route templates and sorted field names.

| HTTP      | Error code                                               | UI behavior                                                                                                  |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 403       | `zhihu_login_required`                                   | Sign in with Zhihu; preserve the guest session for binding                                                   |
| 400       | `request_body_invalid`                                   | Check JSON syntax and encoding; no automatic retry                                                           |
| 400       | `oauth_failed`                                           | Log in again                                                                                                 |
| 401       | `not_authenticated`                                      | Pause turn queries, retain the original user's pending request, and log in again                             |
| 403 / 415 | `forbidden_origin` / `json_required`                     | Suggest refreshing the page                                                                                  |
| 404       | `not_found` / `save_not_found`                           | Return to the entry page and check the resource                                                              |
| 404       | `turn_not_found`                                         | Confirm absence by querying; only a complete original request may replay automatically once with the same ID |
| 409       | `request_id_reused` / `version_conflict`                 | Refresh progress, retain input, and wait for player action                                                   |
| 409       | `turn_still_running` / `save_busy`                       | Query the original turn or the save's current turn                                                           |
| 409       | `unsupported_save_version`                               | Ask the administrator to upgrade the service                                                                 |
| 422       | `validation_failed` / `empty_message` / `rule_violation` | Check input or choose another action                                                                         |
| 429       | `concurrency_budget_exhausted`                           | Wait, then submit explicitly                                                                                 |
| 500       | `internal_error`                                         | Outcome may be unknown; query the original turn after submission                                             |
| 503       | `oauth_not_configured` / `model_unconfigured`            | Ask the administrator to configure the service                                                               |
| 404 / 405 | `http_404` / `http_405`                                  | Framework routing error, not evidence of an absent turn                                                      |

Quota responses carry `Retry-After` and `retry_after_seconds`; the server emits integer seconds. The frontend also accepts HTTP-date headers from proxies. If both values are valid, use the longer delay. Error and successful API responses prohibit caching and include request-tracing information.

Paths use UUID parameters. Versions must be nonnegative JSON integers; booleans, floats, and numeric strings are rejected. Request bodies reject unknown fields. Login names are trimmed and cannot be whitespace-only. Original dialogue text and existing action defaults are preserved.

## Terminal turns and SSE

`TurnResult.failure` is nullable and contains `code/message/request_id/recovery`. Failure types:

- `turn_timeout`: execution or upstream-call timeout.
- `execution_budget_exhausted`: historical persisted failures only; new executions do not emit this code. The retained graph recursion guard maps to `turn_failed`.
- `model_unavailable`: upstream connection or HTTP failure.
- `empty_reply`: no valid dialogue or reflection text returned.
- `turn_interrupted`: cancellation, restart, or leftover-turn recovery.
- `turn_failed`: unclassified exception, or a legacy failure without structured information.

Classification uses exception types, not provider message matching. Failure messages explain that saved actions remain valid. `retryable` remains for compatibility; it does not authorize automatic replay of executed actions. After failure, players refresh progress and explicitly continue with a new ID.

Legacy failures receive defaults on read without rewriting database JSON, original payloads, save versions, or checkpoints. Successful terminal results cannot carry failure. HTTP queries and SSE use the same terminal model.

SSE events are `status` (status text), `dialogue` (complete committed dialogue), `done` (committed terminal state), and `error` (subscription failure with unknown outcome). `error` always uses `subscription_failed`, includes the turn ID and request trace ID, and specifies recovery `recover`. Persistence failure must not fabricate `done`: keep running until the existing cleanup service or restart recovery can commit a terminal result after database recovery.

## Client recovery budgets

- Ordinary JSON requests time out after 15 seconds each. GET network failures, timeouts, and 502/503/504 responses retry at most twice, normally after 1 and 2 seconds. Total automatic waiting is capped at 15 seconds before returning control to the page. Writes do not retry automatically.
- SSE subscriptions cancel after 90 seconds idle. Data resets the timer. Intentional cancellation shows no error and does not cancel the backend turn.
- Turn recovery independently uses 1, 2, 4, and 5-second intervals without nested GET retries. A new 90-second recovery window starts after subscription ends. Valid Retry-After delays queries; delays beyond the window retain manual recovery.
- Network failures, proxy errors, invalid responses, truncated SSE, and subscription errors retain pending. Only explicit business non-admission errors clear it. Legacy records also require `turn_not_found` before being cleared as absent.
- Pending records are isolated by user and save. A valid UUID with a corrupt payload becomes query-only. Invalid IDs are discarded so unrecoverable records cannot lock the UI. Corrupt payloads and legacy ID-only records are never automatically replayed.
- After terminal confirmation, clear pending before refreshing caches. Refresh failure is reported separately and does not resubmit. Late results after user/save switches or unmounting cannot update the new page.

Error messages include local recovery actions and expandable, copyable error codes and request IDs. Failed logout retains the page and identity. Cancellation is not shown as failure. Existing reporting settings without external transmission are retained.

## Verification and rollout

Frontend/backend fault injection, runtime response validation, and recovery tests cover persistence failures against a real database. Browser global setup first reads `/api/config` and permits writes only after confirming `agent_mode=mock`, avoiding accidental use of a real service on the default port.

No schema migration is required. Deploy backend, frontend, and generated contracts together. Run `make contract-generate` to update artifacts, then `make contract` to check drift. See [verification records](verification.md) for results and limitations.

## Saved-state explanations

Turn feedback separates transport uncertainty from server evidence. A lost submission response says acceptance is unconfirmed and queries the original request. A `running` lookup establishes acceptance, not any particular action or reward. A failed terminal result with persisted effects says the action is saved and the reply is incomplete, and displays those effects' recorded text. Without effects it does not claim an action occurred. A completed result remains completed even when subsequent page refresh fails.

The original request identity, one replay only after explicit `turn_not_found`, login pause, and matching-draft clearing rules remain unchanged. This change does not infer failure from a proxy status or automatically repeat a completed turn. Diagnostic details retain the existing expandable error presentation.

Validation distinguishes a real Mock turn with a dropped browser response from UI response substitution. Backend failure integration checks establish that committed effect evidence survives a provider failure and a repeated request; browser recovery checks establish visible wording and no duplicate POST. Physical networking and real-model readiness are separate acceptance scopes.

For the recovery-status change, the current isolated Mock drills were rerun: `scripts/test-restart.py` confirmed the committed tool survived process kill/restart without an incomplete reply, and `scripts/test-disconnect.py` confirmed TCP disconnection did not duplicate tools or replies. These checks use the disposable test database, not production or private saves.
