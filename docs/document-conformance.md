# Source-document conformance implementation record

Reference: https://ccnoz23f7y98.feishu.cn/wiki/Ka47wg91jiUW1ekAcbFc9Fuonqe

The source was read at version 1011. Eleven blue Feishu callout notes added on 2026-09-13 produced version 1022; rewriting them in plain language for a product manager produced version 1033. Full decisions are in `conformance-decisions.json`. Every note was read back; image and attachment blocks were unchanged before and after writing.

## 2026-09-14 · 1064 版结局海报与生成质量

本次以 1064 版六张海报为素材基线。已完成清理素材、E01–E06 映射、结局页与分享卡、众议多样性及复盘角色归属调整。按用户追加要求，桌面也采用原图的纵向海报布局，替代最初计划中的左右栏；中文宋体、居中标题、编号、字距与正文留白一并对齐。

本次没有修改六结局判定、剧情分支、存档内容、接口或数据库结构，也没有向飞书回写或部署生产。以下历史检查项保留原时间点含义；本次范围的最新证据见[交付报告](ending-posters-2026-09-14.md)。

## Acceptance checklist (unchecked means incomplete or insufficient evidence)

- [x] R01–R11 conflicts and implementation supplements recorded beside the source, preserving original text.
- [x] Original v3 story frozen as story-v3-r1.json; saves without content_revision interpreted as revision 1.
- [x] New saves explicitly use content_revision=2; old revisions are read-only, prohibit new turns/branches/AI tasks, and do not count against new-version capacity.
- [x] Old turns/tasks drained before switching; afterward, row-by-row comparison confirmed the original three saves, four turns, one AI task, and one cost record were unchanged (`/tmp/btl-old-state-preserved.json`).
- [ ] All three acts' source dialogue, appearance order, locations, clothing, speaker emphasis, and three original entry points accepted.
  - Revision 2 contains fifteen opening source-dialogue segments across three acts, with per-line location/background; mandatory private-life interludes removed.
  - Act 1 separates its three source entries, requesting participation, and actual attendance; cafeteria node added. Browser acceptance pending at this checkpoint.
  - Act 2 automatically retains yesterday's ordinary application and vague return, and supports approval by rechecking original materials. Review and material versions are separated. Full expedited-request and actual-missing-material performance remains incomplete.
- [ ] Act 2 starts with yesterday's application and unread vague return; original templates/evidence and both genuine omissions and unreasonable-return paths.
- [ ] Material versions separated from review records; complete permissions for Li Jie review, Zhang coordination, and Accountant Wang advice.
- [ ] Act 3 job-change rumors implemented through facts, propagation, clarification, and corrective feedback; unknown sources remain unknown.
- [ ] Project-review advance notice, delays/alternatives, actual losses, and subsequent correction; time advances only at nodes.
- [ ] Repair/boundaries/rule changes follow request → response → execution → later cooperation, without outcome buttons writing success directly.
- [ ] Full leave, help, and exit application/handling flows; initiating exit does not mean procedures are complete.
- [ ] Browser completion for all six endings, combination precedence, independently stored achievements/unresolved matters.
- [ ] Visible high/low consequences for four metrics, event deduplication, no score farming or automatic resignation.
- [ ] Natural expression across the catalog, source grounding, negation/quotation/hypothesis/conflict clarification, persistent consequential confirmation.
- [ ] Independent conversations for four contacts/work group, history pagination, unread state, privacy, and draft isolation.
- [ ] Relationship nodes/edges/original events and equivalent mobile list.
- [ ] Real Zhihu search, caching/concurrency/rate limits/empty results/invalid sources/fallback verification.
- [ ] AI ending text directly on the ending page, key interactions, aftermath for four metrics, failure fallback, and independent reflection.
- [ ] Share-card image export/copy/Zhihu entry, actual-choice grounding, no automatic publishing.
- [ ] Duplicate turn controller fixed; deep state/channel/parameter/three-AI-contract validation; legacy history pagination.
- [ ] Per-scene desktop/mobile checks, long text, hardware/software keyboards, focus, no horizontal overflow, reduced motion.
- [ ] Disconnection recovery, repeated requests, expired confirmation, zero-AI routes, full regression and generated-contract checks.
- [ ] Source-image/layout mapping, unused generated intermediate asset cleanup, and final delivery report.

## Existing verification (not whole-project acceptance)

- New content-revision units plus original six-ending rules: 17 passed.
- Read-only content-revision APIs, existing v3 APIs, and revision units: 13 passed in isolated btl_upgrade_test_v3_checks.
- Legacy-revision history unchanged; new turns/branches/tasks rejected; original story accessible with revision=1.
- Main preview database btl_upgrade_test_v3_20260913 is not cleared; ports 8000 / 18732 and their original database are untouched.
- Two earlier real-model rounds cost a cumulative 0.034458 USD; subsequent work remains under the total 2 USD cap.

## Current limitations

The new revision remains under construction; conformance is not complete. Job-change rumors replaced procurement-progress wording, and sending clarification is separate from corrective group responses. Other ending processes need completion before switching preview. This record proves only the listed verification.

## Incremental verification

- New Act 1/procurement rules and existing six-ending rules: 17 passed.
- Existing v3 API/rule combination after adjustments: 24 passed; three additional unit tests subsequently passed separately.
- Ruff, ESLint, frontend type checks, and backend mypy passed.

## Rumor and history increment

- `clarify` records only sending an explanation. `review_clarification` records `clarified` only after the scripted event of relevant repeaters correcting it within the original audience. Without correction, work-handled conditions such as rewriting rules cannot trigger.
- Acts 2 and 3 have the three source entry points. Act 2 private-chat/work-system entries only open their interfaces; they do not send or submit for the player.
- Act 3 can still report project status to Zhang, recorded separately from Act 2 risk reporting without duplicate report scores.
- New and legacy stages mount conditionally, removing simultaneous turn-recovery controllers.
- Complete history has cursor pagination, including legacy saves. Phone history adds per-channel/contact pagination.
- Rule/API combination: 29 passed; subsequent rule-only run: 19 passed. Play regression: 19 passed; new history pagination: one passed.
- Previous full frontend run: 218 passed / one failed due to a missing Home link on an error page. Fixed and retested with nineteen Play tests; other tests were not repeated.
- Overall acceptance remains incomplete. Next priorities: request/response/execution for repair, boundaries, rule changes, full personnel flows, and the ending page.

## Relationship and rule increment

- Keeping friendship now creates `friendship_offer`; mutual willingness to repair and acknowledgment of specific harm are recorded only after Sun Miao actually responds.
- Repair dialogue explicitly corrects outside statements and restores later work notifications while acknowledging missed opportunities cannot be recovered.
- Later cooperation requires `boundary_response`. Attend/decline/ask-about-arrangements preserve the player's intent and distinct replies. Missing parameters are rejected without assuming agreement or refusal.
- `change_rules` records only Li Jie's agreement. `apply_rules` after project review records actual application and satisfies the rewriting-rules condition.
- Original rule/API suite: 29 passed. After willingness, three-response, and rule-application tests, rule units totaled 24 passed.
- Real-page playthrough remains necessary. Full personnel applications, threshold situations, and AI ending integration were incomplete at this checkpoint.

## Leave and help increment

- Added SupportApplication with reasons, handover/work-allocation plans, and separate event references for draft/submission/approval/implementation.
- `draft_support` saves a preview, `submit_support` submits formally, and Zhang processes `review_support`. Existing `rest` / `request_help` only implement approved arrangements.
- Unsubmitted applications cannot be reviewed; unapproved ones cannot be implemented. Stress decreases by ten only after implementation; repeats are rejected. New drafts cannot overwrite submitted unfinished applications.
- Work extracts SupportForm for previews, status, decisions, and history. Application reasons do not enter ordinary NPC group-visible event text.
- Rule/API combination: 37 passed. Frontend types, ESLint, and backend mypy passed; Ruff import ordering fixed.
- Actual browser submit/refresh/recovery remains necessary; this is not complete personnel-feature acceptance.

## Ending-page increment

- EndingNarrative directly displays generation state, AI text, key interactions, and fact fallback. Request IDs persist by user/save/final version and are reused on refresh.
- Ending pages show distinct aftermath for all four final values without asserting forgiveness or emotional closure, and offer an independent new story.
- Generation input includes all confirmed work/relationship facts. Key-event selection includes actual work events and tool consequences.
- System action summaries are separated from words actually spoken by the player, avoiding treating button-generated copy as player speech.
- Two frontend tests passed for remount request reuse and generation fallback. One isolated API test passed for ending-job facts/original wording/idempotency; three existing search/generation checks passed.
- Frontend types, ESLint, backend mypy, and Ruff passed. Full new-version browser completion and complete typed contracts for all three AI result types remained pending.

## Relationship-graph increment

- Desktop graph centers on Zhou Lingling with edges to four contacts; mobile uses an actionable list with equivalent relationships.
- The backend projects event IDs per relationship. Selecting someone retrieves original evidence rather than truncated identifiers.
- A single-event endpoint validates both save and event ownership. Cross-save/user access returns unavailable.
- Sun Miao's description uses current willingness and actual facts; old sun_cut flags do not override new repair intent. Contacting Accountant Wang once no longer implies a reply was received.
- Five evidence-permission/API/projection tests passed; thirty existing rule/revision tests passed; one frontend original-evidence retrieval test passed.
- Types and code checks passed; actual desktop/mobile appearance still required browser acceptance.

## Natural-expression increment

- v3 NPC tools read the complete current action catalog. Clear ordinary actions use the same transition as buttons; major actions use one v3 confirmation set.
- Added explicit expressions for list requests, boundary questions, review evidence, friendship willingness, and closure. Sentences containing quotation, negation, hypotheses, or conflicts do not execute.
- Automatically recognized group clarification uses the work-group channel and employed-colleague audience, not a private chat.
- Natural invitation API verification requests joining the list without automatically attending. Thirteen new intent/API tests passed; earlier rule/API regression had 39 passed.
- Limits remain: matching depends on defined expressions and source action names; arbitrary paraphrases are unverified. Form parameters are not extracted automatically from free text; missing fields must be filled. This is not complete semantic acceptance.

### Latest asset confirmation: tea room and male Engineer Zhang

- Act 1 tea-room opening/list confirmation uses the user-supplied `tea-room.png`; actual farewell attendance remains in the cafeteria.
- New stories use original `zhang-male.png`, with male persona and mixed-gender forms of address. Legacy stories retain the original image and historical presentation.
- Feishu version 1039 confirmed the male Engineer Zhang product note, consistent with local decisions.

### 2026-09-13 combined regression and first browser completions

- Addressed nineteen backend integration failures by updating obsolete three-ending/no-form/role-permission assertions while preserving idempotency, races, quota stopping, committed facts, privacy, and AI-source validation.
- Fixed actual defects: Li Jie's natural material request was incorrectly blocked by permissions; “materials are complete, please review” was interpreted as two requests; coworker action catalogs exposed private romantic choices.
- Full backend integration: 153 passed (`/tmp/btl-integration-current.log`); after ending-fact changes, 32 relevant integration tests passed. Units: 176 passed; mypy: 36 modules passed. Frontend: 223 passed and production build passed; new stage regressions are recorded separately.
- Current performance is projected from backend facts with its own version. Reading cannot advance while new state and old performance are temporarily out of sync. Approved procurement no longer displays “not finished,” and undelivered work is not guaranteed on time.
- Desktop completed “各自为界” (Separate Boundaries), save `ee314bc5-d808-4dea-a0e5-59a993038173`: prologue, tea-room list confirmation, cafeteria attendance, original-material review, Li Jie approval, group correction, delivery, professional-relationship confirmation, respected later refusal, and explicit closure.
- Mobile 390×844 completed the transfer route “主动转身” (Choosing to Move On), save `68060229-9db6-4da0-a0e0-50f7b0ab58e4`. Drafting did not end the story; Escape preserved the draft; formal confirmation closed it. Consequential confirmation uses a native modal showing application type and reason.
- Down coats, tea-room background, and male Zhang were visually confirmed; mobile ending had no horizontal overflow. All six routes and a real software keyboard were not yet completed. Historical records created before some corrections remain unchanged.
- Added the missing Act 3 closure button and three later-cooperation replies; fixed free input after the prologue, confirmation-time blank events overwriting current dialogue, and excess desktop whitespace below dialogue. User reduced-motion settings are retained.
- Share preview and copy feedback are visible. No download event was captured for in-app browser export, so export is not accepted and needs further repair/verification.
- Early exits no longer list nonexistent procurement disputes or rumors as unresolved. Exit facts explicitly say the application is submitted but procedures remain pending. Existing Feishu product notes were synchronized and read back through version 1042 (`/tmp/btl-notes-verified-current.json`).
- Two new stage regressions passed: out-of-sync performance cannot advance, and all three later-cooperation replies plus closure remain reachable. Frontend types and ESLint passed. Row comparisons showed unchanged legacy saves, terminal results, and costs.

### Grouped commit checks

- Implementation was grouped into assets, backend, frontend, acceptance documentation, and evaluation tooling. Committing does not mean complete product acceptance.
- Before commit, all frontend tests passed: 23 files, 225 tests. Backend units: 176 passed. Contracts had no drift; committed Python files passed Ruff.
- Unused intermediate protagonist images and obsolete WebP files were moved into a local ignored archive. The active manifest references only retained final assets; the user's asset directory was unchanged.
- Remaining work includes browser completion of the other four endings, actual share-image export, a real software keyboard, latest real-model and Zhihu API verification, and the gameplay/contract gaps above.
