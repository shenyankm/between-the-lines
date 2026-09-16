# Production operations

See [verification](verification.md) for CI gates and [development](development.md) for local setup. The procedures below describe the repository's release tooling; verify deployed configuration separately.

## Audited releases

CI and Audit run on GitHub-hosted machines. Audit packages scanned linux/amd64 API and Web images as a short-lived artifact for the same commit. The production server only downloads, verifies, imports, and deploys these images; it does not need Docker Hub to download application images. GitHub build machines still fetch base images and dependencies.

`Deploy` waits for CI and Audit to succeed for the same main commit. `BTL_AUTO_DEPLOY=true` enables automatic deployment; false pauses it. For manual execution, open Actions → Deploy → Run workflow, select main, and choose deploy, rollback, or verify-backup. Failed or superseded commits cannot pass deployment checks. PRs do not run on the production runner.

The production runner uses a separate btl-runner account, the btl-production label, and a systemd service; it is not in the docker group. Its only sudo entry point is root-owned `/usr/local/libexec/btl-deploy`, sourced from `scripts/deploy-release.py`. The entry point uses Compose and `.env` from `/srv/between-the-lines/current` and never executes scripts from an artifact. Production configuration is not copied into the runner workspace. Members able to edit trusted release workflows effectively have production deployment access; labels are not a security boundary. Do not use this runner for public repositories or untrusted PRs.

A server file lock and Actions concurrency serialize deployments. The transaction validates the SHA, audit run ID, archive hashes, platform, and image version labels, then uses immutable image IDs resolved on the server. It stops the API and waits for in-flight requests, exports a complete PostgreSQL backup, runs migrations through Compose with existing configuration, starts containers, and checks the public homepage and `/api/ready`. API replacement includes a brief maintenance window; this is not zero-downtime deployment.

Release state is stored in `/var/lib/btl-releases/state.json`; backups are in `/var/backups/between-the-lines`, both readable only by root. Initial bootstrap records the original production images. Failed health checks restore the previous images only if the schema is unchanged. After a schema change, automatic rollback is refused; the backup is retained for a compatible fix. rollback switches only to a schema-compatible previous release, never downgrades the database or overwrites new player data. verify-backup restores the latest backup into an independent temporary database, reads save/checkpoint counts, then removes that database.

Operations staff install or update the reviewed deployment entry point over SSH into a root-owned directory; workflows cannot overwrite it. Runner registration uses a one-time GitHub registration token and does not require a personal GitHub token on the server. Verify the official runner package checksum, configure it as btl-runner, and install the service with `svc.sh`. The service requires outbound HTTPS 443 to GitHub, Actions, and artifact domains. If mainland network connectivity is unstable, configure a controlled proxy for the runner only.

Images and backups are not automatically pruned, to preserve rollback. The deployment helper stores backups on the same server; configure encrypted off-site backups and retention separately. Pausing automatic deployment does not stop the website or cancel a deployment already running. Artifacts are retained for three days by default. After expiry, a new commit must trigger CI/Audit builds; unscanned manual images are not a substitute.

Single-connection artifact downloads to the mainland server previously slowed to tens of KB/s. Production therefore uses root-owned `/usr/local/libexec/btl-fetch-release`, running as the ordinary runner account and sourced from `scripts/fetch-release.py`: 16 parallel transfers, 2 MB chunks, and at most four attempts. It strictly verifies Content-Range and the GitHub artifact SHA-256, then extracts three allowlisted files. The GitHub token is sent only to the GitHub API, not to redirected temporary storage URLs. The deployment entry point independently verifies image archive hashes and provenance.

## Configuration and network boundaries

Production requires `ENVIRONMENT=production`, `DEV_LOGIN_ENABLED=false`, `AGENT_MODE=deepseek`, a unique 32+ character `SESSION_SECRET`, HTTPS `PUBLIC_ORIGIN`, a DeepSeek key, and complete Zhihu OAuth settings. Set `GUEST_ENABLED=false`; production rejects guest creation even if this flag is accidentally true. See [OAuth configuration and identity rules](zhihu-oauth-deployment.md). Keep root `.env` at `0600`, with separate session and database secrets.

The server overlay uses host Caddy for TLS and binds Nginx only to `127.0.0.1:18080`. Its Docker subnet is `172.31.219.0/24`; check for host-network conflicts. Nginx trusts the host proxy and resolves the API through Docker DNS. Set `TRUSTED_PROXY_NETWORKS` to the actual private proxy network, keep the API and PostgreSQL off public ports, and preserve query/header redaction in both proxy layers.

`compose.production.yaml` is the alternative for Nginx-terminated TLS. It publishes ports 80/443 and mounts `TLS_DIRECTORY`, containing `fullchain.pem` and `privkey.pem`. The web container runs as UID/GID 101; on Linux, use `root:101`, directory mode `0750`, key mode `0640`, and certificate mode `0644`. Preserve permissions after renewal. Do not apply both TLS overlays or bypass audited production releases with a local `--build` command.

## Migrations, compatibility, and recovery

Run one API process. A PostgreSQL advisory lock prevents another instance from performing competing recovery; do not bypass it. Normal shutdown drains work; Compose allows 90 seconds. After a forced exit, startup marks leftover running turns failed while preserving committed tool facts. Clients query the original request and continue explicitly; the server does not replay tools.

Retain all [Alembic migrations](../backend/migrations/versions). Rehearse upgrades on a disposable copy, back up business data and checkpoints, stop incompatible writers, and migrate with the matching release image before starting it. Migration 0009 removes AI accounting, 0010 removes archive state, and 0011 adds authorized avatars. Those changes do not authorize rewriting historical story facts. Current V3 revisions 2/3 remain playable; V1/V2 and V3 revision 1 are read-only.

The deployment helper performs the backup/migration sequence and refuses automatic image rollback after a schema change. Prefer a compatible forward fix. A database restore can lose newer player writes and is a separate recovery decision; do not use a routine application rollback to downgrade or overwrite it.

## Backups and data maintenance

`sh scripts/backup.sh` creates a custom-format PostgreSQL dump and requires `BACKUP_REMOTE` for an off-host SCP destination. Configure the working directory, Compose environment, SSH access, monitoring, and retention before scheduling it. No schedule is installed by the repository. `sh scripts/verify-restore.sh` tests a new dump in a temporary database; it verifies restore mechanics, not delivery or retention of off-host backups. Dumps contain private conversations and session digests.

From the repository root, with `DATABASE_URL` and `CHECKPOINT_URL` explicitly pointing at the intended database:

```sh
python scripts/product-admin.py metrics
python scripts/product-admin.py cleanup
# After reviewing the dry-run counts and taking a backup:
python scripts/product-admin.py cleanup --apply
```

Cleanup selects saves deleted more than 30 days ago and unbound guest saves more than seven days past guest expiry. It excludes running turns/jobs and pending identity transfers, and removes associated checkpoint namespaces. Deleting a save immediately frees its active-save slot; the default member limit is 20. Cleanup also removes expired sessions/rate buckets, aggregates product events older than 30 days, and expires aggregates older than 180 days. Regular cleanup depends on the operator scheduling it; it is not automatic on the thirtieth day.

Logs and metrics retain execution outcomes, active counts, and durations, not application token/cost accounting. Keep private input and provider credentials out of logs and external tracing. [Public reference review](zhihu-data.md) documents the independent content-maintenance commands.
