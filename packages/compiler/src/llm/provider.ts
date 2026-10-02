import type { SemanticTraceStep } from '@trace2code/distiller';
import type { ElementEvidence } from '@trace2code/protocol';
import { isRedactedValue } from '@trace2code/protocol';
import type {
  WorkflowIR,
  WorkflowStep,
  WorkflowTarget,
  WorkflowValue,
  WorkflowInput,
  WorkflowPostcondition,
} from '@trace2code/workflow-ir';
import { LocatorScoringSystem } from '@trace2code/distiller';

export interface UserMarkEvidence {
  kind: 'step' | 'parameter' | 'secret' | 'note';
  label: string;
  details?: Record<string, unknown>;
  targetSeq?: number;
  timestampMs?: number;
}

export interface CompilerEvidenceContext {
  workflowName?: string;
  workflowDescription?: string;
  steps: SemanticTraceStep[];
  userMarks?: UserMarkEvidence[];
  pageUrls?: string[];
  elements?: ElementEvidence[];
}

export interface LLMProvider {
  name: string;
  generateWorkflowIR(context: CompilerEvidenceContext): Promise<WorkflowIR>;
}

/**
 * Builds a canonical WorkflowTarget from ElementEvidence using the locator ranking priority.
 */
export function buildWorkflowTarget(
  evidence?: ElementEvidence,
  containerScope?: string
): WorkflowTarget {
  if (!evidence) {
    return { css: 'body' };
  }

  // 1. Explicit Test ID
  if (evidence.testIds && Object.keys(evidence.testIds).length > 0) {
    const firstVal = Object.values(evidence.testIds)[0];
    if (firstVal) {
      return {
        testId: firstVal,
        containerScope,
      };
    }
  }

  // 2. Role + Accessible Name
  if (evidence.role && evidence.accessibleName) {
    return {
      role: evidence.role,
      name: evidence.accessibleName,
      exact: true,
      containerScope,
    };
  }

  // 3. Aria Label
  if (evidence.ariaLabel) {
    return {
      label: evidence.ariaLabel,
      containerScope,
    };
  }

  // 4. Stable ID
  if (evidence.id && !evidence.id.match(/^ember\d+|^react-aria-|^vue-|\d{5,}/)) {
    return {
      css: `#${evidence.id}`,
      containerScope,
    };
  }

  // 5. Name attribute
  if (evidence.name) {
    return {
      css: `[name="${evidence.name}"]`,
      containerScope,
    };
  }

  // 6. Text
  if (evidence.text && evidence.text.trim().length > 0 && evidence.text.trim().length <= 40) {
    return {
      text: evidence.text.trim(),
      containerScope,
    };
  }

  // 7. Structural CSS
  if (evidence.cssCandidates && evidence.cssCandidates.length > 0) {
    return {
      css: evidence.cssCandidates[0],
      containerScope,
    };
  }

  // 8. XPath
  if (evidence.xpathCandidate) {
    return {
      xpath: evidence.xpathCandidate,
      containerScope,
    };
  }

  return {
    css: evidence.tagName || 'div',
    containerScope,
  };
}

/**
 * Deterministic Rule-Based Compiler Provider.
 * Provides 100% reproducible, offline, rule-based inference without external API keys or network calls.
 */
export class DeterministicRuleCompilerProvider implements LLMProvider {
  name = 'deterministic-rules';
  private scoringSystem = new LocatorScoringSystem();

  async generateWorkflowIR(context: CompilerEvidenceContext): Promise<WorkflowIR> {
    const workflowName = context.workflowName || 'compiled-workflow';
    const inputs: Record<string, WorkflowInput> = {};
    const steps: WorkflowStep[] = [];

    // Map user marks to parameter and secret declarations
    const paramMarksBySeq = new Map<number, UserMarkEvidence>();
    const secretMarksBySeq = new Map<number, UserMarkEvidence>();
    const noteMarksBySeq = new Map<number, string>();

    for (const mark of context.userMarks || []) {
      const seq = mark.targetSeq ?? -1;
      if (mark.kind === 'parameter') {
        const paramName =
          (mark.details?.parameterName as string) || mark.label || `param_${seq >= 0 ? seq : 'input'}`;
        const inputType = (mark.details?.type as any) || 'string';
        inputs[paramName] = {
          type: inputType,
          description: (mark.details?.description as string) || `Parameter for ${mark.label || paramName}`,
          required: mark.details?.required !== false,
          default: mark.details?.default,
        };
        if (seq >= 0) paramMarksBySeq.set(seq, mark);
      } else if (mark.kind === 'secret') {
        if (seq >= 0) secretMarksBySeq.set(seq, mark);
      } else if (mark.kind === 'note') {
        if (seq >= 0) noteMarksBySeq.set(seq, mark.label);
      }
    }

    // Process each semantic trace step
    for (let i = 0; i < context.steps.length; i++) {
      const step = context.steps[i];
      const stepId = `step-${i + 1}`;
      const userNote = noteMarksBySeq.get(step.seq) || noteMarksBySeq.get(i);
      const paramMark = paramMarksBySeq.get(step.seq) || paramMarksBySeq.get(i);
      const secretMark = secretMarksBySeq.get(step.seq) || secretMarksBySeq.get(i);

      // Resolve ranked locators and container scope
      const ranked = this.scoringSystem.rankCandidates(step.target);
      const containerScope = ranked[0]?.containerScope;
      const target = buildWorkflowTarget(step.target, containerScope);

      // Resolve value
      let value: WorkflowValue | undefined;
      const isSecret =
        Boolean(secretMark) ||
        isRedactedValue(step.value) ||
        step.target?.type === 'password';

      if (step.value !== undefined || isSecret) {
        if (paramMark) {
          const paramName =
            (paramMark.details?.parameterName as string) || paramMark.label || `param_${step.seq}`;
          value = { input: paramName };
        } else if (isSecret) {
          const secretRef =
            (secretMark?.details?.secretName as string) ||
            (typeof step.value === 'object' && step.value && 'id' in step.value && (step.value as any).id
              ? String((step.value as any).id)
              : step.target?.name
              ? `${step.target.name}_secret`
              : 'secret_credentials');
          value = { secret: secretRef };
        } else {
          value = { constant: typeof step.value === 'string' ? step.value : String(step.value) };
        }
      }

      // Resolve Action & Intent
      let action: any;
      let intent = userNote || '';

      switch (step.action) {
        case 'navigate': {
          const navUrl = (step.payload?.url as string) || (step.value as string) || 'http://localhost:3000';
          action = { type: 'navigate', url: navUrl };
          if (!intent) intent = `Navigate to ${navUrl}`;
          break;
        }

        case 'click': {
          action = { type: 'click', target };
          if (!intent) {
            const targetName = step.target?.accessibleName || step.target?.text || step.target?.id || 'element';
            intent = `Click ${targetName}`;
          }
          break;
        }

        case 'fill': {
          const valObj = value || { constant: '' };
          action = { type: 'fill', target, value: valObj };
          if (!intent) {
            const field = step.target?.accessibleName || step.target?.ariaLabel || step.target?.id || 'input';
            intent = `Fill ${field}`;
          }
          break;
        }

        case 'check': {
          action = { type: 'check', target };
          if (!intent) intent = `Check ${step.target?.accessibleName || 'checkbox'}`;
          break;
        }

        case 'uncheck': {
          action = { type: 'uncheck', target };
          if (!intent) intent = `Uncheck ${step.target?.accessibleName || 'checkbox'}`;
          break;
        }

        case 'selectOption': {
          const valObj = value || { constant: '' };
          action = { type: 'selectOption', target, value: valObj };
          if (!intent) intent = `Select option in ${step.target?.accessibleName || 'dropdown'}`;
          break;
        }

        case 'uploadFile': {
          const valObj = value || { constant: 'test-upload.txt' };
          action = { type: 'uploadFile', target, value: valObj };
          if (!intent) intent = `Upload file to ${step.target?.accessibleName || 'file input'}`;
          break;
        }

        case 'drag': {
          const sourceTarget = step.payload?.source
            ? buildWorkflowTarget(step.payload.source as ElementEvidence)
            : target;
          const destTarget = step.payload?.destination
            ? buildWorkflowTarget(step.payload.destination as ElementEvidence)
            : { css: '#drop-zone' };
          action = { type: 'drag', source: sourceTarget, destination: destTarget };
          if (!intent) intent = 'Drag and drop item';
          break;
        }

        default: {
          action = { type: 'click', target };
          if (!intent) intent = `Interact with ${step.target?.accessibleName || 'element'}`;
        }
      }

      // Resolve Postcondition
      const postcondition: WorkflowPostcondition = {};
      const nextStep = context.steps[i + 1];

      // URL transition postcondition
      if (step.action === 'navigate') {
        const urlStr = action.url as string;
        try {
          const parsed = new URL(urlStr);
          postcondition.urlMatches = `.*${parsed.pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`;
        } catch {
          postcondition.urlMatches = `.*${urlStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`;
        }
      } else if (nextStep && nextStep.payload?.url && nextStep.payload.url !== step.payload?.url) {
        const nextUrl = nextStep.payload.url as string;
        try {
          const parsed = new URL(nextUrl);
          postcondition.urlMatches = `.*${parsed.pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`;
        } catch {
          postcondition.urlMatches = `.*${nextUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`;
        }
      }

      // Modal or dynamic element postcondition if indicated in step
      if (step.postcondition?.elementVisible) {
        postcondition.elementVisible = { css: step.postcondition.elementVisible };
      }
      if (step.postcondition?.semantic) {
        postcondition.semantic = step.postcondition.semantic;
      }

      // Confidence scoring
      let confidence: 'high' | 'medium' | 'low' = 'high';
      if (target.testId || (target.role && target.name)) {
        confidence = 'high';
      } else if (target.label || target.css) {
        confidence = 'medium';
      } else {
        confidence = 'low';
      }

      steps.push({
        id: stepId,
        intent,
        action,
        ...(Object.keys(postcondition).length > 0 ? { postcondition } : {}),
        confidence,
      });
    }

    return {
      version: '0.1',
      name: workflowName,
      description: context.workflowDescription || `Workflow compiled from ${steps.length} demonstration steps`,
      inputs,
      steps,
    };
  }
}

/**
 * Gemini Compiler Provider using Google Gemini REST API.
 */
export class GeminiCompilerProvider implements LLMProvider {
  name = 'gemini';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(options: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
    this.model = options.model || 'gemini-2.5-flash';
    this.baseUrl =
      options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  async generateWorkflowIR(context: CompilerEvidenceContext): Promise<WorkflowIR> {
    if (!this.apiKey) {
      throw new Error(
        'GeminiCompilerProvider requires GEMINI_API_KEY environment variable or apiKey option.'
      );
    }

    const systemPrompt = `You are Trace2Code's demonstration-to-code compiler.
Given a sequence of recorded user browser interaction steps, locator candidates, and user marks:
Infer the user's high-level workflow intent and output a strictly valid JSON object matching the WorkflowIR schema.

Rules:
1. Version must be "0.1".
2. Inputs: parameterize any field marked as 'parameter', or reusable search/form fields.
3. Secrets: any passwords or fields marked as 'secret' must use { "secret": "secret_name" }, NEVER plain constants.
4. Targets: use the most robust locator (testId > role+name > label > css). Never invent nonexistent selectors.
5. Postconditions: include urlMatches on navigations/page changes and elementVisible on dialogs/results.
6. Output JSON only, no markdown fencing, no preamble.`;

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${systemPrompt}\n\nEvidence Context:\n${JSON.stringify(context, null, 2)}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    };

    const url = `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    const result = await response.json();
    const candidateText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      throw new Error('Gemini API returned empty response');
    }

    const cleanJson = candidateText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleanJson) as WorkflowIR;
  }
}
