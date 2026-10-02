import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { startFixtureServer, type FixtureServerInstance } from '@trace2code/test-fixtures';
import type { WorkflowIR, WorkflowStep } from '@trace2code/workflow-ir';
import { SemanticRecoveryEngine, calculateTextSimilarity } from './recovery.js';
import { RecoverableWorkflowExecutor } from './executor.js';

describe('Milestone 8: Semantic Runtime and Recovery Mode', () => {
  let server: FixtureServerInstance;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    server = await startFixtureServer(0);
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await page.close();
    await browser.close();
    await server.close();
  });

  it('calculates text similarity and token overlap accurately', () => {
    expect(calculateTextSimilarity('Submit', 'Submit')).toBe(1.0);
    expect(calculateTextSimilarity('Submit Application', 'Submit Application')).toBe(1.0);
    expect(calculateTextSimilarity('Submit Application', 'Send Application')).toBeGreaterThan(0.4);
    expect(calculateTextSimilarity('sample-btn', 'sample-btn-v2')).toBeGreaterThan(0.6);
    expect(calculateTextSimilarity('Click Me', 'Totally Unrelated')).toBeLessThan(0.3);
  });

  it('generates a clean unified patch diff for broken locators', () => {
    const engine = new SemanticRecoveryEngine();
    const diff = engine.generatePatchDiff(
      'page.locator("#old-btn")',
      'page.getByRole("button", { name: "Send Application", exact: true })'
    );

    expect(diff).toContain('--- a/workflow.ts');
    expect(diff).toContain('+++ b/workflow.ts');
    expect(diff).toContain('-  await page.locator("#old-btn");');
    expect(diff).toContain('+  await page.getByRole("button", { name: "Send Application", exact: true });');
  });

  it('1. recovers from renamed button mutation (ID and text changed)', async () => {
    // Navigate to benchmark
    await page.goto(server.url);

    // Mutate the button on live DOM to simulate UI drift
    await page.evaluate(() => {
      const btn = document.getElementById('sample-btn');
      if (btn) {
        btn.id = 'sample-btn-v2';
        btn.innerText = 'Send Request';
        btn.removeAttribute('data-testid');
      }
    });

    const engine = new SemanticRecoveryEngine();
    const brokenStep: WorkflowStep = {
      id: 'step-click-sample',
      intent: 'Click sample button',
      action: {
        type: 'click',
        target: { testId: 'sample-button', css: '#sample-btn', name: 'Click Me', role: 'button' },
      },
      postcondition: { elementVisible: { css: '#click-feedback' } },
      confidence: 'high',
    };

    // Attempt recovery
    const decision = await engine.attemptRecovery(
      page,
      brokenStep,
      (brokenStep.action as any).target
    );

    expect(decision).toBeDefined();
    expect(decision.stepId).toBe('step-click-sample');
    expect(decision.confidence).toBeGreaterThanOrEqual(0.7);
    expect(decision.chosenLocator).toBeDefined();
    expect(decision.patchDiff).toContain('workflow.ts');
    expect(decision.postconditionVerified).toBe(true);

    // Verify button was actually clicked on the page
    const feedbackText = await page.locator('#click-feedback').textContent();
    expect(feedbackText).toBe('Clicked!');
  });

  it('2. recovers from text input ID rename and placeholder mutation', async () => {
    await page.goto(server.url);

    // Mutate text input
    await page.evaluate(() => {
      const input = document.getElementById('sample-text');
      if (input) {
        input.id = 'sample-text-drifted';
        input.setAttribute('name', 'sampleTextDrifted');
        input.setAttribute('aria-label', 'Enter Sample Text Here');
      }
    });

    const engine = new SemanticRecoveryEngine();
    const brokenStep: WorkflowStep = {
      id: 'step-fill-sample',
      intent: 'Fill sample text input',
      action: {
        type: 'fill',
        target: { css: '#sample-text', name: 'sampleText', label: 'Sample Text' },
        value: { constant: 'Self-healing recovered text' },
      },
      confidence: 'high',
    };

    const decision = await engine.attemptRecovery(
      page,
      brokenStep,
      (brokenStep.action as any).target
    );

    expect(decision).toBeDefined();
    expect(decision.confidence).toBeGreaterThanOrEqual(0.6);

    // Verify input actually contains the filled value
    const val = await page.locator('#sample-text-drifted').inputValue();
    expect(val).toBe('Self-healing recovered text');
  });

  it('3. recovers from checkbox mutation and verifies check state', async () => {
    await page.goto(server.url);

    // Mutate checkbox
    await page.evaluate(() => {
      const chk = document.getElementById('sample-check') as HTMLInputElement;
      if (chk) {
        chk.id = 'sample-check-v2';
        chk.setAttribute('aria-label', 'Agree to Terms and Conditions');
      }
    });

    const engine = new SemanticRecoveryEngine();
    const brokenStep: WorkflowStep = {
      id: 'step-check-terms',
      intent: 'Check terms agreement',
      action: {
        type: 'check',
        target: { css: '#sample-check', label: 'Agree to Terms' },
      },
      confidence: 'high',
    };

    const decision = await engine.attemptRecovery(
      page,
      brokenStep,
      (brokenStep.action as any).target
    );

    expect(decision).toBeDefined();
    const isChecked = await page.locator('#sample-check-v2').isChecked();
    expect(isChecked).toBe(true);
  });

  it('4. executes complete workflow with RecoverableWorkflowExecutor achieving >= 80% mutation recovery', async () => {
    await page.goto(server.url);

    // Inject mutations on live page
    await page.evaluate(() => {
      const btn = document.getElementById('sample-btn');
      if (btn) {
        btn.id = 'sample-btn-v3';
        btn.innerText = 'Confirm Order';
      }
      const chk = document.getElementById('sample-check');
      if (chk) {
        chk.id = 'terms-checkbox-drift';
      }
    });

    const workflowIR: WorkflowIR = {
      version: '0.1',
      name: 'recovery-benchmark',
      inputs: {
        textVal: { type: 'string', required: true },
      },
      steps: [
        {
          id: 'step-1',
          intent: 'Fill text input',
          action: {
            type: 'fill',
            target: { css: '#sample-text' },
            value: { input: 'textVal' },
          },
          confidence: 'high',
        },
        {
          id: 'step-2',
          intent: 'Check terms',
          action: {
            type: 'check',
            // Broken selector intentionally
            target: { css: '#nonexistent-old-check', label: 'Agree to Terms' },
          },
          confidence: 'high',
        },
        {
          id: 'step-3',
          intent: 'Click submit button',
          action: {
            type: 'click',
            // Deterministic selector is #sample-btn, but DOM was mutated to #sample-btn-v3
            target: { css: '#sample-btn', role: 'button', name: 'Click Me' },
          },
          postcondition: { elementVisible: { css: '#click-feedback' } },
          confidence: 'high',
        },
      ],
    };

    const executor = new RecoverableWorkflowExecutor({
      deterministicTimeoutMs: 800,
      enableRecovery: true,
    });

    const result = await executor.execute(page, workflowIR, { textVal: 'Autonomous Automation' });

    expect(result.success).toBe(true);
    expect(result.stepsExecuted).toBe(3);
    expect(result.recoveredSteps).toBe(2);
    expect(result.decisions).toHaveLength(2);

    // Verify recovery success rate >= 80% (here 2 out of 2 broken steps recovered = 100%)
    const recoveryRate = result.recoveredSteps / 2;
    expect(recoveryRate).toBeGreaterThanOrEqual(0.8);

    // Verify all decisions contain valid patch diffs and high confidence
    for (const d of result.decisions) {
      expect(d.confidence).toBeGreaterThanOrEqual(0.6);
      expect(d.patchDiff).toBeDefined();
      expect(d.patchDiff).toContain('--- a/workflow.ts');
    }

    // Verify the page received the action
    const feedback = await page.locator('#click-feedback').textContent();
    expect(feedback).toBe('Clicked!');
  });
});
