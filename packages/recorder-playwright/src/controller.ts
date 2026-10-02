import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from 'playwright';
import {
  type RecordingRun,
  type RecordingConfig,
  type RecordingConfigInput,
  type RawTraceEvent,
  RecordingConfigSchema,
  serializeRunHeader,
  serializeTraceEvent,
} from '@trace2code/protocol';
import {
  EventSequenceBuffer,
  RedactionEngine,
  buildInPageInstrumentationScript,
} from '@trace2code/recorder-core';
import { OnlineDistiller } from '@trace2code/distiller';

export interface RecorderOptions {
  runId?: string;
  name?: string;
  url?: string;
  config?: RecordingConfigInput;
  outputDir?: string;
  headless?: boolean;
}

export class PlaywrightRecorder {
  private runId: string;
  private name: string;
  private config: RecordingConfig;
  private outputDir: string;
  private headless: boolean;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private buffer: EventSequenceBuffer;
  private redactionEngine: RedactionEngine;
  private distiller: OnlineDistiller | null = null;
  private runMetadata: RecordingRun | null = null;

  private pageToTabId = new Map<Page, string>();
  private tabCounter = 1;
  private traceStream: fs.WriteStream | null = null;
  private screenshotDir: string;
  private screenshotIndex = 0;
  private cdpSessions: CDPSession[] = [];

  constructor(options: RecorderOptions = {}) {
    this.runId = options.runId || `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.name = options.name || 'unnamed-run';
    this.config = RecordingConfigSchema.parse(options.config || { captureMode: 'full' });
    this.headless = options.headless ?? true;
    this.outputDir = options.outputDir || path.resolve(process.cwd(), '.trace2code', 'runs', this.runId);
    this.screenshotDir = path.join(this.outputDir, 'screenshots');

    this.buffer = new EventSequenceBuffer(this.runId);
    this.redactionEngine = new RedactionEngine(this.config.privacy);
    if (this.config.captureMode === 'distilled') {
      this.distiller = new OnlineDistiller();
    }
  }

  async start(initialUrl?: string): Promise<{ run: RecordingRun; page: Page }> {
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    const traceFilePath = path.join(this.outputDir, 'trace.jsonl');
    this.traceStream = fs.createWriteStream(traceFilePath, { flags: 'w', encoding: 'utf-8' });

    this.browser = await chromium.launch({
      headless: this.headless,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: undefined,
    });

    const browserVersion = this.browser.version();
    this.runMetadata = {
      id: this.runId,
      name: this.name,
      startedAt: new Date().toISOString(),
      integration: 'controller',
      captureMode: this.config.captureMode,
      browser: {
        name: 'Chromium',
        version: browserVersion,
        viewport: { width: 1280, height: 720 },
      },
      config: this.config,
      tabs: [],
    };

    // Write header to trace stream
    this.traceStream.write(serializeRunHeader(this.runMetadata) + '\n');

    // Subscribe stream writer to buffer events
    this.buffer.subscribe((event) => {
      if (this.traceStream && !this.traceStream.destroyed) {
        this.traceStream.write(serializeTraceEvent(event) + '\n');
      }
    });

    // Expose binding for in-page script
    await this.context.exposeBinding('__trace2code_emit', async ({ page, frame }, dataStr: string) => {
      try {
        const parsed = JSON.parse(dataStr);
        const tabId = this.pageToTabId.get(page) || 'tab-main';
        const frameId = frame ? frame.name() || frame.url() || 'frame-anon' : 'main';

        // Check if value needs server-side redaction check
        if (parsed.target) {
          if (this.redactionEngine.isSensitiveElement(parsed.target)) {
            parsed.target.value = this.redactionEngine.redactElementValue(parsed.target.value);
          }
        }

        const candidateEvent: RawTraceEvent = {
          id: parsed.id,
          runId: this.runId,
          seq: 0,
          timestampMs: parsed.timestampMs || Date.now(),
          tabId,
          frameId,
          type: parsed.type,
          payload: parsed.payload,
          target: parsed.target,
        };

        if (this.distiller) {
          const distilled = this.distiller.process(candidateEvent);
          for (const evt of distilled) {
            this.buffer.enqueue(evt);
          }
        } else {
          this.buffer.enqueue(candidateEvent);
        }

        // Screenshot capture strategy
        if (this.config.screenshots.enabled && this.config.screenshots.strategy === 'all-actions') {
          if (['click', 'change', 'navigation'].includes(parsed.type)) {
            await this.captureScreenshot(page, parsed.type);
          }
        }
      } catch (err) {
        console.error('[PlaywrightRecorder] Error handling in-page event:', err);
      }
    });

    // Inject in-page instrumentation script
    const initScriptContent = buildInPageInstrumentationScript({
      sampleHz: this.config.pointerMove?.sampleHz ?? 20,
      capturePointerMove: this.config.captureMode === 'full',
    });
    await this.context.addInitScript(initScriptContent);

    // Track pages (tabs)
    this.context.on('page', async (newPage) => {
      await this.setupPageTracking(newPage);
    });

    // Setup initial page
    const page = await this.context.newPage();
    await this.setupPageTracking(page);

    if (initialUrl) {
      await page.goto(initialUrl, { waitUntil: 'domcontentloaded' });
    }

    return { run: this.runMetadata, page };
  }

  private async setupPageTracking(page: Page): Promise<string> {
    const tabId = `tab-${this.tabCounter++}`;
    this.pageToTabId.set(page, tabId);

    if (this.runMetadata) {
      this.runMetadata.tabs.push({
        id: tabId,
        url: page.url(),
        title: await page.title().catch(() => ''),
        createdAtMs: Date.now(),
      });
    }

    // CDP Network instrumentation if enabled
    if (this.config.network.enabled) {
      try {
        const cdp = await page.context().newCDPSession(page);
        this.cdpSessions.push(cdp);
        await cdp.send('Network.enable');

        cdp.on('Network.requestWillBeSent', (params) => {
          const headers = (params.request.headers || {}) as Record<string, string>;
          const sanitizedHeaders = this.redactionEngine.sanitizeHeaders(headers);

          this.buffer.enqueue({
            id: `net_req_${params.requestId}`,
            timestampMs: Date.now(),
            tabId,
            frameId: 'main',
            type: 'network',
            payload: {
              requestId: params.requestId,
              url: params.request.url,
              method: params.request.method,
              requestHeaders: sanitizedHeaders,
              resourceType: params.type,
            },
          });
        });

        cdp.on('Network.responseReceived', (params) => {
          const headers = (params.response.headers || {}) as Record<string, string>;
          const sanitizedHeaders = this.redactionEngine.sanitizeHeaders(headers);

          this.buffer.enqueue({
            id: `net_res_${params.requestId}`,
            timestampMs: Date.now(),
            tabId,
            frameId: 'main',
            type: 'network',
            payload: {
              requestId: params.requestId,
              url: params.response.url,
              status: params.response.status,
              responseHeaders: sanitizedHeaders,
            },
          });
        });
      } catch (err) {
        // CDP session may not be available on all targets
      }
    }

    // Page navigation tracking
    page.on('load', async () => {
      this.buffer.enqueue({
        id: `evt_nav_${Date.now()}`,
        timestampMs: Date.now(),
        tabId,
        frameId: 'main',
        type: 'navigation',
        payload: {
          url: page.url(),
          type: 'load',
        },
      });

      if (this.config.screenshots.enabled) {
        await this.captureScreenshot(page, 'navigation');
      }
    });

    page.on('close', () => {
      this.buffer.enqueue({
        id: `evt_close_${Date.now()}`,
        timestampMs: Date.now(),
        tabId,
        frameId: 'main',
        type: 'page-state',
        payload: { state: 'closed' },
      });
      this.pageToTabId.delete(page);
    });

    return tabId;
  }

  async captureScreenshot(page: Page, reason: string): Promise<string | undefined> {
    try {
      const filename = `shot_${String(this.screenshotIndex++).padStart(4, '0')}_${reason}.png`;
      const fullPath = path.join(this.screenshotDir, filename);
      await page.screenshot({ path: fullPath, fullPage: false });
      return fullPath;
    } catch (_) {
      return undefined;
    }
  }

  async stop(): Promise<{ run: RecordingRun; tracePath: string; eventCount: number }> {
    if (this.distiller) {
      const remaining = this.distiller.flush();
      for (const evt of remaining) {
        this.buffer.enqueue(evt);
      }
    }

    if (this.runMetadata) {
      this.runMetadata.endedAt = new Date().toISOString();
    }

    if (this.traceStream) {
      await new Promise<void>((resolve) => {
        this.traceStream!.end(resolve);
      });
    }

    for (const cdp of this.cdpSessions) {
      await cdp.detach().catch(() => {});
    }

    if (this.context) {
      await this.context.close().catch(() => {});
    }

    if (this.browser) {
      await this.browser.close().catch(() => {});
    }

    const tracePath = path.join(this.outputDir, 'trace.jsonl');
    const events = this.buffer.getEvents();

    return {
      run: this.runMetadata!,
      tracePath,
      eventCount: events.length,
    };
  }

  getBuffer(): EventSequenceBuffer {
    return this.buffer;
  }

  getRunMetadata(): RecordingRun | null {
    return this.runMetadata;
  }
}
