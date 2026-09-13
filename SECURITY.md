# Security policy

## Reporting vulnerabilities

Please **do not** report security vulnerabilities in public issues.

- Preferred: GitHub private vulnerability reporting (repository Security → Report a vulnerability).
- Alternative: email the repository maintainer with a subject beginning `[SECURITY]`.

Include reproduction steps, affected versions or commits, an impact assessment, and possible mitigations. We aim to provide an initial response within five business days.

## Supported versions

Only the latest tag is supported. This is a single-maintainer project deployed on one server; older versions do not receive security maintenance. The upgrade path is to deploy the latest tag. See `docs/operations.md` for rollback procedures.

## Implemented protections

The following constraints are enforced in code, not merely recommended in documentation:

- **Production refuses unsafe startup.** The `production_guards` validator in `backend/app/config.py` rejects `ENVIRONMENT=production` configurations with development login, mock agents, a `SESSION_SECRET` shorter than 32 characters or beginning with `development`, a non-HTTPS `PUBLIC_ORIGIN`, a missing `DEEPSEEK_API_KEY`, a non-HTTPS model endpoint, or no positive monthly cost cap.
- **Session tokens are not stored in plaintext.** `backend/app/auth.py` stores SHA-256 digests of `secrets.token_urlsafe(32)` tokens. Sessions expire after seven days; cookies use `httponly` and `samesite=lax`, plus `secure` in production.
- **Same-origin deployment and Origin validation replace CORS.** Middleware in `backend/app/factory.py` validates Origin and requires JSON for mutation requests as a CSRF defense. See [architecture](docs/architecture.md) for process, transaction, and API boundaries.
- **Redacted logs.** Authentication failures log exception types, not credentials or personal information. `backend/tests/test_logging.py` contains regression assertions.
- **Restricted Agent capabilities.** `backend/app/agents.py` disables generic deepagents subagents, excludes `task` and `execute`, and confines file tools to `StateBackend`, without access to the host filesystem or shell. `MAX_MODEL_CALLS` and `MAX_TOOL_CALLS` bound execution.
- **Server-derived checkpoint thread IDs** use `{user}:{save}:{npc}`. Clients cannot choose them, preventing cross-user checkpoint access.
- **Locked supply chain.** Backend dependencies are installed from `backend/requirements.lock` with `--require-hashes`. GitHub Actions are pinned to commit SHAs; downloaded gitleaks and trivy binaries are verified with checksums.

## Stored personal data

| Data                           | Location                       | Description                                                                                                                                                                   |
| ------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zhihu user ID and nickname     | `public.users`                 | Created through real Zhihu OAuth. Initial verification predates configured endpoints; see `docs/verification.md` and `docs/zhihu-oauth-deployment.md` for subsequent records. |
| Session token digests          | `public.login_sessions`        | SHA-256 digests, not plaintext                                                                                                                                                |
| Saves and turn content         | `public.saves`, `public.turns` | Player input and model replies                                                                                                                                                |
| Agent conversation checkpoints | `agent_checkpoints` schema     | LangGraph checkpoints containing conversation history                                                                                                                         |

`config.py` rejects development login (`DEV_LOGIN_ENABLED`) in production, so the development identity entry point is unavailable there.

## Secret management

Secrets are injected through the host `.env`, which must have mode `600` (checked by `make doctor`). `.env`, `*.pem`, `*.key`, and `doc-fetch-resources/` are excluded by `.gitignore` and checked again by the pre-commit hook. The project does not currently use a secret-management service.
