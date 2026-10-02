# Milestone 7 Completion: Deterministic Source-Code Compiler

## What was implemented
- Created `@trace2code/compiler/src/codegen/playwright.ts`:
  - `formatPlaywrightLocator`: Converts canonical `WorkflowTarget` objects into optimal, resilient Playwright locator expressions adhering to the evidence hierarchy (Test ID -> Role+Name -> Label -> Text -> CSS -> XPath, with container-scoping support).
  - `formatValueExpression`: Resolves values to type-safe TypeScript expressions (`inputs?.param`, `process.env['SECRET']`, or string constants).
  - `generateWorkflowSource`: Generates `workflow.ts` featuring typed input interfaces, step comments, Playwright actions (`goto`, `click`, `fill`, `check`, `uncheck`, `selectOption`, `setInputFiles`, `dragTo`), and Playwright postcondition assertions (`expect(page).toHaveURL(...)`, `expect(locator).toBeVisible()`).
  - `generateInputSchema`: Emits canonical Draft-07 `input.schema.json` capturing property types and required input constraints.
  - `generateTestFile`: Generates `workflow.test.ts` for automated test execution.
  - `generatePackageJson`, `generatePlaywrightConfig`, `generateTsConfig`, `generateReadme`: Generates complete standalone project artifacts.
  - `compileWorkflowToPlaywright`: Bundles all files and exports `writeToDisk(outputDir)`.
- Updated `@trace2code/cli`:
  - `trace2code compile <run-id> --target playwright-ts --output <dir>`: Compiles any recorded demonstration run or trace file into a standalone, runnable Playwright TypeScript directory.

## Architecture changes
- The compiler outputs pure, decoupled Playwright TypeScript code with **zero runtime Trace2Code dependencies and zero LLM dependencies at execution time**.
- Secret values are referenced exclusively via `process.env[...]` lookups, preventing hardcoded credentials from ever being written into generated source code.

## Tests added
- `packages/compiler/src/codegen/codegen.test.ts`:
  - Formats Playwright locators correctly adhering to evidence priority and scoping.
  - Generates clean, type-safe `workflow.ts` source code with step comments and postconditions.
  - Generates valid JSON Schema `input.schema.json`.
  - Generates standalone `workflow.test.ts`.
  - Compiles and writes full project bundle to disk.
  - **Typecheck verification**: Executes `tsc --noEmit -p tsconfig.json` on generated bundle, verifying 100% strict type safety.
  - **Live execution acceptance**: Compiles and executes a multi-step workflow in clean Chromium against the local benchmark server with zero LLM in the loop at execution time, verifying live DOM interaction and feedback assertions.

## Benchmark metrics
```text
Total Test Suites:     14 passed (14)
Total Unit Tests:      62 passed (62)
Codegen Tests:         7 passed (7)
Typecheck (tsc):       0 errors (strict mode)
Live Execution:        Passed in Chromium (zero LLM at runtime)
```

## Next milestone dependencies
- Milestone 8: Semantic Runtime and Recovery Mode (self-healing replay runtime when web UI undergoes drift or mutation).
