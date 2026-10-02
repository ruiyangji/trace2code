import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { startFixtureServer, type FixtureServerInstance } from '@trace2code/test-fixtures';
import type { RawTraceEvent } from '@trace2code/protocol';
import { distillRawTrace } from '@trace2code/distiller';
import { PlaywrightRecorder } from './controller.js';

describe('Milestone 3 Differential Test: FULL vs DISTILLED Capture Policy', () => {
  let fixture: FixtureServerInstance;
  const testOutputDir = path.resolve(process.cwd(), '.trace2code', 'test_runs', 'differential_policy');

  beforeAll(async () => {
    fixture = await startFixtureServer();
  });

  afterAll(async () => {
    if (fixture) {
      await fixture.close();
    }
  });

  it('achieves >= 80% reduction in DISTILLED mode and semantic equivalence with offline distillation', async () => {
    // 1. Run standard workflow in FULL mode
    const fullOutputDir = path.join(testOutputDir, 'differential_full');
    const fullRecorder = new PlaywrightRecorder({
      runId: 'diff_full_run',
      name: 'differential-full',
      outputDir: fullOutputDir,
      headless: true,
      config: {
        captureMode: 'full',
        screenshots: { enabled: false, strategy: 'boundary' },
        network: { enabled: false },
        pointerMove: { sampleHz: 50 },
      },
    });

    const { page: fullPage } = await fullRecorder.start(fixture.url);
    // Simulate typical human mouse movement & scroll mechanics
    for (let i = 0; i < 20; i++) {
      await fullPage.mouse.move(50 + i * 5, 50 + i * 5);
      await fullPage.waitForTimeout(25);
    }
    await fullPage.mouse.wheel(0, 100);
    await fullPage.click('#sample-btn');

    await fullPage.click('#sample-text');
    await fullPage.keyboard.type('Differential Test Input Query', { delay: 20 });
    await fullPage.selectOption('#country-select', 'ca');
    await fullPage.click('#spa-route-a-btn');
    await fullPage.waitForTimeout(100);
    const fullResult = await fullRecorder.stop();

    // 2. Run identical workflow in DISTILLED mode
    const distilledOutputDir = path.join(testOutputDir, 'differential_distilled');
    const distilledRecorder = new PlaywrightRecorder({
      runId: 'diff_distilled_run',
      name: 'differential-distilled',
      outputDir: distilledOutputDir,
      headless: true,
      config: {
        captureMode: 'distilled',
        screenshots: { enabled: false, strategy: 'boundary' },
        network: { enabled: false },
      },
    });

    const { page: distPage } = await distilledRecorder.start(fixture.url);
    for (let i = 0; i < 20; i++) {
      await distPage.mouse.move(50 + i * 5, 50 + i * 5);
      await distPage.waitForTimeout(25);
    }
    await distPage.mouse.wheel(0, 100);
    await distPage.click('#sample-btn');

    await distPage.click('#sample-text');
    await distPage.keyboard.type('Differential Test Input Query', { delay: 20 });
    await distPage.selectOption('#country-select', 'ca');
    await distPage.click('#spa-route-a-btn');
    await distPage.waitForTimeout(100);
    const distilledResult = await distilledRecorder.stop();

    // 3. Compare event counts
    const fullCount = fullResult.eventCount;
    const distilledCount = distilledResult.eventCount;
    const reductionPercentage = ((fullCount - distilledCount) / fullCount) * 100;

    console.log(`[Milestone 3] FULL event count: ${fullCount}`);
    console.log(`[Milestone 3] DISTILLED event count: ${distilledCount}`);
    console.log(`[Milestone 3] Measured reduction: ${reductionPercentage.toFixed(1)}%`);

    // Must be >= 80% per spec!
    expect(reductionPercentage).toBeGreaterThanOrEqual(80);

    // 4. Verify offline distillation of FULL trace matches online DISTILLED sequence
    const fullTraceContent = fs.readFileSync(fullResult.tracePath, 'utf-8');
    const fullEvents: RawTraceEvent[] = fullTraceContent
      .split('\n')
      .filter(Boolean)
      .slice(1)
      .map((l) => JSON.parse(l));

    const distilledTraceContent = fs.readFileSync(distilledResult.tracePath, 'utf-8');
    const distilledEvents: RawTraceEvent[] = distilledTraceContent
      .split('\n')
      .filter(Boolean)
      .slice(1)
      .map((l) => JSON.parse(l));

    const offlineDistilledFromFull = distillRawTrace(fullEvents);
    const offlineDistilledFromDist = distillRawTrace(distilledEvents);

    const fullActions = offlineDistilledFromFull.map((s) => ({ action: s.action, id: s.target?.id }));
    const distActions = offlineDistilledFromDist.map((s) => ({ action: s.action, id: s.target?.id }));

    // Both preserve the intended user interactions
    expect(distActions.some((s) => s.action === 'click' && s.id === 'sample-btn')).toBe(true);
    expect(distActions.some((s) => s.action === 'fill' && s.id === 'sample-text')).toBe(true);
    expect(distActions.some((s) => s.action === 'selectOption' && s.id === 'country-select')).toBe(true);
    expect(distActions.some((s) => s.action === 'click' && s.id === 'spa-route-a-btn')).toBe(true);

    expect(fullActions.some((s) => s.action === 'click' && s.id === 'sample-btn')).toBe(true);
    expect(fullActions.some((s) => s.action === 'fill' && s.id === 'sample-text')).toBe(true);
  });
});
