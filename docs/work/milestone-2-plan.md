# Milestone 2 Plan: Chrome Extension FULL Recorder

## Existing state
- Monorepo initialized with `@trace2code/protocol`, `@trace2code/test-fixtures`, `@trace2code/recorder-core`, and `@trace2code/recorder-playwright`.
- Controller recorder passes 10-step fixture workflow and produces valid canonical JSONL traces with redaction.

## Files/packages affected
- `apps/extension/`: Manifest V3 Chrome Extension (manifest.json, popup.html, popup.js, background.js, content.js).
- `packages/recorder-extension/`: Local daemon HTTP/WebSocket listener, state machine, reconnection buffer, stream persistence.
- `apps/cli/`: Add daemon / extension-recording listener support.
- `apps/extension/extension.test.ts` & `packages/recorder-extension/recorder-extension.test.ts`: Unit tests and Playwright unpacked extension E2E tests.
- `docs/milestones/02-extension-full-recorder.md`: Milestone completion documentation.

## Implementation plan
1. Create `packages/recorder-extension`:
   - Daemon server receiving event streams from the extension (`POST /api/runs`, `POST /api/runs/:id/events`, `POST /api/runs/:id/stop`).
   - Run state machine (IDLE, RECORDING, PAUSED, STOPPED).
   - Reconnection queue logic.
2. Build `apps/extension`:
   - Manifest V3 configuration with popup, background service worker, and content script.
   - UI controls: Start Recording, Stop Recording, Pause / Resume, Capture Mode (FULL/DISTILLED), Run Name, Status indicator.
   - Content script using `@trace2code/recorder-core` instrumentation.
   - Background service worker managing tab lifecycle, webNavigation events, and daemon forwarding.
3. Tests:
   - Unit tests: Run state machine, reconnection buffer, event normalization, message protocol.
   - Extension E2E test in Playwright:
     - Launch Chromium with unpacked extension.
     - Start recording via extension.
     - Interact with fixture website.
     - Test Pause -> interact while paused -> assert paused events are omitted.
     - Resume -> interact -> Stop.
     - Navigation across same page, SPA route, full-page link, iframe.
   - Cross-Recorder Contract Test:
     - Run controller recorder and extension recorder on identical fixture operations.
     - Normalize transport fields (timestamps/IDs) and assert structural and semantic equivalence.
4. Document results in `docs/milestones/02-extension-full-recorder.md`.

## Acceptance test command
```bash
pnpm test
```
plus unpacked extension validation in Chromium.

## Risks
- Service worker dormancy in Manifest V3 (heartbeat keepalive / persistent queue in daemon).
- Port conflict for local daemon (configurable port binding).
