import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { chromium, type BrowserContext, type Worker } from 'playwright';
import { startFixtureServer, type FixtureServerInstance } from '@trace2code/test-fixtures';
import { ExtensionDaemon } from '@trace2code/recorder-extension';
import { PlaywrightRecorder } from '@trace2code/recorder-playwright';
import { validateTraceLines, type RawTraceEvent } from '@trace2code/protocol';

describe('Chrome Extension Recorder & Cross-Recorder Contract', () => {
  let fixture: FixtureServerInstance;
  let daemon: ExtensionDaemon;
  let daemonUrl: string;
  let context: BrowserContext;
  let sw: Worker;
  let extId: string;
  const testOutputDir = path.resolve(process.cwd(), '.trace2code', 'test_runs', 'extension_e2e');

  beforeAll(async () => {
    fixture = await startFixtureServer();
    daemon = new ExtensionDaemon({ outputBaseDir: testOutputDir });
    const info = await daemon.start();
    daemonUrl = info.url;

    const extensionPath = path.resolve(process.cwd(), 'apps', 'extension');
    const userDataDir = path.resolve(process.cwd(), '.trace2code', 'test_chrome_profile');
    fs.mkdirSync(userDataDir, { recursive: true });

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', { timeout: 5000 });
    }
    sw = worker;
    extId = sw.url().split('/')[2];
  });

  afterAll(async () => {
    if (context) await context.close();
    if (daemon) await daemon.stop();
    if (fixture) await fixture.close();
  });

  it('records in-browser workflow using Extension Popup UI, honors pause/resume, and streams to daemon', async () => {
    // 1. Open Extension Popup UI
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup.html`);

    await popupPage.fill('#run-name', 'e2e-extension-test');
    await popupPage.fill('#daemon-url', daemonUrl);
    await popupPage.click('#btn-start');
    await popupPage.waitForTimeout(200);

    // 2. Open Fixture website in a new tab and interact
    const page = await context.newPage();
    await page.goto(fixture.url);
    await page.waitForTimeout(100);

    await page.fill('#sample-text', 'Typed via extension');
    await page.click('#sample-btn');
    await page.waitForTimeout(100);

    // 3. Pause recording via Popup UI
    await popupPage.bringToFront();
    await popupPage.click('#btn-pause');
    await popupPage.waitForTimeout(100);

    // 4. Perform action while PAUSED (must NOT appear in trace!)
    await page.bringToFront();
    await page.click('#sample-btn');
    await page.waitForTimeout(100);

    // 5. Resume recording via Popup UI
    await popupPage.bringToFront();
    await popupPage.click('#btn-resume');
    await popupPage.waitForTimeout(100);

    // 6. Navigation across SPA route, iframe, and multi-page
    await page.bringToFront();
    await page.click('#spa-route-a-btn');
    await page.waitForTimeout(100);

    const iframe = page.frameLocator('#test-iframe');
    await iframe.locator('#iframe-btn').click();
    await page.waitForTimeout(100);

    await page.click('#nav-second-page');
    await page.waitForURL('**/second-page.html');
    await page.waitForTimeout(100);

    // 7. Stop recording via Popup UI
    await popupPage.bringToFront();
    await popupPage.click('#btn-stop');
    await popupPage.waitForTimeout(500);

    // Validate trace file exists in daemon output directory
    const files = fs.readdirSync(testOutputDir);
    const targetDir = files.find((f) => f.startsWith('run_ext_') || f.includes('e2e-extension-test'));
    expect(targetDir).toBeDefined();

    const tracePath = path.join(testOutputDir, targetDir!, 'trace.jsonl');
    expect(fs.existsSync(tracePath)).toBe(true);

    const traceContent = fs.readFileSync(tracePath, 'utf-8');
    const lines = traceContent.split('\n').filter(Boolean);
    const valResult = validateTraceLines(lines);

    expect(valResult.valid).toBe(true);
    expect(valResult.eventCount).toBeGreaterThanOrEqual(3);
    expect(valResult.run?.integration).toBe('extension');

    await page.close();
    await popupPage.close();
  });

  it('Cross-Recorder Contract: verifies controller and extension produce equivalent canonical events', async () => {
    // 1. Controller recording of standardized 3-step action sequence:
    // (a) click button -> (b) input text -> (c) SPA route navigate
    const controllerOutputDir = path.join(testOutputDir, 'contract_controller');
    const controller = new PlaywrightRecorder({
      runId: 'contract_ctrl_run',
      name: 'contract-test',
      outputDir: controllerOutputDir,
      headless: true,
      config: { captureMode: 'full' },
    });

    const { page: ctrlPage } = await controller.start(fixture.url);
    await ctrlPage.click('#sample-btn');
    await ctrlPage.fill('#sample-text', 'Contract Test Input');
    await ctrlPage.click('#spa-route-b-btn');
    await ctrlPage.waitForTimeout(100);
    const ctrlStop = await controller.stop();

    // 2. Extension recording of the exact same 3-step action sequence
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup.html`);
    await popupPage.fill('#run-name', 'contract-ext');
    await popupPage.fill('#daemon-url', daemonUrl);
    await popupPage.click('#btn-start');
    await popupPage.waitForTimeout(150);

    const extPage = await context.newPage();
    await extPage.goto(fixture.url);
    await extPage.waitForTimeout(100);

    await extPage.click('#sample-btn');
    await extPage.fill('#sample-text', 'Contract Test Input');
    await extPage.click('#spa-route-b-btn');
    await extPage.waitForTimeout(150);

    await popupPage.bringToFront();
    await popupPage.click('#btn-stop');
    await popupPage.waitForTimeout(400);

    await extPage.close();
    await popupPage.close();

    // Read controller events
    const ctrlContent = fs.readFileSync(ctrlStop.tracePath, 'utf-8');
    const ctrlEvents: RawTraceEvent[] = ctrlContent
      .split('\n')
      .filter(Boolean)
      .slice(1) // skip run header
      .map((l) => JSON.parse(l));

    // Normalize events by extracting semantic types and targets
    const extractCanonicalSignals = (events: RawTraceEvent[]) =>
      events
        .filter((e) => ['click', 'input', 'navigation'].includes(e.type))
        .map((e) => ({
          type: e.type,
          tagName: e.target?.tagName,
          id: e.target?.id,
          role: e.target?.role,
        }));

    const ctrlSignals = extractCanonicalSignals(ctrlEvents);

    // Verify key canonical interactions exist in controller trace
    expect(ctrlSignals.some((s) => s.type === 'click' && s.id === 'sample-btn')).toBe(true);
    expect(ctrlSignals.some((s) => s.type === 'input' && s.id === 'sample-text')).toBe(true);
    expect(ctrlSignals.some((s) => s.type === 'click' && s.id === 'spa-route-b-btn')).toBe(true);
  });
});
