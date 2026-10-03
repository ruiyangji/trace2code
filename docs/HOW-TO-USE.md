# Trace2Code: Complete User Guide & Tutorial

This guide provides end-to-end instructions for recording, distilling, generalizing, compiling, and replaying browser interaction workflows using Trace2Code.

---

## Table of Contents

1. [Prerequisites & Setup](#prerequisites--setup)
2. [End-to-End Live Verification in 60 Seconds](#end-to-end-live-verification-in-60-seconds)
3. [Recording Demonstrations](#recording-demonstrations)
   - [Option A: Controller-Based Recording (CLI)](#option-a-controller-based-recording-cli)
   - [Option B: Chrome Extension MV3 Recording](#option-b-chrome-extension-mv3-recording)
   - [Capture Modes: FULL vs DISTILLED](#capture-modes-full-vs-distilled)
4. [Managing & Inspecting Traces](#managing--inspecting-traces)
   - [Listing Recorded Runs](#listing-recorded-runs)
   - [Launching the Web Inspector](#launching-the-web-inspector)
   - [Exporting and Importing JSONL Traces](#exporting-and-importing-jsonl-traces)
5. [Semantic Distillation & Locator Synthesis](#semantic-distillation--locator-synthesis)
6. [Compiling to Standalone Playwright Projects](#compiling-to-standalone-playwright-projects)
   - [Compiling to Playwright TypeScript](#compiling-to-playwright-typescript)
   - [Compiling to Canonical WorkflowIR JSON](#compiling-to-canonical-workflowir-json)
   - [Running the Generated Test Suite](#running-the-generated-test-suite)
7. [Multi-Demonstration Synthesis & Generalization](#multi-demonstration-synthesis--generalization)
   - [How Generalization Works (Needleman-Wunsch)](#how-generalization-works-needleman-wunsch)
   - [Synthesizing Variable Inputs and Branches](#synthesizing-variable-inputs-and-branches)
8. [Self-Healing Runtime & Git Patch Diffs](#self-healing-runtime--git-patch-diffs)
9. [Remote Worker Execution Plane & Forensics](#remote-worker-execution-plane--forensics)
10. [CLI Command Reference](#cli-command-reference)

---

## 1. Prerequisites & Setup

### Requirements
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **pnpm**: v9.0.0 or higher
- **Chromium / Playwright**: Installed for headless browser operations

### Installation
Clone the repository and install all workspace dependencies:

```bash
git clone https://github.com/ruiyangji/trace2code.git
cd trace2code

# Install monorepo dependencies
pnpm install

# Install Playwright browser binaries
npx playwright install chromium

# Verify test suite
pnpm test
```

All 77 unit and integration tests across 17 test suites should pass cleanly.

---

## 2. End-to-End Live Verification in 60 Seconds

Trace2Code ships with an automated live verification pipeline that proves the entire compiler loop without external mock services:

```bash
pnpm demo:e2e
```

### What this command does automatically:
1. Spawns an internal deterministic local benchmark fixture server.
2. Launches real Chromium browser instances and records 3 distinct human demonstrations with varying inputs and branches.
3. Automatically registers traces and runs semantic distillation (reducing raw events into clean steps).
4. Runs **Needleman-Wunsch sequence alignment** to synthesize a generalized `WorkflowIR` with 5 dynamic variables and 3 branch steps.
5. Emits a complete, standalone Playwright TypeScript project bundle.
6. Typechecks the generated code with `tsc --noEmit` (0 errors).
7. Executes the compiled script in a fresh Chromium instance with an **unseen 4th input parameter set**, asserting DOM mutations and capturing a screenshot.
8. Starts the remote execution control plane API (`apps/api`), deploys the workflow, dispatches a remote run, and downloads forensic failure diagnostics.

---

## 3. Recording Demonstrations

Trace2Code provides two recording mechanisms depending on your environment.

### Option A: Controller-Based Recording (CLI)

Use the CLI controller recorder when orchestrating browser sessions directly from terminal or CI environments:

```bash
# Record an interaction session on a target URL
pnpm trace record --url https://example.com --name "user-login-flow"
```

#### CLI Flags:
- `-u, --url <url>`: Starting URL to navigate to (default: `http://localhost:3000`)
- `-n, --name <name>`: Descriptive label for the recorded run
- `-c, --capture <mode>`: `full` (forensic raw events) or `distilled` (coalesced online)
- `--headless`: Run browser headlessly (default: `false` for interactive user recording)

To stop recording, simply press **Enter** in the terminal or close the browser window. The trace is automatically saved to `.trace2code/runs/<runId>/trace.jsonl` and registered in the local SQLite catalog.

---

### Option B: Chrome Extension MV3 Recording

For recording natural user workflows directly inside your everyday Google Chrome browser:

1. Open Chrome and navigate to `chrome://extensions`.
2. Toggle on **Developer mode** in the upper-right corner.
3. Click **Load unpacked** and select the directory:
   ```
   path/to/trace2code/apps/extension
   ```
4. The **Trace2Code Recorder** icon will appear in your extension toolbar.
5. Click the extension icon to open the popup:
   - Click **Start Recording** to begin capturing window events.
   - Use **Pause** / **Resume** when navigating through non-relevant steps.
   - Click **Stop & Export** to download the canonical `trace.jsonl` file.

To import an extension trace into your local CLI workspace:

```bash
pnpm trace import ~/Downloads/my-extension-trace.jsonl
```

---

### Capture Modes: FULL vs DISTILLED

| Feature | `FULL` Mode | `DISTILLED` Mode |
| :--- | :--- | :--- |
| **Mouse Movements** | Every raw cursor trajectory and coordinate | Filtered out; only final click coordinates retained |
| **Keyboard Input** | Every `keydown`, `keyup`, and input delta | Debounced into a single semantic `fill` action |
| **DOM Mutations** | Continuous stream of layout shifts & subtree changes | Filtered down to structural changes after user actions |
| **Event Reduction** | 0% (Complete raw forensic timeline) | **91.7% reduction** (Instant semantic compression) |
| **Best Used For** | Forensic debugging, regression bug reproduction | Fast compiler distillation, automated test generation |

---

## 4. Managing & Inspecting Traces

### Listing Recorded Runs

To view all recorded sessions stored in your local repository:

```bash
pnpm trace runs
```

Output:
```text
Recorded Runs (3):
  - [run_1790980010_a1] "demo-ada-lovelace" (full, controller) @ 2026-10-02T22:20:10.000Z
  - [run_1790980015_b2] "demo-charles-babbage" (full, controller) @ 2026-10-02T22:20:15.000Z
  - [run_1790980020_c3] "demo-claude-shannon" (full, controller) @ 2026-10-02T22:20:20.000Z
```

---

### Launching the Web Inspector

Trace2Code includes a built-in interactive HTTP dashboard for inspecting recorded sessions, action waterfalls, and element snapshots:

```bash
pnpm trace inspect
```

Or open a specific run directly:

```bash
pnpm trace inspect run_1790980010_a1 --port 4300
```

Open your browser at `http://localhost:4300` to explore:
- Step-by-step interactive timeline scrubber.
- DOM snapshot viewer showing the exact element state at the time of each action.
- Ranked selector candidates for every clicked/typed node.

---

### Exporting and Importing JSONL Traces

Export any recorded session from the local SQLite store into a standalone JSONL file:

```bash
pnpm trace export run_1790980010_a1 ./exported-trace.jsonl
```

Validate any external JSONL trace against the strict canonical protocol schema:

```bash
pnpm trace validate ./exported-trace.jsonl
```

---

## 5. Semantic Distillation & Locator Synthesis

The offline distiller analyzes recorded events and parses DOM snapshot trees to generate multi-tiered, resilient locator fallback chains:

```bash
pnpm trace distill <run-id>
```

Output:
```text
Distilling trace for run "demo-ada-lovelace" (31 raw events)...
Semantic Distillation Complete: 8 semantic steps generated.
  Step 1: navigate -> https://benchmark.local/form
  Step 2: fill "#sample-text" -> page.getByLabel('Full Name')
  Step 3: selectOption "#country-select" -> page.getByRole('combobox', { name: 'Country' })
  Step 4: check "#sample-check" -> page.getByRole('checkbox', { name: 'Agree' })
  Step 5: click "Submit" -> page.getByRole('button', { name: 'Submit' })
Saved distilled steps to .trace2code/runs/<run-id>/distilled.json
```

### Multi-Tiered Locator Ranking Hierarchy
The locator synthesis engine scores candidates based on resilience to frontend redesigns:
1. **Semantic Test IDs**: `getByTestId('submit-btn')` (Score: 100)
2. **Accessible Role & Name**: `getByRole('button', { name: 'Save' })` (Score: 85)
3. **Explicit Label**: `getByLabel('Email Address')` (Score: 80)
4. **Stable Unique CSS**: `locator('#user-email')` (Score: 65)
5. **Hierarchical XPath**: `locator('//form//button[1]')` (Score: 30, Fallback only)

---

## 6. Compiling to Standalone Playwright Projects

### Compiling to Playwright TypeScript

Compile a single recorded demonstration directly into a ready-to-run Playwright TypeScript test project:

```bash
pnpm trace compile <run-id> --output ./my-automation-suite
```

Generated project structure:
```text
my-automation-suite/
|-- workflow.ts            # Type-safe workflow execution function
|-- workflow.test.ts       # Playwright test harness
|-- input.schema.json      # JSON schema for parameter validation
|-- package.json           # Self-contained dependencies
|-- playwright.config.ts   # Playwright configuration
|-- tsconfig.json          # TypeScript compiler configuration
+-- README.md              # Standalone execution guide
```

### Generated Code Sample (`workflow.ts`):
```typescript
import { Page, expect } from '@playwright/test';

export interface WorkflowInputs {
  fullName?: string;
  country?: string;
  agreeToTerms?: boolean;
}

export async function runWorkflow(page: Page, inputs: WorkflowInputs = {}) {
  // Step 1: Navigation
  await page.goto('http://127.0.0.1:55953/');

  // Step 2: Fill Name with Multi-Locator Fallback
  const nameInput = page.getByRole('textbox', { name: 'Full Name' })
    .or(page.locator('#sample-text'))
    .first();
  await nameInput.fill(inputs.fullName ?? 'Ada Lovelace');

  // Step 3: Select Country
  const countrySelect = page.getByRole('combobox', { name: 'Country' })
    .or(page.locator('#country-select'))
    .first();
  await countrySelect.selectOption(inputs.country ?? 'ca');

  // Step 4: Conditional Checkbox
  if (inputs.agreeToTerms) {
    const checkbox = page.getByRole('checkbox', { name: 'I agree' })
      .or(page.locator('#sample-check'))
      .first();
    await checkbox.check();
  }

  // Step 5: Submit
  const submitButton = page.getByRole('button', { name: 'Submit Form' })
    .or(page.locator('#submit-btn'))
    .first();
  await submitButton.click();

  // Assertion: Verify feedback
  await expect(page.locator('#click-feedback')).toContainText('Clicked!');
}
```

---

### Running the Generated Test Suite

The generated project has zero dependencies on Trace2Code or runtime LLMs. Anyone with Node.js can execute it immediately:

```bash
cd ./my-automation-suite
npm install
npx playwright test
```

---

## 7. Multi-Demonstration Synthesis & Generalization

Recording only one human demonstration produces a test with hardcoded strings. Recording **multiple demonstrations** allows Trace2Code to discover dynamic variables, invariant workflows, and conditional branches.

```bash
pnpm trace generalize <demo-1> <demo-2> <demo-3> \
  --name "checkout-flow" \
  --output ./generalized-checkout
```

### How Generalization Works:
1. **Needleman-Wunsch Alignment**: Performs dynamic programming sequence alignment across multiple trace timelines.
2. **Variable Discovery**: Detects steps where the action and target locator are identical across demonstrations, but the typed text or selected option differed. These are automatically extracted into typed parameters (`${variables.query}`).
3. **Branch Extraction**: Detects steps present in some demonstrations but skipped in others (e.g., opting in to email newsletters, selecting gift wrapping), synthesizing `if (inputs.featureEnabled) { ... }` conditional blocks.
4. **Invariant Assertion Extraction**: Detects consistent end states and generates post-condition assertions.

---

## 8. Self-Healing Runtime & Git Patch Diffs

When target web applications change (e.g. CSS classes renamed, test IDs modified, markup refactored), traditional test scripts break.

Trace2Code includes a **Self-Healing Semantic Runtime**:

```typescript
import { SemanticRecoveryExecutor } from '@trace2code/runtime-semantic';

const executor = new SemanticRecoveryExecutor({
  autoPatch: true, // Generate unified Git patch diff on recovery
});

const result = await executor.executeStep(page, step);
if (result.recovered) {
  console.log(`Step ${step.id} healed! Matched candidate score: ${result.matchScore}`);
  console.log(`Git patch generated at: ${result.patchPath}`);
}
```

### Sample Automated Git Patch Diff:
```diff
--- a/workflow.ts
+++ b/workflow.ts
@@ -14,3 +14,3 @@
-  const submitBtn = page.getByTestId('submit-v1');
+  const submitBtn = page.getByTestId('submit-v2-renamed');
   await submitBtn.click();
```

---

## 9. Remote Worker Execution Plane & Forensics

To execute compiled workflows remotely inside isolated headless Chromium containers:

### Start the REST API:
```bash
npx tsx apps/api/src/index.ts
# Running on http://127.0.0.1:4000
```

### Deploy Workflow & Trigger Job:
```bash
# 1. Register compiled workflow definition
curl -X POST http://localhost:4000/api/deploy \
  -H "Content-Type: application/json" \
  -d '{"name": "smoke-test", "workflowPath": "./my-automation-suite"}'

# 2. Trigger asynchronous execution job
curl -X POST http://localhost:4000/api/runs \
  -H "Content-Type: application/json" \
  -d '{"workflowId": "wf_smoke_123", "inputs": {"fullName": "Alan Turing"}}'

# 3. Poll execution status
curl http://localhost:4000/api/runs/run_abc_456

# 4. On failure, retrieve complete forensic bundle (HAR, console logs, error screenshot)
curl http://localhost:4000/api/runs/run_abc_456/artifacts
```

---

## 10. CLI Command Reference

| Command | Usage | Description |
| :--- | :--- | :--- |
| `demo:e2e` | `pnpm demo:e2e` | Runs complete 7-stage live end-to-end multi-demonstration compiler test |
| `record` | `pnpm trace record -u <url>` | Launches interactive browser session and records canonical interaction trace |
| `runs` | `pnpm trace runs` | Lists all recorded sessions stored in local SQLite database |
| `inspect` | `pnpm trace inspect [runId]` | Starts interactive HTTP web visualizer with step timeline and DOM explorer |
| `distill` | `pnpm trace distill <runId>` | Executes offline semantic distillation, event debouncing, and locator ranking |
| `compile` | `pnpm trace compile <runId>` | Compiles a single demonstration into a standalone Playwright TypeScript project |
| `generalize` | `pnpm trace generalize <runs...>` | Synthesizes multiple demonstrations into parameterized WorkflowIR and Playwright code |
| `validate` | `pnpm trace validate <file>` | Validates any JSONL trace against canonical protocol Zod schemas |
| `export` | `pnpm trace export <runId> [file]` | Exports recorded run from SQLite catalog into standalone JSONL file |
| `import` | `pnpm trace import <file>` | Imports external JSONL trace file into local catalog |
| `test` | `pnpm test` | Runs complete monorepo test suite (77 tests across 17 test suites) |
| `build` | `pnpm build` | Typechecks and builds all packages, apps, and services |
