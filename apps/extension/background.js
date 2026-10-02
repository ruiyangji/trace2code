// Trace2Code Extension Background Service Worker
let state = 'idle'; // idle | recording | paused | stopped
let currentRun = null;
let daemonUrl = 'http://127.0.0.1:4200';
let eventQueue = [];
let isFlushing = false;
let eventCounter = 0;

function createRunId() {
  return 'run_ext_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
}

async function sendEventsToDaemon(events) {
  if (!currentRun || !daemonUrl) return false;
  try {
    const res = await fetch(`${daemonUrl}/api/runs/${currentRun.id}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

async function flushQueue() {
  if (isFlushing || eventQueue.length === 0 || state !== 'recording') return;
  isFlushing = true;

  try {
    while (eventQueue.length > 0 && state === 'recording') {
      const batch = eventQueue.slice(0, 50);
      const success = await sendEventsToDaemon(batch);
      if (!success) {
        break; // Keep in queue if daemon unreachable
      }
      eventQueue.splice(0, batch.length);
    }
  } finally {
    isFlushing = false;
  }
}

// Listen to runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse({
      state,
      runName: currentRun ? currentRun.name : null,
      runId: currentRun ? currentRun.id : null,
      eventCount: eventCounter,
    });
    return true;
  }

  if (message.type === 'START_RECORDING') {
    handleStartRecording(message).then(sendResponse);
    return true;
  }

  if (message.type === 'PAUSE_RECORDING') {
    state = 'paused';
    if (daemonUrl && currentRun) {
      fetch(`${daemonUrl}/api/runs/${currentRun.id}/pause`, { method: 'POST' }).catch(() => {});
    }
    sendResponse({ success: true, state });
    return true;
  }

  if (message.type === 'RESUME_RECORDING') {
    state = 'recording';
    if (daemonUrl && currentRun) {
      fetch(`${daemonUrl}/api/runs/${currentRun.id}/resume`, { method: 'POST' }).catch(() => {});
    }
    flushQueue();
    sendResponse({ success: true, state });
    return true;
  }

  if (message.type === 'STOP_RECORDING') {
    handleStopRecording().then(sendResponse);
    return true;
  }

  if (message.type === 'EMIT_MARK') {
    if (state === 'recording' && currentRun) {
      const markEvent = {
        id: 'evt_mark_' + Date.now(),
        timestampMs: Date.now(),
        tabId: String(sender.tab?.id || 'popup'),
        frameId: 'main',
        type: 'mark',
        payload: {
          kind: message.kind,
          label: message.label,
        },
      };
      eventCounter++;
      eventQueue.push(markEvent);
      flushQueue();
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RAW_EVENT') {
    if (state === 'recording') {
      const raw = message.event;
      raw.tabId = String(sender.tab?.id || 'tab-main');
      eventCounter++;
      eventQueue.push(raw);
      flushQueue();
    }
    sendResponse({ acknowledged: true });
    return true;
  }
});

async function handleStartRecording({ runName, captureMode, daemonUrl: customDaemonUrl }) {
  if (customDaemonUrl) daemonUrl = customDaemonUrl;
  const runId = createRunId();

  currentRun = {
    id: runId,
    name: runName || 'extension-run',
    startedAt: new Date().toISOString(),
    integration: 'extension',
    captureMode: captureMode || 'full',
    browser: {
      name: 'Chrome',
      version: navigator.userAgent,
    },
    config: {
      captureMode: captureMode || 'full',
    },
    tabs: [],
  };

  eventCounter = 0;
  eventQueue = [];

  try {
    const res = await fetch(`${daemonUrl}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentRun),
    });

    if (res.ok) {
      state = 'recording';
      return { success: true, runId, state };
    } else {
      const err = await res.json().catch(() => ({ error: 'Daemon rejected run' }));
      return { success: false, error: err.error || 'Daemon error' };
    }
  } catch (err) {
    // If daemon is not running yet, still allow recording with buffered queue
    state = 'recording';
    return { success: true, runId, state, warning: 'Daemon offline, buffering locally' };
  }
}

async function handleStopRecording() {
  state = 'stopped';
  // Attempt final flush
  await flushQueue();

  let result = { success: true, eventCount: eventCounter, state: 'stopped' };

  if (daemonUrl && currentRun) {
    try {
      const res = await fetch(`${daemonUrl}/api/runs/${currentRun.id}/stop`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        result = { ...result, tracePath: data.tracePath, eventCount: data.eventCount };
      }
    } catch (_) {}
  }

  currentRun = null;
  return result;
}

// WebNavigation monitoring
if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (state === 'recording' && details.frameId === 0) {
      const navEvent = {
        id: 'evt_nav_' + Date.now(),
        timestampMs: Date.now(),
        tabId: String(details.tabId),
        frameId: 'main',
        type: 'navigation',
        payload: {
          url: details.url,
          transitionType: details.transitionType,
          type: 'load',
        },
      };
      eventCounter++;
      eventQueue.push(navEvent);
      flushQueue();
    }
  });
}
