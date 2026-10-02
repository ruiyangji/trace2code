# Milestone 6 Plan: LLM Compile-Time Workflow Inference

## Existing state
- Deterministic distillation produces `SemanticTraceStep[]` with ranked locators.
- Recorders capture user marks for parameter, secret, and notes.

## Files/packages affected
- `packages/workflow-ir/`: Canonical Workflow IR schema, Zod validation, action types, input declarations, postcondition rules.
- `packages/compiler/`:
  - `llm/provider.ts`: LLM provider interface abstraction (`LLMProvider`) supporting Deterministic Rule/Mock Provider and Gemini API provider.
  - `llm/compiler.ts`: `SemanticCompiler` transforming `SemanticTraceStep[]` + user marks into validated `WorkflowIR`.
  - `llm/hallucination-guard.ts`: Verifies all generated targets, URLs, and inputs originate strictly from input evidence or user marks.
  - `llm/compiler.test.ts`: Golden compiler cases (10 fixture workflows), schema validation, mutation robustness, hallucination rejection.
- `docs/milestones/06-llm-compiler.md`: Milestone completion documentation.

## Implementation plan
1. Create `packages/workflow-ir`:
   - Schema for `WorkflowIR`, `WorkflowStep`, `WorkflowAction`, `WorkflowInput`, `WorkflowPostcondition`.
2. Create `packages/compiler`:
   - Provider interface + Rule-based Deterministic Semantic Provider (for offline and CI runs without API key dependency) + Gemini API Provider.
   - User mark override logic (Mark as Parameter, Constant, Secret).
   - Hallucination guard verifying no invented URLs, targets, or plaintext leaked secrets.
3. Test suite:
   - 10 distinct fixture workflows:
     1. Basic form submission
     2. Candidate search with parameters
     3. Authentication login (secret redaction)
     4. Expense report submission
     5. Country selection
     6. Terms agreement checkbox
     7. Multi-page link navigation
     8. Client-side SPA route transition
     9. Modal confirmation dialog
     10. File upload workflow
   - Mutation robustness: verify changing irrelevant timestamps and coordinates preserves generated IR structure.
   - Hallucination guard rejection test.
4. Document results in `docs/milestones/06-llm-compiler.md`.

## Acceptance test command
```bash
pnpm test
```
verifying all 10 fixture workflows compile to valid Workflow IR.
