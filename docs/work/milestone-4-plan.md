# Milestone 4 Plan: Trace Store and Run Inspector

## Existing state
- Recorders support both FULL and DISTILLED modes.
- JSONL files are streamed to `.trace2code/runs/<runId>/trace.jsonl`.
- `OnlineDistiller` and `distillRawTrace` implemented.

## Files/packages affected
- `packages/trace-store`: SQLite repository (`better-sqlite3`), database migrations, CRUD for runs & events, attachments/screenshots management, JSONL import/export.
- `apps/inspector`: Local web inspector server with interactive dashboard UI (timeline, event filtering, element evidence viewer, screenshot modal, redaction markers).
- `apps/cli`: Add commands:
  - `trace2code runs`: list runs in store
  - `trace2code inspect <run-id>`: launches inspector web UI and prints terminal summary
  - `trace2code export <run-id> [out.jsonl]`: exports run and events to JSONL
  - `trace2code import <file.jsonl>`: imports JSONL trace into SQLite store
- `docs/milestones/04-trace-inspector.md`: Milestone completion documentation.

## Implementation plan
1. Create `packages/trace-store`:
   - Schema: `runs` table (id, name, started_at, ended_at, integration, capture_mode, browser_json, config_json), `events` table (id, run_id, seq, timestamp_ms, tab_id, frame_id, type, payload_json, target_json), `attachments` table (id, run_id, type, path, created_at).
   - `TraceStore` class: `saveRun()`, `getRun()`, `listRuns()`, `appendEvents()`, `getEvents()`, `exportJsonl()`, `importJsonl()`.
2. Create `apps/inspector`:
   - HTTP server serving the Web Inspector dashboard.
   - REST endpoints:
     - `GET /api/runs`: list stored runs
     - `GET /api/runs/:id`: get run details, raw events, distilled semantic steps, and screenshots
     - `GET /api/runs/:id/screenshots/:file`: serve screenshot files
   - Single-Page Application (vanilla HTML/CSS/JS or lightweight):
     - Timeline of actions
     - Switch view: Raw Events vs Distilled Semantic Steps
     - Side drawer / detail pane: Element Evidence, CSS candidates, accessible name/role, bounding box, nearby text, redaction badge
     - Screenshot viewer
3. CLI commands: `runs`, `inspect`, `export`, `import`.
4. Tests:
   - Unit tests: migrations, run lifecycle, append ordering, import/export round trip, attachment integrity.
   - Integration test: Record fixture -> persist -> inspect run -> export -> wipe DB -> import -> assert equivalence.
   - UI E2E test via Playwright verifying loading run, switching event modes, selecting event, and redaction display.
5. Milestone documentation.

## Acceptance test command
```bash
pnpm test
```
and CLI trace export/import verification.
