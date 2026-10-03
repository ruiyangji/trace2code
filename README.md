# Trace2Code: Browser Demonstration Compiler

[![Tests](https://img.shields.io/badge/tests-77%20passed%20(17%20suites)-emerald)](https://github.com/ruiyangji/trace2code)
[![Milestones](https://img.shields.io/badge/milestones-11%20completed-blue)](https://github.com/ruiyangji/trace2code/milestones?state=closed)
[![PRs](https://img.shields.io/badge/PRs-23%20merged-purple)](https://github.com/ruiyangji/trace2code/pulls?q=is%3Apr+is%3Aclosed)
[![Runtime](https://img.shields.io/badge/runtime-Zero--LLM%20Playwright-brightgreen)](https://github.com/ruiyangji/trace2code)
[![License](https://img.shields.io/badge/license-MIT-gray)](LICENSE)

**Trace2Code** compiles raw human browser interactions into clean, deterministic, self-healing **Playwright automation scripts** without runtime LLM dependencies.

By combining low-level Chrome DevTools Protocol (CDP) capture, multi-pass semantic distillation (91.7% raw event reduction), dynamic programming sequence alignment (Needleman-Wunsch), and AST codegen, Trace2Code bridges the gap between manual human demonstrations and rock-solid production automations.

---

## Architecture Overview

```text
  [ Human Demonstrations ]
             |
             +------------------------------+
             |                              |
             v                              v
   [ CDP Controller Recorder ]    [ Chrome Extension MV3 ]
   (Headless / CLI Orchestration)  (In-Browser User Sessions)
             |                              |
             +--------------+---------------+
                            |
                            v
               [ Canonical Protocol JSONL ]
               (Mouse, Keypress, DOM Dumps)
                            |
                            v
            [ Multi-Pass Semantic Distiller ]
      (91.7% Event Reduction & Multi-Tiered Locators)
                            |
                            v
             [ Multi-Demonstration Synthesis ]
           (Needleman-Wunsch Sequence Alignment)
             |                              |
             | Parameters                   | Branches
             v                              v
                 [ Semantic WorkflowIR ]
                            |
                            v
               [ Deterministic AST Compiler ]
                            |
                            v
         [ Standalone Playwright TypeScript Project ]
         (Zero LLM at Runtime • Native Type Safety)
                            |
             +--------------+--------------+
             |                             |
             v                             v
   [ Clean Browser CI ]         [ Self-Healing Runtime ]
   (npx playwright test)        (Auto-Repair & Git Patch Diffs)
```

---

## ⚡ Quick Start (60 Seconds)

Trace2Code ships with an automated live end-to-end verification pipeline:

```bash
# 1. Clone the repository
git clone https://github.com/ruiyangji/trace2code.git
cd trace2code

# 2. Install monorepo dependencies
pnpm install

# 3. Run the live end-to-end multi-demonstration verification
pnpm demo:e2e
```

### What `pnpm demo:e2e` executes live:
1. Spawns an internal local web application fixture server.
2. Launches real Chromium and records **3 distinct user demonstrations** with varying inputs and branches.
3. Automatically runs semantic distillation, eliminating layout noise and debouncing keystrokes.
4. Performs **Needleman-Wunsch sequence alignment** to extract 5 dynamic parameters (`${variables.sampleText}`) and 3 conditional execution branches.
5. Emits a standalone, fully-typed Playwright TypeScript project bundle.
6. Typechecks generated code with `tsc --noEmit` (**0 errors**).
7. Executes the compiled script in a fresh browser with an **unseen 4th input**, verifying DOM mutations and capturing a screenshot.
8. Deploys the workflow to the remote worker control plane (`apps/api`), executes in an isolated sandbox, and packages forensic failure diagnostics.

---

## 📖 How to Use Trace2Code

For full step-by-step guides with code examples, see [**docs/HOW-TO-USE.md**](docs/HOW-TO-USE.md).

### 1. Record Browser Sessions

#### Using CLI Controller:
```bash
pnpm trace record --url http://localhost:3000 --name "login-flow"
```
Press **Enter** or close the browser window when done. Traces are automatically registered in the local SQLite store (`.trace2code/store.db`).

#### Using Chrome Extension MV3:
1. Load `apps/extension` as an unpacked extension in `chrome://extensions`.
2. Click **Start Recording**, perform actions, then click **Stop & Export**.
3. Import the resulting trace:
   ```bash
   pnpm trace import ~/Downloads/my-trace.jsonl
   ```

---

### 2. Inspect Recorded Traces in Web UI

Launch the interactive local inspector to visualize event timelines, DOM trees, and screenshots:

```bash
pnpm trace inspect [runId] --port 4300
```
Open [http://localhost:4300](http://localhost:4300) to scrub through action breadcrumbs, inspect captured element snapshots, and view ranked selector scores.

---

### 3. Distill & Rank Element Locators

Run offline distillation to coalesce noise and compute multi-tiered locator fallback chains (TestID $\to$ Role/Text $\to$ CSS $\to$ XPath):

```bash
pnpm trace distill <runId>
```

---

### 4. Compile to Standalone Playwright Projects

Compile a demonstration into a standalone, zero-LLM Playwright TypeScript test project:

```bash
pnpm trace compile <runId> --output ./generated-suite
```

To run the generated test project immediately:
```bash
cd ./generated-suite
npm install
npx playwright test
```

---

### 5. Multi-Demonstration Synthesis & Generalization

Record multiple demonstrations of the same workflow with different inputs or optional steps, then synthesize a generalized workflow:

```bash
pnpm trace generalize demo-run-1 demo-run-2 demo-run-3 \
  --name "dynamic-search" \
  --output ./generalized-search
```

Trace2Code automatically:
- Identifies invariant workflow steps.
- Converts differing values into typed variables (`${variables.query}`).
- Discovers conditional branches (`if (inputs.agree) { ... }`).

---

### 6. Self-Healing Runtime & Automated Git Diffs

When target web apps change classes, IDs, or structure, run with the resilient semantic executor:

```typescript
import { SemanticRecoveryExecutor } from '@trace2code/runtime-semantic';

const executor = new SemanticRecoveryExecutor({ autoPatch: true });
const result = await executor.executeStep(page, step);
// If locator changed, automatically emits ready-to-merge unified Git patch diff
```

---

## 🛠️ CLI Command Reference

| Command | Usage | Description |
| :--- | :--- | :--- |
| `demo:e2e` | `pnpm demo:e2e` | Live 7-stage end-to-end multi-demonstration verification pipeline |
| `record` | `pnpm trace record [options]` | Records browser interaction session via CDP controller |
| `runs` | `pnpm trace runs` | Lists all recorded sessions stored in local SQLite database |
| `inspect` | `pnpm trace inspect [runId]` | Starts interactive HTTP web visualizer and timeline explorer |
| `distill` | `pnpm trace distill <runId>` | Performs semantic distillation and locator ranking |
| `compile` | `pnpm trace compile <runId>` | Compiles a single demonstration to Playwright TypeScript |
| `generalize` | `pnpm trace generalize <runs...>` | Synthesizes multiple demonstrations into parameterized WorkflowIR |
| `validate` | `pnpm trace validate <file>` | Validates JSONL trace against canonical protocol schemas |
| `export` | `pnpm trace export <runId>` | Exports a run from SQLite database to standalone JSONL |
| `import` | `pnpm trace import <file>` | Imports external JSONL trace file into local database |
| `test` | `pnpm test` | Runs entire monorepo test suite (77 tests across 17 suites) |

---

## 📦 Monorepo Architecture

```text
trace2code/
|-- apps/
|   |-- cli/                  # Unified CLI tool (pnpm trace / pnpm trace2code)
|   |-- extension/            # Chrome Manifest V3 Extension (background, popup, content script)
|   |-- inspector/            # Interactive HTTP web visualizer & timeline dashboard
|   +-- api/                  # REST API control plane for remote workflow orchestration
|
|-- packages/
|   |-- protocol/             # Canonical Zod schemas, event contracts, JSONL streaming parser
|   |-- recorder-core/        # Browser-agnostic event capture, ring buffer, and PII redaction
|   |-- recorder-playwright/  # CDP-based Playwright controller recorder
|   |-- recorder-extension/   # MV3 communication daemon and reconnection state machine
|   |-- trace-store/          # Local SQLite store, indexing catalog, JSONL import/export
|   |-- distiller/            # Streaming and offline distillation, locator ranking engine
|   |-- workflow-ir/          # Canonical Workflow Intermediate Representation specification
|   |-- compiler/             # Playwright AST compiler & LLM anti-hallucination compiler
|   |-- runtime-semantic/     # Resilient runtime, self-healing recovery, Git patch diff emitter
|   +-- test-fixtures/        # Deterministic benchmark web server for reproducible tests
|
|-- services/
|   +-- worker/               # Sandboxed Chromium execution worker & forensic artifact packager
|
|-- fixtures/
|   +-- traces/               # Canonical golden trace files
|
+-- docs/
    |-- HOW-TO-USE.md         # Comprehensive end-to-end tutorial & user guide
    |-- SPECIFICATION.md      # Full protocol and compiler specification
    |-- adr/                  # Architectural Decision Records (ADRs)
    |-- milestones/           # Detailed documentation for Milestones 0 through 10
    +-- work/                 # Milestone execution plans
```

---

## 🏆 Shipped Milestones & Pull Requests

Every milestone in Trace2Code was planned, developed in distinct phases, verified with unit and integration tests, and merged into `main` via dedicated GitHub Pull Requests:

| Milestone | Phase PRs | Title & Scope | Status |
| :--- | :--- | :--- | :--- |
| **Milestone 0: Foundation** | [PR #1](https://github.com/ruiyangji/trace2code/pull/1) & [PR #2](https://github.com/ruiyangji/trace2code/pull/2) | Canonical Event Schemas, Streaming JSONL Parser & Deterministic Benchmark Fixtures | Closed |
| **Milestone 1: Controller Recorder** | [PR #3](https://github.com/ruiyangji/trace2code/pull/3) & [PR #4](https://github.com/ruiyangji/trace2code/pull/4) | Browser-Agnostic Recorder Core, In-Page Script, CDP Controller & CLI Recorder | Closed |
| **Milestone 2: Extension Recorder** | [PR #5](https://github.com/ruiyangji/trace2code/pull/5) & [PR #6](https://github.com/ruiyangji/trace2code/pull/6) | Chrome MV3 Background Worker, Reconnection State Machine, Popup UI & Injector | Closed |
| **Milestone 3: Capture Policy** | [PR #7](https://github.com/ruiyangji/trace2code/pull/7) & [PR #8](https://github.com/ruiyangji/trace2code/pull/8) | Streaming Event Distiller, Debounce Engine, FULL vs DISTILLED Differential Policy | Closed |
| **Milestone 4: Trace Store & Inspector** | [PR #9](https://github.com/ruiyangji/trace2code/pull/9) & [PR #10](https://github.com/ruiyangji/trace2code/pull/10) | Persistent Local Trace Store, Metadata Indexing, Interactive HTTP Web Inspector | Closed |
| **Milestone 5: Offline Distiller** | [PR #11](https://github.com/ruiyangji/trace2code/pull/11) & [PR #12](https://github.com/ruiyangji/trace2code/pull/12) | Multi-Tiered Locator Synthesis (TestID/Role/CSS/XPath) & Replay Parity Evaluator | Closed |
| **Milestone 6: LLM Compiler** | [PR #13](https://github.com/ruiyangji/trace2code/pull/13) & [PR #14](https://github.com/ruiyangji/trace2code/pull/14) | Canonical `WorkflowIR` Specification & Compile-Time Anti-Hallucination Guard | Closed |
| **Milestone 7: Deterministic Compiler** | [PR #15](https://github.com/ruiyangji/trace2code/pull/15) & [PR #16](https://github.com/ruiyangji/trace2code/pull/16) | Pure AST Code Generator to Standalone Playwright Project (`package.json`, `tsconfig`) | Closed |
| **Milestone 8: Semantic Runtime** | [PR #17](https://github.com/ruiyangji/trace2code/pull/17) & [PR #18](https://github.com/ruiyangji/trace2code/pull/18) | Resilient Locator Cascade, Self-Healing DOM Recovery Engine & Automated Git Diff Emitter | Closed |
| **Milestone 9: Remote Execution** | [PR #19](https://github.com/ruiyangji/trace2code/pull/19) & [PR #20](https://github.com/ruiyangji/trace2code/pull/20) | Sandboxed Worker Execution Plane, REST API Control Plane & Failure Forensics Bundle | Closed |
| **Milestone 10: Generalization** | [PR #21](https://github.com/ruiyangji/trace2code/pull/21) & [PR #22](https://github.com/ruiyangji/trace2code/pull/22) | Needleman-Wunsch Multi-Trace Alignment, Dynamic Variable Parameterization & Branch Synthesis | Closed |
| **Release Verification** | [PR #23](https://github.com/ruiyangji/trace2code/pull/23) | Live Multi-Demonstration Verification Pipeline (`pnpm demo:e2e`) | Merged |

- **GitHub Repository**: [github.com/ruiyangji/trace2code](https://github.com/ruiyangji/trace2code)
- **Closed Milestones**: [github.com/ruiyangji/trace2code/milestones](https://github.com/ruiyangji/trace2code/milestones?state=closed)
- **Merged PRs**: [github.com/ruiyangji/trace2code/pulls](https://github.com/ruiyangji/trace2code/pulls?q=is%3Apr+is%3Aclosed)

---

## License

MIT © [Jerry Ji](https://github.com/ruiyangji)
