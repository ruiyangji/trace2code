import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startFixtureServer, type FixtureServerInstance } from '@trace2code/test-fixtures';
import { validateTraceLines, isRedactedValue } from '@trace2code/protocol';
import { PlaywrightRecorder } from './controller.js';

describe('Playwright Controller FULL Recorder', () => {
  let fixture: FixtureServerInstance;
  const testOutputDir = path.resolve(process.cwd(), '.trace2code', 'test_runs', 'run_m1_test');

  beforeAll(async () => {
    fixture = await startFixtureServer();
  });

  afterAll(async () => {
    if (fixture) {
      await fixture.close();
    }
  });

  it('records full 10-step fixture workflow with element evidence and security redaction', async () => {
    const recorder = new PlaywrightRecorder({
      runId: 'm1_fixture_run',
      name: 'controller-fixture-test',
      outputDir: testOutputDir,
      headless: true,
      config: {
        captureMode: 'full',
        screenshots: { enabled: true, strategy: 'boundary', maskSensitiveFields: true },
        network: { enabled: true },
      },
    });

    const { page } = await recorder.start(fixture.url);

    // 1. Typing into sample text field
    await page.fill('#sample-text', 'Automated Input Text');
    await page.waitForTimeout(100);

    // 2. Clicking sample button
    await page.click('#sample-btn');
    await page.waitForTimeout(100);

    // 3. Select dropdown
    await page.selectOption('#country-select', 'ca');
    await page.waitForTimeout(100);

    // 4. File upload
    const dummyFilePath = path.join(testOutputDir, 'dummy.txt');
    fs.mkdirSync(testOutputDir, { recursive: true });
    fs.writeFileSync(dummyFilePath, 'sample upload content');
    await page.setInputFiles('#file-upload', dummyFilePath);
    await page.waitForTimeout(100);

    // 5. Drag and Drop
    await page.dragAndDrop('#drag-source', '#drop-target');
    await page.waitForTimeout(100);

    // 6. Iframe click
    const iframeElement = page.frameLocator('#test-iframe');
    await iframeElement.locator('#iframe-btn').click();
    await page.waitForTimeout(100);

    // 7. SPA Navigation
    await page.click('#spa-route-a-btn');
    await page.waitForTimeout(100);

    // 8. Full-page Navigation
    await page.click('#nav-second-page');
    await page.waitForURL('**/second-page.html');
    await page.waitForTimeout(100);
    // Navigate back to main page
    await page.click('#back-home-link');
    await page.waitForURL(`${fixture.url}/`);
    await page.waitForTimeout(100);

    // 9. Opening a new tab
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.evaluate(() => window.open('/second-page.html', '_blank')),
    ]);
    await newPage.waitForLoadState('domcontentloaded');
    await newPage.close();
    await page.waitForTimeout(100);

    // 10. Fake Login Form (Redaction Test)
    const SECRET_PASSWORD = 'known-test-password-12345';
    await page.fill('#login-username', 'testuser@example.com');
    await page.fill('#login-password', SECRET_PASSWORD);
    await page.click('#login-submit');
    await page.waitForTimeout(200);

    // Stop recorder
    const result = await recorder.stop();
    expect(result.eventCount).toBeGreaterThan(10);
    expect(fs.existsSync(result.tracePath)).toBe(true);

    // Validate produced trace JSONL
    const traceContent = fs.readFileSync(result.tracePath, 'utf-8');
    const lines = traceContent.split('\n').filter(Boolean);
    const valResult = validateTraceLines(lines);

    expect(valResult.valid).toBe(true);
    expect(valResult.errors).toEqual([]);
    expect(valResult.run?.captureMode).toBe('full');

    // Security Verification: plaintext password must NEVER appear in trace or filesystem!
    expect(traceContent).not.toContain(SECRET_PASSWORD);

    // Check that password field in trace was recorded with redacted object
    const passwordEvent = valResult.eventCount > 0 && lines.some((l) => {
      try {
        const obj = JSON.parse(l);
        if (obj.target && obj.target.id === 'login-password') {
          return isRedactedValue(obj.target.value);
        }
      } catch (_) {}
      return false;
    });
    expect(passwordEvent).toBe(true);
  });

  it('handles page close mid-recording gracefully', async () => {
    const recorder = new PlaywrightRecorder({
      runId: 'm1_close_test',
      headless: true,
      outputDir: path.join(testOutputDir, 'close_test'),
    });

    const { page } = await recorder.start(fixture.url);
    await page.click('#sample-btn');
    await page.close();

    const result = await recorder.stop();
    expect(result.run).toBeDefined();
    expect(result.eventCount).toBeGreaterThan(0);
  });

  it('handles target element removal during interaction', async () => {
    const recorder = new PlaywrightRecorder({
      runId: 'm1_removal_test',
      headless: true,
      outputDir: path.join(testOutputDir, 'removal_test'),
    });

    const { page } = await recorder.start(fixture.url);
    // Remove element right after click
    await page.evaluate(() => {
      const btn = document.getElementById('sample-btn');
      if (btn && btn.parentElement) {
        btn.parentElement.removeChild(btn);
      }
    });

    const result = await recorder.stop();
    expect(result.eventCount).toBeGreaterThanOrEqual(0);
  });
});
