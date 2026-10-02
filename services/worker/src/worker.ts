import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { WorkflowIR } from '@trace2code/workflow-ir';
import { RecoverableWorkflowExecutor, type RecoveryDecision } from '@trace2code/runtime-semantic';

export interface WorkflowJob {
  id: string;
  workflowId: string;
  workflowIR: WorkflowIR;
  inputs?: Record<string, any>;
  artifactsDir?: string;
}

export interface JobLogEntry {
  timestampMs: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface WorkflowJobResult {
  jobId: string;
  workflowId: string;
  status: 'completed' | 'failed';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  logs: JobLogEntry[];
  decisions: RecoveryDecision[];
  artifacts: string[];
  error?: string;
}

export class WorkflowWorker {
  private browserInstance: Browser | null = null;

  async getBrowser(): Promise<Browser> {
    if (!this.browserInstance) {
      this.browserInstance = await chromium.launch({ headless: true });
    }
    return this.browserInstance;
  }

  async close(): Promise<void> {
    if (this.browserInstance) {
      await this.browserInstance.close();
      this.browserInstance = null;
    }
  }

  /**
   * Executes a workflow job in an isolated browser context.
   */
  async executeJob(job: WorkflowJob): Promise<WorkflowJobResult> {
    const startTime = Date.now();
    const startedAt = new Date(startTime).toISOString();
    const logs: JobLogEntry[] = [];
    const artifacts: string[] = [];

    const log = (level: 'info' | 'warn' | 'error', message: string) => {
      logs.push({ timestampMs: Date.now(), level, message });
    };

    const artifactsDir =
      job.artifactsDir ||
      path.resolve(process.cwd(), '.trace2code', 'artifacts', job.id);
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    log('info', `Starting workflow job ${job.id} for workflow "${job.workflowIR.name}"`);

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    let decisions: RecoveryDecision[] = [];

    try {
      const executor = new RecoverableWorkflowExecutor({
        deterministicTimeoutMs: 1500,
        enableRecovery: true,
      });

      log('info', `Executing ${job.workflowIR.steps.length} workflow steps...`);
      const execResult = await executor.execute(page, job.workflowIR, job.inputs || {});

      decisions = execResult.decisions;

      if (!execResult.success) {
        throw new Error(execResult.error || 'Execution encountered an unrecoverable step failure');
      }

      log('info', `Execution completed successfully. Steps executed: ${execResult.stepsExecuted}, Recovered: ${execResult.recoveredSteps}`);

      // Capture success screenshot
      const successScreenshotPath = path.join(artifactsDir, 'screenshot_success.png');
      await page.screenshot({ path: successScreenshotPath });
      artifacts.push(successScreenshotPath);

      const endTime = Date.now();
      return {
        jobId: job.id,
        workflowId: job.workflowId,
        status: 'completed',
        startedAt,
        completedAt: new Date(endTime).toISOString(),
        durationMs: endTime - startTime,
        logs,
        decisions,
        artifacts,
      };
    } catch (err: any) {
      log('error', `Execution failed: ${err.message}`);

      // Capture failure screenshot
      try {
        const failureScreenshotPath = path.join(artifactsDir, 'screenshot_failure.png');
        await page.screenshot({ path: failureScreenshotPath });
        artifacts.push(failureScreenshotPath);
      } catch (_) {}

      // Capture failure DOM dump
      try {
        const domDumpPath = path.join(artifactsDir, 'dom_dump_failure.html');
        const content = await page.content();
        fs.writeFileSync(domDumpPath, content, 'utf-8');
        artifacts.push(domDumpPath);
      } catch (_) {}

      const endTime = Date.now();
      return {
        jobId: job.id,
        workflowId: job.workflowId,
        status: 'failed',
        startedAt,
        completedAt: new Date(endTime).toISOString(),
        durationMs: endTime - startTime,
        logs,
        decisions,
        artifacts,
        error: err.message,
      };
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }
}
