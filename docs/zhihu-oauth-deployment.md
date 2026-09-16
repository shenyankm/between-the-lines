# Zhihu OAuth integration and single-server deployment

Public entry point: `https://www.openwook.cloud`. Register this callback with Zhihu:
`https://www.openwook.cloud/api/auth/zhihu/callback`.

## Protocol and identity boundaries

`ZHIHU_PROTOCOL=standard` retains the original standard OAuth integration. `hackathon` uses the resource package's `app_id/app_key` protocol:

- Authorization endpoint: `https://openapi.zhihu.com/authorize`.
- Token endpoint: `https://openapi.zhihu.com/access_token`.
- `ZHIHU_CLIENT_ID` maps to App ID; `ZHIHU_CLIENT_SECRET` maps to App Key.
- `ZHIHU_ACCESS_SECRET` is a separate open-platform credential. Developer content endpoints receive both it and `X-OAuth-Token`. Native `openapi.zhihu.com/user` uses the current user's OAuth token as `Authorization: Bearer`; Access Secret is not a user token.
- Accept `authorization_code` or compatible `code`; reject duplicate or conflicting parameters.
- Returned `state` must match the browser-initiated record and be no more than ten minutes old. Missing, expired, or consumed state fails. Never infer the source guest from the current callback-time identity.
- Real verification on 2026-09-13 found top-level `uid` (number) and `fullname` (string) in `/user`. Configure `ZHIHU_SUBJECT_FIELD=uid` and `ZHIHU_NAME_FIELD=fullname`. Do not use nicknames or content authors as identity. Beyond the subject and name, only the avatar URL (`ZHIHU_AVATAR_FIELD`, persisted since migration 0011) is stored for display; no other profile fields are. A missing subject or name prevents session issuance.
- Token and profile requests do not follow redirects or log response bodies or credentials.

Source: the user-provided `https://zhstatic.zhihu.com/skill/zhihu-hackathon-skill_v2026s2.zip`, containing `zhihu/references/oauth.md` and `user-api.md`. The demo initializer was not executed, and the application architecture was not replaced.

## Deployment and verification

Use the audited image release process in [operations](operations.md). Production uses host Caddy for TLS and loopback Nginx; do not substitute manual builds or unscanned image transfers for CI/Audit provenance. API and Web must be deployed together with the existing backup/migration procedure.

Check `/api/ready`, effective `/api/config`, guest/dev rejection, authorization redirects, error callbacks, and redaction in both proxy layers. Final real Zhihu authorization is completed by the user. Record whether state validation, token exchange, stable identity, and progress migration succeed without recording codes, cookies, tokens, or raw profiles.

## Real integration results (2026-09-13)

- App ID 499's public callback returned state and passed binding validation; authorization-code exchange succeeded.
- The package example's mixed `/user` authentication was corrected: it uses OAuth Bearer; dual credentials belong to developer content endpoints.
- Native profile fields were verified as `uid` / `fullname`. Identity uses only these two fields; the avatar URL is additionally persisted for display (migration 0011), and no other profile data is stored.
- The final real callback returned 303. The trial save became member-owned, guest merged_into was set, and binding status became completed.
- The proxy uses dynamic Docker DNS. After API replacement, readiness returned 200 without rebuilding Nginx.
- Caddy, Nginx, and Uvicorn logs did not contain probe authorization codes or state query values.
- This verifies one real account authorization and guest migration, not the full multi-account, denial, and concurrent-callback launch matrix.
- At this stage deployment used manually built and uploaded images; no automatic deployment workflow had been created, and local changes had not been committed or pushed. The current automated release procedure is documented in [operations](operations.md).

## Production login policy

Production permits gameplay only for member identities issued by Zhihu OAuth. Guest creation and development login return 404 even if `GUEST_ENABLED=true` was left in the environment. Explicitly set `GUEST_ENABLED=false` and keep `DEV_LOGIN_ENABLED=false` in production configuration. Development/test environments retain their existing login settings.

`/api/config` reports effective login switches. User responses include required `can_play`; game clients must check it before requesting saves or mounting a game. Authenticated non-Zhihu identities receive `403 zhihu_login_required` with `recovery=login` on game/product endpoints; anonymous users still receive 401. `/api/auth/me`, OAuth initiation/callback and logout remain available to valid guest sessions for binding. Public story/configuration and health endpoints remain public.

Existing guest sessions keep their original seven-day expiry. Do not revoke cookies, delete trial data, extend expiry, or clear browser drafts before authorization succeeds. Existing state-bound migration transfers saved progress without overwriting member saves and waits for running turns/jobs to finish. A lost or expired guest session cannot be recovered merely by supplying a save ID. No schema migration is needed.

Ship API and Web together through the existing CI/Audit/Deploy workflow. Drain in-flight requests and use the existing backup/release procedure; verify public config, rejected guest/dev endpoints, guest game access and one user-completed real OAuth binding. Tests with provider fixtures are not real OAuth acceptance. Rolling back to an older image can restore access for existing guest sessions even with `GUEST_ENABLED=false`; do not treat such a rollback as preserving this access policy.
