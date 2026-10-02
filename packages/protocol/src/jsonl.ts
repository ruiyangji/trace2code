import { RecordingRunSchema, type RecordingRun } from './schema/run.js';
import { RawTraceEventSchema, type RawTraceEvent } from './schema/event.js';
import { isRedactedValue } from './schema/redaction.js';

export interface TraceValidationResult {
  valid: boolean;
  run?: RecordingRun;
  eventCount: number;
  errors: string[];
  warnings: string[];
}

export function parseTraceLine(line: string, lineNumber: number): { type: 'run'; data: RecordingRun } | { type: 'event'; data: RawTraceEvent } {
  const trimmed = line.trim();
  if (!trimmed) {
    throw new Error(`Line ${lineNumber}: Empty line`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err: unknown) {
    throw new Error(`Line ${lineNumber}: Invalid JSON - ${(err as Error).message}`);
  }

  // Check if it's wrapped or direct
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;

    // Case 1: Wrapped as { type: 'run', run: ... } or { type: 'run', ... }
    if (obj.type === 'run' && obj.run) {
      const runRes = RecordingRunSchema.safeParse(obj.run);
      if (runRes.success) return { type: 'run', data: runRes.data };
    }

    // Case 2: Direct RecordingRun (has integration, captureMode, browser, config)
    if ('integration' in obj && 'captureMode' in obj && 'browser' in obj) {
      const runRes = RecordingRunSchema.safeParse(obj);
      if (runRes.success) return { type: 'run', data: runRes.data };
      throw new Error(`Line ${lineNumber} (Run Header): ${runRes.error.message}`);
    }

    // Case 3: Wrapped as { type: 'event', event: ... }
    if (obj.type === 'event' && obj.event) {
      const eventRes = RawTraceEventSchema.safeParse(obj.event);
      if (eventRes.success) return { type: 'event', data: eventRes.data };
      throw new Error(`Line ${lineNumber}: ${eventRes.error.message}`);
    }

    // Case 4: Direct RawTraceEvent
    if ('seq' in obj && 'runId' in obj && 'type' in obj && 'timestampMs' in obj) {
      const eventRes = RawTraceEventSchema.safeParse(obj);
      if (eventRes.success) return { type: 'event', data: eventRes.data };
      throw new Error(`Line ${lineNumber}: ${eventRes.error.message}`);
    }
  }

  throw new Error(`Line ${lineNumber}: Unrecognized trace object structure`);
}

export function validateTraceLines(lines: string[]): TraceValidationResult {
  const result: TraceValidationResult = {
    valid: true,
    eventCount: 0,
    errors: [],
    warnings: [],
  };

  let lastSeq = -1;
  let lastTimestamp = -1;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine || !rawLine.trim()) continue;

    const lineNum = i + 1;
    try {
      const parsed = parseTraceLine(rawLine, lineNum);

      if (parsed.type === 'run') {
        if (result.run) {
          result.errors.push(`Line ${lineNum}: Duplicate run header encountered`);
          result.valid = false;
        } else {
          result.run = parsed.data;
        }
      } else if (parsed.type === 'event') {
        const event = parsed.data;
        result.eventCount++;

        // Enforce monotonicity
        if (event.seq <= lastSeq) {
          result.errors.push(
            `Line ${lineNum}: Sequence number must be strictly monotonic. Expected > ${lastSeq}, got ${event.seq}`
          );
          result.valid = false;
        }
        lastSeq = event.seq;

        // Enforce timestamp monotonicity or near-monotonicity
        if (lastTimestamp >= 0 && event.timestampMs < lastTimestamp) {
          result.warnings.push(
            `Line ${lineNum}: Event timestamp went backwards from ${lastTimestamp}ms to ${event.timestampMs}ms`
          );
        }
        lastTimestamp = event.timestampMs;

        // Check password field redaction
        if (event.target) {
          const isPasswordField =
            event.target.type === 'password' ||
            (event.target.name && /password/i.test(event.target.name)) ||
            (event.target.id && /password/i.test(event.target.id));

          if (isPasswordField && event.target.value !== undefined && !isRedactedValue(event.target.value)) {
            result.errors.push(
              `Line ${lineNum}: Password element value was not redacted: found plaintext value`
            );
            result.valid = false;
          }
        }
      }
    } catch (err: unknown) {
      result.errors.push((err as Error).message);
      result.valid = false;
    }
  }

  if (!result.run) {
    result.errors.push('Trace missing run metadata header');
    result.valid = false;
  }

  return result;
}

export function serializeRunHeader(run: RecordingRun): string {
  return JSON.stringify(run);
}

export function serializeTraceEvent(event: RawTraceEvent): string {
  return JSON.stringify(event);
}
