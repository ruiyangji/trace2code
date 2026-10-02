# Milestone 3 Plan: Per-Run Capture Policy: FULL vs DISTILLED

## Existing state
- Recorders support FULL capture in controller and Chrome extension.
- Protocol schema defines `captureMode: "full" | "distilled"`.

## Files/packages affected
- `packages/distiller/`: New package implementing deterministic online and offline trace distillation.
- `packages/recorder-core/`: Integration hook with distiller for online mode.
- `packages/recorder-playwright/`: Controller recorder support for online distillation when `captureMode: "distilled"`.
- `packages/recorder-extension/`: Daemon recorder support for online distillation when `captureMode: "distilled"`.
- `packages/distiller/src/distiller.test.ts`:
  - Unit tests for all required transformations (pointermove->click, typing->fill, wheel->click, checkbox check/uncheck, selectOption, uploadFile, drag).
  - Adversarial tests: alternating fields, typing interrupted by click, drag vs click, double clicks.
  - Invariant property tests: ordering preservation, navigation preservation, redaction preservation, frame isolation.
  - Differential test: compare FULL vs DISTILLED on fixture workflow; verify >= 80% reduction; verify offline distillation of FULL matches online DISTILLED sequence.
- `docs/milestones/03-capture-modes.md`: Milestone completion documentation.

## Implementation plan
1. Create `packages/distiller`:
   - Implement `SemanticTraceStep` types.
   - Implement `OnlineDistiller` maintaining an action accumulator.
   - Implement event coalescing rules:
     - `pointermove* + click` -> single `click`
     - `focus + keydown/input* + change/blur` -> single `fill`
     - `wheel* + click` -> single `click`
     - `click + change(checked=true/false)` -> `check` / `uncheck`
     - `change(select)` -> `selectOption`
     - `dragstart + dragover* + drop` -> `drag`
   - Implement `distillRawTrace` offline distillation.
2. Hook `OnlineDistiller` into `PlaywrightRecorder` and `ExtensionDaemon` when `captureMode === 'distilled'`.
3. Unit, adversarial, and differential tests.
4. Validate acceptance criteria (>= 80% event reduction, equivalence of offline-distilled FULL and online DISTILLED).
5. Document in `docs/milestones/03-capture-modes.md`.

## Acceptance test command
```bash
pnpm test
```

## Risks
- Losing trailing input events if blur/change is not explicitly fired before page close (mitigated by flushing accumulator on end/stop).
- Distinguishing drag from slight mouse jitter during click (movement threshold > 10px).
