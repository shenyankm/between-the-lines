# Zhihu perspectives and NPC reference integration design

Design references: [Game acts and asset list](https://ccnoz23f7y98.feishu.cn/wiki/Ka47wg91jiUW1ekAcbFc9Fuonqe), read at version 801, plus existing three-act rules, independent NPC checkpoints, and 319 candidate `zhihu_contents` records. This is a design proposal: the new APIs, tables, and interactions below were not implemented at the time of this document.

## Product goal

Zhihu perspectives help players compare approaches. NPCs respond in character to ideas the player brings into conversation. External articles are neither story facts nor private NPC memories. Do not inject the entire library into system prompts or use Zhihu opinions to adjudicate values, approvals, or endings.

Main flow: current act → topic-limited retrieval → candidate filtering → DeepSeek extracts 2–3 evidence-based perspectives → source validation → perspective card → player selects “Bring into conversation” → populate draft → player sends → current NPC responds.

## Three information boundaries

| Layer             | Content                                               | Storage and permissions                                                                             |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Story facts       | Completed actions, material status, project progress  | Business saves/events, adjudicated by Python and filtered by role visibility                        |
| NPC memory        | Dialogue with that NPC and role-visible events        | Isolated by user + save + NPC; retain the existing last-30-event context and PostgreSQL checkpoints |
| Public references | Zhihu excerpts, authors, links, and perspective cards | Independent content library, not player accounts or default NPC memory                              |

Opening or bookmarking a card does not notify NPCs. Only sent expressions and selected citations become visible events for the target NPC. Switching NPCs does not propagate private chats. Multiple NPCs may independently retrieve public knowledge without sharing player behavior.

## Organizing perspectives by act

| Point                     | Retrieval scope                                                          | Possible perspective directions, subject to evidence                               |
| ------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Prologue                  | Distinguishing jokes from belittling; emotional responses                | Story only, without interrupting with search                                       |
| Act 1: farewell gathering | Exclusion, direct questions, maintaining contact with a senior colleague | Confirm facts; express discomfort; lower expectations of private friendship        |
| Act 2: procurement        | Material lists, cross-team cooperation, risk reporting                   | Clarify rules; complete records; communicate project impact                        |
| Act 3: rumors             | Fact clarification, professional delivery, propagation boundaries        | Clarify within an appropriate audience; inform leadership; avoid amplifying rumors |
| Interludes/ending         | Rumination, autonomy, relationship adjustments                           | Reflection material without revealing future endings                               |

These are retrieval/classification candidates, not predetermined “Zhihu consensus.” The 319 records are a limited search sample, not statistically representative opinions or a trending list. The UI should say “Zhihu perspectives / Different views” and “Compiled from X retrieved sources.”

## Retrieval and content processing

Phase one adds no vector database or other model. Use PostgreSQL topic mappings, keywords, and excerpt matching. Map the 30 expansion topics to exclusion, boundaries, procurement, reporting, rumors, intimate relationships, family, and similar tags, then rank only within the current act's allowed tags.

Retrieve at most 12 candidates. Filter duplicates, advertising, empty excerpts, and irrelevant topics, then provide at most six to DeepSeek. If the author is missing, show “Author information was not returned”; do not invent one. Preserve original provenance URLs and display excerpts, not full articles.

Add candidate / approved / rejected review status, topic tags, content hashes, and review notes to `zhihu_contents`. Upvotes are only a supporting signal, not proof of reliability. Keep all 319 initial records as candidate until reviewed.

If local approved content is insufficient, make at most one Zhihu search for a fixed generic act topic, returning at most ten items. Outbound queries contain no raw private chats, identity, or save IDs. Check cache/quota first and limit short-term request rates. Failure or insufficient quota falls back to clearly labeled editorial advice.

## Generation and citation constraints

Use the backend's unified ChatDeepSeek factory, fixed `deepseek-flash`, and non-thinking mode. Do not call Zhihu's direct-answer service.

Model input contains only allowed scene topics and candidate references, excluding hidden endings, other NPC chats, account data, and webpage instructions. Retrieved text is marked as external material and cannot change system constraints or grant tool access.

Suggested structured output: perspectives[{title, summary, suggested_expression, tradeoff, source_ids}]. Every perspective references IDs present in the input. The backend fills source titles, authors, and links from those IDs; never trust model-generated URLs. Reject unknown sources, empty citations, excessive length, and off-topic results. Source validation does not prove faithful summarization; source-comparison evaluation and spot checks are still needed.

Show one perspective if the evidence supports only one; use editorial advice if it supports none. Do not force 2–3 categories. Distinguish summaries of source viewpoints from generated expressions tailored to the scene.

## NPC integration

Prioritize player-initiated use. “Bring into conversation” only fills the input; the player can edit and send it. Submit card_id and perspective_id with the message. The backend verifies save ownership, act, and source allowlist, then freezes a citation snapshot. Requests cannot select arbitrary database records or URLs.

If proactive NPC citations are later needed, add read-only `lookup_public_advice(topic)`, returning at most two perspectives from authorized scene cards without unrestricted web search. Allow at most one lookup per turn within the existing tool budget; no additional retrieval-model call is needed.

- Sun Miao may defend herself, minimize the issue, or respond to clear boundaries, without turning into a counselor after reading advice.
- Li Jie focuses on materials, review steps, and process responsibility; external articles are not company policy.
- Engineer Zhang focuses on project facts and risks; cards do not authorize finance approval.

Reading or selecting cards does not directly change values. Material submission, reports, and clarification still use existing domain actions. LLM advice cannot directly write business state.

## APIs, caching, and persistence

Proposed additions:

- `POST /api/saves/{id}/discussions`: create or reuse generation by request_id, save version, and current act.
- `GET /api/saves/{id}/discussions`: retrieve this save's generated cards and sources.
- Existing turn requests may optionally include discussion_id / perspective_id, validated as player-supplied reference material.

Add discussion_jobs (idempotency key, status, usage, error), discussion_cards (save, act, body, generation version), and discussion_sources (source snapshots and hashes). Shared generation caches depend only on act topics, content hashes, prompt version, and model version, never private chats or names. Player selections and sends remain save-isolated.

Initially, add neither Redis nor a task queue. Reuse PostgreSQL unique constraints and short transactions to claim jobs, application timeouts, and restart recovery. Do not hold database transactions while waiting for external APIs. Publish completed cards atomically; interrupted work becomes retryable instead of a partially successful card.

Suggested initial budget: generate once on first opening per act, with at most one Zhihu search and one DeepSeek summary; reopenings reuse results. Limit daily user requests, global in-flight work, and output length, accounting alongside existing quotas and cost caps. These are proposed product budgets, not Zhihu platform limits.

## UI improvements

Retain clearly labeled editorial advice as fallback and add a separate Zhihu perspectives entry point. Renaming existing static advice must not imply Zhihu provenance.

Cards contain viewpoints, applicable situations, possible costs, expandable sources, and “Bring into conversation.” Support loading, no data, missing sources, and retryable states. Reading does not consume a player action turn. Mobile drawers scroll, links support keyboard navigation, and generation completion does not steal input focus.

## Other source-document differences

This integration does not also change values or endings. Separate decisions are needed:

1. Source analysis uses Zhou Ling (Lingling), while the proposal uses Zhou Lingling. The project currently uses the former. Centralize the display name before settling the adaptation's final naming.
2. The document separates rumination and work stress; the project currently has one stress value. Splitting it requires save migration and explicit rules, not free-form model scoring.
3. Ending categories differ between the document's first and second halves. Use four stable ending_id values, separating narrative titles from relationship choices; map them before rewriting ending copy.
4. The document proposes forced resignation at high stress; the game retains voluntary departure. Start with crisis prompts and optional actions. Forced endings require separately defined thresholds and recovery windows.
5. Prologue slides, ensemble openings, relationship graphs, and system contacts can follow in UI/story iterations without an autonomous director Agent. Zhihu sharing must be player-triggered, with preview generation by default and no automatic publishing.

## Implementation and acceptance order

1. Content review tags, act-based retrieval, and source snapshots.
2. DeepSeek summaries, idempotent caching, the perspective drawer, and fallback states.
3. Player-introduced perspectives and role filtering; add NPC read-only lookup only if needed.
4. Separate migrations for four metrics, the prologue, and ending branches.

CI uses fixed references and a mock LLM. Verify: no future-act cards; no cross-save/role private-chat access; injected source instructions cannot trigger business tools; fabricated sources are rejected; duplicate requests and refresh do not double-charge; external rate limits/timeouts/restarts recover; selecting a view does not change values; desktop/mobile users can inspect citations and edit drafts. Real APIs receive separate, small, budget-capped integration checks outside routine CI.
