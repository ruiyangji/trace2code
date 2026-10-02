import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  RecordingStateMachine,
  ReconnectionBuffer,
  ExtensionDaemon,
} from './index.js';
import { validateTraceLines } from '@trace2code/protocol';

describe('Recorder Extension Unit Tests', () => {
  it('enforces correct state machine transitions', () => {
    const sm = new RecordingStateMachine();
    expect(sm.getState()).toBe('idle');

    // Idle -> Recording
    const started = sm.start('run_1', 'Test Run');
    expect(sm.getState()).toBe('recording');
    expect(started.runId).toBe('run_1');

    // Invalid: start while recording
    expect(() => sm.start('run_2', 'Test Run 2')).toThrow(/Cannot start recording/);

    // Recording -> Paused
    const paused = sm.pause();
    expect(sm.getState()).toBe('paused');
    expect(paused.state).toBe('paused');

    // Invalid: pause while paused
    expect(() => sm.pause()).toThrow(/Cannot pause/);

    // Paused -> Recording (Resume)
    sm.resume();
    expect(sm.getState()).toBe('recording');

    // Recording -> Stopped
    const stopped = sm.stop();
    expect(sm.getState()).toBe('stopped');
    expect(stopped.stoppedAt).toBeDefined();

    // Invalid: resume while stopped
    expect(() => sm.resume()).toThrow(/Cannot resume/);
  });

  it('buffers and flushes events in ReconnectionBuffer', async () => {
    const buf = new ReconnectionBuffer(10);
    const mockEvents = Array.from({ length: 5 }, (_, i) => ({
      id: `evt_${i}`,
      runId: 'run_buf',
      seq: i,
      timestampMs: 1000 + i * 10,
      tabId: 't1',
      frameId: 'main',
      type: 'click' as const,
      payload: {},
    }));

    for (const e of mockEvents) {
      buf.enqueue(e);
    }
    expect(buf.size()).toBe(5);

    // Simulate sender failure
    let senderCalls = 0;
    const failSender = async () => {
      senderCalls++;
      return false;
    };
    const failResult = await buf.flush(failSender);
    expect(failResult.flushed).toBe(0);
    expect(failResult.remaining).toBe(5);

    // Successful sender
    const sent: unknown[] = [];
    const successSender = async (batch: any[]) => {
      sent.push(...batch);
      return true;
    };

    const successResult = await buf.flush(successSender);
    expect(successResult.flushed).toBe(5);
    expect(successResult.remaining).toBe(0);
    expect(sent.length).toBe(5);
  });

  describe('Extension Daemon Server', () => {
    let daemon: ExtensionDaemon;
    let daemonUrl: string;
    const outputDir = path.resolve(process.cwd(), '.trace2code', 'test_runs', 'daemon_test');

    beforeAll(async () => {
      daemon = new ExtensionDaemon({ outputBaseDir: outputDir });
      const info = await daemon.start();
      daemonUrl = info.url;
    });

    afterAll(async () => {
      if (daemon) {
        await daemon.stop();
      }
    });

    it('receives run creation, streams events, handles pause/resume, and finalizes trace', async () => {
      const runId = 'daemon_run_01';

      // 1. Create run
      const runPayload = {
        id: runId,
        name: 'extension-e2e-run',
        startedAt: new Date().toISOString(),
        integration: 'extension',
        captureMode: 'full',
        browser: { name: 'Chrome', version: '130.0' },
        config: { captureMode: 'full' },
        tabs: [],
      };

      const createRes = await fetch(`${daemonUrl}/api/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(runPayload),
      });
      expect(createRes.status).toBe(200);

      // 2. Stream events
      const event1 = {
        id: 'evt_d1',
        timestampMs: 100,
        tabId: 't1',
        frameId: 'main',
        type: 'click',
        payload: { x: 50, y: 50 },
      };
      const evtRes = await fetch(`${daemonUrl}/api/runs/${runId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([event1]),
      });
      expect(evtRes.status).toBe(200);

      // 3. Pause
      await fetch(`${daemonUrl}/api/runs/${runId}/pause`, { method: 'POST' });
      expect(daemon.getState()).toBe('paused');

      // 4. Send event while paused (must be ignored)
      const ignoredEvent = {
        id: 'evt_ignored',
        timestampMs: 200,
        tabId: 't1',
        frameId: 'main',
        type: 'click',
        payload: { x: 99, y: 99 },
      };
      const pausedRes = await fetch(`${daemonUrl}/api/runs/${runId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([ignoredEvent]),
      });
      const pausedJson = await pausedRes.json();
      expect(pausedJson.accepted).toBe(0);

      // 5. Resume
      await fetch(`${daemonUrl}/api/runs/${runId}/resume`, { method: 'POST' });
      expect(daemon.getState()).toBe('recording');

      // 6. Stop
      const stopRes = await fetch(`${daemonUrl}/api/runs/${runId}/stop`, { method: 'POST' });
      const stopJson = await stopRes.json();
      expect(stopJson.success).toBe(true);
      expect(fs.existsSync(stopJson.tracePath)).toBe(true);

      // 7. Validate produced trace
      const content = fs.readFileSync(stopJson.tracePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const valResult = validateTraceLines(lines);
      expect(valResult.valid).toBe(true);
      expect(valResult.eventCount).toBe(1); // Only 1 event accepted, the paused one was dropped!
    });
  });
});
