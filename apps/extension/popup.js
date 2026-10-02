// Trace2Code Extension Popup Script
document.addEventListener('DOMContentLoaded', async () => {
  const badge = document.getElementById('status-badge');
  const runNameInput = document.getElementById('run-name');
  const captureModeSelect = document.getElementById('capture-mode');
  const daemonUrlInput = document.getElementById('daemon-url');

  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnPause = document.getElementById('btn-pause');
  const btnResume = document.getElementById('btn-resume');
  const btnMarkStep = document.getElementById('btn-mark-step');
  const btnMarkParam = document.getElementById('btn-mark-param');
  const btnMarkSecret = document.getElementById('btn-mark-secret');
  const statusMsg = document.getElementById('status-msg');

  function updateUI(state, count = 0) {
    badge.className = 'badge badge-' + state;
    badge.innerText = state.toUpperCase();

    btnStart.disabled = state === 'recording' || state === 'paused';
    btnStop.disabled = state === 'idle' || state === 'stopped';
    btnPause.disabled = state !== 'recording';
    btnResume.disabled = state !== 'paused';

    const recordingActive = state === 'recording';
    btnMarkStep.disabled = !recordingActive;
    btnMarkParam.disabled = !recordingActive;
    btnMarkSecret.disabled = !recordingActive;

    if (state === 'recording') {
      statusMsg.innerText = `Recording active (${count} events captured)`;
    } else if (state === 'paused') {
      statusMsg.innerText = `Recording paused. Interactions are not captured.`;
    } else if (state === 'stopped') {
      statusMsg.innerText = `Recording finished and saved to daemon.`;
    } else {
      statusMsg.innerText = `Ready to record demonstration.`;
    }
  }

  // Fetch initial status from background
  try {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      if (response) {
        updateUI(response.state, response.eventCount);
        if (response.runName) runNameInput.value = response.runName;
      }
    });
  } catch (_) {}

  btnStart.addEventListener('click', () => {
    const runName = runNameInput.value.trim() || 'demo-run';
    const captureMode = captureModeSelect.value;
    const daemonUrl = daemonUrlInput.value.trim();

    statusMsg.innerText = 'Starting session...';
    chrome.runtime.sendMessage(
      {
        type: 'START_RECORDING',
        runName,
        captureMode,
        daemonUrl,
      },
      (res) => {
        if (res && res.success) {
          updateUI('recording', 0);
        } else {
          statusMsg.innerText = 'Failed: ' + (res?.error || 'Unknown error');
        }
      }
    );
  });

  btnPause.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' }, (res) => {
      if (res && res.success) updateUI('paused');
    });
  });

  btnResume.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' }, (res) => {
      if (res && res.success) updateUI('recording');
    });
  });

  btnStop.addEventListener('click', () => {
    statusMsg.innerText = 'Stopping session and saving...';
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (res) => {
      if (res && res.success) {
        updateUI('stopped', res.eventCount);
        statusMsg.innerText = `Saved! ${res.eventCount} events at ${res.tracePath || 'daemon'}`;
      } else {
        statusMsg.innerText = 'Stop error: ' + (res?.error || 'failed');
      }
    });
  });

  btnMarkStep.addEventListener('click', () => {
    const label = prompt('Step intent or note:', 'User performed step');
    if (label) {
      chrome.runtime.sendMessage({ type: 'EMIT_MARK', kind: 'step', label });
    }
  });

  btnMarkParam.addEventListener('click', () => {
    const paramName = prompt('Parameter name:', 'searchQuery');
    if (paramName) {
      chrome.runtime.sendMessage({ type: 'EMIT_MARK', kind: 'parameter', label: paramName });
    }
  });

  btnMarkSecret.addEventListener('click', () => {
    const secretName = prompt('Secret field name:', 'apiToken');
    if (secretName) {
      chrome.runtime.sendMessage({ type: 'EMIT_MARK', kind: 'secret', label: secretName });
    }
  });
});
