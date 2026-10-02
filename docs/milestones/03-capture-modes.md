# Milestone 3 Completion: Per-Run Capture Policy: FULL vs DISTILLED

## What was implemented
- Created `@trace2code/distiller`:
  - `OnlineDistiller`: Real-time event reducer coalescing raw pointer/wheel/keyboard mechanics into distilled semantic action events.
  - Required transformations implemented:
    - `pointermove* + click` -> single `click`
    - `focus + keydown* + input* + change` -> single `fill`/`change` with final value
    - `wheel* + click` -> single `click`
    - `click + change(checked)` -> `check` / `uncheck`
    - `<select>` change -> `selectOption`
    - `<input type="file">` -> `uploadFile`
    - `pointerdown + pointermove* + pointerup` -> `drag`
  - Adversarial handling: alternating input fields, typing interrupted by clicks, double click detection within 300ms window, drag vs click disambiguation.
  - `distillRawTrace`: Offline semantic distillation converting any canonical trace into clean `SemanticTraceStep[]`.
- Integrated `OnlineDistiller` into both:
  - `@trace2code/recorder-playwright` (`PlaywrightRecorder`)
  - `@trace2code/recorder-extension` (`ExtensionDaemon`)
  When `captureMode === 'distilled'`, both recorders stream reduced events in real-time.

## Architecture changes
- Capture policy (`full` vs `distilled`) is a run-level configuration parameter rather than separate recorder engines.
- Both recorders apply identical online distillation rules, producing canonical traces with identical semantics.

## Tests added
- `packages/distiller/src/distiller.test.ts`:
  - Unit tests for pointermove+click, typing coalescing into single change.
  - Adversarial test: alternating typing across two form fields.
  - Adversarial test: double-click detection.
  - Privacy invariant: password redaction preservation through distillation.
  - Invariant property test: chronological ordering and tab/frame isolation.
- `packages/recorder-playwright/src/differential.test.ts`:
  - Differential benchmark comparing FULL mode against DISTILLED mode across identical workflow on the fixture site.
  - Measured reduction: **91.7%** (exceeds the >= 80% acceptance threshold).
  - Verified that offline distillation of the FULL trace matches the online DISTILLED sequence.

## Benchmark metrics
```text
FULL Event Count:      133 events
DISTILLED Event Count: 11 events
Measured Reduction:    91.7%
Semantic equivalence:  100% matched
```

## Next milestone dependencies
- Milestone 4: Trace Store and Run Inspector.
