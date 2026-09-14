# Source and product review · 2026-09-13

> Historical note: AI quota, reservation and cost-accounting descriptions below predate their removal in schema 0009 and no longer describe the current application.

**Assessment: a workplace interactive-fiction MVP with a complete playable route and solid engineering foundations. Visual quality and reliability are ahead of gameplay depth. The next useful investment is to give player expressions understandable consequences and test whether players want to continue.**

The review baseline was `2b6cb6c` plus pre-existing uncommitted changes to `agents.py`, `test_agents.py`, and `verification.md`. Coverage included frontend/backend business code, story definitions, APIs and recovery state machines, role permissions, data models, tests, builds, deployment, and operations scripts, supported by local page inspection, existing tests, and targeted reproductions. This report did not modify business code.

The scores below are review judgments about that version, not user research, market rankings, or revenue forecasts.

| Dimension                         | Score / 10 | Basis                                                                                                                                   |
| --------------------------------- | ---------: | --------------------------------------------------------------------------------------------------------------------------------------- |
| Theme and emotional resonance     |          7 | Being ignored, blocked procurement, rumors, and boundaries provide clear, relatable conflict                                            |
| Visuals and basic interaction     |          7 | Consistent art, colors, typography, and usable mobile layout; dialogue/action feedback remains thin                                     |
| Player agency and replay          |          4 | Mostly fixed plot; metrics do not control branches; major private decisions happen automatically in interludes                          |
| AI necessity and validation       |          5 | Handles procurement tools and character dialogue, but required progression depends on tool calls without systematic semantic evaluation |
| Engineering reliability           |          8 | Solid transactions, idempotency, role isolation, recovery, types, and E2E checks                                                        |
| Acquisition and ongoing operation |          4 | External login dependency; missing guest experience, product funnel, feedback, and content-operations loop                              |

Overall: approximately **6/10**. Suitable for controlled small-group user testing. Current evidence does not establish willingness to pay, replay demand, or scalable operations.

## Verification and boundaries

| Check                      | Result                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend pure units         | 98 passed                                                                                                                                                                                                   |
| Backend integration        | 96 passed in a temporary source copy and new isolated database                                                                                                                                              |
| Deduplicated backend count | 182 tests covered by the two groups; twelve have both markers and must not be counted twice                                                                                                                 |
| Frontend Vitest            | 199 passed                                                                                                                                                                                                  |
| Desktop/mobile Playwright  | 60 passed in about 2.5 minutes; production frontend connected to isolated mock API                                                                                                                          |
| Static/build checks        | Ruff, mypy, ESLint, TypeScript / Vite build passed                                                                                                                                                          |
| Additional reproductions   | Free expression did not advance boundary actions; different metrics produced the same ending; AI budget blocked free actions; incorrect continue-save ordering; draft loss; OAuth parameters in access logs |

The integration copy changed only test database addresses and the migration test's database-name guard. Application code matched the review baseline. Existing `btl` and `btl_test` were not cleared. Browser checks included real mock API flows and fault injection, not real semantic evaluation. This review did not call paid models, integrate real OAuth, or repeat deployment, load, restoration, or dependency-vulnerability audits.

`docs/verification.md` already records one real DeepSeek main-route smoke test, which remains positive evidence. README's then-current “future real integration” wording lagged behind that record. One smoke test still does not establish arbitrary-wording reliability.

## Confirmed code problems

These findings concern the review baseline and are separate from product suggestions or later fixes.

1. **[P1] An exhausted monthly model budget blocks story actions that do not call a model.**

   Locations: [services.py:137](../backend/app/services.py#L137), [runner.py:113](../backend/app/runner.py#L113). The budget check happens before determining whether the action needs a model. In isolation, recorded estimated spending of 1 USD against a 0.5 USD cap made new `begin` return `503 monthly_cost_cap_reached`, despite no model call. Material submission and boundary choices are affected too; the frontend also disables actions according to Retry-After.

   Recommendation: identify model requirements first; separate AI budgets, API abuse limits, and free progression. Fixed endings should remain submittable while generated reflections can wait. Acceptance: free actions complete after the cap, AI requests are correctly rejected, and accepted turns remain queryable.

2. **[P2] “Continue the last story” chooses the most recently created save.**

   Locations: [routes/game.py:69](../backend/app/routes/game.py#L69), [Home.tsx:94](../frontend/src/features/Home.tsx#L94). The endpoint sorts by created_at descending and Home selects the first item. Reproduction: create A, create B, then play A; B still appears first. The button's promise and navigation differ for multi-save players.

   Recommendation: define “last” as most recently played, persist last_played_at or a user's last_save_id, and specify handling for completed saves. Acceptance: returning to an older save makes Home continue that save consistently across devices.

3. **[P2] Story-option clicks clear unsent dialogue drafts.**

   Location: [Play.tsx:67](../frontend/src/features/game/Play.tsx#L67). `act()` clears input after every successful action without checking whether the draft was sent. Browser reproduction: type unsent text, then click the boundary-setting action; the text disappears. Existing recovery tests protect newly typed text during a turn, not a draft cleared by an unrelated action.

   Recommendation: clear only successfully submitted matching speak text. If refresh/inter-act persistence is needed, scope drafts by user/save/NPC. Acceptance: material, report, and boundary actions preserve unsent text; successful speech clears only matching text.

4. **[P2] OAuth callback query parameters enter access logs.**

   Locations: [logging_setup.py:98](../backend/app/logging_setup.py#L98), [nginx.main.conf:9](../deploy/nginx.main.conf#L9). Business OAuth errors log only exception types, but access logging is separate. A fake-parameter request to the isolated API appeared in real Uvicorn logs as `callback?code=REVIEW_FAKE_OAUTH_CODE&state=REVIEW_FAKE_STATE`. Nginx used its default access format without callback-specific handling.

   This proves a redaction gap, not real token leakage or account takeover. Remove callback queries at both Uvicorn and Nginx while retaining path, status, duration, and correlation IDs. Verify through actual HTTP access logs rather than only business-logger exception branches.

No Critical / P0 finding was confirmed. This was not an exhaustive security audit.

## Five product priorities

1. **Free expression and story actions are separate mechanisms, while the UI implies equivalence.**

   [domain.py:26](../backend/app/domain.py#L26) returns unchanged state for speak. Agent state tools only cover material requirements, procurement approval, and project support. Expressing a clear boundary in Act 1 does not set boundary; the player still has to click. Act 3 clarification, delivery, and relationship choices also do not resolve through natural language, whereas Act 2 requires it to trigger tools. The interaction rules are inconsistent.

   Start with Act 1: let the model propose one bounded intent, validate it in the backend, and display the recognized action. Consequential choices need explicit player confirmation. Without intent recognition, label conversation and action distinctly. Add deterministic “Ask for materials” and “Request review” buttons in Act 2 so completion does not require guessing phrasing when tools fail. Never let models assign arbitrary values or flags.

2. **Metrics are visible but lack meaningful tradeoffs and feedback.**

   [domain.py:66](../backend/app/domain.py#L66) checks flags and procurement, not credit, stress, or heat, for progression/endings; NPC-visible state also omits them. Two reproduced routes ended with credit/stress/heat of 80/5/0 after boundaries and 70/20/25 after public confrontation, yet both reached “找回自我 · 只留工作往来” (Rediscovering Yourself · Work Contact Only). Some ending text mentions confrontation, so not all text is identical, but core consequences do not differ.

   Add a few observable effects first: confrontation changes later greetings, communication costs, or available solutions; Zhang's support unlocks a useful path. If metrics are only reflective, explain that or use qualitative states instead of suggesting a nonexistent strategy system. High emotion should not simply mean failure, nor firmness only penalties.

3. **The narrative stresses autonomy while major private decisions happen automatically.**

   [story.json:69](../backend/app/story.json#L69) fixes the breakup with Xie Chuan in an interlude, and [domain.py:72](../backend/app/domain.py#L72) sets personal_resolved on entering Act 3 regardless of earlier choices. Schoolmate/family support mostly appears as long monologues. This preserves adaptation direction but reduces participation.

   Retain the author's direction while offering at least one meaningful response, or make fixed character experiences explicit up front. Adaptation notes such as references to the relationship diagram, differences from its ending, and lack of promotion belong in expandable context; ending prose should focus on character experience and closure. Interludes should be rereadable in history; the current event model lacks an interlude type and cannot fully replay them.

4. **Identity is required before users experience value.**

   [Home.tsx:103](../frontend/src/features/Home.tsx#L103) offers Zhihu login to unauthenticated users, with trials only in development. Production disables development login, yet [config.py:59](../backend/app/config.py#L59) does not require usable OAuth. A configuration with no member-login path passed production validation. This is a launch configuration gap, not proof that the live site was failing.

   Offer a short guest experience before registration and migrate progress on login, with server-side guest quotas. If production is deliberately Zhihu-only, require callback, denial, expiry, and same-account recovery checks so a healthy service cannot be inaccessible to users.

5. **Completion offers little reason to continue or take something away.**

   The version has one three-act story, three conversational NPCs, two main relationship endings, and voluntary departure. It lacks chapter selection, key-point replay, expression comparisons, or another story entry. Generated reflections mainly receive final state and relationship summaries, not complete player expressions, limiting personalization.

   Build takeaways around “How could I respond next time?”: actual player wording, the other person's feedback, an alternative expression, and each approach's possible costs, with replay at one key point. Releasing further situations by chapter can test ongoing demand before adding many characters. Share cards should contain only player-selected content and provide a preview before sharing.

## Next steps for AI, content, and engineering

- **Add real-model semantic evaluations.** Mock tests validate flows/protocols, not persona consistency, truthful success claims, or synonym-stable tool use. The real smoke test itself exposed verbal-only material requests and processing historical requests. Create fixed cases across three NPCs, prerequisite states, ordinary/indirect/angry wording, compound requests, and attempted permission violations. Evaluate tool trajectories, factual consistency, tone, repetition, latency, and tokens separately. Distinguish trajectory matching from text-quality assessment; see [LangChain Agent Evals](https://docs.langchain.com/oss/python/langchain/test/evals). Changing models or enabling full external tracing is not a prerequisite.
- **Make Zhihu data useful to players.** `zhihu_import.py` and `ZhihuContent` import/store data, but runtime NPC/advice features did not consume it at this baseline; only three static editorial suggestions existed. This was not an implemented retrieval-enhanced product. Use the [perspectives design](zhihu-npc-integration-design.md) to build curated source cards and “Bring into conversation” for one act, then test whether they improve expression before implementing every proposed table/workflow. Popularity and source counts do not establish quality.
- **Optimize images first.** Ten PNGs totaled 19.54 MB; backgrounds were 1672×941 and characters 1024×1536. Production JS was 338.18 kB, estimated 108.72 kB gzip. Home background was about 1.81 MB, and the game scene/current character about 4 MB. Total assets are not the initial download. Generate appropriately sized WebP/AVIF and avatar thumbnails, then address preloading, lazy loading, and cache versioning. See [web.dev image formats](https://web.dev/articles/choose-the-right-image-format). Real mobile-network LCP was not measured; file sizes cannot be converted into claimed loading times.
- **Close the operations feedback loop.** The reporter in `reporting.ts:53` defaults to a no-op with no production installation point; backend metrics focus on turns, latency, calls, and cost. Add anonymous/minimal chapter entry/completion, approval bottlenecks, recovery failures, and feedback to identify drop-off. Do not upload raw private dialogue as default telemetry.
- **Manage data lifecycle.** Save/event endpoints read everything; save creation has no count limit, deletion/archive, or checkpoint-retention policy. Character context uses only the last thirty events, but complete play-state and checkpoint storage keep growing. Start with archiving, event pagination, and cleanup boundaries before further scale-driven optimization. Monthly spending is reaggregated on submission and mostly recorded at turn end; this is estimated protection, not a provider-enforced hard budget.
- **Keep current monolith boundaries.** Separating domain rules, transaction services, runner, and HTTP adapters is appropriate. The single-instance lock explicitly limits multiprocess deployment. There is no current evidence requiring microservices, Redis, vector storage, or additional autonomous Agents. A small comparison can measure Deep Agents virtual-file/checkpoint benefits; continuity currently comes mainly from reconstructed event context. Measure tokens, latency, and persona consistency before simplifying.
- **Reduce content-iteration cost.** `story.json` centralizes presentation, but action types, rules, and frontend progress hints remain scattered, and Chinese ending strings drive state decisions. Before another chapter, add stable story_id/story_version/ending_id so titles can change independently. Extract only necessary rule descriptions, without immediately building a generic story editor. The roughly 995-line CSS can be split as pages evolve. Correct outdated Python 3.12 support, real-integration status, and nonexistent ADR references in documentation.

## Suggested delivery stages

| Stage                           | Deliverables                                                                                                                       | Acceptance focus                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1: before public trial          | Fix confirmed bugs; establish member/guest access; compress initial images; explicit Act 2 actions                                 | Free actions at zero model budget; correct continuation; retained drafts; no OAuth query logs; unaided Act 1 completion |
| 2: validate the core experience | Map Act 1 expressions to bounded intents; observable differences between two choices; reflection grounded in actual player wording | No duplicate equivalent button action; players understand consequences; mistaken recognition can be corrected           |
| 3: validate ongoing value       | Real-model evaluation suite, anonymous funnel, key-point replay, curated Zhihu cards for one act                                   | Compare bottlenecks, completion, expression support, and willingness to try another situation                           |

Start with 10–15 target users, each independently completing a situation, then ask which line felt familiar, which choice changed the outcome, and whether they want another situation. This sample identifies problems, not market validation. Suggested first-round targets: over 80% complete Act 1 without verbal guidance and over 70% accurately explain one consequence. These are proposed targets, not observed results.

The priority is to **make players feel their words were heard and see the consequences**. The engineering foundation is sufficient to support that validation.
