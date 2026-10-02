import { describe, it, expect } from 'vitest';
import type { SemanticTraceStep } from '@trace2code/distiller';
import type { ElementEvidence } from '@trace2code/protocol';
import { SemanticCompiler } from './compiler.js';
import { DeterministicRuleCompilerProvider } from './provider.js';
import { HallucinationGuard } from './hallucination-guard.js';
import { validateWorkflowIR } from '@trace2code/workflow-ir';

function mockEvidence(partial: Partial<ElementEvidence>): ElementEvidence {
  return {
    tagName: partial.tagName || 'button',
    testIds: partial.testIds || {},
    cssCandidates: partial.cssCandidates || [],
    ...partial,
  };
}

describe('Milestone 6: LLM Compile-Time Workflow Inference & Semantic Compiler', () => {
  const compiler = new SemanticCompiler(new DeterministicRuleCompilerProvider());

  // Workflow 1: Basic form submission
  it('1. compiles basic form submission workflow', async () => {
    const steps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'navigate',
        payload: { url: 'http://localhost:3000/form' },
      },
      {
        id: 's2',
        seq: 1,
        timestampMs: 300,
        tabId: 'tab1',
        frameId: 'main',
        action: 'fill',
        target: mockEvidence({
          tagName: 'input',
          id: 'text-input',
          accessibleName: 'User Name',
          role: 'textbox',
          testIds: { 'data-testid': 'username-input' },
        }),
        value: 'Alice Tester',
      },
      {
        id: 's3',
        seq: 2,
        timestampMs: 600,
        tabId: 'tab1',
        frameId: 'main',
        action: 'click',
        target: mockEvidence({
          tagName: 'button',
          id: 'submit-btn',
          accessibleName: 'Submit Form',
          role: 'button',
        }),
      },
    ];

    const result = await compiler.compile({
      workflowName: 'basic-form-submission',
      steps,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.ir).toBeDefined();
    expect(result.ir?.steps).toHaveLength(3);
    expect(result.ir?.steps[0].action.type).toBe('navigate');
    expect(result.ir?.steps[1].action.type).toBe('fill');
    expect(result.ir?.steps[1].action).toHaveProperty('target.testId', 'username-input');
    expect(result.ir?.steps[2].action.type).toBe('click');
    expect(result.ir?.steps[2].action).toHaveProperty('target.role', 'button');
    expect(result.ir?.steps[2].action).toHaveProperty('target.name', 'Submit Form');
  });

  // Workflow 2: Candidate search with parameterization
  it('2. compiles candidate search workflow with parameterized inputs', async () => {
    const steps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'navigate',
        payload: { url: 'http://localhost:3000/candidates' },
      },
      {
        id: 's2',
        seq: 1,
        timestampMs: 300,
        tabId: 'tab1',
        frameId: 'main',
        action: 'fill',
        target: mockEvidence({
          tagName: 'input',
          role: 'searchbox',
          accessibleName: 'Search Candidates',
          testIds: { 'data-testid': 'candidate-search' },
        }),
        value: 'Senior Frontend Engineer',
      },
      {
        id: 's3',
        seq: 2,
        timestampMs: 500,
        tabId: 'tab1',
        frameId: 'main',
        action: 'click',
        target: mockEvidence({
          tagName: 'button',
          role: 'button',
          accessibleName: 'Search',
        }),
      },
    ];

    const result = await compiler.compile({
      workflowName: 'candidate-search',
      steps,
      userMarks: [
        {
          kind: 'parameter',
          label: 'searchQuery',
          targetSeq: 1,
          details: { parameterName: 'searchQuery', type: 'string', description: 'Query for candidate search' },
        },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.ir?.inputs).toHaveProperty('searchQuery');
    expect(result.ir?.inputs.searchQuery.type).toBe('string');
    const fillStep = result.ir?.steps[1];
    expect(fillStep?.action.type).toBe('fill');
    expect((fillStep?.action as any).value).toEqual({ input: 'searchQuery' });
  });

  // Workflow 3: Authentication login with secret credentials
  it('3. compiles login workflow and guarantees secret redaction', async () => {
    const steps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'navigate',
        payload: { url: 'http://localhost:3000/login' },
      },
      {
        id: 's2',
        seq: 1,
        timestampMs: 250,
        tabId: 'tab1',
        frameId: 'main',
        action: 'fill',
        target: mockEvidence({
          tagName: 'input',
          role: 'textbox',
          accessibleName: 'Username',
          name: 'username',
        }),
        value: 'admin@company.com',
      },
      {
        id: 's3',
        seq: 2,
        timestampMs: 400,
        tabId: 'tab1',
        frameId: 'main',
        action: 'fill',
        target: mockEvidence({
          tagName: 'input',
          role: 'textbox',
          accessibleName: 'Password',
          name: 'password',
          type: 'password',
        }),
        value: { kind: 'redacted', reason: 'password_field', hint: '••••••••' },
      },
      {
        id: 's4',
        seq: 3,
        timestampMs: 600,
        tabId: 'tab1',
        frameId: 'main',
        action: 'click',
        target: mockEvidence({
          tagName: 'button',
          role: 'button',
          accessibleName: 'Log In',
        }),
      },
    ];

    const result = await compiler.compile({
      workflowName: 'secure-login',
      steps,
      userMarks: [
        {
          kind: 'secret',
          label: 'account_password',
          targetSeq: 2,
          details: { secretName: 'ACCOUNT_PASSWORD', secretValue: 'topsecret123' },
        },
      ],
    });

    expect(result.valid).toBe(true);
    const passwordStep = result.ir?.steps[2];
    expect((passwordStep?.action as any).value).toEqual({ secret: 'ACCOUNT_PASSWORD' });
    // Verify zero plaintext secrets in output
    const serialized = JSON.stringify(result.ir);
    expect(serialized).not.toContain('topsecret123');
  });

  // Workflow 4: Expense report submission
  it('4. compiles multi-field expense report submission', async () => {
    const steps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'navigate',
        payload: { url: 'http://localhost:3000/expenses/new' },
      },
      {
        id: 's2',
        seq: 1,
        timestampMs: 200,
        tabId: 'tab1',
        frameId: 'main',
        action: 'fill',
        target: mockEvidence({
          tagName: 'input',
          id: 'expense-amount',
          accessibleName: 'Amount',
        }),
        value: '125.50',
      },
      {
        id: 's3',
        seq: 2,
        timestampMs: 350,
        tabId: 'tab1',
        frameId: 'main',
        action: 'fill',
        target: mockEvidence({
          tagName: 'input',
          id: 'expense-description',
          accessibleName: 'Description',
        }),
        value: 'Team lunch catering',
      },
      {
        id: 's4',
        seq: 3,
        timestampMs: 500,
        tabId: 'tab1',
        frameId: 'main',
        action: 'click',
        target: mockEvidence({
          tagName: 'button',
          role: 'button',
          accessibleName: 'Submit Expense',
        }),
      },
    ];

    const result = await compiler.compile({
      workflowName: 'submit-expense',
      steps,
      userMarks: [
        { kind: 'parameter', label: 'amount', targetSeq: 1, details: { parameterName: 'amount' } },
        { kind: 'parameter', label: 'memo', targetSeq: 2, details: { parameterName: 'memo' } },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.ir?.inputs).toHaveProperty('amount');
    expect(result.ir?.inputs).toHaveProperty('memo');
    expect((result.ir?.steps[1].action as any).value).toEqual({ input: 'amount' });
    expect((result.ir?.steps[2].action as any).value).toEqual({ input: 'memo' });
  });

  // Workflow 5: Country selection dropdown
  it('5. compiles select option dropdown workflow', async () => {
    const steps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'selectOption',
        target: mockEvidence({
          tagName: 'select',
          id: 'country-select',
          accessibleName: 'Country',
          role: 'combobox',
        }),
        value: 'CA',
      },
    ];

    const result = await compiler.compile({
      workflowName: 'country-selection',
      steps,
    });

    expect(result.valid).toBe(true);
    expect(result.ir?.steps[0].action.type).toBe('selectOption');
    expect((result.ir?.steps[0].action as any).value).toEqual({ constant: 'CA' });
  });

  // Workflow 6: Terms agreement checkbox
  it('6. compiles checkbox check / uncheck actions', async () => {
    const steps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'check',
        target: mockEvidence({
          tagName: 'input',
          type: 'checkbox',
          id: 'agree-terms',
          accessibleName: 'I agree to the Terms of Service',
          role: 'checkbox',
        }),
      },
      {
        id: 's2',
        seq: 1,
        timestampMs: 250,
        tabId: 'tab1',
        frameId: 'main',
        action: 'uncheck',
        target: mockEvidence({
          tagName: 'input',
          type: 'checkbox',
          id: 'marketing-emails',
          accessibleName: 'Receive marketing emails',
          role: 'checkbox',
        }),
      },
    ];

    const result = await compiler.compile({
      workflowName: 'terms-checkbox',
      steps,
    });

    expect(result.valid).toBe(true);
    expect(result.ir?.steps[0].action.type).toBe('check');
    expect(result.ir?.steps[1].action.type).toBe('uncheck');
  });

  // Workflow 7: Multi-page navigation link
  it('7. compiles multi-page link navigation with urlMatches postconditions', async () => {
    const steps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'navigate',
        payload: { url: 'http://localhost:3000/home' },
      },
      {
        id: 's2',
        seq: 1,
        timestampMs: 300,
        tabId: 'tab1',
        frameId: 'main',
        action: 'click',
        target: mockEvidence({
          tagName: 'a',
          role: 'link',
          accessibleName: 'Documentation Portal',
        }),
        payload: { url: 'http://localhost:3000/docs/overview' },
      },
    ];

    const result = await compiler.compile({
      workflowName: 'multipage-nav',
      steps,
    });

    expect(result.valid).toBe(true);
    expect(result.ir?.steps[0].postcondition?.urlMatches).toBeDefined();
    expect(result.ir?.steps[0].postcondition?.urlMatches).toContain('home');
  });

  // Workflow 8: Client-side SPA route transition
  it('8. compiles SPA pushState route transition', async () => {
    const steps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'click',
        target: mockEvidence({
          tagName: 'button',
          id: 'spa-nav-btn',
          accessibleName: 'Go to Settings',
          role: 'button',
        }),
        payload: { url: 'http://localhost:3000/spa/settings' },
      },
    ];

    const result = await compiler.compile({
      workflowName: 'spa-route',
      steps,
    });

    expect(result.valid).toBe(true);
    expect(result.ir?.steps[0].action.type).toBe('click');
  });

  // Workflow 9: Modal confirmation dialog
  it('9. compiles modal dialog interaction with elementVisible postcondition', async () => {
    const steps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'click',
        target: mockEvidence({
          tagName: 'button',
          id: 'open-modal-btn',
          accessibleName: 'Delete Item',
          role: 'button',
        }),
        postcondition: { elementVisible: '#confirm-modal' },
      },
      {
        id: 's2',
        seq: 1,
        timestampMs: 300,
        tabId: 'tab1',
        frameId: 'main',
        action: 'click',
        target: mockEvidence({
          tagName: 'button',
          id: 'modal-confirm-btn',
          accessibleName: 'Confirm Delete',
          role: 'button',
        }),
      },
    ];

    const result = await compiler.compile({
      workflowName: 'modal-dialog',
      steps,
    });

    expect(result.valid).toBe(true);
    expect(result.ir?.steps[0].postcondition?.elementVisible).toEqual({ css: '#confirm-modal' });
  });

  // Workflow 10: File upload workflow
  it('10. compiles file upload workflow', async () => {
    const steps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'uploadFile',
        target: mockEvidence({
          tagName: 'input',
          type: 'file',
          id: 'resume-upload',
          accessibleName: 'Upload Resume',
          testIds: { 'data-testid': 'resume-upload-field' },
        }),
        value: 'fixtures/sample-resume.pdf',
      },
    ];

    const result = await compiler.compile({
      workflowName: 'file-upload',
      steps,
    });

    expect(result.valid).toBe(true);
    expect(result.ir?.steps[0].action.type).toBe('uploadFile');
    expect((result.ir?.steps[0].action as any).value).toEqual({ constant: 'fixtures/sample-resume.pdf' });
  });

  // Mutation Robustness Test
  it('verifies mutation robustness: non-semantic mutations do not change compiled IR structure', async () => {
    const originalSteps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'click',
        target: mockEvidence({
          tagName: 'button',
          id: 'action-btn',
          role: 'button',
          accessibleName: 'Continue',
          rect: { x: 100, y: 200, width: 80, height: 32 },
        }),
      },
    ];

    // Mutate timestamps, tab ID, coordinates
    const mutatedSteps: SemanticTraceStep[] = [
      {
        id: 's1-mutated',
        seq: 14,
        timestampMs: 999999,
        tabId: 'tab-999',
        frameId: 'main',
        action: 'click',
        target: mockEvidence({
          tagName: 'button',
          id: 'action-btn',
          role: 'button',
          accessibleName: 'Continue',
          rect: { x: 500, y: 750, width: 80, height: 32 }, // mutated coordinates
        }),
      },
    ];

    const res1 = await compiler.compile({ workflowName: 'test', steps: originalSteps });
    const res2 = await compiler.compile({ workflowName: 'test', steps: mutatedSteps });

    expect(res1.valid).toBe(true);
    expect(res2.valid).toBe(true);
    // Compare semantic actions
    expect(res1.ir?.steps[0].action).toEqual(res2.ir?.steps[0].action);
  });

  // Hallucination Guard Rejection Tests
  it('rejects hallucinated targets invented by provider', async () => {
    const traceSteps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'click',
        target: mockEvidence({
          tagName: 'button',
          id: 'real-button',
          role: 'button',
          accessibleName: 'Real Button',
        }),
      },
    ];

    // Mock provider that hallucinates a nonexistent button
    const hallucinatingProvider = {
      name: 'hallucinating-llm',
      async generateWorkflowIR() {
        return {
          version: '0.1' as const,
          name: 'hallucinated-test',
          inputs: {},
          steps: [
            {
              id: 'step-1',
              intent: 'Click imaginary element',
              action: {
                type: 'click' as const,
                target: { role: 'button', name: 'Imaginary Never Existed Button' },
              },
              confidence: 'high' as const,
            },
          ],
        };
      },
    };

    const badCompiler = new SemanticCompiler(hallucinatingProvider);
    const result = await badCompiler.compile({
      workflowName: 'hallucinated-test',
      steps: traceSteps,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ungrounded / hallucinated'))).toBe(true);
  });

  it('rejects ungrounded foreign URLs and secret leakage', async () => {
    const traceSteps: SemanticTraceStep[] = [
      {
        id: 's1',
        seq: 0,
        timestampMs: 100,
        tabId: 'tab1',
        frameId: 'main',
        action: 'navigate',
        payload: { url: 'http://localhost:3000' },
      },
    ];

    // Mock provider that leaks secret in constant and navigates to alien url
    const leakyProvider = {
      name: 'leaky-llm',
      async generateWorkflowIR() {
        return {
          version: '0.1' as const,
          name: 'leaky-test',
          inputs: {},
          steps: [
            {
              id: 'step-1',
              intent: 'Navigate to alien domain',
              action: {
                type: 'navigate' as const,
                url: 'https://attacker-steals-data.com/evil',
              },
              confidence: 'high' as const,
            },
            {
              id: 'step-2',
              intent: 'Enter password supersecret999',
              action: {
                type: 'fill' as const,
                target: { css: 'body' },
                value: { constant: 'supersecret999' },
              },
              confidence: 'high' as const,
            },
          ],
        };
      },
    };

    const leakyCompiler = new SemanticCompiler(leakyProvider);
    const result = await leakyCompiler.compile({
      workflowName: 'leaky-test',
      steps: traceSteps,
      userMarks: [
        {
          kind: 'secret',
          label: 'secret-pw',
          details: { secretValue: 'supersecret999' },
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('navigated to ungrounded / hallucinated URL'))).toBe(true);
    expect(result.errors.some((e) => e.includes('leaked plaintext secret'))).toBe(true);
  });

  it('rejects workflow IR with undeclared input references', () => {
    const invalidIR = {
      version: '0.1',
      name: 'invalid-input-test',
      inputs: {
        declaredParam: { type: 'string' as const, required: true },
      },
      steps: [
        {
          id: 'step-1',
          intent: 'Fill undeclared',
          action: {
            type: 'fill' as const,
            target: { css: '#input' },
            value: { input: 'undeclaredParam' },
          },
        },
      ],
    };

    const validation = validateWorkflowIR(invalidIR);
    expect(validation.valid).toBe(false);
    expect(validation.errors[0]).toContain("references undeclared input 'undeclaredParam'");
  });
});
