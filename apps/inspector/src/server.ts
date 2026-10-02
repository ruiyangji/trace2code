import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { TraceStore } from '@trace2code/trace-store';
import { distillRawTrace } from '@trace2code/distiller';

export interface InspectorServerOptions {
  port?: number;
  dbPath?: string;
  runsDir?: string;
}

export function createInspectorServer(options: InspectorServerOptions = {}) {
  const port = options.port ?? 0;
  const dbPath = options.dbPath ?? path.resolve(process.cwd(), '.trace2code', 'store.db');
  const runsDir = options.runsDir ?? path.resolve(process.cwd(), '.trace2code', 'runs');
  const store = new TraceStore(dbPath);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /api/runs
    if (pathname === '/api/runs') {
      const runs = store.listRuns();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(runs));
      return;
    }

    // GET /api/runs/:id
    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch) {
      const runId = runMatch[1];
      const run = store.getRun(runId);
      if (!run) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Run ${runId} not found` }));
        return;
      }

      const events = store.getEvents(runId);
      const semanticSteps = distillRawTrace(events);

      // Check for screenshots on disk
      const screenshotDir = path.join(runsDir, runId, 'screenshots');
      let screenshots: string[] = [];
      if (fs.existsSync(screenshotDir)) {
        screenshots = fs.readdirSync(screenshotDir).filter((f) => f.endsWith('.png') || f.endsWith('.jpg'));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ run, events, semanticSteps, screenshots }));
      return;
    }

    // GET /api/screenshots/:runId/:filename
    const shotMatch = pathname.match(/^\/api\/screenshots\/([^/]+)\/([^/]+)$/);
    if (shotMatch) {
      const [, runId, filename] = shotMatch;
      const shotPath = path.join(runsDir, runId, 'screenshots', filename);
      if (fs.existsSync(shotPath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        fs.createReadStream(shotPath).pipe(res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    // Serve HTML dashboard
    if (pathname === '/' || pathname.startsWith('/run/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(INSPECTOR_HTML);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return {
    server,
    store,
    start: async () => {
      await store.init();
      return new Promise<{ url: string; port: number }>((resolve, reject) => {
        server.listen(port, '127.0.0.1', () => {
          const addr = server.address() as AddressInfo;
          const assignedPort = addr.port;
          resolve({ url: `http://127.0.0.1:${assignedPort}`, port: assignedPort });
        });
        server.on('error', reject);
      });
    },
    stop: () =>
      new Promise<void>((resolve, reject) => {
        store.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const INSPECTOR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Trace2Code Run Inspector</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; height: 100vh; }
    header { background: #1e293b; padding: 12px 24px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; }
    h1 { font-size: 18px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
    .select-wrap select { background: #334155; color: white; border: 1px solid #475569; padding: 6px 12px; border-radius: 6px; font-size: 13px; }
    main { display: flex; flex: 1; overflow: hidden; }
    .timeline-col { width: 45%; border-right: 1px solid #334155; display: flex; flex-direction: column; background: #0f172a; }
    .toolbar { padding: 10px 16px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; gap: 8px; align-items: center; }
    .toggle-btn { background: #334155; color: #cbd5e1; border: none; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .toggle-btn.active { background: #0284c7; color: white; }
    .event-list { flex: 1; overflow-y: auto; list-style: none; }
    .event-item { padding: 10px 16px; border-bottom: 1px solid #1e293b; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: background 0.15s; }
    .event-item:hover { background: #1e293b; }
    .event-item.active { background: #0369a1; }
    .type-badge { font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
    .type-click { background: #0284c7; color: white; }
    .type-input, .type-fill { background: #16a34a; color: white; }
    .type-navigation, .type-navigate { background: #9333ea; color: white; }
    .type-change, .type-selectOption { background: #d97706; color: white; }
    .type-pointermove { background: #475569; color: #cbd5e1; }
    .event-info { flex: 1; font-size: 13px; }
    .event-target { font-family: monospace; color: #94a3b8; font-size: 11px; }
    .seq-num { font-size: 11px; color: #64748b; width: 24px; }

    .detail-col { flex: 1; overflow-y: auto; padding: 20px; background: #1e293b; }
    .detail-card { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .detail-title { font-size: 14px; font-weight: 700; color: #38bdf8; margin-bottom: 12px; border-bottom: 1px solid #334155; padding-bottom: 6px; }
    .detail-row { display: flex; margin-bottom: 8px; font-size: 13px; }
    .detail-label { width: 140px; color: #94a3b8; font-weight: 600; }
    .detail-val { flex: 1; color: #f8fafc; word-break: break-all; font-family: monospace; }
    .redaction-tag { background: #dc2626; color: white; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 11px; }
    pre { background: #0b1120; padding: 10px; border-radius: 6px; font-size: 12px; overflow-x: auto; color: #38bdf8; }
    .screenshot-view { max-width: 100%; border: 1px solid #475569; border-radius: 4px; margin-top: 8px; }
  </style>
</head>
<body>
  <header>
    <h1>Trace2Code Inspector</h1>
    <div class="select-wrap">
      <select id="run-select">
        <option value="">-- Select Run --</option>
      </select>
    </div>
  </header>

  <main>
    <div class="timeline-col">
      <div class="toolbar">
        <button id="btn-distilled" class="toggle-btn active">Distilled Steps</button>
        <button id="btn-raw" class="toggle-btn">Raw Events</button>
        <span id="event-stats" style="margin-left: auto; font-size: 11px; color: #94a3b8;"></span>
      </div>
      <ul id="event-list" class="event-list"></ul>
    </div>

    <div class="detail-col">
      <div id="no-selection" style="color: #64748b; text-align: center; margin-top: 60px;">Select an action or event on the left to inspect its evidence</div>
      <div id="selection-panel" style="display: none;">
        <div class="detail-card">
          <div class="detail-title">Action & Interaction Intent</div>
          <div class="detail-row"><span class="detail-label">Action Type:</span><span id="dt-action" class="detail-val"></span></div>
          <div class="detail-row"><span class="detail-label">Timestamp:</span><span id="dt-time" class="detail-val"></span></div>
          <div class="detail-row"><span class="detail-label">Tab / Frame:</span><span id="dt-frame" class="detail-val"></span></div>
          <div class="detail-row"><span class="detail-label">Value:</span><span id="dt-value" class="detail-val"></span></div>
        </div>

        <div class="detail-card">
          <div class="detail-title">Target Element Evidence</div>
          <div class="detail-row"><span class="detail-label">Tag Name:</span><span id="dt-tag" class="detail-val"></span></div>
          <div class="detail-row"><span class="detail-label">Role:</span><span id="dt-role" class="detail-val"></span></div>
          <div class="detail-row"><span class="detail-label">Accessible Name:</span><span id="dt-accname" class="detail-val"></span></div>
          <div class="detail-row"><span class="detail-label">Test IDs:</span><span id="dt-testids" class="detail-val"></span></div>
          <div class="detail-row"><span class="detail-label">CSS Candidates:</span><span id="dt-css" class="detail-val"></span></div>
          <div class="detail-row"><span class="detail-label">XPath:</span><span id="dt-xpath" class="detail-val"></span></div>
          <div class="detail-row"><span class="detail-label">Bounding Rect:</span><span id="dt-rect" class="detail-val"></span></div>
        </div>

        <div class="detail-card">
          <div class="detail-title">Payload & Raw JSON</div>
          <pre id="dt-raw-json"></pre>
        </div>
      </div>
    </div>
  </main>

  <script>
    let currentRunData = null;
    let viewMode = 'distilled'; // 'distilled' | 'raw'
    let selectedItem = null;

    const runSelect = document.getElementById('run-select');
    const eventList = document.getElementById('event-list');
    const eventStats = document.getElementById('event-stats');
    const btnDistilled = document.getElementById('btn-distilled');
    const btnRaw = document.getElementById('btn-raw');
    const selectionPanel = document.getElementById('selection-panel');
    const noSelection = document.getElementById('no-selection');

    btnDistilled.addEventListener('click', () => {
      viewMode = 'distilled';
      btnDistilled.classList.add('active');
      btnRaw.classList.remove('active');
      renderTimeline();
    });

    btnRaw.addEventListener('click', () => {
      viewMode = 'raw';
      btnRaw.classList.add('active');
      btnDistilled.classList.remove('active');
      renderTimeline();
    });

    async function loadRuns() {
      const res = await fetch('/api/runs');
      const runs = await res.json();
      runSelect.innerHTML = '<option value="">-- Select Run --</option>';
      runs.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.innerText = r.name + ' (' + r.captureMode + ' - ' + r.id + ')';
        runSelect.appendChild(opt);
      });
      if (runs.length > 0) {
        runSelect.value = runs[0].id;
        loadRunDetails(runs[0].id);
      }
    }

    runSelect.addEventListener('change', (e) => {
      if (e.target.value) loadRunDetails(e.target.value);
    });

    async function loadRunDetails(runId) {
      const res = await fetch('/api/runs/' + runId);
      currentRunData = await res.json();
      renderTimeline();
    }

    function renderTimeline() {
      if (!currentRunData) return;
      eventList.innerHTML = '';

      const items = viewMode === 'distilled' ? currentRunData.semanticSteps : currentRunData.events;
      eventStats.innerText = items.length + ' ' + (viewMode === 'distilled' ? 'steps' : 'events');

      items.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'event-item';
        if (selectedItem === item) li.classList.add('active');

        const seq = document.createElement('span');
        seq.className = 'seq-num';
        seq.innerText = item.seq;

        const badge = document.createElement('span');
        const actionType = item.action || item.type;
        badge.className = 'type-badge type-' + actionType;
        badge.innerText = actionType;

        const info = document.createElement('div');
        info.className = 'event-info';

        let targetSummary = '';
        if (item.target) {
          targetSummary = (item.target.role || item.target.tagName) + (item.target.accessibleName ? ' "' + item.target.accessibleName + '"' : (item.target.id ? ' #' + item.target.id : ''));
        } else if (item.payload && item.payload.url) {
          targetSummary = item.payload.url;
        }

        info.innerHTML = '<div>' + (item.action || item.type) + '</div><div class="event-target">' + targetSummary + '</div>';

        li.appendChild(seq);
        li.appendChild(badge);
        li.appendChild(info);

        li.addEventListener('click', () => {
          document.querySelectorAll('.event-item').forEach(el => el.classList.remove('active'));
          li.classList.add('active');
          selectedItem = item;
          showDetails(item);
        });

        eventList.appendChild(li);
      });

      if (items.length > 0 && !selectedItem) {
        selectedItem = items[0];
        showDetails(selectedItem);
      }
    }

    function showDetails(item) {
      noSelection.style.display = 'none';
      selectionPanel.style.display = 'block';

      document.getElementById('dt-action').innerText = item.action || item.type;
      document.getElementById('dt-time').innerText = new Date(item.timestampMs).toISOString();
      document.getElementById('dt-frame').innerText = (item.tabId || '') + ' / ' + (item.frameId || 'main');

      const valContainer = document.getElementById('dt-value');
      let val = item.value !== undefined ? item.value : (item.target && item.target.value !== undefined ? item.target.value : (item.payload && item.payload.value));
      if (val && typeof val === 'object' && val.kind === 'redacted') {
        valContainer.innerHTML = '<span class="redaction-tag">[REDACTED: ' + val.reason + ']</span>';
      } else {
        valContainer.innerText = val !== undefined ? String(val) : 'n/a';
      }

      if (item.target) {
        document.getElementById('dt-tag').innerText = item.target.tagName || '';
        document.getElementById('dt-role').innerText = item.target.role || 'none';
        document.getElementById('dt-accname').innerText = item.target.accessibleName || 'none';
        document.getElementById('dt-testids').innerText = JSON.stringify(item.target.testIds || {});
        document.getElementById('dt-css').innerText = (item.target.cssCandidates || []).join(', ') || 'none';
        document.getElementById('dt-xpath').innerText = item.target.xpathCandidate || 'none';
        document.getElementById('dt-rect').innerText = item.target.rect ? (item.target.rect.width + 'x' + item.target.rect.height + ' at (' + item.target.rect.x + ',' + item.target.rect.y + ')') : 'none';
      } else {
        document.getElementById('dt-tag').innerText = 'none';
        document.getElementById('dt-role').innerText = 'none';
        document.getElementById('dt-accname').innerText = 'none';
        document.getElementById('dt-testids').innerText = '{}';
        document.getElementById('dt-css').innerText = 'none';
        document.getElementById('dt-xpath').innerText = 'none';
        document.getElementById('dt-rect').innerText = 'none';
      }

      document.getElementById('dt-raw-json').innerText = JSON.stringify(item, null, 2);
    }

    loadRuns();
  </script>
</body>
</html>
`;
