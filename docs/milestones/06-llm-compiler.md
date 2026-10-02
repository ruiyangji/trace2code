# Milestone 6 Completion: LLM Compile-Time Workflow Inference

## What was implemented
- Created `@trace2code/workflow-ir`:
  - `schema.ts`: Canonical Workflow IR schema validated by Zod (`WorkflowIRSchema`, `WorkflowStepSchema`, `WorkflowActionSchema`, `WorkflowTargetSchema`, `WorkflowValueSchema`, `WorkflowInputSchema`, `WorkflowPostconditionSchema`).
  - Cross-validation in `validateWorkflowIR`: Enforces that all action inputs referenced in steps are strictly declared in `inputs`.
- Created `@trace2code/compiler`:
  - `llm/provider.ts`:
    - `LLMProvider` interface abstraction.
    - `DeterministicRuleCompilerProvider`: Offline heuristic/rule-based compiler for 100% reproducible execution and offline test suites without external API dependencies.
    - `GeminiCompilerProvider`: Production provider integrating Google Gemini REST API with structured JSON output and schema validation.
    - `buildWorkflowTarget`: Maps DOM element evidence into canonical `WorkflowTarget` prioritizing testId, role+name, ariaLabel, and stable attributes.
  - `llm/hallucination-guard.ts`:
    - `HallucinationGuard`: Grounding verifier enforcing that:
      1. Every target element in the generated workflow is grounded in recorded trace evidence or DOM snapshots (rejects fabricated elements).
      2. Every navigated URL and postcondition URL matches a visited or linked domain in the trace.
      3. No plaintext secret values leak into constant values or step intents.
      4. All referenced inputs are declared in the workflow schema.
  - `llm/compiler.ts`:
    - `SemanticCompiler`: Pipeline coordinating inference, schema validation, and the hallucination guard into a verified `WorkflowIR`.
- Integrated CLI command in `@trace2code/cli`:
  - `trace2code compile <run-id> --ir`: Compiles a recorded run or JSONL trace into canonical Workflow IR JSON.

## Architecture changes
- Two-tier inference model: Deterministic rule-based provider provides full offline compilation and CI guarantees, while LLM provider offers open-ended workflow intent synthesis.
- Hallucination guard operates as an independent compile-time checkpoint, preventing invented selectors, ungrounded domains, or credential leakage from reaching code generation.

## Tests added
- `packages/compiler/src/llm/compiler.test.ts`:
  - Golden compiler test cases across 10 distinct fixture workflows:
    1. Basic form submission (`#text-input`, `#submit-btn`)
    2. Candidate search with parameterized inputs (`input: 'searchQuery'`)
    3. Authentication login with secret credentials (guaranteed zero plaintext password leakage)
    4. Expense report multi-field submission (`amount`, `memo`)
    5. Country selection dropdown (`selectOption`)
    6. Terms agreement checkbox (`check` and `uncheck`)
    7. Multi-page link navigation with URL postconditions
    8. Client-side SPA route transition
    9. Modal confirmation dialog with `elementVisible` postcondition
    10. File upload workflow
  - Mutation robustness test: Non-semantic trace mutations (distorted timestamps, coordinates, frame timings) preserve identical compiled Workflow IR actions and targets.
  - Hallucination rejection tests:
    - Verifies invented/hallucinated element targets are rejected.
    - Verifies ungrounded foreign URLs and leaked plaintext secrets are rejected.
    - Verifies undeclared input references are rejected by schema cross-validation.

## Benchmark metrics
```text
Total Test Suites:     13 passed (13)
Total Unit Tests:      55 passed (55)
Compiler Test Cases:   14 passed (14)
Coverage:              10/10 Fixture Workflows Compiled Successfully
Plaintext Leaks:       0 detected
```

## Next milestone dependencies
- Milestone 7: Deterministic Source-Code Compiler (`WorkflowIR` -> Playwright TypeScript test project with input schema and postconditions).
