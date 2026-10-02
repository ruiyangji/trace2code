import { describe, it, expect } from 'vitest';
import { isRedactedValue, type RawTraceEvent, type ElementEvidence } from '@trace2code/protocol';
import { OnlineDistiller, distillRawTrace } from './index.js';

function makeTarget(partial: Partial<ElementEvidence>): ElementEvidence {
  return {
    tagName: 'div',
    testIds: {},
    cssCandidates: [],
    ...partial,
  };
}

describe('Milestone 3: Distiller Unit & Adversarial Tests', () => {
  describe('OnlineDistiller Transformations & Adversarial Cases', () => {
    it('reduces pointermove* + click to single click', () => {
      const distiller = new OnlineDistiller();
      const events: RawTraceEvent[] = [
        { id: '1', runId: 'r', seq: 0, timestampMs: 10, tabId: 't', frameId: 'f', type: 'pointermove', payload: { x: 10, y: 10 } },
        { id: '2', runId: 'r', seq: 1, timestampMs: 20, tabId: 't', frameId: 'f', type: 'pointermove', payload: { x: 20, y: 20 } },
        { id: '3', runId: 'r', seq: 2, timestampMs: 30, tabId: 't', frameId: 'f', type: 'pointermove', payload: { x: 30, y: 30 } },
        { id: '4', runId: 'r', seq: 3, timestampMs: 40, tabId: 't', frameId: 'f', type: 'click', payload: { button: 0 }, target: makeTarget({ tagName: 'button', id: 'submit' }) },
      ];

      const distilled: RawTraceEvent[] = [];
      for (const e of events) {
        distilled.push(...distiller.process(e));
      }
      distilled.push(...distiller.flush());

      expect(distilled.length).toBe(1);
      expect(distilled[0].type).toBe('click');
      expect(distilled[0].target?.id).toBe('submit');
    });

    it('coalesces keydown* + input* + change into a single change event with final value', () => {
      const distiller = new OnlineDistiller();
      const events: RawTraceEvent[] = [
        { id: '1', runId: 'r', seq: 0, timestampMs: 10, tabId: 't', frameId: 'f', type: 'focus', payload: {}, target: makeTarget({ tagName: 'input', id: 'name' }) },
        { id: '2', runId: 'r', seq: 1, timestampMs: 20, tabId: 't', frameId: 'f', type: 'keydown', payload: { key: 'J' }, target: makeTarget({ tagName: 'input', id: 'name' }) },
        { id: '3', runId: 'r', seq: 2, timestampMs: 30, tabId: 't', frameId: 'f', type: 'input', payload: { data: 'J' }, target: makeTarget({ tagName: 'input', id: 'name', value: 'J' }) },
        { id: '4', runId: 'r', seq: 3, timestampMs: 40, tabId: 't', frameId: 'f', type: 'keydown', payload: { key: 'e' }, target: makeTarget({ tagName: 'input', id: 'name' }) },
        { id: '5', runId: 'r', seq: 4, timestampMs: 50, tabId: 't', frameId: 'f', type: 'input', payload: { data: 'e' }, target: makeTarget({ tagName: 'input', id: 'name', value: 'Je' }) },
        { id: '6', runId: 'r', seq: 5, timestampMs: 60, tabId: 't', frameId: 'f', type: 'change', payload: { value: 'Jerry Ji' }, target: makeTarget({ tagName: 'input', id: 'name', value: 'Jerry Ji' }) },
      ];

      const distilled: RawTraceEvent[] = [];
      for (const e of events) {
        distilled.push(...distiller.process(e));
      }
      distilled.push(...distiller.flush());

      expect(distilled.length).toBe(1);
      expect(distilled[0].type).toBe('change');
      expect(distilled[0].target?.value).toBe('Jerry Ji');
    });

    it('adversarial: handles two fields typed alternately', () => {
      const distiller = new OnlineDistiller();
      const events: RawTraceEvent[] = [
        { id: '1', runId: 'r', seq: 0, timestampMs: 10, tabId: 't', frameId: 'f', type: 'input', payload: { data: 'a' }, target: makeTarget({ tagName: 'input', id: 'field1', value: 'a' }) },
        { id: '2', runId: 'r', seq: 1, timestampMs: 20, tabId: 't', frameId: 'f', type: 'input', payload: { data: 'b' }, target: makeTarget({ tagName: 'input', id: 'field2', value: 'b' }) },
        { id: '3', runId: 'r', seq: 2, timestampMs: 30, tabId: 't', frameId: 'f', type: 'input', payload: { data: 'c' }, target: makeTarget({ tagName: 'input', id: 'field1', value: 'ac' }) },
      ];

      const distilled: RawTraceEvent[] = [];
      for (const e of events) {
        distilled.push(...distiller.process(e));
      }
      distilled.push(...distiller.flush());

      // Target switched twice, so all three entries are correctly preserved
      expect(distilled.length).toBe(3);
      expect(distilled[0].target?.id).toBe('field1');
      expect(distilled[1].target?.id).toBe('field2');
      expect(distilled[2].target?.id).toBe('field1');
    });

    it('adversarial: detects double click within 300ms', () => {
      const distiller = new OnlineDistiller();
      const btnTarget = makeTarget({ tagName: 'button', id: 'dbl-btn' });
      const events: RawTraceEvent[] = [
        { id: '1', runId: 'r', seq: 0, timestampMs: 100, tabId: 't', frameId: 'f', type: 'click', payload: { button: 0 }, target: btnTarget },
        { id: '2', runId: 'r', seq: 1, timestampMs: 250, tabId: 't', frameId: 'f', type: 'click', payload: { button: 0 }, target: btnTarget },
      ];

      const distilled: RawTraceEvent[] = [];
      for (const e of events) {
        distilled.push(...distiller.process(e));
      }
      distilled.push(...distiller.flush());

      expect(distilled.length).toBe(2);
      expect(distilled[0].type).toBe('click');
      expect(distilled[1].type).toBe('dblclick');
    });

    it('preserves redaction of password fields', () => {
      const rawEvents: RawTraceEvent[] = [
        {
          id: 'p1',
          runId: 'r',
          seq: 0,
          timestampMs: 10,
          tabId: 't',
          frameId: 'main',
          type: 'input',
          payload: { data: '[REDACTED]' },
          target: makeTarget({ tagName: 'input', type: 'password', id: 'pwd', value: { kind: 'redacted', reason: 'password-field' } }),
        },
      ];

      const steps = distillRawTrace(rawEvents);
      expect(steps.length).toBe(1);
      expect(steps[0].action).toBe('fill');
      expect(isRedactedValue(steps[0].value)).toBe(true);
    });

    it('property invariant: preserves chronological semantic ordering and frame isolation', () => {
      const events: RawTraceEvent[] = [
        { id: '1', runId: 'r', seq: 0, timestampMs: 100, tabId: 'tab-1', frameId: 'main', type: 'navigation', payload: { url: 'http://test.com' } },
        { id: '2', runId: 'r', seq: 1, timestampMs: 200, tabId: 'tab-1', frameId: 'main', type: 'click', payload: {}, target: makeTarget({ tagName: 'button', id: 'b1' }) },
        { id: '3', runId: 'r', seq: 2, timestampMs: 300, tabId: 'tab-1', frameId: 'iframe-1', type: 'click', payload: {}, target: makeTarget({ tagName: 'button', id: 'b2' }) },
      ];

      const steps = distillRawTrace(events);
      expect(steps.length).toBe(3);
      expect(steps[0].action).toBe('navigate');
      expect(steps[0].seq).toBe(0);
      expect(steps[1].action).toBe('click');
      expect(steps[1].frameId).toBe('main');
      expect(steps[2].action).toBe('click');
      expect(steps[2].frameId).toBe('iframe-1');
      expect(steps[2].seq).toBe(2);
    });
  });
});

