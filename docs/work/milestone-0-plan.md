# Milestone 0 Plan: Repository, Contracts, Fixtures

## Existing state
Clean repository initialized with git. Empty workspace.

## Files/packages affected
- `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.base.json`
- `packages/protocol/`: Canonical schemas (Zod + TypeScript interfaces), serialization, redaction guard, validators
- `packages/test-fixtures/`: Fixture website providing deterministic DOM elements, forms, modals, iframes, SPA routes, uploads, drag-and-drop
- `fixtures/traces/basic.jsonl`: Valid sample trace meeting the canonical protocol
- `apps/cli/`: Baseline CLI exposing `trace validate <path>`
- `docs/milestones/00-foundation.md`: Milestone completion documentation
- `docs/adr/0001-canonical-recorder-protocol.md`: ADR on the canonical recorder protocol
- `README.md`: Architecture overview and guide

## Implementation plan
1. Initialize monorepo root config with pnpm workspaces, TypeScript base config, Vitest config.
2. Build `packages/protocol`:
   - Implement `RecordingRunSchema`, `RawTraceEventSchema`, `ElementEvidenceSchema`, `PageSnapshotSchema`, `RecordingConfigSchema`, and `RedactedValueSchema`.
   - Implement monotonic sequence validator, JSONL parser/serializer, redaction leak checker.
3. Build `packages/test-fixtures`:
   - Create deterministic test server with all required controls: text fields, button, checkbox, select, custom dropdown, upload, drag-and-drop, modal, multi-page, SPA route change, iframe, dynamic element, duplicate labels, fake login form.
4. Create sample canonical trace in `fixtures/traces/basic.jsonl`.
5. Create baseline CLI `apps/cli` to support `pnpm trace validate fixtures/traces/basic.jsonl`.
6. Write unit tests for schemas, validation, serialization, monotonicity, and redaction safety.
7. Write integration test verifying fixture website launches and responds with all expected elements.
8. Validate `pnpm install`, `pnpm build`, `pnpm test`, `pnpm trace validate fixtures/traces/basic.jsonl`.
9. Document results in `docs/milestones/00-foundation.md`.

## Test plan
- Unit tests:
  - Schema acceptance of valid samples
  - Schema rejection of malformed samples
  - Serialization round-trip data preservation
  - Event sequence monotonic enforcement
  - Redacted value type safety (cannot accidentally serialize plaintext)
- Integration tests:
  - Fixture server start and route verification
- Trace validation CLI:
  - Successful validation on `fixtures/traces/basic.jsonl`

## Acceptance test command
```bash
pnpm install && pnpm build && pnpm test && pnpm trace validate fixtures/traces/basic.jsonl
```

## Risks
- Version mismatch across workspace packages (mitigated with consistent root tsconfig and catalog/shared devDependencies).
- Port collision in fixture website tests (use dynamic port binding).
