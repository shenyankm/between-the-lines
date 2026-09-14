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

HeroUI Card separates the ending header, responsive narrative/facts columns and action footer. Paragraph breaks are rendered as text nodes, not HTML. Facts, outcome lists, copy text and the share canvas keep their existing data sources. On ending screens the navigation returns to normal document flow so the wide card cannot cover the work/history controls.
