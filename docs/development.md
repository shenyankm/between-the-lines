# Local development

Start with [CONTRIBUTING](../CONTRIBUTING.md) for the toolchain, issue/PR requirements, initial setup, and check commands. Run Make targets from the repository root; run direct Corepack/pnpm commands from `frontend/` so they use the pinned version.

## Run the application

Use the existing Miniconda Python 3.13 interpreter, Node.js 22.x (at least 22.23.2), and pnpm 11.19.0. Do not create a virtual environment or another Conda environment, or use `uv sync` / `uv run`.

After completing the initial setup in CONTRIBUTING:

```sh
make dev-up
make migrate
PUBLIC_ORIGIN=http://localhost:5173 make api
```

Run `make web` in another terminal and open [localhost:5173](http://localhost:5173). The inline `PUBLIC_ORIGIN` overrides the root `.env`'s port-8080 container origin for this API process; otherwise Vite's mutation requests would be rejected. `make api` explicitly selects mock mode and the host database addresses, even when the root `.env` contains Compose-internal addresses.

The development login creates a new identity each time. Refreshing retains its session; logging out and logging in again does not recover the previous identity. Zhihu accounts use a stable provider identity. Guest trials are available only when enabled outside production.

## Configuration and database addresses

[Settings](../backend/app/config.py) reads the root `.env` and then `backend/.env`; the latter overrides the former, and environment variables override both. Container services inject the root `.env`. Keep credentials out of Git and restrict dotenv permissions to `0600`.

Host Python connects through `localhost:54329`; `db:5432` is only resolvable inside Compose. The Makefile's `HOST_DATABASE_URL` and `HOST_CHECKPOINT_URL` override both addresses for `make api`, and the first for migrations. Example local settings:

```dotenv
AGENT_MODE=mock
DATABASE_URL=postgresql+asyncpg://btl:btl@localhost:54329/btl
CHECKPOINT_URL=postgresql://btl:btl@localhost:54329/btl
PUBLIC_ORIGIN=http://localhost:5173
```

Tests use disposable `btl_test`, not the development database. Migrate both explicitly as described in CONTRIBUTING. Never share the test database between pytest, disconnection checks, or restart checks running concurrently.

## Mock and real models

Mock mode runs the actual Agent graph through `ChatDeepSeek → HTTPX mock DeepSeek SSE → Deep Agents tools → domain services → PostgreSQL`, including tool calls and checkpoints. It does not establish real-model semantics, latency, billing, or OAuth readiness.

For an explicitly authorized real-model check, start the API with the same host DSNs and `AGENT_MODE=deepseek` instead of using `make api`, which forces mock. Configure `DEEPSEEK_API_KEY` in the local environment. The model remains official `deepseek-flash` with `thinking.type=disabled`. See [verification](verification.md) for real-model boundaries and [Zhihu OAuth](zhihu-oauth-deployment.md) for login setup.

## Containers, checks, and dependencies

- `make stack-up` builds the local full-stack preview from `compose.yaml`; it requires a configured root `.env` and serves `http://localhost:8080`. `make stack-down` retains its database volume.
- `make ci-stack` starts the separate mock test stack on port 18080 without reading local `.env`. Follow [verification](verification.md), then run `make ci-stack-down` to remove only that test stack and its data.
- `make contract-generate` updates API types and story fixtures; `make contract` checks them without rewriting tracked files.
- `make deps-update` updates backend locks and their hashed installation export. Frontend dependency updates belong in `frontend/` with pinned pnpm. Commit manifests and locks together and run the affected checks.

Production release, TLS, backups, and rollback procedures are maintained only in [operations](operations.md).
