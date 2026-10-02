# Milestone 10 Plan: Multi-Demonstration Generalization

## Existing state
- Single demonstrations compile to `WorkflowIR` and Playwright TypeScript.
- Remote worker and self-healing runtime execute single demonstrations.

## Files/packages affected
- `packages/compiler/`:
  - `src/synthesis/alignment.ts`:
    - Needleman-Wunsch sequence alignment across multiple demonstration step sequences.
    - Aligning steps based on action type, target role, and selector similarity.
  - `src/synthesis/generalizer.ts`:
    - `MultiTraceGeneralizer`:
      1. Identifies varying input values across traces and parameterizes them (`input: { varName: string }`).
      2. Identifies common constant invariant values and keeps them as constants.
      3. Identifies optional/conditional branch steps that appear in only a subset of demonstrations.
      4. Detects repeated loop patterns across demonstrations.
      5. Synthesizes a unified, generalized `WorkflowIR`.
  - `src/synthesis/generalizer.test.ts`:
    - Multi-demonstration synthesis test across 3 distinct demonstration traces.
    - Verifies variable inference (e.g. `candidateName`, `candidateEmail`, `searchRole`).
    - Verifies optional branch step identification.
    - Live browser execution: Compiles synthesized `WorkflowIR` to Playwright TypeScript and executes against local benchmark fixture with an unseen 4th demonstration input!
- `docs/milestones/10-generalization.md`: Milestone completion documentation.

## Acceptance criteria
```bash
pnpm test
```
All monorepo tests pass, generalized workflow synthesizes variables and branch steps across 3 demonstrations, and executes correctly with unseen 4th input in clean browser.
