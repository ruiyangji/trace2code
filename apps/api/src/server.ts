import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { WorkflowIR } from '@trace2code/workflow-ir';
import { validateWorkflowIR } from '@trace2code/workflow-ir';
import { WorkflowWorker, type WorkflowJobResult } from '@trace2code/worker';

export interface WorkflowRecord {
  id: string;
  name: string;
  description?: string;
  ir: WorkflowIR;
  createdAt: string;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  inputs: Record<string, any>;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  logs?: any[];
  decisions?: any[];
  artifacts?: string[];
  error?: string;
}

export interface ApiServerInstance {
  url: string;
  port: number;
  close: () => Promise<void>;
  worker: WorkflowWorker;
}

export function createApiServer(workerInstance?: WorkflowWorker): {
  start: (port?: number) => Promise<ApiServerInstance>;
} {
  const workflows = new Map<string, WorkflowRecord>();
  const runs = new Map<string, RunRecord>();
  const worker = workerInstance || new WorkflowWorker();

  const parseBody = (req: IncomingMessage): Promise<any> => {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  };

  const sendJson = (res: ServerResponse, status: number, body: any) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(body));
  };

  return {
    start(requestedPort = 0): Promise<ApiServerInstance> {
      return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
          const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
          const pathname = parsedUrl.pathname;
          const method = req.method?.toUpperCase();

          if (method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
            });
            return res.end();
          }

          // POST /workflows
          if (pathname === '/workflows' && method === 'POST') {
            try {
              const body = await parseBody(req);
              const ir = body.ir || body;
              const validation = validateWorkflowIR(ir);
              if (!validation.valid) {
                return sendJson(res, 400, { error: 'Invalid WorkflowIR', details: validation.errors });
              }

              const id = body.id || `wf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              const record: WorkflowRecord = {
                id,
                name: ir.name,
                description: ir.description,
                ir: validation.data || ir,
                createdAt: new Date().toISOString(),
              };

              workflows.set(id, record);
              return sendJson(res, 201, record);
            } catch (err: any) {
              return sendJson(res, 400, { error: err.message });
            }
          }

          // GET /workflows/:id
          const wfMatch = pathname.match(/^\/workflows\/([^/]+)$/);
          if (wfMatch && method === 'GET') {
            const id = wfMatch[1];
            const wf = workflows.get(id);
            if (!wf) return sendJson(res, 404, { error: 'Workflow not found' });
            return sendJson(res, 200, wf);
          }

          // POST /workflows/:id/runs
          const runMatch = pathname.match(/^\/workflows\/([^/]+)\/runs$/);
          if (runMatch && method === 'POST') {
            const workflowId = runMatch[1];
            const wf = workflows.get(workflowId);
            if (!wf) return sendJson(res, 404, { error: 'Workflow not found' });

            const body = await parseBody(req);
            const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

            const runRecord: RunRecord = {
              id: runId,
              workflowId,
              status: 'running',
              inputs: body.inputs || {},
              startedAt: new Date().toISOString(),
            };
            runs.set(runId, runRecord);

            // Execute in background via Worker
            (async () => {
              try {
                const jobResult = await worker.executeJob({
                  id: runId,
                  workflowId,
                  workflowIR: wf.ir,
                  inputs: runRecord.inputs,
                });

                runRecord.status = jobResult.status;
                runRecord.completedAt = jobResult.completedAt;
                runRecord.durationMs = jobResult.durationMs;
                runRecord.logs = jobResult.logs;
                runRecord.decisions = jobResult.decisions;
                runRecord.artifacts = jobResult.artifacts;
                runRecord.error = jobResult.error;
              } catch (execErr: any) {
                runRecord.status = 'failed';
                runRecord.completedAt = new Date().toISOString();
                runRecord.error = execErr.message;
              }
            })();

            return sendJson(res, 202, runRecord);
          }

          // GET /runs/:id
          const runGetMatch = pathname.match(/^\/runs\/([^/]+)$/);
          if (runGetMatch && method === 'GET') {
            const runId = runGetMatch[1];
            const run = runs.get(runId);
            if (!run) return sendJson(res, 404, { error: 'Run not found' });
            return sendJson(res, 200, run);
          }

          // GET /runs/:id/artifacts
          const artifactMatch = pathname.match(/^\/runs\/([^/]+)\/artifacts$/);
          if (artifactMatch && method === 'GET') {
            const runId = artifactMatch[1];
            const run = runs.get(runId);
            if (!run) return sendJson(res, 404, { error: 'Run not found' });

            return sendJson(res, 200, {
              runId,
              artifacts: run.artifacts || [],
            });
          }

          // GET /runs/:id/artifacts/:filename
          const artifactFileMatch = pathname.match(/^\/runs\/([^/]+)\/artifacts\/([^/]+)$/);
          if (artifactFileMatch && method === 'GET') {
            const [_, runId, filename] = artifactFileMatch;
            const run = runs.get(runId);
            if (!run) return sendJson(res, 404, { error: 'Run not found' });

            const targetFile = (run.artifacts || []).find((a) => path.basename(a) === filename);
            if (!targetFile || !fs.existsSync(targetFile)) {
              return sendJson(res, 404, { error: 'Artifact file not found' });
            }

            const contentType = filename.endsWith('.png')
              ? 'image/png'
              : filename.endsWith('.html')
              ? 'text/html'
              : 'application/octet-stream';

            const fileBytes = fs.readFileSync(targetFile);
            res.writeHead(200, { 'Content-Type': contentType });
            return res.end(fileBytes);
          }

          return sendJson(res, 404, { error: 'Not Found' });
        });

        server.listen(requestedPort, '127.0.0.1', () => {
          const addr = server.address() as AddressInfo;
          const port = addr.port;
          const url = `http://127.0.0.1:${port}`;

          resolve({
            url,
            port,
            worker,
            close: () =>
              new Promise<void>((done, fail) => {
                worker.close().finally(() => {
                  server.close((err) => (err ? fail(err) : done()));
                });
              }),
          });
        });

        server.on('error', reject);
      });
    },
  };
}
