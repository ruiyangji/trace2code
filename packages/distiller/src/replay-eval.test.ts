import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { startFixtureServer, type FixtureServerInstance } from '@trace2code/test-fixtures';
import { SemanticReplayEvaluator } from './evaluator.js';
import type { SemanticTraceStep } from './types.js';

describe('Milestone 5: Replay Evaluation Benchmark', () => {
  let fixture: FixtureServerInstance;
  let browser: Browser;
  let page: Page;
  const evaluator = new SemanticReplayEvaluator();

  beforeAll(async () => {
    fixture = await startFixtureServer();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (fixture) await fixture.close();
  });

  it('achieves >= 95% target resolution and cleanly disambiguates duplicate labels without resolving to wrong element', async () => {
    // 10-step benchmark workflow testing varied controls & disambiguation
    const benchmarkSteps: SemanticTraceStep[] = [
      // 1. Navigation
      {
        id: 'step_1',
        seq: 0,
        timestampMs: 100,
        tabId: 't1',
        frameId: 'main',
        action: 'navigate',
        payload: { url: fixture.url },
      },
      // 2. Click standard button
      {
        id: 'step_2',
        seq: 1,
        timestampMs: 200,
        tabId: 't1',
        frameId: 'main',
        action: 'click',
        target: {
          tagName: 'button',
          id: 'sample-btn',
          role: 'button',
          accessibleName: 'Click Me',
          testIds: { 'data-testid': 'sample-button' },
          cssCandidates: ['#sample-btn'],
        },
      },
      // 3. Fill text field
      {
        id: 'step_3',
        seq: 2,
        timestampMs: 300,
        tabId: 't1',
        frameId: 'main',
        action: 'fill',
        value: 'Benchmark Search Input',
        target: {
          tagName: 'input',
          id: 'sample-text',
          name: 'sampleText',
          role: 'textbox',
          accessibleName: 'Sample Text',
          testIds: {},
          cssCandidates: ['#sample-text'],
        },
      },
      // 4. Duplicate Label: Shipping Contact Email
      {
        id: 'step_4',
        seq: 3,
        timestampMs: 400,
        tabId: 't1',
        frameId: 'main',
        action: 'fill',
        value: 'shipping@acme.com',
        target: {
          tagName: 'input',
          id: 'shipping-email',
          name: 'shippingEmail',
          role: 'textbox',
          accessibleName: 'Email Address',
          testIds: { 'data-testid': 'shipping-email' },
          cssCandidates: ['#shipping-email'],
          ancestorSummary: ['div#shipping-address-group'],
        },
      },
      // 5. Duplicate Label: Billing Contact Email
      {
        id: 'step_5',
        seq: 4,
        timestampMs: 500,
        tabId: 't1',
        frameId: 'main',
        action: 'fill',
        value: 'billing@acme.com',
        target: {
          tagName: 'input',
          id: 'billing-email',
          name: 'billingEmail',
          role: 'textbox',
          accessibleName: 'Email Address',
          testIds: { 'data-testid': 'billing-email' },
          cssCandidates: ['#billing-email'],
          ancestorSummary: ['div#billing-address-group'],
        },
      },
      // 6. Select dropdown
      {
        id: 'step_6',
        seq: 5,
        timestampMs: 600,
        tabId: 't1',
        frameId: 'main',
        action: 'selectOption',
        value: 'ca',
        target: {
          tagName: 'select',
          id: 'country-select',
          name: 'country',
          role: 'combobox',
          accessibleName: 'Country',
          testIds: {},
          cssCandidates: ['#country-select'],
        },
      },
      // 7. Checkbox
      {
        id: 'step_7',
        seq: 6,
        timestampMs: 700,
        tabId: 't1',
        frameId: 'main',
        action: 'check',
        target: {
          tagName: 'input',
          type: 'checkbox',
          id: 'sample-check',
          name: 'sampleCheck',
          role: 'checkbox',
          accessibleName: 'Agree to Terms',
          testIds: {},
          cssCandidates: ['#sample-check'],
        },
      },
      // 8. Open modal dialog
      {
        id: 'step_8',
        seq: 7,
        timestampMs: 800,
        tabId: 't1',
        frameId: 'main',
        action: 'click',
        target: {
          tagName: 'button',
          id: 'open-modal-btn',
          role: 'button',
          accessibleName: 'Open Dialog',
          text: 'Open Dialog',
          testIds: {},
          cssCandidates: ['#open-modal-btn'],
        },
      },
      // 9. Confirm modal
      {
        id: 'step_9',
        seq: 8,
        timestampMs: 900,
        tabId: 't1',
        frameId: 'main',
        action: 'click',
        target: {
          tagName: 'button',
          id: 'confirm-modal-btn',
          role: 'button',
          accessibleName: 'Confirm Modal',
          text: 'Confirm Modal',
          testIds: {},
          cssCandidates: ['#confirm-modal-btn'],
        },
      },
      // 10. SPA route navigation
      {
        id: 'step_10',
        seq: 9,
        timestampMs: 1000,
        tabId: 't1',
        frameId: 'main',
        action: 'click',
        target: {
          tagName: 'button',
          id: 'spa-route-a-btn',
          role: 'button',
          accessibleName: 'SPA Route A',
          text: 'SPA Route A',
          testIds: {},
          cssCandidates: ['#spa-route-a-btn'],
        },
      },
    ];

    const report = await evaluator.evaluateWorkflow(page, benchmarkSteps);

    console.log(`[Milestone 5 Benchmark Report]:`);
    console.log(`  - Total Steps: ${report.totalSteps}`);
    console.log(`  - Target Resolution Rate: ${(report.targetResolutionSuccessRate * 100).toFixed(1)}%`);
    console.log(`  - Action Success Rate: ${(report.actionSuccessRate * 100).toFixed(1)}%`);
    console.log(`  - Ambiguous Locators: ${(report.ambiguousLocatorRate * 100).toFixed(1)}%`);

    // Milestone 5 Acceptance Criteria: target resolution >= 95%
    expect(report.targetResolutionSuccessRate).toBeGreaterThanOrEqual(0.95);
    expect(report.actionSuccessRate).toBeGreaterThanOrEqual(0.95);

    // Verify Disambiguation correctness: neither duplicate field received the other's value
    const shippingVal = await page.inputValue('#shipping-email');
    const billingVal = await page.inputValue('#billing-email');

    expect(shippingVal).toBe('shipping@acme.com');
    expect(billingVal).toBe('billing@acme.com');

    // Verify all steps produced diagnostics with candidate ranking
    expect(report.diagnostics.length).toBe(10);
    report.diagnostics.forEach((d) => {
      expect(d.success).toBe(true);
      if (d.action !== 'navigate') {
        expect(d.chosenLocator).toBeDefined();
        expect(d.allCandidates.length).toBeGreaterThan(0);
      }
    });
  });
});
