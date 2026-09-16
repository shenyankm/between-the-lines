# Frontend component conventions

HeroUI and Tailwind provide shared controls; [package.json](../frontend/package.json) pins their versions. `theme.css` imports the used component styles. CSS Modules own page geometry, the existing colors, and narrative artwork. Preserve accessible names, focus indication, draft storage, and server-derived permissions when changing controls.

Vite aliases `tailwind-variants` to its `lite` entry because the application composes CSS Modules rather than conflicting utility classes. The alias omits utility conflict resolution. Terser keeps the production JavaScript within the existing 150,000-byte gzip budget; verify the budget before introducing a heavier component runtime.

## Controls and panels

Use the existing HeroUI Button, Card, Form, TextArea, and Surface patterns. Router links retain navigation semantics. Native selects, checkboxes, meters, disclosures, and `dialog` remain deliberate exceptions. The native modal shell preserves focus containment, Escape, and focus restoration without the additional overlay bundle cost.

Panels keep title/close controls outside independently scrolling content. Forms display the server's reason when an action is unavailable. Account navigation is separate from story tools; save operations lock only the affected card. Render each turn's feedback once in the accessible surface and keep `useTurnController` authoritative for submission and recovery.

The UI follows system `prefers-reduced-motion` changes directly. Stored reading size and reveal speed remain supported; the removed in-stage reading settings must not be described as visible controls.

## Ending and old saves

The ending opens with factual narration from `EndingOpening`, then displays the complete E01–E06 source image through `Ending`. Keep the original title, text, handwriting, and illustration intact; scale proportionally without cropping or adding generated prose. Failed artwork displays an honest text fallback. See [poster provenance](assets/ending-posters/README.md) and `frontend/e2e/ending-posters.spec.ts`.

There are no current ending share/export controls or generated-narrative component. Legacy saves use the read-only `EventHistory` page with a home link; they do not render conversation input, menus, or old gameplay drawers. Input-error regression tests exercise V3, and responsive tests cover read-only legacy history.

## Responsive behavior and accessibility

The V3 stage separates title/metrics, tools, portraits, dialogue, and feedback. Wide screens place tools beside the stage; smaller screens place them in normal flow. Mobile dialogue/input precede secondary tools. Focused input reduces portrait space; long content wraps or scrolls. Speaker labels follow the speaker's side, while dialogue text remains left-aligned.

Use 16px input text, visible focus outlines, and at least 44px primary/close controls. Native dialogs use dynamic viewport height and safe-area insets; confirmation titles and actions remain reachable while the body scrolls. Home-return and logout flows retain confirmation, cancellation focus restoration, and local error recovery.

Check narrow reflow, landscape, long Chinese text, focus, reduced motion, and feedback placement with the existing browser suites. Physical iOS/Android keyboards and VoiceOver/TalkBack acceptance remain open in [verification](verification.md#physical-device-acceptance-still-pending).
