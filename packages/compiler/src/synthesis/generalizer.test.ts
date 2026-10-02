import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { startFixtureServer, type FixtureServerInstance } from '@trace2code/test-fixtures';
import type { SemanticTraceStep } from '@trace2code/distiller';
import type { ElementEvidence } from '@trace2code/protocol';
import { execSync } from 'node:child_process';
import {
  alignMultiTraceSequences,
  computeStepSimilarity,
} from './alignment.js';
import {
  MultiTraceGeneralizer,
  inferParameterName,
  detectRepeatedPatterns,
} from './generalizer.js';
import { compileWorkflowToPlaywright } from '../codegen/playwright.js';
import type { WorkflowIR } from '@trace2code/workflow-ir';

function makeTarget(partial: Partial<ElementEvidence> & { tagName: string }): ElementEvidence {
  return {
    testIds: {},
    cssCandidates: [],
    ...partial,
  };
}

function getLocator(page: any, target: any) {
  if (target.testId) return page.getByTestId(target.testId);
  if (target.role && target.name) return page.getByRole(target.role, { name: target.name, exact: true });
  if (target.label) return page.getByLabel(target.label, { exact: true });
  if (target.text) return page.getByText(target.text, { exact: true });
  if (target.css) return page.locator(target.css);
  return page.locator('body');
}

async function executeWorkflow(page: any, ir: WorkflowIR, inputs: Record<string, any>) {
  for (const step of ir.steps) {
    if (step.condition) {
      if (step.condition.input) {
        const val = inputs[step.condition.input];
        if (step.condition.equals !== undefined) {
          if (val !== step.condition.equals) continue;
        } else if (step.condition.notEquals !== undefined) {
          if (val === step.condition.notEquals) continue;
        } else if (!val) {
          continue;
        }
      }
    } else if (step.optional) {
      if ('value' in step.action && step.action.value && 'input' in step.action.value) {
        if (!inputs[step.action.value.input]) continue;
      }
    }

    switch (step.action.type) {
      case 'navigate': {
        await page.goto(step.action.url);
        break;
      }
      case 'fill': {
        const val =
          'input' in step.action.value
            ? inputs[step.action.value.input] ?? ''
            : (step.action.value as any).constant ?? '';
        await getLocator(page, step.action.target).fill(val);
        break;
      }
      case 'check': {
        await getLocator(page, step.action.target).check();
        break;
      }
      case 'uncheck': {
        await getLocator(page, step.action.target).uncheck();
        break;
      }
      case 'selectOption': {
        const val =
          'input' in step.action.value
            ? inputs[step.action.value.input] ?? ''
            : (step.action.value as any).constant ?? '';
        await getLocator(page, step.action.target).selectOption(val);
        break;
      }
      case 'click': {
        await getLocator(page, step.action.target).click();
        break;
      }
    }
  }
}

describe('Milestone 10: Multi-Demonstration Generalization', () => {
  let server: FixtureServerInstance;
  let browser: Browser;

  beforeAll(async () => {
    server = await startFixtureServer(0);
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
    await server.close();
  });

  describe('1. Needleman-Wunsch Sequence Alignment', () => {
    it('computes positive similarity for matching actions and targets, negative for mismatches', () => {
      const step1: SemanticTraceStep = {
        id: 's1',
        seq: 0,
        timestampMs: 1000,
        tabId: 't1',
        frameId: 'f1',
        action: 'fill',
        target: makeTarget({ tagName: 'input', id: 'sample-text', name: 'sampleText' }),
        value: 'Alice',
      };

      const step2: SemanticTraceStep = {
        id: 's2',
        seq: 0,
        timestampMs: 2000,
        tabId: 't1',
        frameId: 'f1',
        action: 'fill',
        target: makeTarget({ tagName: 'input', id: 'sample-text', name: 'sampleText' }),
        value: 'Bob',
      };

      const stepDifferentAction: SemanticTraceStep = {
        ...step2,
        action: 'click',
      };

      const simMatching = computeStepSimilarity(step1, step2);
      const simMismatch = computeStepSimilarity(step1, stepDifferentAction);

      expect(simMatching).toBeGreaterThan(5);
      expect(simMismatch).toBeLessThan(0);
    });

    it('aligns 2 traces with an optional step in Trace 2', () => {
      const trace1: SemanticTraceStep[] = [
        {
          id: 't1-s1',
          seq: 0,
          timestampMs: 100,
          tabId: 't1',
          frameId: 'f1',
          action: 'navigate',
          value: 'http://localhost:3000',
        },
        {
          id: 't1-s2',
          seq: 1,
          timestampMs: 200,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({ tagName: 'input', id: 'name-field', name: 'name' }),
          value: 'Alice',
        },
        {
          id: 't1-s3',
          seq: 2,
          timestampMs: 300,
          tabId: 't1',
          frameId: 'f1',
          action: 'check',
          target: makeTarget({ tagName: 'input', id: 'agree-check', name: 'agree' }),
        },
        {
          id: 't1-s4',
          seq: 3,
          timestampMs: 400,
          tabId: 't1',
          frameId: 'f1',
          action: 'click',
          target: makeTarget({ tagName: 'button', id: 'submit-btn', testIds: { testId: 'submit' } }),
        },
      ];

      // Trace 2 skips the check step
      const trace2: SemanticTraceStep[] = [
        {
          id: 't2-s1',
          seq: 0,
          timestampMs: 100,
          tabId: 't1',
          frameId: 'f1',
          action: 'navigate',
          value: 'http://localhost:3000',
        },
        {
          id: 't2-s2',
          seq: 1,
          timestampMs: 200,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({ tagName: 'input', id: 'name-field', name: 'name' }),
          value: 'Bob',
        },
        {
          id: 't2-s3',
          seq: 2,
          timestampMs: 400,
          tabId: 't1',
          frameId: 'f1',
          action: 'click',
          target: makeTarget({ tagName: 'button', id: 'submit-btn', testIds: { testId: 'submit' } }),
        },
      ];

      const alignment = alignMultiTraceSequences([trace1, trace2]);

      expect(alignment.columns.length).toBe(4);
      // Col 0: navigate
      expect(alignment.columns[0].action).toBe('navigate');
      expect(alignment.columns[0].isOptional).toBe(false);

      // Col 1: fill name
      expect(alignment.columns[1].action).toBe('fill');
      expect(alignment.columns[1].isOptional).toBe(false);

      // Col 2: check agree (skipped in trace2)
      expect(alignment.columns[2].action).toBe('check');
      expect(alignment.columns[2].isOptional).toBe(true);
      expect(alignment.columns[2].steps[0]).not.toBeNull();
      expect(alignment.columns[2].steps[1]).toBeNull();

      // Col 3: click submit
      expect(alignment.columns[3].action).toBe('click');
      expect(alignment.columns[3].isOptional).toBe(false);
    });
  });

  describe('2. Parameter Inference & Invariant Preservation', () => {
    it('infers clean parameter names from element evidence', () => {
      expect(inferParameterName({ tagName: 'input', name: 'sampleText' })).toBe('sampleText');
      expect(inferParameterName({ tagName: 'input', id: 'sample-text' })).toBe('sampleText');
      expect(inferParameterName({ tagName: 'input', id: 'country-select', name: 'country' })).toBe('country');
      expect(inferParameterName({ tagName: 'input', ariaLabel: 'Agree to Terms' })).toBe('agreeToTerms');
      expect(inferParameterName({ tagName: 'input', testIds: { default: 'shipping-email' } })).toBe('shippingEmail');

      // Disambiguation
      const used = new Set(['sampleText']);
      expect(inferParameterName({ tagName: 'input', name: 'sampleText' }, 1, used)).toBe('sampleText_2');
    });

    it('synthesizes parameters for varying values and constants for invariants', () => {
      const trace1: SemanticTraceStep[] = [
        {
          id: 't1-s1',
          seq: 0,
          timestampMs: 100,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({ tagName: 'input', id: 'search-query', name: 'searchQuery' }),
          value: 'Alice',
        },
        {
          id: 't1-s2',
          seq: 1,
          timestampMs: 200,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({ tagName: 'input', id: 'memo-field', name: 'memo' }),
          value: 'Confidential Note',
        },
      ];

      const trace2: SemanticTraceStep[] = [
        {
          id: 't2-s1',
          seq: 0,
          timestampMs: 100,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({ tagName: 'input', id: 'search-query', name: 'searchQuery' }),
          value: 'Bob',
        },
        {
          id: 't2-s2',
          seq: 1,
          timestampMs: 200,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({ tagName: 'input', id: 'memo-field', name: 'memo' }),
          value: 'Confidential Note',
        },
      ];

      const trace3: SemanticTraceStep[] = [
        {
          id: 't3-s1',
          seq: 0,
          timestampMs: 100,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({ tagName: 'input', id: 'search-query', name: 'searchQuery' }),
          value: 'Charlie',
        },
        {
          id: 't3-s2',
          seq: 1,
          timestampMs: 200,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({ tagName: 'input', id: 'memo-field', name: 'memo' }),
          value: 'Confidential Note',
        },
      ];

      const generalizer = new MultiTraceGeneralizer();
      const result = generalizer.generalize({
        workflowName: 'search-workflow',
        traces: [trace1, trace2, trace3],
      });

      // searchQuery varied -> parameterized!
      expect(result.parameterizedInputs).toContain('searchQuery');
      expect(result.ir.inputs.searchQuery).toBeDefined();
      expect(result.ir.inputs.searchQuery.type).toBe('string');
      expect((result.ir.steps[0].action as any).value).toEqual({ input: 'searchQuery' });

      // memo was invariant -> kept as constant!
      expect(result.constantInvariants).toContain('step-2:Confidential Note');
      expect(result.ir.inputs.memo).toBeUndefined();
      expect((result.ir.steps[1].action as any).value).toEqual({ constant: 'Confidential Note' });
    });
  });

  describe('3. Loop Pattern Detection', () => {
    it('detects repeating action sequences in demonstrated steps', () => {
      const generalizer = new MultiTraceGeneralizer();
      const trace: SemanticTraceStep[] = [
        {
          id: 's1',
          seq: 0,
          timestampMs: 100,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({ tagName: 'input', id: 'item-input', name: 'item' }),
          value: 'apple',
        },
        {
          id: 's2',
          seq: 1,
          timestampMs: 200,
          tabId: 't1',
          frameId: 'f1',
          action: 'click',
          target: makeTarget({ tagName: 'button', id: 'add-btn' }),
        },
        {
          id: 's3',
          seq: 2,
          timestampMs: 300,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({ tagName: 'input', id: 'item-input', name: 'item' }),
          value: 'banana',
        },
        {
          id: 's4',
          seq: 3,
          timestampMs: 400,
          tabId: 't1',
          frameId: 'f1',
          action: 'click',
          target: makeTarget({ tagName: 'button', id: 'add-btn' }),
        },
      ];

      const res = generalizer.generalize({
        workflowName: 'add-items',
        traces: [trace],
      });

      expect(res.detectedLoops.length).toBeGreaterThanOrEqual(1);
      const loop = res.detectedLoops[0];
      expect(loop.repetitions).toBe(2);
      expect(loop.pattern).toEqual(['fill(#item-input)', 'click(#add-btn)']);
    });
  });

  describe('4. End-to-End Acceptance Test with Unseen 4th Demonstration Input', () => {
    it('synthesizes a generalized workflow across 3 demonstrations and executes with unseen 4th input in clean Chromium', async () => {
      // Demonstration 1: Alice, agrees to terms, selects US, clicks button
      const demo1: SemanticTraceStep[] = [
        {
          id: 'd1-s1',
          seq: 0,
          timestampMs: 100,
          tabId: 't1',
          frameId: 'f1',
          action: 'navigate',
          payload: { url: server.url },
        },
        {
          id: 'd1-s2',
          seq: 1,
          timestampMs: 200,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({
            tagName: 'input',
            id: 'sample-text',
            name: 'sampleText',
            ariaLabel: 'Sample Text',
          }),
          value: 'Alice',
        },
        {
          id: 'd1-s3',
          seq: 2,
          timestampMs: 300,
          tabId: 't1',
          frameId: 'f1',
          action: 'check',
          target: makeTarget({
            tagName: 'input',
            id: 'sample-check',
            name: 'sampleCheck',
            ariaLabel: 'Agree to Terms',
          }),
        },
        {
          id: 'd1-s4',
          seq: 3,
          timestampMs: 400,
          tabId: 't1',
          frameId: 'f1',
          action: 'selectOption',
          target: makeTarget({
            tagName: 'select',
            id: 'country-select',
            name: 'country',
            ariaLabel: 'Country',
          }),
          value: 'us',
        },
        {
          id: 'd1-s5',
          seq: 4,
          timestampMs: 500,
          tabId: 't1',
          frameId: 'f1',
          action: 'click',
          target: makeTarget({
            tagName: 'button',
            id: 'sample-btn',
            role: 'button',
            accessibleName: 'Click Me',
            testIds: { testId: 'sample-button' },
          }),
        },
      ];

      // Demonstration 2: Bob, skips terms agreement, selects Canada, clicks button
      const demo2: SemanticTraceStep[] = [
        {
          id: 'd2-s1',
          seq: 0,
          timestampMs: 100,
          tabId: 't1',
          frameId: 'f1',
          action: 'navigate',
          payload: { url: server.url },
        },
        {
          id: 'd2-s2',
          seq: 1,
          timestampMs: 200,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({
            tagName: 'input',
            id: 'sample-text',
            name: 'sampleText',
            ariaLabel: 'Sample Text',
          }),
          value: 'Bob',
        },
        // Omitted agreement check!
        {
          id: 'd2-s3',
          seq: 2,
          timestampMs: 400,
          tabId: 't1',
          frameId: 'f1',
          action: 'selectOption',
          target: makeTarget({
            tagName: 'select',
            id: 'country-select',
            name: 'country',
            ariaLabel: 'Country',
          }),
          value: 'ca',
        },
        {
          id: 'd2-s4',
          seq: 3,
          timestampMs: 500,
          tabId: 't1',
          frameId: 'f1',
          action: 'click',
          target: makeTarget({
            tagName: 'button',
            id: 'sample-btn',
            role: 'button',
            accessibleName: 'Click Me',
            testIds: { testId: 'sample-button' },
          }),
        },
      ];

      // Demonstration 3: Charlie, agrees to terms, selects UK, clicks button
      const demo3: SemanticTraceStep[] = [
        {
          id: 'd3-s1',
          seq: 0,
          timestampMs: 100,
          tabId: 't1',
          frameId: 'f1',
          action: 'navigate',
          payload: { url: server.url },
        },
        {
          id: 'd3-s2',
          seq: 1,
          timestampMs: 200,
          tabId: 't1',
          frameId: 'f1',
          action: 'fill',
          target: makeTarget({
            tagName: 'input',
            id: 'sample-text',
            name: 'sampleText',
            ariaLabel: 'Sample Text',
          }),
          value: 'Charlie',
        },
        {
          id: 'd3-s3',
          seq: 2,
          timestampMs: 300,
          tabId: 't1',
          frameId: 'f1',
          action: 'check',
          target: makeTarget({
            tagName: 'input',
            id: 'sample-check',
            name: 'sampleCheck',
            ariaLabel: 'Agree to Terms',
          }),
        },
        {
          id: 'd3-s4',
          seq: 3,
          timestampMs: 400,
          tabId: 't1',
          frameId: 'f1',
          action: 'selectOption',
          target: makeTarget({
            tagName: 'select',
            id: 'country-select',
            name: 'country',
            ariaLabel: 'Country',
          }),
          value: 'uk',
        },
        {
          id: 'd3-s5',
          seq: 4,
          timestampMs: 500,
          tabId: 't1',
          frameId: 'f1',
          action: 'click',
          target: makeTarget({
            tagName: 'button',
            id: 'sample-btn',
            role: 'button',
            accessibleName: 'Click Me',
            testIds: { testId: 'sample-button' },
          }),
        },
      ];

      // 1. Synthesize generalized workflow across all 3 demonstrations
      const generalizer = new MultiTraceGeneralizer();
      const generalized = generalizer.generalize({
        workflowName: 'benchmark-form-flow',
        workflowDescription: 'Synthesized benchmark flow with parameterized inputs and optional terms agreement',
        traces: [demo1, demo2, demo3],
      });

      // Verify synthesized WorkflowIR properties
      expect(generalized.parameterizedInputs).toContain('sampleText');
      expect(generalized.parameterizedInputs).toContain('country');
      expect(generalized.parameterizedInputs).toContain('sampleCheck');

      expect(generalized.ir.inputs.sampleText).toBeDefined();
      expect(generalized.ir.inputs.sampleText.type).toBe('string');
      expect(generalized.ir.inputs.country).toBeDefined();
      expect(generalized.ir.inputs.country.type).toBe('string');
      expect(generalized.ir.inputs.sampleCheck).toBeDefined();
      expect(generalized.ir.inputs.sampleCheck.type).toBe('boolean');
      expect(generalized.ir.inputs.sampleCheck.required).toBe(false);

      // Verify branch step
      expect(generalized.branchSteps.length).toBe(1);
      const branchStep = generalized.ir.steps.find((s) => s.id === generalized.branchSteps[0]);
      expect(branchStep).toBeDefined();
      expect(branchStep?.action.type).toBe('check');
      expect(branchStep?.optional).toBe(true);
      expect(branchStep?.condition).toEqual({ input: 'sampleCheck', equals: true });

      // 2. Compile synthesized WorkflowIR to standalone Playwright project bundle
      const project = compileWorkflowToPlaywright(generalized.ir);
      expect(project.files['workflow.ts']).toContain('if (inputs?.sampleCheck === true)');
      expect(project.files['workflow.ts']).toContain('await page.getByLabel("Agree to Terms", { exact: true }).check()');

      const outDir = path.resolve(process.cwd(), '.trace2code', 'test-output', 'generalized-flow');
      project.writeToDisk(outDir);
      expect(fs.existsSync(path.join(outDir, 'workflow.ts'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'input.schema.json'))).toBe(true);

      // Verify that the generated standalone project typechecks cleanly with tsc
      const tsconfigPath = path.join(outDir, 'tsconfig.json');
      expect(() => {
        execSync(`npx tsc --noEmit -p ${tsconfigPath}`, {
          cwd: process.cwd(),
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      }).not.toThrow();

      // 3. Acceptance Execution with UNSEEN 4TH INPUT in clean live Chromium browser!
      const unseen4thInput = {
        sampleText: 'Grace Hopper',
        country: 'ca',
        sampleCheck: true,
      };

      const page1 = await browser.newPage();

      try {
        await executeWorkflow(page1, generalized.ir, unseen4thInput);

        // Verify live DOM reflects the unseen 4th input
        const textVal = await page1.locator('#sample-text').inputValue();
        expect(textVal).toBe('Grace Hopper');

        const countryVal = await page1.locator('#country-select').inputValue();
        expect(countryVal).toBe('ca');

        const isChecked = await page1.locator('#sample-check').isChecked();
        expect(isChecked).toBe(true);

        const checkFeedback = await page1.locator('#checkbox-feedback').textContent();
        expect(checkFeedback).toBe('Checked');

        const clickFeedback = await page1.locator('#click-feedback').textContent();
        expect(clickFeedback).toBe('Clicked!');
      } finally {
        await page1.close();
      }

      // 4. Acceptance Execution with UNSEEN 5TH INPUT (with optional branch skipped!)
      const unseen5thInput = {
        sampleText: 'Alan Turing',
        country: 'uk',
        sampleCheck: false,
      };

      const page2 = await browser.newPage();
      try {
        await executeWorkflow(page2, generalized.ir, unseen5thInput);

        // Verify live DOM reflects the unseen 5th input and skipped check
        const textVal = await page2.locator('#sample-text').inputValue();
        expect(textVal).toBe('Alan Turing');

        const countryVal = await page2.locator('#country-select').inputValue();
        expect(countryVal).toBe('uk');

        const isChecked = await page2.locator('#sample-check').isChecked();
        expect(isChecked).toBe(false);

        const checkFeedback = await page2.locator('#checkbox-feedback').textContent();
        expect(checkFeedback).not.toBe('Checked');

        const clickFeedback = await page2.locator('#click-feedback').textContent();
        expect(clickFeedback).toBe('Clicked!');
      } finally {
        await page2.close();
      }
    });
  });
});
