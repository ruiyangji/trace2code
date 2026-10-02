import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { createInspectorServer } from './index.js';
import type { RecordingRun, RawTraceEvent } from '@trace2code/protocol';

describe('Milestone 4: Web Run Inspector UI & Integration Tests', () => {
  let inspector: ReturnType<typeof createInspectorServer>;
  let inspectorUrl: string;
  let browser: Browser;
  const testDir = path.resolve(process.cwd(), '.trace2code', 'test_inspector');
  const dbPath = path.join(testDir, 'inspector_test.db');

  beforeAll(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    inspector = createInspectorServer({ dbPath, port: 0 });
    const info = await inspector.start();
    inspectorUrl = info.url;

    // Seed test run with element evidence and redacted value
    const sampleRun: RecordingRun = {
      id: 'insp_run_01',
      name: 'expense-report-demo',
      startedAt: '2026-10-02T16:00:00Z',
      integration: 'controller',
      captureMode: 'full',
      browser: { name: 'Chromium', version: '130.0' },
      config: { captureMode: 'full' } as any,
      tabs: [{ id: 'tab-1', url: 'http://localhost:3000' }],
    };
    inspector.store.saveRun(sampleRun);

    const events: RawTraceEvent[] = [
      {
        id: 'evt_1',
        runId: 'insp_run_01',
        seq: 0,
        timestampMs: 1000,
        tabId: 'tab-1',
        frameId: 'main',
        type: 'navigation',
        payload: { url: 'http://localhost:3000/dashboard' },
      },
      {
        id: 'evt_2',
        runId: 'insp_run_01',
        seq: 1,
        timestampMs: 1500,
        tabId: 'tab-1',
        frameId: 'main',
        type: 'click',
        payload: { button: 0 },
        target: {
          tagName: 'button',
          id: 'submit-report-btn',
          role: 'button',
          accessibleName: 'Submit Expense Report',
          testIds: { 'data-testid': 'submit-expense-btn' },
          cssCandidates: ['#submit-report-btn', 'button.primary'],
          rect: { x: 120, y: 340, width: 140, height: 40 },
        },
      },
      {
        id: 'evt_3',
        runId: 'insp_run_01',
        seq: 2,
        timestampMs: 2000,
        tabId: 'tab-1',
        frameId: 'main',
        type: 'input',
        payload: { data: '[REDACTED]' },
        target: {
          tagName: 'input',
          id: 'auth-pin',
          name: 'pin',
          type: 'password',
          role: 'textbox',
          accessibleName: 'Security PIN',
          value: { kind: 'redacted', reason: 'password-field' },
          testIds: {},
          cssCandidates: ['#auth-pin'],
        },
      },
    ];
    inspector.store.appendEvents('insp_run_01', events);

    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (inspector) await inspector.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('serves inspector API endpoints with run, raw events, and distilled steps', async () => {
    const runsRes = await fetch(`${inspectorUrl}/api/runs`);
    expect(runsRes.status).toBe(200);
    const runs = await runsRes.json();
    expect(runs.length).toBe(1);
    expect(runs[0].id).toBe('insp_run_01');

    const detailsRes = await fetch(`${inspectorUrl}/api/runs/insp_run_01`);
    expect(detailsRes.status).toBe(200);
    const details = await detailsRes.json();
    expect(details.events.length).toBe(3);
    expect(details.semanticSteps.length).toBe(3);
  });

  it('renders interactive web inspector UI: verifies timeline, mode toggle, and element evidence details', async () => {
    const page = await browser.newPage();
    await page.goto(inspectorUrl);

    // Header & Run selection
    await page.waitForSelector('#run-select');
    const selectedRun = await page.$eval('#run-select', (el: any) => el.value);
    expect(selectedRun).toBe('insp_run_01');

    // Default view: Distilled Steps
    await page.waitForSelector('.event-item');
    const distilledItems = await page.$$('.event-item');
    expect(distilledItems.length).toBeGreaterThanOrEqual(1);

    // Toggle to Raw Events
    await page.click('#btn-raw');
    await page.waitForTimeout(100);
    const rawItems = await page.$$('.event-item');
    expect(rawItems.length).toBe(3);

    // Select second event (click action)
    await rawItems[1].click();
    await page.waitForTimeout(100);

    const actionText = await page.$eval('#dt-action', (el) => el.textContent);
    expect(actionText).toBe('click');

    const accName = await page.$eval('#dt-accname', (el) => el.textContent);
    expect(accName).toBe('Submit Expense Report');

    const cssCand = await page.$eval('#dt-css', (el) => el.textContent);
    expect(cssCand).toContain('#submit-report-btn');

    // Select third event (redacted password/pin)
    await rawItems[2].click();
    await page.waitForTimeout(100);

    const valHtml = await page.$eval('#dt-value', (el) => el.innerHTML);
    expect(valHtml).toContain('[REDACTED: password-field]');

    await page.close();
  });
});
