# Milestone 5 Plan: Offline Semantic Distiller & Locator Scoring

## Existing state
- Basic `distillRawTrace` exists in `@trace2code/distiller`.
- Fixture application contains rich controls including duplicate labels (Shipping Email vs Billing Email), nested spans, iframes, custom controls.

## Files/packages affected
- `packages/distiller/src/locator.ts`: Locator candidate generator, scoring engine (testId, role+name, label, text, css, xpath, coordinates), and container-scoped disambiguation.
- `packages/distiller/src/evaluator.ts`: Replay evaluator verifying locator resolution, target ambiguity detection, candidate ranking diagnostics, and success rate metrics.
- `packages/distiller/src/locator.test.ts`: Focused unit tests across roles, labels, duplicate text, nested spans, dynamic IDs, iframes.
- `packages/distiller/src/replay-eval.test.ts`: Live fixture browser replay evaluation benchmarking >= 95% target resolution and zero wrong-duplicate resolution.
- `apps/cli/src/index.ts`: Add `trace2code distill <run-id>` command.
- `docs/milestones/05-semantic-distiller.md`: Milestone completion documentation.

## Implementation plan
1. Build `LocatorScoringSystem`:
   - Preference hierarchy:
     1. Test ID (score 100)
     2. Role + accessibleName (score 90)
     3. Label association (score 85)
     4. Placeholder / Name attribute (score 80)
     5. Exact text content (score 70)
     6. Stable CSS selector (score 60)
     7. XPath (score 40)
     8. Bounding box coordinates (score 10)
   - Scope disambiguation: when duplicate labels or roles are detected, generates ancestor-scoped locator (`container.getByRole(...)` or `container.getByLabel(...)`).
2. Build `SemanticReplayEvaluator`:
   - Runs against Playwright `Page` or fixture DOM.
   - Evaluates target resolution, detects multiple matching elements, computes metrics (target resolution rate, action success rate, ambiguity rate).
3. Unit tests for locator scoring across varied DOM topologies.
4. Browser replay test on fixture site (including duplicate labels disambiguation).
5. Document results in `docs/milestones/05-semantic-distiller.md`.

## Acceptance test command
```bash
pnpm test
```
verifying target resolution >= 95% and zero wrong-duplicate resolutions.
