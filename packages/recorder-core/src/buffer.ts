import { type RawTraceEvent, RawTraceEventSchema } from '@trace2code/protocol';

export type EventConsumer = (event: RawTraceEvent) => void | Promise<void>;

export class EventSequenceBuffer {
  private currentSeq = 0;
  private subscribers: EventConsumer[] = [];
  private runId: string;
  private capturedEvents: RawTraceEvent[] = [];

  constructor(runId: string, initialSeq = 0) {
    this.runId = runId;
    this.currentSeq = initialSeq;
  }

  subscribe(consumer: EventConsumer): () => void {
    this.subscribers.push(consumer);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== consumer);
    };
  }

  enqueue(eventData: Omit<RawTraceEvent, 'seq' | 'runId'>): RawTraceEvent {
    const event: RawTraceEvent = {
      ...eventData,
      runId: this.runId,
      seq: this.currentSeq++,
    };

    // Schema validation ensures correctness before dispatch
    const validated = RawTraceEventSchema.parse(event);
    this.capturedEvents.push(validated);

    for (const sub of this.subscribers) {
      try {
        sub(validated);
      } catch (err) {
        console.error('Error dispatching event to subscriber:', err);
      }
    }

    return validated;
  }

  getEvents(): readonly RawTraceEvent[] {
    return this.capturedEvents;
  }

  getNextSeq(): number {
    return this.currentSeq;
  }
}
