# Milestone 1 Plan: Controller-Based FULL Recorder

## Existing state
- Monorepo initialized with `@trace2code/protocol`, `@trace2code/test-fixtures`, `@trace2code/cli`.
- Fixture application operational.
- Playwright Chromium installed.

## Files/packages affected
- `packages/recorder-core`: Shared in-page DOM instrumentation, element evidence extraction, credential redaction, monotonic sequence buffering.
- `packages/recorder-playwright`: Playwright controller recorder lifecycle, `addInitScript` injection, CDP network capture, screenshot handling, multi-tab/frame tracking, trace stream writer.
- `apps/cli`: Add `record --integration controller --capture full --url <url>` command.
- `docs/milestones/01-controller-full-recorder.md`: Milestone completion documentation.

## Implementation plan
1. Create `packages/recorder-core`:
   - `evidence.ts`: In-page DOM inspector computing accessible name, role, tags, testIds, CSS selectors, XPath, bounding rects, nearby text, ancestor summary.
   - `redaction.ts`: Password field / sensitive selector detection and redaction masking.
   - `events.ts`: Event listener wiring for pointer, mouse, wheel, keyboard, input, change, focus, blur, navigation, unload.
   - `buffer.ts`: Thread-safe monotonic sequence buffer with event queuing.
2. Create `packages/recorder-playwright`:
   - `controller.ts`: Manages browser context, pages, iframes, init scripts, and CDP sessions.
   - Handles multi-page lifecycle (page creation, popup, close).
   - Handles boundary screenshots (navigation, click, fill).
   - Configurable CDP network metadata recording.
   - Stream writer saving to `.trace2code/runs/<runId>/trace.jsonl` and screenshots directory.
3. Wire `record` command in `apps/cli`.
4. Tests:
   - Unit tests: buffer monotonicity, element evidence extraction, password redaction masking.
   - Browser Integration tests: automate fixture website through typing, clicking, select, upload, drag, iframe, SPA navigation, full-page navigation, new tab.
   - Security verification: grep for test password to ensure zero plaintext credential leaks.
   - Failure tests: page closure mid-recording, target element removal.
5. Generate `docs/milestones/01-controller-full-recorder.md`.

## Test plan
- Unit tests in `packages/recorder-core` and `packages/recorder-playwright`.
- Full 10-step fixture workflow automated via Playwright recorder.
- Grep assertion on `.trace2code/` ensuring `known-test-password` never appears.

## Acceptance test command
```bash
pnpm test
```
and automated CLI demonstration against fixture server.

## Risks
- Frame detachment during DOM inspection (handled via try/catch and fallback evidence).
- High volume of pointermove events (sampleHz throttling).
