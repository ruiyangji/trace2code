import { describe, it, expect } from 'vitest';
import {
  RecordingRunSchema,
  RawTraceEventSchema,
  ElementEvidenceSchema,
  PageSnapshotSchema,
  RecordingConfigSchema,
  RedactedValueSchema,
  createRedactedValue,
  assertNoLeakedSecrets,
  validateTraceLines,
  serializeRunHeader,
  serializeTraceEvent,
  parseTraceLine,
} from './index.js';

describe('Canonical Protocol Schemas', () => {
  it('accepts valid RecordingRun', () => {
    const validRun = {
      id: 'run_test_01',
      name: 'expense-report',
      startedAt: '2026-10-02T16:00:00Z',
      integration: 'controller' as const,
      captureMode: 'full' as const,
      browser: {
        name: 'Chromium',
        version: '130.0.0.0',
        userAgent: 'Mozilla/5.0 Chrome/130.0.0.0',
        viewport: { width: 1280, height: 720 },
      },
      config: {
        captureMode: 'full' as const,
        screenshots: { enabled: true, strategy: 'boundary' as const, maskSensitiveFields: true },
        network: { enabled: true, captureBodies: false, redactHeaders: ['authorization'] },
        privacy: {
          redactPasswords: true,
          redactAuthorizationHeaders: true,
          redactCookies: true,
          sensitiveSelectors: ['input[type="password"]'],
        },
      },
      tabs: [{ id: 'tab-1', url: 'http://localhost:3000', title: 'Test App' }],
    };

    const res = RecordingRunSchema.safeParse(validRun);
    expect(res.success).toBe(true);
  });

  it('rejects malformed RecordingRun', () => {
    const badRun = {
      id: 'run_test_01',
      // missing name, startedAt, integration
      captureMode: 'invalid_mode',
    };
    const res = RecordingRunSchema.safeParse(badRun);
    expect(res.success).toBe(false);
  });

  it('accepts valid RawTraceEvent with target ElementEvidence', () => {
    const validEvent = {
      id: 'evt_01',
      runId: 'run_test_01',
      seq: 0,
      timestampMs: 1727884800000,
      tabId: 'tab-1',
      frameId: 'main',
      type: 'click' as const,
      payload: { button: 0 },
      target: {
        tagName: 'button',
        role: 'button',
        accessibleName: 'Submit Form',
        text: 'Submit',
        testIds: { 'data-testid': 'submit-btn' },
        cssCandidates: ['#submit-btn', 'button.primary'],
        rect: { x: 100, y: 200, width: 80, height: 32 },
      },
    };
    const res = RawTraceEventSchema.safeParse(validEvent);
    expect(res.success).toBe(true);
  });

  it('rejects non-monotonic sequence numbers', () => {
    const lines = [
      JSON.stringify({
        id: 'run_1',
        name: 'test',
        startedAt: '2026-10-02T16:00:00Z',
        integration: 'controller',
        captureMode: 'full',
        browser: { name: 'Chromium', version: '1.0' },
        config: { captureMode: 'full' },
        tabs: [],
      }),
      JSON.stringify({
        id: 'e1',
        runId: 'run_1',
        seq: 5,
        timestampMs: 100,
        tabId: 't1',
        frameId: 'main',
        type: 'click',
        payload: {},
      }),
      JSON.stringify({
        id: 'e2',
        runId: 'run_1',
        seq: 3, // Out of order!
        timestampMs: 200,
        tabId: 't1',
        frameId: 'main',
        type: 'click',
        payload: {},
      }),
    ];

    const result = validateTraceLines(lines);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('strictly monotonic'))).toBe(true);
  });

  it('round-trips serialization and parsing preserving data', () => {
    const event = {
      id: 'evt_rt',
      runId: 'run_1',
      seq: 1,
      timestampMs: 12345,
      tabId: 'tab_0',
      frameId: 'main',
      type: 'input' as const,
      payload: { data: 'test input' },
      target: {
        tagName: 'input',
        name: 'username',
        testIds: { 'data-test': 'username-input' },
        cssCandidates: ['input[name="username"]'],
      },
    };

    const serialized = serializeTraceEvent(event);
    const parsed = parseTraceLine(serialized, 2);
    expect(parsed.type).toBe('event');
    expect(parsed.data).toEqual(event);
  });

  it('enforces secret/password redaction', () => {
    const redacted = createRedactedValue('password-field');
    expect(RedactedValueSchema.safeParse(redacted).success).toBe(true);

    const sensitiveEventWithPlaintext = {
      id: 'e_pass',
      runId: 'run_1',
      seq: 0,
      timestampMs: 50,
      tabId: 't1',
      frameId: 'main',
      type: 'input' as const,
      payload: {},
      target: {
        tagName: 'input',
        type: 'password',
        name: 'user_password',
        value: 'plaintext_super_secret_123',
        testIds: {},
        cssCandidates: [],
      },
    };

    const lines = [
      JSON.stringify({
        id: 'run_1',
        name: 'test',
        startedAt: '2026-10-02T16:00:00Z',
        integration: 'controller',
        captureMode: 'full',
        browser: { name: 'Chromium', version: '1.0' },
        config: { captureMode: 'full' },
        tabs: [],
      }),
      JSON.stringify(sensitiveEventWithPlaintext),
    ];

    const result = validateTraceLines(lines);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Password element value was not redacted'))).toBe(true);

    // Verify assertNoLeakedSecrets throws when secret is in payload
    expect(() => {
      assertNoLeakedSecrets(sensitiveEventWithPlaintext, ['plaintext_super_secret_123']);
    }).toThrow(/Plaintext secret detected/);
  });
});
