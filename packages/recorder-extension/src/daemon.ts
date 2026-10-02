import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import {
  type RecordingRun,
  RecordingRunSchema,
  type RawTraceEvent,
  serializeRunHeader,
  serializeTraceEvent,
} from '@trace2code/protocol';
import { EventSequenceBuffer, RedactionEngine } from '@trace2code/recorder-core';
import { OnlineDistiller } from '@trace2code/distiller';
import { RecordingStateMachine } from './state-machine.js';

export interface ExtensionDaemonOptions {
  port?: number;
  outputBaseDir?: string;
}

export class ExtensionDaemon {
  private port: number;
  private outputBaseDir: string;
  private server: http.Server | null = null;
  private stateMachine = new RecordingStateMachine();
  private currentRun: RecordingRun | null = null;
  private buffer: EventSequenceBuffer | null = null;
  private distiller: OnlineDistiller | null = null;
  private traceStream: fs.WriteStream | null = null;
  private redactionEngine = new RedactionEngine();
  private activeRunDir = '';

  constructor(options: ExtensionDaemonOptions = {}) {
    this.port = options.port ?? 0; // 0 = dynamic
    this.outputBaseDir = options.outputBaseDir ?? path.resolve(process.cwd(), '.trace2code', 'runs');
  }

  async start(): Promise<{ url: string; port: number }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Enable CORS for extension requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = req.url || '/';

        try {
          // POST /api/runs
          if (req.method === 'POST' && url === '/api/runs') {
            const body = await this.readJsonBody(req);
            const run = RecordingRunSchema.parse(body);

            this.currentRun = run;
            this.activeRunDir = path.join(this.outputBaseDir, run.id);
            fs.mkdirSync(this.activeRunDir, { recursive: true });

            const traceFilePath = path.join(this.activeRunDir, 'trace.jsonl');
            this.traceStream = fs.createWriteStream(traceFilePath, { flags: 'w', encoding: 'utf-8' });
            this.traceStream.write(serializeRunHeader(run) + '\n');

            this.buffer = new EventSequenceBuffer(run.id);
            if (run.captureMode === 'distilled') {
              this.distiller = new OnlineDistiller();
            } else {
              this.distiller = null;
            }

            this.buffer.subscribe((evt) => {
              if (this.traceStream && !this.traceStream.destroyed) {
                this.traceStream.write(serializeTraceEvent(evt) + '\n');
              }
            });

            this.stateMachine.start(run.id, run.name);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, runId: run.id, state: 'recording' }));
            return;
          }

          // POST /api/runs/:runId/events
          const eventsMatch = url.match(/^\/api\/runs\/([^/]+)\/events$/);
          if (req.method === 'POST' && eventsMatch) {
            const runId = eventsMatch[1];
            if (!this.currentRun || this.currentRun.id !== runId) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Run ${runId} not found or active` }));
              return;
            }

            if (this.stateMachine.getState() === 'paused') {
              // Discard events if paused per spec!
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ accepted: 0, reason: 'paused' }));
              return;
            }

            const body = await this.readJsonBody(req);
            const events: unknown[] = Array.isArray(body) ? body : [body];
            let acceptedCount = 0;

            for (const item of events) {
              const evt = item as Omit<RawTraceEvent, 'seq' | 'runId'>;
              // Redaction sanity check
              if (evt.target && this.redactionEngine.isSensitiveElement(evt.target)) {
                evt.target.value = this.redactionEngine.redactElementValue(evt.target.value);
              }

              if (this.distiller) {
                const distilled = this.distiller.process({
                  ...evt,
                  id: evt.id || `evt_${Date.now()}`,
                  runId,
                  seq: 0,
                  timestampMs: evt.timestampMs || Date.now(),
                  tabId: evt.tabId || 'tab-main',
                  frameId: evt.frameId || 'main',
                });
                for (const d of distilled) {
                  this.buffer?.enqueue(d);
                  acceptedCount++;
                }
              } else {
                this.buffer?.enqueue(evt);
                acceptedCount++;
              }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ accepted: acceptedCount }));
            return;
          }

          // POST /api/runs/:runId/pause
          const pauseMatch = url.match(/^\/api\/runs\/([^/]+)\/pause$/);
          if (req.method === 'POST' && pauseMatch) {
            this.stateMachine.pause();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ state: 'paused' }));
            return;
          }

          // POST /api/runs/:runId/resume
          const resumeMatch = url.match(/^\/api\/runs\/([^/]+)\/resume$/);
          if (req.method === 'POST' && resumeMatch) {
            this.stateMachine.resume();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ state: 'recording' }));
            return;
          }

          // POST /api/runs/:runId/stop
          const stopMatch = url.match(/^\/api\/runs\/([^/]+)\/stop$/);
          if (req.method === 'POST' && stopMatch) {
            this.stateMachine.stop();
            if (this.distiller) {
              const remaining = this.distiller.flush();
              for (const r of remaining) {
                this.buffer?.enqueue(r);
              }
            }

            if (this.currentRun) {
              this.currentRun.endedAt = new Date().toISOString();
            }

            if (this.traceStream) {
              await new Promise<void>((f) => this.traceStream!.end(f));
            }

            const eventCount = this.buffer?.getEvents().length || 0;
            const tracePath = path.join(this.activeRunDir, 'trace.jsonl');

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, tracePath, eventCount, state: 'stopped' }));
            return;
          }

          // GET /api/status
          if (req.method === 'GET' && url === '/api/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                status: 'online',
                state: this.stateMachine.getState(),
                currentRun: this.stateMachine.getMetadata(),
                eventCount: this.buffer?.getEvents().length || 0,
              })
            );
            return;
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Endpoint not found' }));
        } catch (err: unknown) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server!.address() as AddressInfo;
        const port = addr.port;
        const url = `http://127.0.0.1:${port}`;
        resolve({ url, port });
      });

      this.server.on('error', reject);
    });
  }

  private readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (this.traceStream) {
      await new Promise<void>((f) => this.traceStream!.end(f));
    }
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }

  getState(): string {
    return this.stateMachine.getState();
  }

  getBuffer(): EventSequenceBuffer | null {
    return this.buffer;
  }
}
