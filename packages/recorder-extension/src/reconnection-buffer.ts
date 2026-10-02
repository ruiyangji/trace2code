import type { RawTraceEvent } from '@trace2code/protocol';

export type EventSender = (events: RawTraceEvent[]) => Promise<boolean>;

export class ReconnectionBuffer {
  private queue: RawTraceEvent[] = [];
  private maxCapacity: number;
  private isFlushing = false;

  constructor(maxCapacity = 5000) {
    this.maxCapacity = maxCapacity;
  }

  enqueue(event: RawTraceEvent): boolean {
    if (this.queue.length >= this.maxCapacity) {
      console.warn(`[ReconnectionBuffer] Queue capacity reached (${this.maxCapacity}). Dropping oldest event.`);
      this.queue.shift();
    }
    this.queue.push(event);
    return true;
  }

  size(): number {
    return this.queue.length;
  }

  getQueued(): readonly RawTraceEvent[] {
    return this.queue;
  }

  async flush(sender: EventSender): Promise<{ flushed: number; remaining: number }> {
    if (this.isFlushing || this.queue.length === 0) {
      return { flushed: 0, remaining: this.queue.length };
    }

    this.isFlushing = true;
    let flushedCount = 0;

    try {
      while (this.queue.length > 0) {
        // Send batch of up to 50 events
        const batch = this.queue.slice(0, 50);
        const success = await sender(batch);
        if (!success) {
          break; // Stop flushing if transmission failed
        }
        this.queue.splice(0, batch.length);
        flushedCount += batch.length;
      }
    } finally {
      this.isFlushing = false;
    }

    return { flushed: flushedCount, remaining: this.queue.length };
  }

  clear(): void {
    this.queue = [];
  }
}
