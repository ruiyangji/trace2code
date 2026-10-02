import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TraceStore } from './index.js';
import type { RecordingRun, RawTraceEvent } from '@trace2code/protocol';

describe('Milestone 4: TraceStore SQLite Unit & Integration Tests', () => {
  const testDbDir = path.resolve(process.cwd(), '.trace2code', 'test_store');
  const dbPath = path.join(testDbDir, 'test.db');
  let store: TraceStore;

  beforeEach(async () => {
    if (fs.existsSync(testDbDir)) {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    }
    store = new TraceStore(dbPath);
    await store.init();
  });

  afterEach(() => {
    if (store) store.close();
    if (fs.existsSync(testDbDir)) {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    }
  });

  it('handles run lifecycle: saveRun, getRun, listRuns', () => {
    const sampleRun: RecordingRun = {
      id: 'run_store_01',
      name: 'expense-report',
      startedAt: '2026-10-02T16:00:00Z',
      integration: 'controller',
      captureMode: 'full',
      browser: { name: 'Chromium', version: '130.0' },
      config: { captureMode: 'full' } as any,
      tabs: [{ id: 'tab-1', url: 'http://localhost:3000' }],
    };

    store.saveRun(sampleRun);
    const retrieved = store.getRun('run_store_01');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('expense-report');
    expect(retrieved?.captureMode).toBe('full');

    const allRuns = store.listRuns();
    expect(allRuns.length).toBe(1);
    expect(allRuns[0].id).toBe('run_store_01');
  });

  it('preserves monotonic event append ordering', () => {
    const run: RecordingRun = {
      id: 'run_order',
      name: 'order-test',
      startedAt: '2026-10-02T16:00:00Z',
      integration: 'controller',
      captureMode: 'full',
      browser: { name: 'Chromium', version: '1.0' },
      config: { captureMode: 'full' } as any,
      tabs: [],
    };
    store.saveRun(run);

    const events: RawTraceEvent[] = [
      { id: 'e1', runId: 'run_order', seq: 0, timestampMs: 100, tabId: 't1', frameId: 'main', type: 'navigation', payload: {} },
      { id: 'e2', runId: 'run_order', seq: 1, timestampMs: 200, tabId: 't1', frameId: 'main', type: 'click', payload: {}, target: { tagName: 'button', id: 'b1', testIds: {}, cssCandidates: [] } },
      { id: 'e3', runId: 'run_order', seq: 2, timestampMs: 300, tabId: 't1', frameId: 'main', type: 'input', payload: { data: 'text' }, target: { tagName: 'input', id: 'i1', testIds: {}, cssCandidates: [] } },
    ];

    store.appendEvents('run_order', events);
    const fetched = store.getEvents('run_order');
    expect(fetched.length).toBe(3);
    expect(fetched.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('performs export/import round trip with complete data preservation', async () => {
    const exportFile = path.join(testDbDir, 'exported.jsonl');
    const run: RecordingRun = {
      id: 'run_rt',
      name: 'round-trip-test',
      startedAt: '2026-10-02T16:00:00Z',
      integration: 'controller',
      captureMode: 'full',
      browser: { name: 'Chromium', version: '130.0' },
      config: { captureMode: 'full' } as any,
      tabs: [{ id: 'tab-1', url: 'http://localhost:3000' }],
    };
    store.saveRun(run);

    const events: RawTraceEvent[] = [
      {
        id: 'e1',
        runId: 'run_rt',
        seq: 0,
        timestampMs: 1000,
        tabId: 'tab-1',
        frameId: 'main',
        type: 'click',
        payload: { x: 25 },
        target: { tagName: 'button', id: 'submit-btn', role: 'button', accessibleName: 'Submit', testIds: {}, cssCandidates: ['#submit-btn'] },
      },
    ];
    store.appendEvents('run_rt', events);

    // 1. Export to JSONL
    store.exportJsonl('run_rt', exportFile);
    expect(fs.existsSync(exportFile)).toBe(true);

    // 2. Wipe database
    store.close();
    fs.rmSync(dbPath);

    // 3. New database instance & Import JSONL
    const freshStore = new TraceStore(dbPath);
    await freshStore.init();
    const importedRun = freshStore.importJsonl(exportFile);
    expect(importedRun.id).toBe('run_rt');

    // 4. Verify round trip preservation
    const importedEvents = freshStore.getEvents('run_rt');
    expect(importedEvents.length).toBe(1);
    expect(importedEvents[0].target?.accessibleName).toBe('Submit');
    expect(importedEvents[0].target?.id).toBe('submit-btn');

    freshStore.close();
  });

  it('records and retrieves attachments', () => {
    const runId = 'run_att';
    store.saveRun({
      id: runId,
      name: 'attachment-test',
      startedAt: '2026-10-02T16:00:00Z',
      integration: 'controller',
      captureMode: 'full',
      browser: { name: 'Chromium', version: '1.0' },
      config: { captureMode: 'full' } as any,
      tabs: [],
    });

    const att = store.saveAttachment(runId, 'screenshot', '/path/to/shot.png');
    expect(att.id).toBeDefined();

    const retrieved = store.getAttachments(runId);
    expect(retrieved.length).toBe(1);
    expect(retrieved[0].filePath).toBe('/path/to/shot.png');
  });
});
