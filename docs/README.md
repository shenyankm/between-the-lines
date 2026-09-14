# Documentation index

Start here. Player and contributor entry points live in the repository root ([README](../README.md), [README.zh-CN](../README.zh-CN.md), [CONTRIBUTING](../CONTRIBUTING.md), [SECURITY](../SECURITY.md), [CHANGELOG](../CHANGELOG.md)). The pages below are the technical and product references.

Most pages are **living references**: they describe current implementation and change with the code. Anything that was a point-in-time acceptance or review snapshot has been consolidated into [verification](verification.md); per-iteration numbers are not restated as current, per the rule in [CONTRIBUTING](../CONTRIBUTING.md).

## Engineering

| Document | What it covers |
| --- | --- |
| [architecture](architecture.md) | Modular-monolith modules, resource lifecycle, transaction and turn invariants, public protocol, frontend recovery. |
| [development](development.md) | Local setup, configuration, verification commands, single-server deployment, TLS, backups, dependency upgrades. |
| [ci](ci.md) | GitHub Actions code gates, test isolation, container/browser gates, image auditing. |
| [cicd](cicd.md) | Actions-driven build/audit/deploy to the mainland server, runner isolation, rollback, artifact fetching. |
| [operations](operations.md) | Single-process runtime, advisory lock, recovery after restart, backup/restore, rollback. |
| [error-handling](error-handling.md) | HTTP error catalog, structured turn failures, SSE events, client recovery budgets. |
| [ui-components](ui-components.md) | Frontend component conventions, HeroUI/native-dialog exceptions, ending poster layout, responsive and feedback rules. |
| [mobile-reading-validation](mobile-reading-validation.md) | Mobile reading/accessibility behavior and the remaining physical-device checks. |
| [verification](verification.md) | Canonical verification status: gates, coverage floors, reproduction, boundaries, screenshots. |
| [product-v2-release](product-v2-release.md) | v2/v3 upgrade: implementation map, migrations, rollout order, feature flags, launch gates. |

## Story and product design

| Document | What it covers |
| --- | --- |
| [story-scope](story-scope.md) | What this release does and does not include. |
| [story-relationships](story-relationships.md) | Relationship development, actions/projections, endings, legacy-save compatibility. |
| [metric-contract](metric-contract.md) | The four metrics: sources, observable behavior, and what they never do. |
| [route-balance-r3](route-balance-r3.md) | Content-revision 3 route gains and costs. |
| [visual-scenes](visual-scenes.md) | Scene art, assets, and narrative references. |
| [data/conformance-decisions](data/conformance-decisions.json) | R01–R11 source/product conflict decisions and rationale. |

## Zhihu integration

| Document | What it covers |
| --- | --- |
| [zhihu-data](zhihu-data.md) | Public Zhihu reference data: import, schema, and expansion runs. |
| [zhihu-npc-integration-design](zhihu-npc-integration-design.md) | Design proposal for perspectives and NPC reference integration. |
| [zhihu-oauth-deployment](zhihu-oauth-deployment.md) | OAuth protocol and identity boundaries, single-server deployment, production login policy. |

## Data and assets

| Path | Contents |
| --- | --- |
| [data/zhihu-topics](data/zhihu-topics.json) | Zhihu search-topic catalog. |
| [data/conformance-decisions](data/conformance-decisions.json) | R01–R11 decision records. |
| [assets/ending-posters](assets/ending-posters/README.md) | E01–E06 poster provenance and rebuild notes. |
| `assets/` and `screenshots/` | Referenced artwork and visual-acceptance captures; see the gallery in [verification](verification.md). |
