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
- Real verification on 2026-09-13 found top-level `uid` (number) and `fullname` (string) in `/user`. Configure `ZHIHU_SUBJECT_FIELD=uid` and `ZHIHU_NAME_FIELD=fullname`. Do not use nicknames or content authors as identity, and do not store other profile fields. Missing fields prevent session issuance.
- Token and profile requests do not follow redirects or log response bodies or credentials.

Source: the user-provided `https://zhstatic.zhihu.com/skill/zhihu-hackathon-skill_v2026s2.zip`, containing `zhihu/references/oauth.md` and `user-api.md`. The demo initializer was not executed, and the application architecture was not replaced.

## Deployment

Host Caddy retains TLS and proxies to `127.0.0.1:18080`:

```sh
cd /srv/between-the-lines/current
docker compose -f compose.yaml -f compose.server.yaml build api web
docker compose -f compose.yaml -f compose.server.yaml up -d --wait --wait-timeout 150
```

`.env` uses mode 600, with separate database and session secrets. Source code, images, and commits contain no configuration secrets. The database exposes no host port, the API uses one worker, and Nginx binds only to loopback.

If the image registry is unreachable, build on another machine with `docker buildx build --platform linux/amd64 --load`, set `BTL_API_IMAGE` / `BTL_WEB_IMAGE` to the matching versions, transfer with `docker save` / SSH / `docker load`, then run `up -d --no-build --pull never --wait` without changing image provenance.

Nginx resolves the API dynamically through Docker DNS instead of retaining stale container IPs. Merge `deploy/Caddyfile.server` and run `caddy validate` first. Access and runtime logs remove query parameters and request headers; see the [official logging filters](https://caddyserver.com/docs/caddyfile/directives/log).

The dedicated Docker subnet `172.31.219.0/24` must not overlap the host network. Nginx trusts Caddy's forwarded IP only from the host gateway; the application trusts only that private network.

Initial empty-database startup applies migrations automatically. Later releases must follow the product release guide: back up the database and checkpoints, stop writers, and migrate with a compatible image. Do not reuse empty-database initialization procedures against business data.

The initial integration monthly AI cap was 2 USD, with automatic intents and perspective generation disabled. Do not claim production-login acceptance until the full OAuth, real-model evaluation, and public-launch gates pass.

## Previous site and verification

The PractiQ Java backend and its AI service were stopped and disabled. Their source and dedicated configuration were removed from active directories. The backup is `/var/backups/btl-replacement-20260913/practiq.tar.gz` on the server, in a root-only directory with adjacent `SHA256SUMS`. The database and another independent application were not deleted.

Check `/api/ready`, guest creation, authorization redirects, error callbacks, and redaction in both proxy layers. The user completes final Zhihu authorization personally. Record whether state is returned, token exchange succeeds, a stable user ID exists, and guest saves migrate. Do not record codes, cookies, tokens, or raw profiles.

## Real integration results (2026-09-13)

- App ID 499's public callback returned state and passed binding validation; authorization-code exchange succeeded.
- The package example's mixed `/user` authentication was corrected: it uses OAuth Bearer; dual credentials belong to developer content endpoints.
- Native profile fields were verified as `uid` / `fullname`. Only these two fields are used for accounts; other profile data is not persisted.
- The final real callback returned 303. The trial save became member-owned, guest merged_into was set, and binding status became completed.
- The proxy uses dynamic Docker DNS. After API replacement, readiness returned 200 without rebuilding Nginx.
- Caddy, Nginx, and Uvicorn logs did not contain probe authorization codes or state query values.
- This verifies one real account authorization and guest migration, not the full multi-account, denial, and concurrent-callback launch matrix.
- At this stage deployment used manually built and uploaded images; no automatic deployment workflow had been created, and local changes had not been committed or pushed. Later automation is documented separately in [CI/CD](cicd.md).
