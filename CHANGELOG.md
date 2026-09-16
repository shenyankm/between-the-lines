# Changelog

Changes are grouped by development milestone. Application versions are recorded in [backend/pyproject.toml](backend/pyproject.toml) and [frontend/package.json](frontend/package.json); story/content revisions are separate save-compatibility identifiers, not package releases. Production deployments are identified by audited commit SHA. Do not infer a release date or deployed status from an unreleased section.

Use `make release V=<version>` to update both package versions and insert a release stub. `make version-check` verifies that backend and frontend versions match. Release procedure: [operations](docs/operations.md).

<!-- next -->

## Unreleased

### Added

- V3 workplace scenes with four metrics, evidence-based work and relationship actions, explicit confirmations, and six fact-based endings.
- Content revision 3 route balancing while retaining revision 2 scoring for existing saves.
- Original E01–E06 ending cards, factual ending openings, responsive panels, and accessible draft/recovery feedback.
- Zhihu OAuth with state-bound guest migration and authorized avatars; production gameplay requires a Zhihu member identity.
- Public-topic search, reviewed-source discussion jobs, citation validation, and editable response drafts.
- Audited immutable-image releases with exact-commit CI/Audit gates, backup verification, and schema-compatible rollback.

### Changed

- V1/V2 and V3 revision 1 saves are read-only; current V3 revisions retain their original facts and request recovery behavior.
- Save management uses active/deleted states. Deleted saves become eligible for scheduled cleanup after 30 days.
- Browser tests cover V3 input errors and read-only legacy history after retirement of the old gameplay UI.
- Contribution templates require English issue/PR titles and descriptions and an existing issue for every PR.
- Technical documentation consolidates setup, verification, operations, and current story behavior into maintained references.

### Removed

- Application AI usage quotas, cost accounting, and obsolete request-rate buckets (migration 0009). Execution capacity, timeouts, and permissions remain.
- The archive state machine (migration 0010); authorized avatar storage was added in migration 0011.
- Retired legacy gameplay components, their dedicated Zustand store, unreachable ending narration/share components, and the unused story-version setting.
- The separate V3 semantic-evaluator script; `scripts/evaluate-semantics.py --version 2|3` is the shared entry point. Its V3 fixture limitation is documented in [verification](docs/verification.md).

## Initial development — 0.1.0 (unreleased)

Historical milestones below describe the initial implementation, including behavior later superseded above:

- React/FastAPI/PostgreSQL application with three isolated Deep Agents, deterministic mock transport, SSE replies, idempotent turns, and committed-fact recovery after disconnect or restart.
- V1/V2 workplace stories, consequential-choice proposals, guest identities, independent snapshots, and reviewed public references.
- Migrations 0001–0008 established game/session storage, compatibility constraints, product/AI jobs, historical accounting, reading positions, and search caching.
- Host Miniconda and pinned pnpm workflow, hashed backend dependencies, generated OpenAPI/TypeScript contracts, versioned Git hooks, and isolated database tests.
- Frontend/backend coverage gates, desktop/mobile browser tests, load/restore checks, secret scanning, dependency/container audits, and non-root TLS runtime checks.

See Git history for detailed engineering changes. Historical test counts and local measurements are not current verification results.
