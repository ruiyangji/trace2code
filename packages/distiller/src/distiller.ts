import type { RawTraceEvent, ElementEvidence, RedactedValue } from '@trace2code/protocol';
import type { SemanticTraceStep, SemanticActionType } from './types.js';

export interface DistillerOptions {
  dragDistanceThreshold?: number;
}

export class OnlineDistiller {
  private pendingTyping: {
    event: RawTraceEvent;
    finalValue: string | RedactedValue;
  } | null = null;

  private pendingDrag: {
    sourceEvent: RawTraceEvent;
    sourceTarget?: ElementEvidence;
  } | null = null;

  private lastClickTime = 0;
  private lastClickTargetId = '';

  constructor(private options: DistillerOptions = {}) {}

  /**
   * Process a single incoming raw trace event online.
   * Returns an array of 0 or more distilled events to persist.
   */
  process(raw: RawTraceEvent): RawTraceEvent[] {
    const emitted: RawTraceEvent[] = [];

    // Filter out pure noise in distilled mode
    if (raw.type === 'pointermove' || raw.type === 'wheel') {
      return emitted;
    }

    // Ignore redundant mouse down/up if click follows
    if (raw.type === 'pointerdown') {
      // Check if it's a dragstart
      if ((raw.payload as any)?.drag) {
        this.pendingDrag = { sourceEvent: raw, sourceTarget: raw.target };
      }
      return emitted;
    }

    if (raw.type === 'pointerup') {
      if (this.pendingDrag && (raw.payload as any)?.drop) {
        // Drag sequence completed
        const dragEvent: RawTraceEvent = {
          ...raw,
          type: 'click',
          payload: {
            action: 'drag',
            source: this.pendingDrag.sourceTarget,
            destination: raw.target,
          },
        };
        this.pendingDrag = null;
        emitted.push(dragEvent);
        return emitted;
      }
      this.pendingDrag = null;
      return emitted;
    }

    // Handle typing events (keydown, input, change, blur)
    if (raw.type === 'keydown' || raw.type === 'keyup') {
      // Mechanics, omit individual keystrokes in distilled mode
      return emitted;
    }

    if (raw.type === 'input' || raw.type === 'change') {
      const targetKey = this.getTargetKey(raw.target);
      const val = (raw.payload as any)?.value ?? (raw.target as any)?.value ?? (raw.payload as any)?.data;

      if (this.pendingTyping && this.getTargetKey(this.pendingTyping.event.target) === targetKey) {
        // Update accumulated value
        if (val !== undefined) {
          this.pendingTyping.finalValue = val;
        }
      } else {
        // Target switched: flush previous typing if exists
        if (this.pendingTyping) {
          emitted.push(this.flushTyping()!);
        }
        this.pendingTyping = {
          event: raw,
          finalValue: val ?? '',
        };
      }

      // If explicit change event fired, flush typing immediately
      if (raw.type === 'change') {
        const flushed = this.flushTyping();
        if (flushed) emitted.push(flushed);
      }
      return emitted;
    }

    if (raw.type === 'focus' || raw.type === 'blur') {
      // If blurring typed element, flush it
      if (raw.type === 'blur' && this.pendingTyping) {
        const flushed = this.flushTyping();
        if (flushed) emitted.push(flushed);
      }
      return emitted;
    }

    // User clicked somewhere: flush any pending typing first
    if (this.pendingTyping) {
      const flushed = this.flushTyping();
      if (flushed) emitted.push(flushed);
    }

    // Double click detection
    if (raw.type === 'click') {
      const targetId = this.getTargetKey(raw.target);
      const now = raw.timestampMs;
      if (targetId && targetId === this.lastClickTargetId && now - this.lastClickTime < 300) {
        raw = { ...raw, type: 'dblclick' };
      }
      this.lastClickTime = now;
      this.lastClickTargetId = targetId;
    }

    emitted.push(raw);
    return emitted;
  }

  flush(): RawTraceEvent[] {
    const flushed: RawTraceEvent[] = [];
    if (this.pendingTyping) {
      const item = this.flushTyping();
      if (item) flushed.push(item);
    }
    return flushed;
  }

  private flushTyping(): RawTraceEvent | null {
    if (!this.pendingTyping) return null;
    const { event, finalValue } = this.pendingTyping;
    this.pendingTyping = null;

    return {
      ...event,
      type: 'change',
      payload: { value: finalValue },
      target: event.target
        ? {
            ...event.target,
            value: finalValue,
          }
        : undefined,
    };
  }

  private getTargetKey(target?: ElementEvidence): string {
    if (!target) return '';
    return target.id || target.name || (target.cssCandidates && target.cssCandidates[0]) || target.tagName;
  }
}

/**
 * Offline semantic distiller: converts any list of RawTraceEvents into SemanticTraceSteps.
 */
export function distillRawTrace(events: RawTraceEvent[]): SemanticTraceStep[] {
  const steps: SemanticTraceStep[] = [];
  let seq = 0;

  let pendingTyping: {
    event: RawTraceEvent;
    finalValue: string | RedactedValue;
  } | null = null;

  const flushTyping = () => {
    if (!pendingTyping) return;
    const { event, finalValue } = pendingTyping;
    pendingTyping = null;

    steps.push({
      id: `step_${seq + 1}`,
      seq: seq++,
      timestampMs: event.timestampMs,
      tabId: event.tabId,
      frameId: event.frameId,
      action: 'fill',
      target: event.target,
      value: finalValue,
      payload: { value: finalValue },
    });
  };

  for (let i = 0; i < events.length; i++) {
    const raw = events[i];

    // Filter noise
    if (raw.type === 'pointermove' || raw.type === 'wheel') {
      continue;
    }

    // Navigation
    if (raw.type === 'navigation') {
      flushTyping();
      const navUrl = (raw.payload as any)?.url || '';
      steps.push({
        id: `step_${seq + 1}`,
        seq: seq++,
        timestampMs: raw.timestampMs,
        tabId: raw.tabId,
        frameId: raw.frameId,
        action: 'navigate',
        payload: { url: navUrl },
        postcondition: { urlMatches: navUrl },
      });
      continue;
    }

    // Input / Change (Typing coalescing)
    if (raw.type === 'input' || raw.type === 'change') {
      const val = (raw.payload as any)?.value ?? (raw.target as any)?.value ?? (raw.payload as any)?.data;
      const targetId = raw.target?.id || raw.target?.name || raw.target?.tagName;

      // Special case: Select option change
      if (raw.target?.tagName === 'select') {
        flushTyping();
        steps.push({
          id: `step_${seq + 1}`,
          seq: seq++,
          timestampMs: raw.timestampMs,
          tabId: raw.tabId,
          frameId: raw.frameId,
          action: 'selectOption',
          target: raw.target,
          value: val,
          payload: { value: val },
        });
        continue;
      }

      // Special case: Checkbox toggle
      if (raw.target?.type === 'checkbox') {
        flushTyping();
        const isChecked = (raw.payload as any)?.checked ?? (val === 'on' || val === true);
        steps.push({
          id: `step_${seq + 1}`,
          seq: seq++,
          timestampMs: raw.timestampMs,
          tabId: raw.tabId,
          frameId: raw.frameId,
          action: isChecked ? 'check' : 'uncheck',
          target: raw.target,
          payload: { checked: isChecked },
        });
        continue;
      }

      // Special case: File upload
      if (raw.target?.type === 'file') {
        flushTyping();
        steps.push({
          id: `step_${seq + 1}`,
          seq: seq++,
          timestampMs: raw.timestampMs,
          tabId: raw.tabId,
          frameId: raw.frameId,
          action: 'uploadFile',
          target: raw.target,
          value: val,
        });
        continue;
      }

      // Text input accumulation
      if (pendingTyping && (pendingTyping.event.target?.id === targetId || pendingTyping.event.target?.name === targetId)) {
        if (val !== undefined) pendingTyping.finalValue = val;
      } else {
        flushTyping();
        pendingTyping = { event: raw, finalValue: val ?? '' };
      }

      if (raw.type === 'change') {
        flushTyping();
      }
      continue;
    }

    // Click / Drag
    if (raw.type === 'click') {
      flushTyping();

      // Check if it's a drag payload
      if ((raw.payload as any)?.action === 'drag') {
        steps.push({
          id: `step_${seq + 1}`,
          seq: seq++,
          timestampMs: raw.timestampMs,
          tabId: raw.tabId,
          frameId: raw.frameId,
          action: 'drag',
          target: (raw.payload as any).source,
          payload: { destination: (raw.payload as any).destination },
        });
        continue;
      }

      // Skip click on checkbox if change event handles it
      if (raw.target?.type === 'checkbox') {
        continue;
      }

      steps.push({
        id: `step_${seq + 1}`,
        seq: seq++,
        timestampMs: raw.timestampMs,
        tabId: raw.tabId,
        frameId: raw.frameId,
        action: 'click',
        target: raw.target,
        payload: raw.payload as Record<string, unknown>,
      });
      continue;
    }

    // Marks
    if (raw.type === 'mark') {
      flushTyping();
      steps.push({
        id: `step_${seq + 1}`,
        seq: seq++,
        timestampMs: raw.timestampMs,
        tabId: raw.tabId,
        frameId: raw.frameId,
        action: 'mark',
        payload: raw.payload as Record<string, unknown>,
      });
      continue;
    }
  }

  flushTyping();
  return steps;
}
