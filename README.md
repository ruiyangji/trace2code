# Trace2Code: Browser Demonstration Compiler

Trace2Code records human browser interactions, distills the raw event trace into a semantic workflow representation, and compiles it into clean, deterministic Playwright automation source code without runtime LLM dependencies.

```text
human demonstration
        |
        v
interaction trace (Canonical Protocol JSONL)
        |
        v
deterministic distiller (event coalescing & locator ranking)
        |
        v
semantic workflow IR
        |
        +---------------------+
        |                     |
        v                     v
Playwright compiler      semantic executor
        |                     |
        v                     v
source code             LLM-assisted recovery
        |                     |
        +----------+----------+
                   |
                   v
             browser runtime
```

## Repository Structure

```text
trace2code/
|-- apps/
|   |-- cli/                  # Unified CLI (trace2code / pnpm trace)
|   |-- extension/            # Chrome Manifest V3 Extension
|   |-- inspector/            # Local developer web inspector
|   +-- api/                  # Remote worker orchestration API
|
|-- packages/
|   |-- protocol/             # Canonical schemas, Zod validators & JSONL stream tools
|   |-- recorder-core/        # Shared event normalization & redaction engine
|   |-- recorder-playwright/  # Controller-based recorder using Playwright & CDP
|   |-- recorder-extension/   # Content script & service worker recorder bridge
|   |-- trace-store/          # Local SQLite store & JSONL export/import
|   |-- distiller/            # Deterministic online/offline distillation & locator scoring
|   |-- workflow-ir/          # Semantic Workflow IR definition & validation
|   |-- compiler/             # Playwright code generator & LLM semantic compiler
|   |-- runtime-playwright/   # Deterministic replay engine
|   |-- runtime-semantic/     # Semantic recovery runtime
|   +-- test-fixtures/        # Deterministic benchmark website for tests & demos
|
|-- fixtures/
|   +-- traces/               # Canonical golden trace files
|
+-- docs/
    |-- adr/                  # Architectural Decision Records
    |-- milestones/           # Shipped milestone artifacts
    +-- work/                 # Milestone execution plans
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Run all unit and integration tests
pnpm test

# Build all packages
pnpm build

# Validate a canonical trace file
pnpm trace validate fixtures/traces/basic.jsonl
```
