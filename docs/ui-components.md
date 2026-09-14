# Frontend component conventions

HeroUI 3.2.5 provides the shared UI foundation with Tailwind CSS 4.3.3. `theme.css` imports only used component styles and sets the existing blue/green surfaces and gold accent. CSS Modules own page geometry and narrative visuals; do not add competing utility classes to override component variants.

Vite resolves `tailwind-variants` to its official `lite` entry: HeroUI uses BEM component classes, and this application composes CSS Modules rather than conflicting Tailwind utility classes. This deliberately omits utility conflict resolution. If future code requires that feature, revisit the alias and verify the original 150,000-byte gzip budget. Terser compresses the production bundle; no asset or coverage thresholds are relaxed.

The saves page uses HeroUI Button and Card with separate header, metadata, and action areas. Router links retain client-side navigation. Story art, relationship graph geometry, native meter semantics and share canvas remain domain-specific visuals.

Migration proceeds in independently reviewable page changes: saves, V3 panels and controls, ending, then legacy/shared states. Existing API, save and recovery behavior must remain intact. Keyboard, narrow viewport and long-content checks accompany each page.

References: [HeroUI setup](https://heroui.com/en/docs/react/getting-started/quick-start), [Tailwind Variants lite](https://www.tailwind-variants.org/docs/quick-start).
