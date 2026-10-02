import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { startFixtureServer, type FixtureServerInstance } from '@trace2code/test-fixtures';
import type { WorkflowIR } from '@trace2code/workflow-ir';
import { createApiServer, type ApiServerInstance } from '../src/server.js';

describe('Milestone 9: Remote Worker and Deployment E2E', () => {
  let fixtureServer: FixtureServerInstance;
  let apiServer: ApiServerInstance;

  beforeAll(async () => {
    fixtureServer = await startFixtureServer(0);
    const apiFactory = createApiServer();
    apiServer = await apiFactory.start(0);
  });

  afterAll(async () => {
    await apiServer.close();
    await fixtureServer.close();
  });

  let workflowId: string;

  it('1. registers a workflow definition via POST /workflows', async () => {
    const validIR: WorkflowIR = {
      version: '0.1',
      name: 'remote-e2e-workflow',
      description: 'End-to-end remote execution demonstration',
      inputs: {
        userName: { type: 'string', description: 'Name parameter', required: true },
      },
      steps: [
        {
          id: 'step-1',
          intent: 'Navigate to fixture server',
          action: { type: 'navigate', url: fixtureServer.url },
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
          confidence: 'high',
        },
        {
          id: 'step-3',
          intent: 'Click button',
          action: {
            type: 'click',
            target: { testId: 'sample-button', role: 'button', name: 'Click Me' },
          },
          confidence: 'high',
        },
      ],
    };

    const res = await fetch(`${apiServer.url}/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ir: validIR }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('remote-e2e-workflow');
    workflowId = body.id;

    // Verify GET /workflows/:id
    const getRes = await fetch(`${apiServer.url}/workflows/${workflowId}`);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.id).toBe(workflowId);
  });

  it('2. dispatches run, executes via worker in isolated browser, polls status, and retrieves success artifacts', async () => {
    // Dispatch run
    const dispatchRes = await fetch(`${apiServer.url}/workflows/${workflowId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: { userName: 'Ada Lovelace' } }),
    });

    expect(dispatchRes.status).toBe(202);
    const dispatchBody = await dispatchRes.json();
    const runId = dispatchBody.id;
    expect(runId).toBeDefined();

    // Poll until completed
    let runStatus = 'running';
    let runResult: any = null;
    const startTime = Date.now();

    while (runStatus === 'running' || runStatus === 'queued') {
      if (Date.now() - startTime > 15000) {
        throw new Error('Test timed out polling run status');
      }
      await new Promise((r) => setTimeout(r, 200));

      const pollRes = await fetch(`${apiServer.url}/runs/${runId}`);
      expect(pollRes.status).toBe(200);
      runResult = await pollRes.json();
      runStatus = runResult.status;
    }

    expect(runStatus).toBe('completed');
    expect(runResult.durationMs).toBeGreaterThan(0);
    expect(runResult.logs.length).toBeGreaterThan(0);
    expect(runResult.artifacts.length).toBeGreaterThan(0);

    // Verify artifact manifest GET /runs/:id/artifacts
    const artifactsRes = await fetch(`${apiServer.url}/runs/${runId}/artifacts`);
    expect(artifactsRes.status).toBe(200);
    const artifactsBody = await artifactsRes.json();
    expect(artifactsBody.artifacts.some((a: string) => a.includes('screenshot_success.png'))).toBe(true);

    // Verify artifact file download GET /runs/:id/artifacts/screenshot_success.png
    const fileRes = await fetch(`${apiServer.url}/runs/${runId}/artifacts/screenshot_success.png`);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('content-type')).toBe('image/png');
    const imageBytes = await fileRes.arrayBuffer();
    expect(imageBytes.byteLength).toBeGreaterThan(1000);
  });

  it('3. handles intentional failure: reports error diagnostics, captures failure screenshot and DOM dump', async () => {
    // Register workflow with impossible step
    const failingIR: WorkflowIR = {
      version: '0.1',
      name: 'failing-workflow',
      steps: [
        {
          id: 'step-1',
          intent: 'Navigate to fixture server',
          action: { type: 'navigate', url: fixtureServer.url },
          confidence: 'high',
        },
        {
          id: 'step-2',
          intent: 'Click impossible nonexistent element with no recovery',
          action: {
            type: 'click',
            target: { css: '#completely-impossible-never-existed' },
          },
          confidence: 'high',
        },
      ],
    };

    const wfRes = await fetch(`${apiServer.url}/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ir: failingIR }),
    });
    const wfBody = await wfRes.json();
    const failingWfId = wfBody.id;

    // Dispatch run
    const dispatchRes = await fetch(`${apiServer.url}/workflows/${failingWfId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const runBody = await dispatchRes.json();
    const runId = runBody.id;

    // Poll until failed
    let runStatus = 'running';
    let runResult: any = null;
    const startTime = Date.now();

    while (runStatus === 'running' || runStatus === 'queued') {
      if (Date.now() - startTime > 15000) {
        throw new Error('Test timed out polling run status');
      }
      await new Promise((r) => setTimeout(r, 200));

      const pollRes = await fetch(`${apiServer.url}/runs/${runId}`);
      runResult = await pollRes.json();
      runStatus = runResult.status;
    }

    expect(runStatus).toBe('failed');
    expect(runResult.error).toBeDefined();
    expect(runResult.error).toContain('step-2');

    // Verify failure screenshot captured and accessible via API
    const failScreenshotRes = await fetch(`${apiServer.url}/runs/${runId}/artifacts/screenshot_failure.png`);
    expect(failScreenshotRes.status).toBe(200);
    expect(failScreenshotRes.headers.get('content-type')).toBe('image/png');
    const screenshotBytes = await failScreenshotRes.arrayBuffer();
    expect(screenshotBytes.byteLength).toBeGreaterThan(1000);

    // Verify failure DOM dump captured and accessible via API
    const domDumpRes = await fetch(`${apiServer.url}/runs/${runId}/artifacts/dom_dump_failure.html`);
    expect(domDumpRes.status).toBe(200);
    expect(domDumpRes.headers.get('content-type')).toBe('text/html');
    const domHtml = await domDumpRes.text();
    expect(domHtml).toContain('Trace2Code Deterministic Test Benchmark');
  });
});
