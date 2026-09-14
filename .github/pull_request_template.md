<!-- Use a descriptive title, preferably type(scope): description.
Keep the PR focused. Use Draft for unfinished work and list what remains.
Fill in each section briefly; use "Not applicable" with a reason where appropriate.
Never include credentials, .env files, raw saves, or private dialogue. -->

## Problem and change

<!-- Explain the trigger, previous behavior, resulting behavior, and why this approach was chosen.
Link related issues; use "Closes #..." only when this PR fully resolves the issue. -->

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

- [ ] The diff is focused and contains no credentials, private content, or temporary artifacts.
- [ ] Relevant tests, documentation, and generated contracts are updated where applicable.
- [ ] Verification results and skipped checks are reported accurately above.
- [ ] Compatibility and operational impacts are described above.
