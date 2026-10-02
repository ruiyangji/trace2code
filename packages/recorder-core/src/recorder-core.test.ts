import { describe, it, expect } from 'vitest';
import { EventSequenceBuffer, RedactionEngine, buildInPageInstrumentationScript } from './index.js';

describe('Recorder Core Unit Tests', () => {
  it('enforces monotonic sequence numbering in EventSequenceBuffer', () => {
    const buffer = new EventSequenceBuffer('run_test_buf');
    const received: number[] = [];

    buffer.subscribe((evt) => {
      received.push(evt.seq);
    });

    const evt1 = buffer.enqueue({
      id: 'e1',
      timestampMs: 100,
      tabId: 't1',
      frameId: 'main',
      type: 'click',
      payload: {},
    });

    const evt2 = buffer.enqueue({
      id: 'e2',
      timestampMs: 150,
      tabId: 't1',
      frameId: 'main',
      type: 'click',
      payload: {},
    });

    expect(evt1.seq).toBe(0);
    expect(evt2.seq).toBe(1);
    expect(received).toEqual([0, 1]);
    expect(buffer.getNextSeq()).toBe(2);
  });

  it('redacts sensitive element values and passwords', () => {
    const engine = new RedactionEngine();

    expect(engine.isSensitiveElement({ type: 'password' })).toBe(true);
    expect(engine.isSensitiveElement({ name: 'user_password' })).toBe(true);
    expect(engine.isSensitiveElement({ id: 'cc-cvv-field' })).toBe(true);
    expect(engine.isSensitiveElement({ attributes: { 'data-secret': 'true' } })).toBe(true);
    expect(engine.isSensitiveElement({ type: 'text', name: 'user_name' })).toBe(false);

    const redacted = engine.redactElementValue('super_secret_password');
    expect(redacted).toEqual({ kind: 'redacted', reason: 'password-field' });
  });

  it('sanitizes authorization and cookie headers', () => {
    const engine = new RedactionEngine();
    const headers = {
      Authorization: 'Bearer secret_token_xyz',
      Cookie: 'sessionid=12345; auth=yes',
      'Content-Type': 'application/json',
      Accept: 'text/html',
    };

    const sanitized = engine.sanitizeHeaders(headers);
    expect(sanitized['Authorization']).toBe('[REDACTED]');
    expect(sanitized['Cookie']).toBe('[REDACTED]');
    expect(sanitized['Content-Type']).toBe('application/json');
  });

  it('generates in-page script with specified sample rate', () => {
    const script = buildInPageInstrumentationScript({ sampleHz: 25, capturePointerMove: true });
    expect(script).toContain('var throttleMs = 40;');
    expect(script).toContain('window.__trace2code_installed');
    expect(script).toContain('addEventListener(\'click\'');
  });
});
