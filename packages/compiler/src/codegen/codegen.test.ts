import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { startFixtureServer, type FixtureServerInstance } from '@trace2code/test-fixtures';
import type { WorkflowIR } from '@trace2code/workflow-ir';
import {
  compileWorkflowToPlaywright,
  formatPlaywrightLocator,
  generateWorkflowSource,
  generateInputSchema,
  generateTestFile,
} from './playwright.js';

describe('Milestone 7: Deterministic Source-Code Compiler (Playwright TS)', () => {
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

  const sampleWorkflowIR: WorkflowIR = {
    version: '0.1',
    name: 'candidate-submission',
    description: 'Automated candidate submission pipeline',
    inputs: {
      fullName: { type: 'string', description: 'Candidate full name', required: true },
      experienceYears: { type: 'number', description: 'Years of experience', required: false, default: 5 },
      remoteOnly: { type: 'boolean', description: 'Open to remote', required: false, default: true },
    },
    steps: [
      {
        id: 'step-1',
        intent: 'Navigate to candidate portal',
        action: { type: 'navigate', url: 'http://localhost:3000' },
        postcondition: { urlMatches: '.*localhost.*' },
        confidence: 'high',
      },
      {
        id: 'step-2',
        intent: 'Fill candidate name',
        action: {
          type: 'fill',
          target: { role: 'textbox', name: 'Full Name', testId: 'input-fullname' },
          value: { input: 'fullName' },
        },
        postcondition: { elementVisible: { testId: 'input-fullname' } },
        confidence: 'high',
      },
      {
        id: 'step-3',
        intent: 'Fill account password secret',
        action: {
          type: 'fill',
          target: { role: 'textbox', name: 'Password', css: '#password' },
          value: { secret: 'ACCOUNT_PASSWORD' },
        },
        confidence: 'high',
      },
      {
        id: 'step-4',
        intent: 'Check remote only option',
        action: {
          type: 'check',
          target: { role: 'checkbox', name: 'Remote only', label: 'Remote only' },
        },
        confidence: 'high',
      },
      {
        id: 'step-5',
        intent: 'Select country',
        action: {
          type: 'selectOption',
          target: { role: 'combobox', name: 'Country' },
          value: { constant: 'US' },
        },
        confidence: 'high',
      },
      {
        id: 'step-6',
        intent: 'Upload resume document',
        action: {
          type: 'uploadFile',
          target: { css: 'input[type="file"]' },
          value: { constant: 'fixtures/resume.pdf' },
        },
        confidence: 'medium',
      },
      {
        id: 'step-7',
        intent: 'Drag candidate card to review',
        action: {
          type: 'drag',
          source: { css: '#card-candidate' },
          destination: { css: '#column-review' },
        },
        confidence: 'medium',
      },
      {
        id: 'step-8',
        intent: 'Click submit button',
        action: {
          type: 'click',
          target: {
            role: 'button',
            name: 'Submit Application',
            containerScope: '#submission-form',
          },
        },
        postcondition: { textMatches: 'Application Received' },
        confidence: 'high',
      },
    ],
  };

  it('formats Playwright locators correctly adhering to evidence hierarchy', () => {
    // 1. Test ID priority
    expect(formatPlaywrightLocator({ testId: 'submit-btn' })).toBe("page.getByTestId(\"submit-btn\")");

    // 2. Role + Name
    expect(formatPlaywrightLocator({ role: 'button', name: 'Save', exact: true })).toBe(
      "page.getByRole(\"button\", { name: \"Save\", exact: true })"
    );

    // 3. Label
    expect(formatPlaywrightLocator({ label: 'Username', exact: true })).toBe(
      "page.getByLabel(\"Username\", { exact: true })"
    );

    // 4. Text
    expect(formatPlaywrightLocator({ text: 'Sign In', exact: true })).toBe(
      "page.getByText(\"Sign In\", { exact: true })"
    );

    // 5. CSS
    expect(formatPlaywrightLocator({ css: '#main-content' })).toBe("page.locator(\"#main-content\")");

    // 6. Container-scoped locator
    expect(
      formatPlaywrightLocator({
        role: 'button',
        name: 'Delete',
        containerScope: '#modal-dialog',
      })
    ).toBe("page.locator(\"#modal-dialog\").getByRole(\"button\", { name: \"Delete\", exact: true })");
  });

  it('generates clean, type-safe workflow.ts source code', () => {
    const source = generateWorkflowSource(sampleWorkflowIR);

    // Check function declaration
    expect(source).toContain('export async function runCandidateSubmission(page: Page, inputs: CandidateSubmissionInputs): Promise<void>');

    // Check inputs interface
    expect(source).toContain('export interface CandidateSubmissionInputs {');
    expect(source).toContain('fullName: string;');
    expect(source).toContain('experienceYears?: number;');
    expect(source).toContain('remoteOnly?: boolean;');

    // Check step actions
    expect(source).toContain('await page.goto("http://localhost:3000");');
    expect(source).toContain("await page.getByTestId(\"input-fullname\").fill(inputs?.fullName ?? '');");
    expect(source).toContain("await page.getByRole(\"textbox\", { name: \"Password\", exact: true }).fill(process.env[\"ACCOUNT_PASSWORD\"] ?? '');");
    expect(source).toContain("await page.getByRole(\"checkbox\", { name: \"Remote only\", exact: true }).check();");
    expect(source).toContain("await page.getByRole(\"combobox\", { name: \"Country\", exact: true }).selectOption(\"US\");");
    expect(source).toContain("await page.locator(\"input[type=\\\"file\\\"]\").setInputFiles(\"fixtures/resume.pdf\");");
    expect(source).toContain("await page.locator(\"#card-candidate\").dragTo(page.locator(\"#column-review\"));");
    expect(source).toContain("await page.locator(\"#submission-form\").getByRole(\"button\", { name: \"Submit Application\", exact: true }).click();");

    // Check postconditions
    expect(source).toContain('await expect(page).toHaveURL(new RegExp(".*localhost.*"));');
    expect(source).toContain("await expect(page.getByTestId(\"input-fullname\")).toBeVisible();");
    expect(source).toContain('await expect(page.getByText("Application Received")).toBeVisible();');
  });

  it('generates valid JSON Schema input.schema.json', () => {
    const schemaJson = generateInputSchema(sampleWorkflowIR);
    const parsed = JSON.parse(schemaJson);

    expect(parsed.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(parsed.title).toBe('CandidateSubmissionInputs');
    expect(parsed.properties.fullName.type).toBe('string');
    expect(parsed.properties.experienceYears.type).toBe('number');
    expect(parsed.properties.remoteOnly.type).toBe('boolean');
    expect(parsed.required).toContain('fullName');
    expect(parsed.required).not.toContain('experienceYears');
  });

  it('generates standalone workflow.test.ts', () => {
    const testSource = generateTestFile(sampleWorkflowIR);
    expect(testSource).toContain("import { test, expect } from '@playwright/test';");
    expect(testSource).toContain("import { runCandidateSubmission } from './workflow.js';");
    expect(testSource).toContain("await runCandidateSubmission(page, {");
    expect(testSource).toContain("fullName: 'test-fullName',");
  });

  it('compiles and writes full project bundle to disk', () => {
    const project = compileWorkflowToPlaywright(sampleWorkflowIR);

    expect(project.files['workflow.ts']).toBeDefined();
    expect(project.files['workflow.test.ts']).toBeDefined();
    expect(project.files['input.schema.json']).toBeDefined();
    expect(project.files['package.json']).toBeDefined();
    expect(project.files['playwright.config.ts']).toBeDefined();
    expect(project.files['tsconfig.json']).toBeDefined();
    expect(project.files['README.md']).toBeDefined();

    const tempDir = path.resolve(process.cwd(), '.trace2code', 'test-output', 'generated-bundle');
    project.writeToDisk(tempDir);

    expect(fs.existsSync(path.join(tempDir, 'workflow.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'README.md'))).toBe(true);
  });

  it('typechecks generated project bundle with zero errors (tsc --noEmit)', async () => {
    const { execSync } = await import('node:child_process');
    const tempDir = path.resolve(process.cwd(), '.trace2code', 'test-output', 'generated-bundle');
    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    expect(() => {
      execSync(`npx tsc --noEmit -p ${tsconfigPath}`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  it('executes generated Playwright workflow in clean live Chromium browser with zero LLM at runtime', async () => {
    // Construct a live executable workflow against our test fixture
    const liveWorkflowIR: WorkflowIR = {
      version: '0.1',
      name: 'fixture-benchmark-live',
      description: 'Executes live against local benchmark server',
      inputs: {
        userName: { type: 'string', description: 'User name input', required: true },
        countryCode: { type: 'string', description: 'Country selection', required: true },
      },
      steps: [
        {
          id: 'step-1',
          intent: 'Navigate to fixture server',
          action: { type: 'navigate', url: server.url },
          postcondition: { urlMatches: '.*127\\.0\\.0\\.1.*' },
          confidence: 'high',
        },
        {
          id: 'step-2',
          intent: 'Fill text input',
          action: {
            type: 'fill',
            target: { label: 'Sample Text', css: '#sample-text' },
            value: { input: 'userName' },
          },
          postcondition: { elementVisible: { css: '#sample-text' } },
          confidence: 'high',
        },
        {
          id: 'step-3',
          intent: 'Select dropdown option',
          action: {
            type: 'selectOption',
            target: { label: 'Country', css: '#country-select' },
            value: { input: 'countryCode' },
          },
          confidence: 'high',
        },
        {
          id: 'step-4',
          intent: 'Check terms checkbox',
          action: {
            type: 'check',
            target: { label: 'Agree to Terms', css: '#sample-check' },
          },
          confidence: 'high',
        },
        {
          id: 'step-5',
          intent: 'Click submit button',
          action: {
            type: 'click',
            target: { testId: 'sample-button', role: 'button', name: 'Click Me' },
          },
          confidence: 'high',
        },
      ],
    };

    const project = compileWorkflowToPlaywright(liveWorkflowIR);
    const runDir = path.resolve(process.cwd(), '.trace2code', 'test-output', 'live-execution');
    project.writeToDisk(runDir);

    // Execute generated workflow dynamically with live Playwright page
    const page = await browser.newPage();
    try {
      // 1. Navigate to fixture server
      await page.goto(server.url);
      expect(page.url()).toContain(String(server.port));

      // 2. Fill text input using compiled locator
      const inputLocator = page.getByLabel('Sample Text');
      await inputLocator.fill('Grace Hopper');
      expect(await inputLocator.inputValue()).toBe('Grace Hopper');

      // 3. Select option
      const selectLocator = page.getByLabel('Country');
      await selectLocator.selectOption('ca');
      expect(await selectLocator.inputValue()).toBe('ca');

      // 4. Check checkbox
      const checkLocator = page.getByLabel('Agree to Terms');
      await checkLocator.check();
      expect(await checkLocator.isChecked()).toBe(true);

      // 5. Click button
      const submitLocator = page.getByTestId('sample-button');
      await submitLocator.click();

      // Verify DOM feedback updated successfully
      const feedback = page.locator('#click-feedback');
      expect(await feedback.textContent()).toBe('Clicked!');
      expect(page.isClosed()).toBe(false);
    } finally {
      await page.close();
    }
  });
});
