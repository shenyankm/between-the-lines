# Public Zhihu references

Public references are separate from player identity, story facts, and private NPC memory. Search results are source material, not authoritative workplace rules or permission to execute actions. The implementation uses existing PostgreSQL tables and the shared DeepSeek factory; there is no separate discussion service or vector database.

## Current discussion flow

[Discussion](../frontend/src/features/v3/Discussion.tsx) submits a `discussion` job through `POST /api/saves/{id}/jobs` and reads its status/result. `backend/app/jobs.py` validates ownership, save revision, version, and request identity. The earlier proposal for dedicated `/discussions` endpoints was superseded by the job API.

- In real mode, enabled V3 discussions can search a fixed topic for the current act through `zhihu_search.py`. Queries contain no player input, identity, or save ID. Search results are cached for 24 hours; failed refreshes may return explicitly labeled older cache entries.
- If live sources are unavailable, generation can use approved, hash-validated local records matching the act. Missing sources or disabled discussions use labeled editorial advice. Mock mode returns labeled synthetic examples.
- Generation validates source IDs and supporting excerpt quotes. The server fills source URLs/authors from allowed records; unknown sources and invented supporting quotes are rejected. This validation does not prove that every summary is semantically faithful.
- Completed discussion results may be reused for 24 hours by story version, act, source content, prompt, model, and runtime configuration. Cache keys do not include private player dialogue.
- Choosing an expression fills a draft. The player must send it before it becomes dialogue. Turn fields `discussion_id` and `perspective_id` are checked against the player's save, act, and card; opening a card does not alter story facts or notify another NPC.

The application has no AI usage or spending quota. Provider service limits, execution capacity, timeouts, input validation, and NPC permissions still apply. `ZHIHU_ACCESS_SECRET` is separate from OAuth user tokens and DeepSeek credentials; keep it in the server environment or a protected, Git-ignored dotenv file.

## Import and review

`public.zhihu_contents` stores public titles, service excerpts, authors when available, source URLs, statistics, topics, and timestamps. Imports deduplicate by content type and ID, merge topic tags, and invalidate review approval when relevant source content changes. They do not import the authorized user's private content.

After configuring the intended host database and credentials, run from `backend/`:

```sh
python -m app.zhihu_import
python -m app.zhihu_import --query '职场沟通边界' --count 5
```

The importer accepts up to ten queries with up to ten results each, checks provider quota, and commits each topic independently. Later failure leaves earlier batches committed and exits unsuccessfully. The four-second pause between topics is a local pacing choice, not a guarantee about platform limits. Its report goes to `artifacts/zhihu-import.json`.

From the repository root, review local content before approving it:

```sh
mkdir -p artifacts
python scripts/product-admin.py review-export --file artifacts/candidates.json
# Review sources; set approved/rejected, review_note, and act_1/act_2/act_3 tags.
# Keep the exported content_hash unchanged; changed source content needs a new export.
python scripts/product-admin.py review-import --file artifacts/candidates.json
python scripts/product-admin.py review-import --file artifacts/candidates.json --apply
```

Set both `DATABASE_URL` and `CHECKPOINT_URL` to the intended database before administration. The review CLI is dry-run unless `--apply` is provided. Original imports and live-search caches are different sources; imported candidates do not automatically become approved material.

## References and verification

[Topic catalog](data/zhihu-topics.json) preserves historical search topics, including topics outside the currently playable workplace story. Previous import totals and provider quota readings were snapshots, not current inventory or available capacity. Do not label them as current without querying the target environment.

[Provider search documentation](https://developer.zhihu.com/docs?key=zhihu_search) and [authentication documentation](https://developer.zhihu.com/docs?key=authorization) are external references. Runtime behavior above is described from the repository code, not a new verification of the provider service. Check source fidelity, unavailable sources, cross-save/act rejection, and NPC isolation separately; real API checks require explicit authorization and never run as routine mock CI.
