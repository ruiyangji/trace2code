# Milestone 7 Plan: Deterministic Source-Code Compiler

## Existing state
- Milestone 6 produced canonical `WorkflowIR` with validated actions, parameterized inputs, postconditions, and confidence scores.
- `@trace2code/compiler` provides `SemanticCompiler` and LLM provider abstractions.

## Files/packages affected
- `packages/compiler/`:
  - `src/codegen/playwright.ts`: Compiles `WorkflowIR` into:
    1. `workflow.ts`: Clean, standalone, parameterized Playwright TypeScript function.
    2. `input.schema.json`: JSON Schema for input validation.
    3. `workflow.test.ts`: Automated test executing `workflow(page, inputs)` with assertions.
    4. `README.md`: Usage documentation and instructions.
    5. `package.json`: Standalone dependencies (Playwright, @types/node, typescript).
  - `src/codegen/codegen.test.ts`: Unit and integration tests verifying code generation, locator formatting, postcondition assertions, and typechecking.
- `apps/cli/`:
  - Update `compile` command to support `--target playwright-ts` and `--output <dir>` producing the runnable test bundle.
- Acceptance Test:
  - Generate Playwright bundle from fixture trace.
  - Run typecheck (`tsc --noEmit`) on generated project.
  - Run Playwright test in live Chromium browser against benchmark server with zero LLM in the loop at execution time.
- `docs/milestones/07-deterministic-compiler.md`: Milestone completion documentation.

## Acceptance criteria
```bash
pnpm test
```
All monorepo tests pass, generated code passes `tsc`, and executes successfully against live test server.
