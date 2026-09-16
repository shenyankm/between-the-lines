# Scene art and narrative references

Current scene locations and asset paths come from [story-v3.json](../backend/app/story-v3.json). Both playable content revisions use these workplace scenes; scoring differences are documented in [route balance](route-balance-r3.md).

| Scene          | Asset                   | Setting                                                    |
| -------------- | ----------------------- | ---------------------------------------------------------- |
| Prologue       | `office-morning.png`    | R&D workspace, Monday 09:10                                |
| Act 1          | `tea-room.png`          | Tea room, Friday 12:15                                     |
| Act 1 farewell | `cafeteria-noon.png`    | Company cafeteria after joining and attending the farewell |
| Act 2          | `meeting-room-act2.png` | Meeting room, Tuesday 10:30                                |
| Act 3          | `meeting-room-act3.png` | Project meeting room, Thursday 09:00                       |
| Ending         | `office.png`            | R&D workspace after the story                              |

The table includes act backgrounds and scene-specific overrides. The optional `act_1_farewell` scene uses the cafeteria artwork in both playable revisions. The protagonist is Zhou Lingling (周菱菱). The workplace story does not automatically enact a romantic breakup or family reconciliation when changing acts. Older bedroom/corridor artwork and versioned narrative files are retained for historical content; their presence is not a current playable scene. See [story scope](story-scope.md).

## Asset conventions

Use contemporary editorial illustration with the laboratory's blue-gray palette, warm light, glass partitions, and urban setting. Backgrounds leave space for dialogue overlays and contain no added characters, logos, or UI text. Authored ending posters are the deliberate exception: preserve the complete source image and its original text.

Original PNGs live in `frontend/public/assets/`. `python scripts/build-images.py` uses Pillow to generate content-hashed WebP variants and `frontend/src/assets.json`; `python scripts/check-product-assets.py` validates responsive assets and payload budgets. Do not delete apparently unused original artwork without checking versioned story references and the asset build script.

[Ending poster provenance](assets/ending-posters/README.md) records the E01–E06 originals. The [R01–R11 decisions](data/conformance-decisions.json) preserve source/product conflicts and their resolutions without rewriting the source documents.

Historical visual references: [content and character analysis](https://ocn2ki5kcbpc.feishu.cn/docx/C6LWdjODtoROluxOl80cCVJtnMe), recorded at version 6, and [workplace source text](https://ocn2ki5kcbpc.feishu.cn/wiki/JhD3w2j8NihO89kEZPIcR3aynWd), recorded at version 216. These are provenance records, not newly verified source readings. Private caches under `doc-fetch-resources/` remain Git-ignored and are not required to understand the repository's implementation.
