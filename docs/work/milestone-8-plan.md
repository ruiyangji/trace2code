# Milestone 8 Plan: Semantic Runtime and Recovery Mode

## Existing state
- Deterministic compiler produces standalone Playwright code (`workflow.ts`).
- Workflow IR defines actions, targets, intents, and postconditions.

## Files/packages affected
- `packages/runtime-semantic/`:
  - `src/types.ts`: `RecoveryDecision`, `CandidateMatch`, `DOMCandidateEvidence`, `RecoveryPatch`.
  - `src/recovery.ts`: `SemanticRecoveryEngine`:
    - Step 1: Detect deterministic locator failure (timeout).
    - Step 2: DOM context and candidate extraction (clickable/inputs matching action type).
    - Step 3: Semantic candidate scoring (role, text similarity, container context, stable attributes).
    - Step 4: Alternative action execution.
    - Step 5: Postcondition verification (`urlMatches`, `elementVisible`, `textMatches`).
    - Step 6: Emits structured `RecoveryDecision` and source code patch diff.
  - `src/executor.ts`: `RecoverableWorkflowExecutor`:
    - Executes `WorkflowIR` steps with automatic recovery wrapping.
  - `src/recovery.test.ts`:
    - Tests against fixture page mutations:
      1. Renamed button ('Click Me' -> 'Send Request')
      2. Renamed ID / testId (`#sample-btn` -> `#sample-btn-v2`)
      3. Moved elements / layout DOM restructuration
      4. Duplicate added with disambiguation
    - Verification: Recovery success rate >= 80% on single-element mutations, valid patch diff emitted.
- `docs/milestones/08-semantic-runtime.md`: Milestone completion documentation.

## Acceptance criteria
```bash
pnpm test
```
All monorepo tests pass, recovery succeeds on mutated fixtures with structured recovery decisions and patch diffs.
