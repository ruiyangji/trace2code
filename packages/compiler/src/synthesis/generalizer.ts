import type { SemanticTraceStep } from '@trace2code/distiller';
import type { ElementEvidence } from '@trace2code/protocol';
import { isRedactedValue } from '@trace2code/protocol';
import type {
  WorkflowIR,
  WorkflowStep,
  WorkflowInput,
  WorkflowValue,
} from '@trace2code/workflow-ir';
import { validateWorkflowIR } from '@trace2code/workflow-ir';
import { LocatorScoringSystem } from '@trace2code/distiller';
import { buildWorkflowTarget } from '../llm/provider.js';
import type { AlignmentResult } from './alignment.js';
import { alignMultiTraceSequences } from './alignment.js';

export interface MultiTraceSynthesisRequest {
  workflowName?: string;
  workflowDescription?: string;
  traces: SemanticTraceStep[][];
  traceNames?: string[];
}

export interface DetectedLoop {
  pattern: string[];
  repetitions: number;
  startIndex: number;
  endIndex: number;
  stepIds: string[];
}

export interface GeneralizedWorkflowResult {
  ir: WorkflowIR;
  alignment: AlignmentResult;
  parameterizedInputs: string[];
  constantInvariants: string[];
  branchSteps: string[];
  detectedLoops: DetectedLoop[];
}

/**
 * Infers an idiomatic, camelCase parameter variable name from element evidence.
 */
export function inferParameterName(
  target?: Partial<ElementEvidence>,
  stepIndex: number = 0,
  usedNames: Set<string> = new Set()
): string {
  let baseName = '';

  // 1. Explicit name attribute (e.g. name="country" or name="sampleText")
  if (target?.name) {
    baseName = target.name;
  }
  // 2. Explicit test IDs (e.g. data-testid="shipping-email")
  else if (target?.testIds && Object.keys(target.testIds).length > 0) {
    const firstTestId = Object.values(target.testIds)[0];
    if (firstTestId) baseName = firstTestId;
  }
  // 3. Stable element ID (e.g. id="sample-text")
  else if (target?.id && !target.id.match(/^ember\d+|^react-aria-|^vue-|\d{5,}/)) {
    baseName = target.id;
  }
  // 4. Accessible Name or Aria Label
  else if (target?.accessibleName || target?.ariaLabel) {
    baseName = target.accessibleName || target.ariaLabel || '';
  }
  // 5. Fallback
  else {
    baseName = `param_${stepIndex + 1}`;
  }

  // Convert to clean camelCase
  let normalized = toCamelCase(baseName);

  // Strip redundant common UI suffixes if appropriate (e.g., -select, -input)
  if (normalized.endsWith('Select') && normalized.length > 6) {
    normalized = normalized.slice(0, -6);
  } else if (normalized.endsWith('Input') && normalized.length > 5) {
    normalized = normalized.slice(0, -5);
  }

  // Ensure unique variable name
  let finalName = normalized;
  let counter = 2;
  while (usedNames.has(finalName)) {
    finalName = `${normalized}_${counter++}`;
  }

  return finalName;
}

function toCamelCase(str: string): string {
  if (/^[a-z][a-zA-Z0-9]*$/.test(str)) {
    return str;
  }

  const words = str
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .trim()
    .split(/[\s_\-]+/)
    .filter(Boolean);

  if (words.length === 0) return 'input';

  return words
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/**
 * Detects consecutive repeating step sequences (loops) within synthesized steps.
 */
export function detectRepeatedPatterns(steps: WorkflowStep[]): DetectedLoop[] {
  const loops: DetectedLoop[] = [];
  const n = steps.length;
  if (n < 2) return loops;

  const signatures = steps.map((s) => {
    const targetKey =
      s.action && 'target' in s.action && s.action.target
        ? s.action.target.testId || s.action.target.css || s.action.target.name || s.action.target.role || ''
        : '';
    return `${s.action.type}(${targetKey})`;
  });

  for (let len = 1; len <= Math.floor(n / 2); len++) {
    for (let start = 0; start <= n - 2 * len; start++) {
      const pattern = signatures.slice(start, start + len);
      let reps = 1;

      while (start + (reps + 1) * len <= n) {
        const nextSlice = signatures.slice(start + reps * len, start + (reps + 1) * len);
        const matches = pattern.every((sig, idx) => sig === nextSlice[idx]);
        if (!matches) break;
        reps++;
      }

      if (reps >= 2) {
        const stepIds = steps.slice(start, start + reps * len).map((s) => s.id);
        loops.push({
          pattern,
          repetitions: reps,
          startIndex: start,
          endIndex: start + reps * len - 1,
          stepIds,
        });
        start += reps * len - 1;
      }
    }
  }

  return loops;
}

/**
 * Synthesizes a generalized WorkflowIR from multiple demonstration traces.
 */
export class MultiTraceGeneralizer {
  private scoringSystem = new LocatorScoringSystem();

  generalize(request: MultiTraceSynthesisRequest): GeneralizedWorkflowResult {
    const { traces, workflowName = 'generalized-workflow', workflowDescription } = request;

    if (!traces || traces.length === 0) {
      throw new Error('At least one demonstration trace is required for generalization.');
    }

    // 1. Needleman-Wunsch Progressive Sequence Alignment
    const alignment = alignMultiTraceSequences(traces);

    const inputs: Record<string, WorkflowInput> = {};
    const steps: WorkflowStep[] = [];
    const usedParamNames = new Set<string>();
    const parameterizedInputs: string[] = [];
    const constantInvariants: string[] = [];
    const branchSteps: string[] = [];

    // 2. Synthesize steps across aligned columns
    for (let colIdx = 0; colIdx < alignment.columns.length; colIdx++) {
      const col = alignment.columns[colIdx];
      const nonNullSteps = col.steps.filter((s): s is SemanticTraceStep => s !== null);
      if (nonNullSteps.length === 0) continue;

      const repStep = nonNullSteps[0];
      const stepId = `step-${colIdx + 1}`;
      const isOptional = col.isOptional;

      if (isOptional) {
        branchSteps.push(stepId);
      }

      // Ranked locator and container scope
      const ranked = this.scoringSystem.rankCandidates(col.target || repStep.target);
      const containerScope = ranked[0]?.containerScope;
      const target = buildWorkflowTarget(col.target || repStep.target, containerScope);

      switch (repStep.action) {
        case 'navigate': {
          const urls = nonNullSteps.map(
            (s) => (s.payload?.url as string) || (s.value as string) || 'http://localhost:3000'
          );
          const allUrlsIdentical = urls.every((u) => u === urls[0]);

          if (allUrlsIdentical) {
            steps.push({
              id: stepId,
              intent: `Navigate to ${urls[0]}`,
              action: { type: 'navigate', url: urls[0] },
              optional: isOptional,
              confidence: 'high',
            });
            constantInvariants.push(`${stepId}:url`);
          } else {
            const paramName = inferParameterName(undefined, colIdx, usedParamNames);
            usedParamNames.add(paramName);
            inputs[paramName] = {
              type: 'string',
              description: 'Navigation Target URL',
              default: urls[0],
              required: !isOptional,
            };
            steps.push({
              id: stepId,
              intent: `Navigate to input URL`,
              action: { type: 'navigate', url: urls[0] },
              optional: isOptional,
              confidence: 'high',
            });
            parameterizedInputs.push(paramName);
          }
          break;
        }

        case 'fill':
        case 'selectOption':
        case 'uploadFile': {
          const rawValues = nonNullSteps.map((s) => s.value);
          const hasSecret = rawValues.some(
            (v) => isRedactedValue(v) || repStep.target?.type === 'password'
          );

          let valueObj: WorkflowValue;

          if (hasSecret) {
            const secretRef = repStep.target?.name
              ? `${repStep.target.name}_secret`
              : 'secret_credentials';
            valueObj = { secret: secretRef };
          } else {
            const strValues = rawValues.map((v) =>
              v !== undefined && v !== null ? (typeof v === 'string' ? v : String(v)) : ''
            );
            const isAllEqual = strValues.every((v) => v === strValues[0]);

            if (isAllEqual && strValues.length > 0) {
              valueObj = { constant: strValues[0] };
              constantInvariants.push(`${stepId}:${strValues[0]}`);
            } else {
              const paramName = inferParameterName(repStep.target, colIdx, usedParamNames);
              usedParamNames.add(paramName);
              inputs[paramName] = {
                type: 'string',
                description:
                  repStep.target?.accessibleName || repStep.target?.ariaLabel || paramName,
                default: strValues[0],
                required: !isOptional,
              };
              valueObj = { input: paramName };
              parameterizedInputs.push(paramName);
            }
          }

          let actionObj: any;
          if (repStep.action === 'fill') {
            actionObj = { type: 'fill', target, value: valueObj };
          } else if (repStep.action === 'selectOption') {
            actionObj = { type: 'selectOption', target, value: valueObj };
          } else {
            actionObj = { type: 'uploadFile', target, value: valueObj };
          }

          steps.push({
            id: stepId,
            intent: `${repStep.action} ${
              repStep.target?.accessibleName || repStep.target?.id || 'element'
            }`,
            action: actionObj,
            optional: isOptional,
            confidence: 'high',
          });
          break;
        }

        case 'check':
        case 'uncheck': {
          const actionType = repStep.action;
          let condition: WorkflowStep['condition'];

          if (isOptional) {
            const paramName = inferParameterName(repStep.target, colIdx, usedParamNames);
            usedParamNames.add(paramName);
            inputs[paramName] = {
              type: 'boolean',
              description: `${actionType === 'check' ? 'Check' : 'Uncheck'} ${
                repStep.target?.accessibleName || repStep.target?.id || paramName
              }`,
              default: false,
              required: false,
            };
            condition = { input: paramName, equals: true };
            parameterizedInputs.push(paramName);
          }

          steps.push({
            id: stepId,
            intent: `${actionType} ${
              repStep.target?.accessibleName || repStep.target?.id || 'checkbox'
            }`,
            action: { type: actionType, target },
            optional: isOptional,
            condition,
            confidence: 'high',
          });
          break;
        }

        case 'click': {
          let condition: WorkflowStep['condition'];
          if (isOptional) {
            condition = { elementVisible: target };
          }

          steps.push({
            id: stepId,
            intent: `Click ${repStep.target?.accessibleName || repStep.target?.id || 'element'}`,
            action: { type: 'click', target },
            optional: isOptional,
            condition,
            confidence: 'high',
          });
          break;
        }

        case 'drag': {
          const source = repStep.payload?.source
            ? buildWorkflowTarget(repStep.payload.source as ElementEvidence)
            : target;
          const destination = repStep.payload?.destination
            ? buildWorkflowTarget(repStep.payload.destination as ElementEvidence)
            : { css: '#drop-zone' };

          steps.push({
            id: stepId,
            intent: 'Drag and drop item',
            action: { type: 'drag', source, destination },
            optional: isOptional,
            confidence: 'high',
          });
          break;
        }

        default: {
          steps.push({
            id: stepId,
            intent: `Interact with ${repStep.target?.accessibleName || 'element'}`,
            action: { type: 'click', target },
            optional: isOptional,
            confidence: 'high',
          });
        }
      }
    }

    // 3. Postconditions
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.action.type === 'navigate') {
        const urlStr = step.action.url;
        try {
          const parsed = new URL(urlStr);
          step.postcondition = {
            urlMatches: `.*${parsed.pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`,
          };
        } catch {
          // ignore invalid URLs
        }
      }
    }

    // 4. Detect Loops
    const detectedLoops = detectRepeatedPatterns(steps);

    // 5. Construct & Validate Canonical WorkflowIR
    const ir: WorkflowIR = {
      version: '0.1',
      name: workflowName,
      description: workflowDescription || `Synthesized from ${traces.length} demonstrations`,
      inputs,
      steps,
    };

    const validation = validateWorkflowIR(ir);
    if (!validation.valid) {
      throw new Error(`Synthesized WorkflowIR failed validation: ${validation.errors.join(', ')}`);
    }

    return {
      ir,
      alignment,
      parameterizedInputs,
      constantInvariants,
      branchSteps,
      detectedLoops,
    };
  }
}
