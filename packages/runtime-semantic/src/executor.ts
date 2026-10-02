import type { Page } from 'playwright';
import type { WorkflowIR, WorkflowStep, WorkflowTarget } from '@trace2code/workflow-ir';
import { SemanticRecoveryEngine } from './recovery.js';
import type { ExecutionResult, RecoveryDecision } from './types.js';

export interface ExecutorOptions {
  deterministicTimeoutMs?: number;
  enableRecovery?: boolean;
}

export class RecoverableWorkflowExecutor {
  private recoveryEngine = new SemanticRecoveryEngine();
  private timeoutMs: number;
  private enableRecovery: boolean;

  constructor(options: ExecutorOptions = {}) {
    this.timeoutMs = options.deterministicTimeoutMs ?? 2000;
    this.enableRecovery = options.enableRecovery ?? true;
  }

  /**
   * Executes a workflow with automatic self-healing recovery mode.
   */
  async execute(
    page: Page,
    ir: WorkflowIR,
    inputs: Record<string, any> = {}
  ): Promise<ExecutionResult> {
    const decisions: RecoveryDecision[] = [];
    let stepsExecuted = 0;
    let recoveredSteps = 0;

    for (const step of ir.steps) {
      if (step.condition) {
        if (step.condition.input) {
          const inputVal = inputs[step.condition.input];
          if (step.condition.equals !== undefined) {
            if (inputVal !== step.condition.equals) continue;
          } else if (step.condition.notEquals !== undefined) {
            if (inputVal === step.condition.notEquals) continue;
          } else if (!inputVal) {
            continue;
          }
        }
      } else if (step.optional) {
        if ('value' in step.action && step.action.value && 'input' in step.action.value) {
          if (!inputs[step.action.value.input]) continue;
        }
      }

      try {
        await this.executeStepDeterministically(page, step, inputs);
        stepsExecuted++;
      } catch (detError) {
        if (!this.enableRecovery || !('target' in step.action) || !step.action.target) {
          return {
            success: false,
            stepsExecuted,
            recoveredSteps,
            decisions,
            error: (detError as Error).message,
          };
        }

        // Trigger Recovery Mode
        try {
          const decision = await this.recoveryEngine.attemptRecovery(
            page,
            step,
            step.action.target as WorkflowTarget
          );
          decisions.push(decision);
          recoveredSteps++;
          stepsExecuted++;
        } catch (recError) {
          return {
            success: false,
            stepsExecuted,
            recoveredSteps,
            decisions,
            error: `Deterministic and Recovery modes both failed on ${step.id}: ${(recError as Error).message}`,
          };
        }
      }
    }

    return {
      success: true,
      stepsExecuted,
      recoveredSteps,
      decisions,
    };
  }

  private async executeStepDeterministically(
    page: Page,
    step: WorkflowStep,
    inputs: Record<string, any>
  ): Promise<void> {
    const timeout = this.timeoutMs;

    switch (step.action.type) {
      case 'navigate': {
        await page.goto(step.action.url, { timeout });
        break;
      }

      case 'click': {
        const target = step.action.target;
        const selector = this.resolveSelector(target);
        const locator = page.locator(selector);
        await locator.waitFor({ state: 'visible', timeout });
        await locator.click({ timeout });
        break;
      }

      case 'fill': {
        const target = step.action.target;
        const selector = this.resolveSelector(target);
        const locator = page.locator(selector);
        await locator.waitFor({ state: 'visible', timeout });

        let val = '';
        if ('value' in step.action && step.action.value) {
          if ('input' in step.action.value) val = inputs[step.action.value.input] ?? '';
          else if ('constant' in step.action.value) val = step.action.value.constant;
          else if ('secret' in step.action.value) val = process.env[step.action.value.secret] ?? '';
        }

        await locator.fill(val, { timeout });
        break;
      }

      case 'check': {
        const target = step.action.target;
        const selector = this.resolveSelector(target);
        const locator = page.locator(selector);
        await locator.waitFor({ state: 'visible', timeout });
        await locator.check({ timeout });
        break;
      }

      case 'uncheck': {
        const target = step.action.target;
        const selector = this.resolveSelector(target);
        const locator = page.locator(selector);
        await locator.waitFor({ state: 'visible', timeout });
        await locator.uncheck({ timeout });
        break;
      }

      case 'selectOption': {
        const target = step.action.target;
        const selector = this.resolveSelector(target);
        const locator = page.locator(selector);
        await locator.waitFor({ state: 'visible', timeout });
        let val = 'ca';
        if ('value' in step.action && step.action.value) {
          if ('input' in step.action.value) val = inputs[step.action.value.input] ?? '';
          else if ('constant' in step.action.value) val = step.action.value.constant;
        }
        await (locator as any).selectOption(val, { timeout });
        break;
      }
    }
  }

  private resolveSelector(target: WorkflowTarget): string {
    if (target.testId) return `[data-testid="${target.testId}"]`;
    if (target.css) return target.css;
    if (target.role && target.name) return `[role="${target.role}"][aria-label="${target.name}"]`;
    return 'body';
  }
}
