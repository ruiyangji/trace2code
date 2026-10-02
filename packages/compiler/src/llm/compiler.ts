import type { WorkflowIR } from '@trace2code/workflow-ir';
import { validateWorkflowIR } from '@trace2code/workflow-ir';
import type { CompilerEvidenceContext, LLMProvider } from './provider.js';
import { DeterministicRuleCompilerProvider } from './provider.js';
import { HallucinationGuard } from './hallucination-guard.js';

export interface CompileRequest extends CompilerEvidenceContext {}

export interface CompileResult {
  valid: boolean;
  ir?: WorkflowIR;
  errors: string[];
  warnings: string[];
  stats: {
    stepCount: number;
    inputCount: number;
    provider: string;
  };
}

export class SemanticCompiler {
  constructor(private provider: LLMProvider = new DeterministicRuleCompilerProvider()) {}

  /**
   * Compiles distilled trace steps and user marks into a validated, grounded WorkflowIR.
   */
  async compile(request: CompileRequest): Promise<CompileResult> {
    const ir = await this.provider.generateWorkflowIR(request);

    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Canonical Workflow IR schema & input reference validation
    const schemaResult = validateWorkflowIR(ir);
    if (!schemaResult.valid) {
      errors.push(...schemaResult.errors);
    }

    // 2. Grounding & Hallucination Guard
    const guardResult = HallucinationGuard.verify(ir, request);
    if (!guardResult.valid) {
      errors.push(...guardResult.violations);
    }

    const isValid = errors.length === 0;

    return {
      valid: isValid,
      ir: isValid ? ir : undefined,
      errors,
      warnings,
      stats: {
        stepCount: ir.steps.length,
        inputCount: Object.keys(ir.inputs || {}).length,
        provider: this.provider.name,
      },
    };
  }
}
