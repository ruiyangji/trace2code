# Milestone 4 Completion: Trace Store and Run Inspector

## What was implemented
- Created `@trace2code/trace-store`:
  - Pure WebAssembly SQLite persistence engine via `sql.js` providing zero-segfault, cross-platform persistence.
  - Relational schema with migrations: `runs`, `events` (indexed on `run_id, seq`), and `attachments`.
  - Full CRUD operations: `saveRun`, `getRun`, `listRuns`, `appendEvents`, `getEvents`, `saveAttachment`, `getAttachments`.
  - Complete JSONL serialization round-trip: `exportJsonl` and `importJsonl` with schema and monotonic sequence verification.
- Created `@trace2code/inspector`:
  - Developer web dashboard with timeline, run selection dropdown, and dual-mode inspection:
    - Distilled Semantic Steps view
    - Raw Events view
  - Detailed Evidence Inspector panel:
    - Interaction intent and timestamp
    - Target element evidence: accessibleName, role, testIds, CSS candidates, XPath, bounding rect
    - Value preview with clear security redaction tags (`[REDACTED: password-field]`)
    - Raw JSON inspection
    - Screenshot attachments viewer
  - HTTP REST endpoints: `/api/runs`, `/api/runs/:id`, `/api/screenshots/:runId/:filename`.
- Extended `@trace2code/cli` with commands:
  - `trace2code runs`: lists recorded runs in local SQLite store
  - `trace2code inspect [run-id]`: launches local web inspector dashboard
  - `trace2code export <run-id> [out.jsonl]`: exports trace from SQLite store to portable JSONL
  - `trace2code import <file.jsonl>`: imports JSONL trace into SQLite store

## Architecture changes
- Recordings can be persisted locally in SQLite, exported to canonical JSONL for portable sharing/CI regression testing, and inspected visually without manual JSON parsing.
- Zero external runtime database infrastructure (Postgres/Redis) needed.

## Tests added
- `packages/trace-store/src/store.test.ts`:
  - Run lifecycle: `saveRun`, `getRun`, `listRuns`.
  - Monotonic event append ordering preservation.
  - Export/import round-trip: export to JSONL -> wipe database -> import -> exact data preservation.
  - Attachment persistence and retrieval.
- `apps/inspector/src/inspector.test.ts`:
  - Inspector API route verification (`/api/runs`, `/api/runs/:id`).
  - Automated browser UI test using Playwright:
    - Loads dashboard and verifies selected run
    - Toggles between Distilled Steps and Raw Events
    - Clicks action and inspects Element Evidence drawer
    - Verifies redaction tag rendering for sensitive fields

## Commands executed & Automated test results
```bash
$ pnpm test
 Test Files  10 passed (10)
      Tests  35 passed (35)
   Duration  4.52s

$ pnpm trace import fixtures/traces/basic.jsonl
Successfully imported run "basic-demonstration" (ID: run_fixture_basic) into SQLite store.

$ pnpm trace runs
Recorded Runs (1):
  - [run_fixture_basic] "basic-demonstration" (full, controller) @ 2026-10-02T16:00:00Z

$ pnpm trace export run_fixture_basic /tmp/basic_exported.jsonl
Run run_fixture_basic successfully exported to /tmp/basic_exported.jsonl

$ pnpm trace validate /tmp/basic_exported.jsonl
Trace valid! Run ID: run_fixture_basic, Event Count: 7
```

## Next milestone dependencies
- Milestone 5: Offline Semantic Distiller.
