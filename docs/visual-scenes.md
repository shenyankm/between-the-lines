# Scene art and narrative references

References: [Content summary and character analysis](https://ocn2ki5kcbpc.feishu.cn/docx/C6LWdjODtoROluxOl80cCVJtnMe), read at version 6; [workplace source text](https://ocn2ki5kcbpc.feishu.cn/wiki/JhD3w2j8NihO89kEZPIcR3aynWd), read at version 216; and the user's list of six background categories.

This document is intentionally self-contained. Private HTML caches from those Feishu documents are in `doc-fetch-resources/`, excluded by `.gitignore` and never committed. Art rationale, style constraints, and decisions are recorded here so the conclusions remain understandable after deleting the cache; no uncommitted local artifact is required.

Style: contemporary editorial illustration / lightly realistic visual novel. Retain the original laboratory's blue-gray palette, warm light, glass partitions, and urban setting. Scenes contain no characters, logos, or body text, leaving room for dialogue overlays. Images live in `frontend/public/assets/`; the original `office.png` is retained.

| Scene                   | Asset                | Game use                                                                           |
| ----------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| R&D workspace           | office-morning.png   | Prologue, Monday 09:10                                                             |
| Cafeteria               | cafeteria-noon.png   | Act 1, Friday lunch; empty cups and plates after the gathering                     |
| Bedroom                 | bedroom-night.png    | Nighttime reflection after Act 1                                                   |
| Finance counter         | finance-rain.png     | Act 2 procurement review on a rainy day                                            |
| Corridor                | corridor-evening.png | After Act 2: organize facts after work and revisit that evening's private decision |
| Meeting room            | meeting-morning.png  | Act 3 project meeting                                                              |
| R&D workspace at sunset | office.png           | Home and ending                                                                    |

In this iteration, the protagonist is Zhou Ling, nicknamed Lingling, and Engineer Zhang is explicitly a female R&D lead. The bedroom is an ordinary urban home, with a long black down coat and research notes as character details. The first interlude combines the senior schoolmate's relationship categories, the mother's awkward care, and family greetings. The second covers the breakup with Xie Chuan, preserves mother-daughter affection, and makes personal autonomy explicit. Both use newly written text and keep private content out of NPC conversation context. Later content-revision decisions are recorded in the [R01–R11 conformance decisions](data/conformance-decisions.json).

This remains the agreed three-act workplace adaptation, with procurement and rumor events in the game's established order. Xie Chuan, the mother, and the senior schoolmate are background figures in fixed interludes, not new autonomous Agents. This does not implement every romantic, family, or distant-future branch of the novel. Weather and exact times are art-direction choices.

Interludes can return to the current scene or close with Escape. Only “进入下一幕” (Enter the next act) sends the existing next action, whose prerequisites remain backend-validated. Cancellation does not change saves; refresh restores the current act from the server.

Verification at this stage: TypeScript/Vite build, ESLint, and desktop/mobile scene browser tests passed. Browser tests intercepted APIs without real LLM calls. They checked all background decoding, both interludes, cancellation without actions, continuation with exactly one action, and page width.

See [relationships and endings](story-relationships.md) for relationship state, the final Act 3 choice, and legacy-save compatibility.
