# Public Zhihu reference data

The initial import used the user-authorized Access Secret with the official Zhihu search API: five topics, five results each, totaling 25 distinct items. Topics covered belittling colleagues and boundaries, exclusion from gatherings, procurement communication, job-change rumors, and personal growth.

Data is stored in `public.zhihu_contents` in the `btl` database of Docker container `between-the-lines-db-1`. Fields include titles, service-provided excerpts, public author nicknames, source URLs with provenance parameters, upvote/comment counts, search topics, and collection timestamps. Deduplication uses content type plus content ID; repeated imports update content/statistics and merge topics.

This independent reference table does not represent player accounts or contain the authorized user's private content. At this import stage, it was not injected into NPC memory or connected to advice cards. Search relevance and perspective quality require filtering before player display.

The credential is stored as `ZHIHU_ACCESS_SECRET` in local `backend/.env`, mode 0600 and Git-ignored. It is separate from OAuth and DeepSeek keys. The importer sends it only to public-data endpoints on `developer.zhihu.com`, does not follow redirects, and accepts source links only on HTTPS Zhihu domains.

Using the existing Miniconda interpreter, run from backend:

```sh
python -m alembic upgrade head
python -m app.zhihu_import
# Custom topics: at most ten per invocation, ten results each.
python -m app.zhihu_import --query '职场沟通边界' --count 5
```

The program checks remaining quota first and makes one search request per topic. Each batch commits separately; later failures preserve committed batches and are not reported as success. The completion report is `artifacts/zhihu-import.json`, without secrets.

[Search API documentation](https://developer.zhihu.com/docs?key=zhihu_search) · [Authentication documentation](https://developer.zhihu.com/docs?key=authorization)

## Second expansion

Thirty new topics returned ten items each, processing 300 results. Deduplication by type and ID added 294 items, bringing the recorded total to 319. `docs/data/zhihu-topics.json` lists topics covering all three workplace acts, partner relationships, mother-daughter communication, independent choices, and personal growth.

At verification time, the search quota was 35 / 5000 used, with 4965 remaining. After one short-term rate limit, committed batches were retained and import resumed from unfinished topics. The importer now waits four seconds between topics in a batch to reduce bursts. This interval is not a platform rate guarantee; rate-limit handling remains necessary.

All 30 topics were verified to have ten associated records. Twenty items lacked author nicknames and remain empty rather than inventing authors. Some results were product-oriented; these remained candidate references, not individually curated content or automatic NPC input. Summary report: `artifacts/zhihu-expansion-summary.json`.
