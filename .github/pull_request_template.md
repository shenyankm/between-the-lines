<!-- Write the PR title and description in English. Use type(scope): description.
Original UI text, logs, and screenshots may retain their original language with an English explanation.
Keep the PR focused. Use Draft for unfinished work and list what remains.
Fill in each section briefly; use "Not applicable" with a reason where appropriate.
Never include credentials, .env files, raw saves, or private dialogue. -->

## Linked issue

<!-- Required for every PR, including documentation, tests, and small fixes.
Replace the placeholder with an existing issue number or full issue URL.
Use "Closes #123" for a complete fix. For partial work, use "Refs #123",
describe the remaining scope, and leave the issue open. -->

Closes #<issue-number>

## Problem and change

<!-- Explain the problem, resulting behavior, and how this meets the linked issue's acceptance criteria.
Include the reason for the approach when it helps review. -->

## Verification

<!-- List checks actually run, their results, and relevant scenarios.
Report skipped checks and reasons. Match verification to the change; documentation-only
changes need content/link checks. See CONTRIBUTING.md for commands and setup.
For recovery changes, cover applicable disconnect/restart scenarios.
Distinguish mock checks from real DeepSeek or OAuth verification. -->

- Checks and results:
- Skipped checks / remaining limitations:

## Demo

<!-- Include screenshots or a short video for UI, story, or interaction changes,
covering relevant desktop/mobile scenarios; otherwise state "No visible change." -->

## Compatibility and operations

<!-- Describe save/story compatibility, API/SSE contracts, database migrations,
configuration, and deployment implications; state "None" if there are none.
For migrations or operational changes, include upgrade and rollback/recovery steps.
For turn/NPC changes, explain effects on committed facts, information isolation,
request idempotency, drafts, and recovery. -->

## Checklist

<!-- Check items once satisfied, including when the requirement is not applicable. -->

- [ ] This PR links an existing issue; both the issue and PR have English titles and descriptions.
- [ ] The diff is focused and contains no credentials, private content, or temporary artifacts.
- [ ] Relevant tests, documentation, and generated contracts are updated where applicable.
- [ ] Verification results and skipped checks are reported accurately above.
- [ ] Compatibility and operational impacts are described above.
