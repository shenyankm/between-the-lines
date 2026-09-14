# Relationships and endings

This iteration uses the user-provided relationship diagram for the source novel “横扫恶意，找回自我” (Overcoming Malice, Rediscovering Yourself) as the main ending reference. The full novel was not retrieved again. New dialogue, Uncle Wang's reply, and interludes are original game writing, not claimed as verbatim adaptations. The three workplace acts and conversation Agents for Sun Miao, Li Jie, and Engineer Zhang are retained.

## Relationship development

- Zhou Ling once considered Sun Miao a friend. Early confrontation or boundary-setting changes events and values but does not replace the final private-relationship choice in Act 3. Ending private contact still permits necessary work communication.
- Li Jie verifies notices and facts while mediating, without asking the protagonist to endure mistreatment. She approves complete procurement materials. Engineer Zhang only provides project support; facts are recorded only after an actual report and support-tool execution.
- Uncle Wang is a retired senior colleague and intergenerational friend. `contact_wang` atomically writes a greeting and a `personal` reply with an empty audience, visible only to the player. Repeated requests do not duplicate it.
- After Act 1, a senior schoolmate helps the protagonist distinguish relationships, while her mother and family express care. After Act 2, the protagonist breaks up with Xie Chuan while retaining maternal affection and asserting autonomy. These fixed narratives are recorded only after successfully entering Acts 2 and 3 respectively. Closing the interlude does not commit facts.
- Xiao Liu and Xiao Chen ask about or repeat rumors; the original source remains unverified. NPCs cannot accuse Sun Miao of originating them without evidence.

## Actions and projections

In the current v3 release, Act 3 offers the final private-relationship choices that set `relationship.intention`: `cut_ties` (retain work-only contact, stores `sun_cut`), `keep_distance` (defer, stores `sun_observe`), and `repair_friendship` (offer to keep the friendship). These do not score repeatedly. The ending itself is not a button the player clicks but one of six outcomes the server adjudicates from the committed work and relationship facts at close, shown as posters E01–E06: `rules_rewritten` (改写规则), `professional_boundary` (各自为界), `limited_repair` (有限修复), `active_exit` (主动转身), `career_cost` (付出代价), and the `unresolved` (尚未破局) fallback. A submitted exit resolves to `active_exit` and summarizes only events that have already happened; the earlier “只留工作往来 / 继续观察” two-ending framing was superseded by this fact-based set.

`relationship_story` marks saves using these rules; `reflection` / `personal_resolved` track interlude progress. Existing flags are retained, with no new table or `state_schema_version` change.

`SaveOut` adds backend-derived `relationships` (id, name, role, description), `npc_greetings`, and `ending_summary`. Story material is centralized in `backend/app/story.json`. Public story data excludes NPC personas and future relationship variants. The phone retains three chat contacts; other characters have read-only cards. The fixed ending summary is independent of the retryable generated reflection, which receives only confirmed relationship facts.

Final relationship choices and boundary events are visible only to Sun Miao; reports and project support only to Engineer Zhang. Uncle Wang's reply, family matters, and romantic status never enter workplace NPC history or visible flags. NPC tone by act also follows only visible facts.

## Legacy saves

Completed saves retain their original endings, events, and reflections. Endings without `relationship_story` show “旧版结局” (Legacy ending), without inferring a breakup or severed friendship. Unfinished legacy saves retain work facts and use the relevant narrative for their current act. Act 3 requires the final choice, and subsequent submissions persist the narrative marker. Story content is cached in-process, so restart the backend after story changes.

## Verification entry points

Backend `test_relationships.py` covers branches, prerequisites, mutual exclusion, early departure, and legacy saves. `test_api.py` checks duplicate requests, private-event filtering, and relationship projections after refresh. Frontend `relationships.test.tsx` checks choice prerequisites, relationship cards, and fixed summaries without generated reflections. Browser `game.spec.ts` completes both relationship endings on desktop/mobile and checks refresh recovery; `scenes.spec.ts` checks interlude cancellation and assets.
