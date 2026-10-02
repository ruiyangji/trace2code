# ADR 0001: Canonical Recorder Protocol

## Status
Accepted

## Context
Trace2Code supports two independent browser integrations:
1. `controller`: Chromium launched and controlled via Playwright / CDP.
2. `extension`: Manifest V3 Chrome Extension injected into user-driven Chrome tabs.

Without a strictly defined and enforced canonical schema, recorder implementations naturally diverge by leaking environment-specific objects (Playwright locators, Chrome tabs, CDP internal domain shapes) into downstream distillation and compilation steps.

## Decision
1. All interaction capture MUST serialize into the common `@trace2code/protocol` event format before downstream ingestion.
2. Every recording session produces a single JSONL stream where:
   - Line 0 represents the `RecordingRun` header with browser metadata and recording configuration.
   - Lines 1..N represent ordered `RawTraceEvent` entries with strictly monotonic sequence numbers (`seq`).
3. Raw events reference target elements through `ElementEvidence`, capturing structural, accessibility, positional, and text evidence without depending on a live browser DOM.
4. Privacy and credential redaction must be performed at event capture time. Passwords and sensitive fields MUST be serialized as `{ kind: "redacted", reason: string }` and never as plaintext strings.
5. All schema validation is enforced via Zod.

## Consequences
- Both recorder engines (Playwright controller and Chrome Extension) can be tested against the exact same contract test suite.
- Downstream distillers and compilers have zero dependency on browser runtime internals.
- Trace files are portable across machines, architectures, and CI runners.
