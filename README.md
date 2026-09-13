# Between the Lines · 言外之意

English | [简体中文](README.zh-CN.md)

A workplace interactive novel built with React and FastAPI. Sun Miao, Li Jie, and Engineer Zhang each run through an independent Deep Agent. The backend adjudicates story rules and procurement workflows, while PostgreSQL stores game facts and separate Agent checkpoints.

## Run locally

**Use the existing Miniconda Python installation. Do not create a `.venv` or a new Conda environment. Run PostgreSQL with Docker.**

Run the following from the repository root. `python` should resolve to the activated Miniconda Python 3.13 interpreter (`/Users/sheny/miniconda3/bin/python` on the original development machine).

```sh
conda activate base
python -m pip install uv
uv pip install --python "$(command -v python)" --require-hashes -r backend/requirements.lock
docker compose -f compose.yaml -f compose.dev.yaml up -d db
cd backend
python -m alembic upgrade head
AGENT_MODE=mock python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). Select “立即试玩 · 第一幕” (Try Act 1 now), or “开发环境试玩” (Development preview) to test all three acts. Each development login creates a separate identity. Refreshing preserves the session; logging out and back in does not recover the previous development identity. Member accounts use a stable Zhihu identity mapping.

Mock mode still runs the Agent: `ChatDeepSeek → HTTPX mock DeepSeek SSE → Deep Agents tool loop → domain services → PostgreSQL`, including streamed tool-argument assembly, tool execution, and checkpoints. Mock token counts are test estimates, with zero cost; they do not represent real-model latency, semantic quality, or billing.

## Development configuration

The local backend reads `backend/.env`. Without overrides, the database uses `localhost:54329`; production containers use the root `.env`. Do not use the container address `db:5432` with host Python.

```dotenv
# Example backend/.env for local development
AGENT_MODE=mock
DATABASE_URL=postgresql+asyncpg://btl:btl@localhost:54329/btl
CHECKPOINT_URL=postgresql://btl:btl@localhost:54329/btl
PUBLIC_ORIGIN=http://localhost:5173
```

For real integration testing, set `AGENT_MODE=deepseek`, configure `DEEPSEEK_API_KEY`, and restart the backend. The model is fixed to the official DeepSeek `deepseek-flash` endpoint, with explicit `thinking.type=disabled`; providers are not switched automatically. Use mock for daily development. Real-model and OAuth acceptance for a new version must be performed separately using the release guide.

## Implemented flows

- Prologue, farewell gathering, procurement review, rumor clarification, and endings; independent saves and cloud progress across devices.
- Character conversations, phone contacts, social-feed text, procurement materials and project reports, editorial advice, and action history.
- Fixed act prerequisites, role permissions, request idempotency, optimistic version checks, per-save concurrency limits, and daily AI task quotas. Deterministic story actions do not consume AI quota.
- Role-visible event filtering and independent checkpoints. Failed turns retain committed facts and do not save incomplete dialogue.
- Model timeouts and call/tool budgets. Only final dialogue is shown; internal reasoning, tool arguments, and prompts remain private.

New stories use v2; existing stories retain v1. Features include natural-language action intents, confirmation of consequential choices, partner-relationship branches, personalized reflections, independent replay from key checkpoints, and reviewed perspective cards with sources. Zhihu account linking can inherit guest Act 1 progress. Draft protection, archiving, and a 30-day recycle bin are supported.

Story and character definitions are in `backend/app/story.json` (v1) and `backend/app/story-v2.json` (v2). Domain rules live in `backend/app/domain.py`; v2 action catalogs and consequences live in `backend/app/actions.py`. Relationship cards in the phone update with progress. After clarification and delivery in Act 3, the player chooses to end private contact or keep their distance and continue observing. See [Relationships and endings](docs/story-relationships.md) for narrative, privacy, and legacy-save rules. Editorial advice is labeled as such and is not presented as live Zhihu search results.

## Verification

```sh
# Create the dedicated test database once.
docker compose exec -T db createdb -U btl btl_test
cd backend
DATABASE_URL=postgresql+asyncpg://btl:btl@localhost:54329/btl_test python -m alembic upgrade head
python -m pytest -q
python -m ruff check app tests migrations
cd ../frontend
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Local browser tests use Google Chrome and require a running mock backend and Vite server. They cover desktop and mobile playthroughs, procurement tools, refresh recovery, and horizontal overflow.

```sh
# From the repository root, with the mock backend running.
python scripts/load-test.py
python scripts/test-restart.py
sh scripts/verify-restore.sh
```

Load tests cover 10/20/30 concurrent player turns and write `artifacts/load-test.json`. The script refuses to load-test a real model.

Update API contracts with:

```sh
python scripts/export-openapi.py
cd frontend
pnpm generate:api
```

## Single-server deployment

```sh
cp .env.example .env
# Edit configuration; production requires the settings described below.
docker compose up -d --build
```

The local container preview is at `http://localhost:8080`. Production requires `ENVIRONMENT=production`, `DEV_LOGIN_ENABLED=false`, `AGENT_MODE=deepseek`, a random `SESSION_SECRET`, HTTPS `PUBLIC_ORIGIN`, a database password, a DeepSeek key, and Zhihu configuration. Production startup rejects development identities and mock mode.

Configure Zhihu OAuth authorization, token, user-info endpoints, and identity fields using the partner's official documentation. No endpoints were guessed in the initial setup, and real login had not yet been tested at that stage; subsequent integration records are in [Zhihu OAuth deployment](docs/zhihu-oauth-deployment.md). OAuth credentials are not stored in the browser. The site uses revocable HttpOnly Cookie sessions.

The Web container runs as UID/GID `101:101`, with internal HTTP/HTTPS ports 8080/8443. Compose's external addresses remain unchanged.

The TLS directory contains `fullchain.pem` and `privkey.pem`. On a Linux deployment host, set the private key to `root:101` with mode `0640`, and allow GID 101 to traverse the directory (for example, `root:101` with mode `0750`). The certificate can use `0644`. Do not make the private key world-readable; preserve these permissions after renewal. Example:

```sh
sudo chown root:101 "$TLS_DIRECTORY" "$TLS_DIRECTORY/privkey.pem"
sudo chmod 0750 "$TLS_DIRECTORY"
sudo chmod 0640 "$TLS_DIRECTORY/privkey.pem"
```

After setting `TLS_DIRECTORY`, run:

```sh
docker compose -f compose.yaml -f compose.production.yaml up -d --build
```

The production database exposes no host port. Only the local development overlay binds `127.0.0.1:54329`. The API explicitly uses one Uvicorn worker; capacity limits assume one process. Multiple processes or hosts require global concurrency budgets and recovery coordination to be redesigned first.

### Backup, recovery, and maintenance

`scripts/backup.sh` uses `pg_dump -Fc` and SCP to send the backup to another host specified by `BACKUP_REMOTE`. A failed transfer returns a nonzero exit code. After configuring SSH on the deployment host, a daily task could use:

```cron
15 3 * * * BACKUP_REMOTE=backup@archive.example:/srv/btl-backups/ /bin/sh /srv/between-the-lines/scripts/backup.sh >> /var/log/btl-backup.log 2>&1
```

This example does not install a scheduled task. Replace the destination and verify backup success; retention is managed on the backup host. `verify-restore.sh` restores into a temporary database, checks business tables and checkpoints, then deletes that database without overwriting live data.

Logs include turn IDs, NPCs, usage, duration, and failure types, but not keys, complete private conversations, or internal reasoning. External LangSmith tracing is disabled by default. Real costs are estimates based on configurable prices; DeepSeek billing is authoritative.

### Dependency upgrades

`backend/uv.lock` is the version lock; `requirements.lock` is its hashed installation export, compatible with installation directly into Miniconda. Use `uv lock` and `uv export` for upgrades, not `uv sync` or `uv run`, which create environments:

```sh
uv lock --project backend
uv export --project backend --frozen --no-emit-project --format requirements-txt --output-file backend/requirements.lock --quiet
uv pip install --python "$(command -v python)" --require-hashes -r backend/requirements.lock
```

Before production launch, configure a real domain, certificates, partner Zhihu OAuth, a DeepSeek key, and an off-host backup destination. A single-server deployment does not provide high availability.

## CI and contributing

GitHub Actions runs backend tests, API contract synchronization, frontend checks and builds, Docker integration, desktop/mobile end-to-end tests, and backup restoration. Tests use a mock LLM and require no real keys. See [CI documentation](docs/ci.md) for workflows and local reproduction. Branch protection can use the aggregate check `CI required`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and development workflows.

The [architecture guide](docs/architecture.md) describes module boundaries, transactions, SSE contracts, and recovery state machines. `make contract-generate` explicitly generates artifacts; `make contract` and `make lock-check` only check them without changing files.

See the [v2 release guide](docs/product-v2-release.md) for the product upgrade, maintenance commands, and release gates.
