# Milestone 2 Completion: Chrome Extension FULL Recorder

## What was implemented
- Built Manifest V3 Chrome Extension in `apps/extension`:
  - `manifest.json`: Manifest V3 requesting strictly necessary permissions (`activeTab`, `scripting`, `storage`, `webNavigation`, `<all_urls>`).
  - `popup.html` & `popup.js`: User-facing recorder controls: Start Recording, Stop Recording, Pause / Resume, Capture Mode (FULL / DISTILLED), Local Daemon URL, Status badge, Step & Parameter Annotations.
  - `background.js`: Service worker managing session lifecycle, reconnection queue, navigation monitoring via `webNavigation.onCommitted`, and HTTP streaming to daemon.
  - `content.js`: In-page DOM instrumentation bridge capturing pointer, keyboard, input, change, and SPA navigation events.
- Built `@trace2code/recorder-extension`:
  - `RecordingStateMachine`: State transitions (idle, recording, paused, stopped) with invalid transition guard.
  - `ReconnectionBuffer`: Queue buffering events during daemon disconnections, flushing batches upon reconnect.
  - `ExtensionDaemon`: HTTP streaming server receiving runs, appending events with schema validation, discarding paused interactions, and finalizing canonical JSONL traces.
- Automated unpacked Chrome Extension E2E test in Playwright (`apps/extension/extension.test.ts`).
- Cross-Recorder Contract Test proving controller recorder and extension recorder produce equivalent canonical events adhering to `@trace2code/protocol`.

## Architecture changes
- Both controller and extension recorder integrations stream canonical events to the exact same JSONL protocol without leaking browser-specific objects into downstream modules.
- Daemon supports resilient streaming: extension service worker buffers locally if daemon is temporarily offline.

## Tests added
- `packages/recorder-extension/src/recorder-extension.test.ts`:
  - State machine transition rules (start, pause, resume, stop, illegal transitions).
  - Reconnection buffer queue limit and batch flushing.
  - Extension daemon HTTP endpoints (`/api/runs`, `/api/runs/:id/events`, pause, resume, stop).
  - Validation of output trace ensuring paused events are properly discarded.
- `apps/extension/extension.test.ts`:
  - Unpacked extension installation in Chromium with isolated profile.
  - In-browser workflow execution via real Extension Popup UI.
  - Verification that interactions while paused do not appear in trace.
  - Cross-page and SPA route navigation via extension content script.
  - Cross-Recorder Contract test comparing controller recorder and extension recorder on identical action sequences.

## Commands executed & Automated test results
```bash
$ pnpm test
 Test Files  6 passed (6)
      Tests  22 passed (22)
   Duration  4.07s
```

## Next milestone dependencies
- Milestone 3: Per-Run Capture Policy: FULL vs DISTILLED.
