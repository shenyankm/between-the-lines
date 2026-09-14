# Frontend component conventions

HeroUI 3.2.5 provides the shared UI foundation with Tailwind CSS 4.3.3. `theme.css` imports only used component styles and sets the existing blue/green surfaces and gold accent. CSS Modules own page geometry and narrative visuals; do not add competing utility classes to override component variants.

Vite resolves `tailwind-variants` to its official `lite` entry: HeroUI uses BEM component classes, and this application composes CSS Modules rather than conflicting Tailwind utility classes. This deliberately omits utility conflict resolution. If future code requires that feature, revisit the alias and verify the original 150,000-byte gzip budget. Terser compresses the production bundle; no asset or coverage thresholds are relaxed.

The saves page uses HeroUI Button and Card with separate header, metadata, and action areas. Router links retain client-side navigation. Story art, relationship graph geometry, native meter semantics and share canvas remain domain-specific visuals.

Migration proceeds in independently reviewable page changes: saves, V3 panels and controls, ending, then legacy/shared states. Existing API, save and recovery behavior must remain intact. Keyboard, narrow viewport and long-content checks accompany each page.

References: [HeroUI setup](https://heroui.com/en/docs/react/getting-started/quick-start), [Tailwind Variants lite](https://www.tailwind-variants.org/docs/quick-start).

## V3 controls and panel exceptions

V3 controls use HeroUI Button, Form and TextArea. Existing draft keys, submission callbacks and action permissions remain authoritative. The five panels share a fixed title/close region and an independently scrolling body with consistent form, list, evidence and empty/error styles.

The overlay shell intentionally retains browser-native `dialog`: HeroUI Modal brought the combined production JS above the existing 150 KB gzip budget even with lite variants and minification. Native dialog preserves modal focus containment, Escape and focus restoration without another overlay runtime. The existing native selects, checkboxes and meters also retain their HTML semantics. These are explicit migration exceptions, not wrapper imitations of HeroUI controls.

V3 follows system `prefers-reduced-motion` changes directly. The retired identity-specific override is removed, including when it conflicts with the system; storage access failures do not disable system preferences.

## Ending page

HeroUI Card retains the ending region and action footer. The 1064 poster area uses self-hosted Noto Serif SC, a centered title, E01–E06 code, full-width illustration and narrative below it. The user's later visual clarification replaces the initial desktop split-column proposal with the same vertical poster order on all widths. CSS background slices retain the original paper ornaments without baked-in text or duplicate portrait edges. The E01–E06 source posters, per-image cleanup method, and rebuild command are recorded in [poster provenance](assets/ending-posters/README.md).

Saved facts and share controls follow the poster in ordinary document flow. Share selection permits at most three saved achievements/unresolved facts; default copy contains the ending, expression style and four final metrics. Preview, clipboard and export derive from the same lines. PNG is 900px wide and at least 1600px tall, with measured wrapping, awaited fonts/images, and explicit failure states. Noto Serif SC loads by unicode-range only where the ending uses it; ordinary game typography remains unchanged. Paragraphs are rendered as text, not HTML. Navigation remains in normal flow and never overlays the poster.

## Legacy and shared UI

Legacy conversations, menus, result panels and interludes use the same HeroUI buttons and form controls; shared errors use Surface while retaining `role="alert"`, retry delays and diagnostic-copy behavior. Router links, authored story artwork, share canvas, native dialogs, select/checkbox/meter and disclosure details are deliberate semantic exceptions. The native dialog shell remains shared in design conventions across versions, with existing focus and close behavior preserved.

The migration does not change account identity, per-save draft storage, turn idempotency, recovery or server facts. Validation includes a legacy save fixture with a rejected submission to ensure the input and shared error remain usable.

## Responsive and feedback conventions

The V3 stage uses separate grid areas for title/metrics, tools, portraits, dialogue and feedback. Above 1000px, tools occupy the right column; smaller windows place tools in normal flow. At 700px the metrics and controls compact, and windows at most 500px high use a small portrait region. The header keeps the four metric values visible on every width; the explanatory panels and the in-stage reading settings are gone, while stored reading preferences (size, reveal speed) still apply. The dialogue panel renders only the current speaker's name and anchors it to that speaker's side of the stage — left for 周菱菱, 旁白 and 内心独白, right for the characters shown on the right — and every line reads left-aligned whether it is short or long. Tool actions and account navigation remain separate groups. Long content wraps and scrolls instead of being clipped.

Native selects and text controls use the shared field colors, 16px input text and visible focus outlines. Independent buttons and close controls have a minimum 44px height. Both legacy and V3 drawers keep their header outside the scrolling body; native confirmation dialogs focus the title and keep their actions outside the scroll region. Modal height uses dynamic viewport units and safe-area insets. Returning home and logging out confirm through that same dialog: a failed logout keeps the dialog open with an inline retry, and cancel restores focus to the invoking tool.

Turn feedback is rendered once in the currently accessible V3 surface (stage, drawer, confirmation or interlude). Keep the existing controller as the source of pending/recovery behavior. Forms explain unavailable actions from the server; local save management locks only the affected card. Display helpers may translate ending labels and choose version-specific metrics, but must not rewrite saved facts. See [verification](verification.md) for evidence, reproduction commands and remaining device checks, and [mobile reading and accessibility validation](mobile-reading-validation.md) for the open physical-device checklist.
