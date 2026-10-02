# Milestone 9 Plan: Remote Worker and Deployment

## Existing state
- Deterministic compiler produces standalone Playwright code (`workflow.ts`).
- Recoverable runtime executes workflows with recovery decisions and patch diffs.

## Files/packages affected
- `apps/api/`:
  - Fast HTTP control plane server.
  - Endpoints:
    - `POST /workflows`: Registers workflow IR and metadata.
    - `POST /workflows/:id/runs`: Queues a run with input parameters.
    - `GET /runs/:id`: Returns status (`queued` | `running` | `completed` | `failed`), step logs, recovery decisions.
    - `GET /runs/:id/artifacts`: Serves artifact manifest and file buffers.
- `services/worker/`:
  - `WorkerService`: Queue consumer executing workflow runs in isolated browser contexts.
  - Captures execution logs, step timing, screenshots, and failure dumps.
- `apps/api/test/e2e.test.ts`:
  - End-to-end test:
    1. Register workflow via API.
    2. Dispatch successful run with inputs -> worker executes -> poll status -> verify completed and artifacts present.
    3. Dispatch intentionally failing run (broken assertion / unrecoverable target) -> verify status `failed`, structured failure diagnostics, and failure screenshot captured.
- `docs/milestones/09-remote-execution.md`: Milestone completion documentation.

## Acceptance criteria
```bash
pnpm test
```
All monorepo tests pass, end-to-end API workflow submission and isolated worker execution passes with failure diagnostic and screenshot verification.
