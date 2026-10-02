export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface RunStateMetadata {
  runId: string;
  name: string;
  state: RecorderState;
  startedAt: string;
  pausedAt?: string;
  stoppedAt?: string;
}

export class RecordingStateMachine {
  private currentState: RecorderState = 'idle';
  private currentMetadata: RunStateMetadata | null = null;

  getState(): RecorderState {
    return this.currentState;
  }

  getMetadata(): RunStateMetadata | null {
    return this.currentMetadata ? { ...this.currentMetadata } : null;
  }

  start(runId: string, name: string): RunStateMetadata {
    if (this.currentState === 'recording' || this.currentState === 'paused') {
      throw new Error(`Cannot start recording: session is already in state '${this.currentState}'`);
    }

    this.currentState = 'recording';
    this.currentMetadata = {
      runId,
      name,
      state: 'recording',
      startedAt: new Date().toISOString(),
    };
    return { ...this.currentMetadata };
  }

  pause(): RunStateMetadata {
    if (this.currentState !== 'recording') {
      throw new Error(`Cannot pause: session is in state '${this.currentState}', expected 'recording'`);
    }

    this.currentState = 'paused';
    this.currentMetadata!.state = 'paused';
    this.currentMetadata!.pausedAt = new Date().toISOString();
    return { ...this.currentMetadata! };
  }

  resume(): RunStateMetadata {
    if (this.currentState !== 'paused') {
      throw new Error(`Cannot resume: session is in state '${this.currentState}', expected 'paused'`);
    }

    this.currentState = 'recording';
    this.currentMetadata!.state = 'recording';
    return { ...this.currentMetadata! };
  }

  stop(): RunStateMetadata {
    if (this.currentState === 'idle' || this.currentState === 'stopped') {
      throw new Error(`Cannot stop: session is already in state '${this.currentState}'`);
    }

    this.currentState = 'stopped';
    this.currentMetadata!.state = 'stopped';
    this.currentMetadata!.stoppedAt = new Date().toISOString();
    const finalMetadata = { ...this.currentMetadata! };
    return finalMetadata;
  }

  reset(): void {
    this.currentState = 'idle';
    this.currentMetadata = null;
  }
}
