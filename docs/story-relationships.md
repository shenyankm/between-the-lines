# Relationships and endings

The current story follows Zhou Lingling (周菱菱) through the three workplace acts. Sun Miao, Li Jie, and Engineer Zhang are the three conversational NPCs. Authored scenes live in [story-v3.json](../backend/app/story-v3.json); older story files remain for compatibility. [Story scope](story-scope.md) defines the boundary between the workplace story and unimplemented partner/family scenes.

## Relationships and permissions

- Sun's private relationship with the protagonist is separate from required professional cooperation. A boundary expression does not imply forgiveness or a final relationship choice.
- Li owns procurement approval and checks the recorded materials. Zhang coordinates project support and delivery; neither conversation nor a relationship choice grants financial authority.
- Wang is a senior colleague with an authored farewell contact. His reply is not a fourth autonomous NPC or evidence that workplace actions completed.
- Rumor responsibility depends on evidence. Characters must not accuse another person of originating a rumor without a recorded basis.
- Advancing an act does not commit a breakup, reconciliation, disclosure, acceptance of family advice, or emotional closure. Historical explicit private choices remain preserved and isolated from workplace NPCs.

The backend derives relationship cards, greetings, and summaries through `SaveOut` and versioned story definitions. NPC history is filtered by recipient and audience; private chats do not become another NPC's memory. Public story projections omit personas and internal prompts.

## Choices and endings

Act 3 offers `cut_ties`, `keep_distance`, and `repair_friendship`, representing professional-only contact, an undecided relationship, or willingness to retain friendship. Repair requires actual supporting actions; a choice alone does not fabricate an apology or completed remedy. Work prerequisites and consequential-choice confirmations remain server-owned.

The backend selects an ending from committed facts when the story closes:

| ID                      | Poster       | Meaning                                                                             |
| ----------------------- | ------------ | ----------------------------------------------------------------------------------- |
| `rules_rewritten`       | E01 改写规则 | Recorded procurement approval, clarification, responsibility, and rule change       |
| `professional_boundary` | E02 各自为界 | Professional boundaries supported by the saved outcome                              |
| `limited_repair`        | E03 有限修复 | Relationship repair supported by actual actions                                     |
| `active_exit`           | E04 主动转身 | An exit application has been submitted; later arrangements are not assumed complete |
| `career_cost`           | E05 付出代价 | Unresolved recorded career consequences                                             |
| `unresolved`            | E06 尚未破局 | Remaining work or relationship issues                                               |

Exact precedence and prerequisites are defined in [V3 rules](../backend/app/story_rules.py), not by numeric scores or a direct “choose ending” button. [EndingOpening](../frontend/src/features/v3/EndingOpening.tsx) describes the saved work and relationship state, then [Ending](../frontend/src/features/v3/Ending.tsx) displays the matching original poster. Generated ending artifacts remain a backend capability; generated prose and share/export controls are not part of the current ending page.

## Compatibility and verification

V1/V2 and V3 revision 1 are read-only history. Existing endings, events, and choices are not rewritten; missing historical choices must not be inferred. V3 revisions 2 and 3 remain playable with their own scoring. See [route balance](route-balance-r3.md).

[Play routing tests](../frontend/src/Play.test.tsx) cover read-only history and V3 recovery. Browser suites under `frontend/e2e/` cover relationship choices, ending facts and variants, original posters, and refresh recovery. See [verification](verification.md) for commands and the distinction between mock, real-model, and player acceptance.
