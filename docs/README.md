# Documentation

Player entry points: [English README](../README.md) and [Chinese README](../README.zh-CN.md). Contributor policy, including English issues/PRs and mandatory issue linkage, lives in [CONTRIBUTING](../CONTRIBUTING.md). See [SECURITY](../SECURITY.md) for private vulnerability reporting and [CHANGELOG](../CHANGELOG.md) for release history.

## Engineering

| Reference                           | Scope                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| [Development](development.md)       | Local configuration, host/container database addresses, mock and real modes           |
| [Architecture](architecture.md)     | Modules, transactions, Agent isolation, version compatibility, turn recovery          |
| [Verification](verification.md)     | Local/CI gates, test isolation, coverage, historical evidence, open device acceptance |
| [Operations](operations.md)         | Audited releases, deployment, migrations, backups, rollback, cleanup                  |
| [Error handling](error-handling.md) | HTTP/SSE failures, uncertain outcomes, retry and recovery rules                       |
| [UI components](ui-components.md)   | HeroUI/native controls, responsive layouts, ending posters, read-only history         |

## Story and content

| Reference                                           | Scope                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| [Story scope](story-scope.md)                       | Three workplace acts and excluded partner/family branches        |
| [Relationships and endings](story-relationships.md) | NPC permissions, actual choices, six factual endings, old saves  |
| [Metric contract](metric-contract.md)               | Sources and effects of the four values                           |
| [Revision 3 balance](route-balance-r3.md)           | Current scoring and preservation of revision 2 behavior          |
| [Visual scenes](visual-scenes.md)                   | Current scene assets and historical provenance                   |
| [Zhihu references](zhihu-data.md)                   | Public search, review, cached discussion jobs, source boundaries |
| [Zhihu OAuth](zhihu-oauth-deployment.md)            | Provider protocol, identity binding, production access policy    |

## Source records and assets

- [Conformance decisions](data/conformance-decisions.json): R01–R11 source/product decisions; historical records, not a second runtime specification.
- [Zhihu topics](data/zhihu-topics.json): import topics, including historical topics outside current gameplay.
- [Ending posters](assets/ending-posters/README.md): original E01–E06 artwork and provenance.
- `screenshots/`: historical visual evidence. UI code and current tests define present behavior.

Keep each procedure in its owning reference and link to it from other pages. Update documentation with the implementation; label proposals and dated checks explicitly. Superseded V2 release instructions, the early discussion proposal, and duplicate CI/mobile notes have been consolidated into the references above; their history remains in Git.
