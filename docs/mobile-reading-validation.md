# Mobile reading and accessibility validation

The mobile stage now places dialogue and input before secondary tools in both DOM and visual order. Metrics start collapsed on narrow screens. All existing tools, save navigation and logout remain available. Focused input reduces portrait space without clipping dialogue. Reading size and reveal speed persist per account and save in the current browser tab; reduced motion always reveals complete text. Receipt details collapse inside a tool panel so forms remain reachable.

Automated coverage uses Mock data, Chromium desktop and a 390 px touch viewport, plus 320 px (equivalent narrow reflow), landscape, large text, long Chinese input, restored preferences and 44 px primary controls. These are browser simulations, not physical keyboard or screen-reader results. Before/after baseline images are linked in issue #34; updated desktop/mobile screenshots are attached to its PR.

## Physical-device acceptance: still pending

No physical iOS/Android device or VoiceOver/TalkBack session was available for this change. The following checks remain open; do not infer completion from Playwright/WebKit or screenshots.

- [ ] Record device model, OS, browser and assistive-technology versions.
- [ ] iOS Safari and Android Chrome: open/close keyboard, Chinese composition without premature submission, move caret and edit long input, rotate, background and return.
- [ ] Verify current context, input, send button and feedback remain reachable with the keyboard open; test 200% browser zoom as well as narrow reflow.
- [ ] VoiceOver and TalkBack: reading order, recipient label, status announcements, panel focus/close, return to saves.
- [ ] Observe whether a target player finds input and tools; record outcomes, not just screenshot appearance.

No story rules, permissions, persisted events or turn recovery protocol change. Old saves retain their facts.
