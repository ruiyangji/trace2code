# Milestone 5 Completion: Offline Semantic Distiller

## What was implemented
- Created `@trace2code/distiller/src/locator.ts`:
  - `LocatorScoringSystem`: Implemented locator candidate ranking based on the strict evidence hierarchy:
    1. Explicit test ID (`getByTestId(...)`) - score: 100
    2. Role + accessibleName (`getByRole(...)`) - score: 90
    3. Form label association (`getByLabel(...)`) - score: 85
    4. Stable attributes / ID (`#id`, `name`) - score: 75-80
    5. Inner visible text (`getByText(...)`) - score: 70
    6. Structural CSS candidates - score: 60
    7. XPath fallback - score: 40
    8. Coordinates - score: 10 (last resort)
  - Scoped container disambiguation: When elements share identical labels/roles (such as Shipping Contact vs Billing Contact in the benchmark), container scopes (e.g. `div#shipping-address-group`) are automatically bound to disambiguate targets.
  - Dynamic ID filter: Automatically filters out non-deterministic/randomized IDs (e.g. `:r1:`, `dynamic-item-12345`).
- Created `@trace2code/distiller/src/evaluator.ts`:
  - `SemanticReplayEvaluator`: Evaluates semantic step execution against live browser DOMs, detecting ambiguity, computing target resolution rates, action success rates, and collecting detailed step diagnostics.
- Added `trace2code distill <run-id>` to `@trace2code/cli`.

## Architecture changes
- Semantic action inference and locator ranking operate completely deterministically without requiring an LLM.
- Disambiguation rules prevent locators from resolving to duplicate elements elsewhere on the page.

## Tests added
- `packages/distiller/src/locator.test.ts`:
  - Test ID priority ranking over generic classes.
  - Role + accessible name ranking.
  - Container-scoped disambiguation between duplicate labels (Shipping Email vs Billing Email).
  - Dynamic identifier deprioritization.
  - Nested span button resolution to parent accessible name and role.
- `packages/distiller/src/replay-eval.test.ts`:
  - 10-step fixture workflow evaluated live against the fixture website.
  - Verified target resolution success rate = **100%** (exceeds >= 95% threshold).
  - Verified zero wrong-duplicate resolutions (asserted `#shipping-email` received shipping email and `#billing-email` received billing email).
  - Verified every step produces complete diagnostic ranking records.

## Benchmark metrics
```text
Total Benchmark Steps:           10
Target Resolution Success Rate:  100.0% (Benchmark threshold: >= 95%)
Action Success Rate:             100.0%
Ambiguous Locators Resolved:     0
Duplicate Misrouting:            0
```

## Next milestone dependencies
- Milestone 6: LLM Compile-Time Workflow Inference.
