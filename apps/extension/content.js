// Trace2Code Content Script
(function () {
  if (window.__trace2code_content_installed) return;
  window.__trace2code_content_installed = true;

  const isMainFrame = window === window.top;
  const frameId = isMainFrame ? 'main' : 'frame_' + Math.random().toString(36).substring(2, 7);

  // Inject in-page script to intercept native DOM events
  const scriptEl = document.createElement('script');
  scriptEl.textContent = `
(function() {
  if (window.__trace2code_installed) return;
  window.__trace2code_installed = true;

  var lastPointerMoveTime = 0;
  var lastWheelTime = 0;

  function emit(type, payload, targetEl) {
    try {
      var evidence = targetEl ? extractEvidence(targetEl) : undefined;
      var eventObj = {
        id: 'evt_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now(),
        timestampMs: Date.now(),
        type: type,
        payload: payload || {},
        target: evidence
      };
      window.postMessage({ source: 'trace2code-inpage', event: eventObj }, '*');
    } catch (e) {
      console.error('[Trace2Code Content] Emit error:', e);
    }
  }

  function isPasswordField(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName.toLowerCase() === 'input' && el.type && el.type.toLowerCase() === 'password') return true;
    var name = (el.name || '').toLowerCase();
    var id = (el.id || '').toLowerCase();
    if (name.includes('password') || name.includes('passwd') || id.includes('password') || id.includes('passwd')) return true;
    if (el.getAttribute('data-secret') === 'true') return true;
    return false;
  }

  function extractEvidence(el) {
    if (!el || el === document || el === window) return undefined;
    var tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
    
    var testIds = {};
    ['data-testid', 'data-test', 'data-cy', 'data-qa'].forEach(function(attr) {
      var val = el.getAttribute(attr);
      if (val) testIds[attr] = val;
    });

    var role = el.getAttribute('role') || undefined;
    if (!role) {
      if (tag === 'button') role = 'button';
      else if (tag === 'a' && el.hasAttribute('href')) role = 'link';
      else if (tag === 'input') {
        var inputType = (el.type || 'text').toLowerCase();
        if (inputType === 'checkbox') role = 'checkbox';
        else if (inputType === 'radio') role = 'radio';
        else if (inputType === 'button' || inputType === 'submit') role = 'button';
        else role = 'textbox';
      } else if (tag === 'select') role = 'combobox';
      else if (tag === 'textarea') role = 'textbox';
    }

    var ariaLabel = el.getAttribute('aria-label') || undefined;
    var accessibleName = ariaLabel;
    if (!accessibleName && el.id) {
      var labelFor = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (labelFor) accessibleName = labelFor.innerText.trim();
    }
    if (!accessibleName && (role === 'button' || role === 'link' || tag === 'button' || tag === 'a')) {
      accessibleName = (el.innerText || el.textContent || '').trim();
    }
    if (!accessibleName && el.placeholder) {
      accessibleName = el.placeholder;
    }

    var cssCandidates = [];
    if (el.id) cssCandidates.push('#' + CSS.escape(el.id));
    for (var k in testIds) {
      cssCandidates.push('[' + k + '="' + CSS.escape(testIds[k]) + '"]');
    }
    if (el.name) {
      cssCandidates.push(tag + '[name="' + CSS.escape(el.name) + '"]');
    }

    var rect;
    try {
      var r = el.getBoundingClientRect();
      rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    } catch (_) {}

    var val = undefined;
    if ('value' in el) {
      if (isPasswordField(el)) {
        val = { kind: 'redacted', reason: 'password-field' };
      } else {
        val = String(el.value);
      }
    }

    return {
      tagName: tag,
      role: role,
      accessibleName: accessibleName || undefined,
      ariaLabel: ariaLabel,
      text: (el.innerText || el.textContent || '').trim().substring(0, 100) || undefined,
      value: val,
      id: el.id || undefined,
      name: el.name || undefined,
      type: el.type || undefined,
      testIds: testIds,
      cssCandidates: cssCandidates,
      rect: rect
    };
  }

  document.addEventListener('pointerdown', function(e) {
    emit('pointerdown', { button: e.button, x: e.clientX, y: e.clientY }, e.target);
  }, true);

  document.addEventListener('pointerup', function(e) {
    emit('pointerup', { button: e.button, x: e.clientX, y: e.clientY }, e.target);
  }, true);

  document.addEventListener('click', function(e) {
    emit('click', { button: e.button, x: e.clientX, y: e.clientY }, e.target);
  }, true);

  document.addEventListener('dblclick', function(e) {
    emit('dblclick', { button: e.button, x: e.clientX, y: e.clientY }, e.target);
  }, true);

  document.addEventListener('wheel', function(e) {
    var now = Date.now();
    if (now - lastWheelTime >= 100) {
      lastWheelTime = now;
      emit('wheel', { deltaX: e.deltaX, deltaY: e.deltaY }, e.target);
    }
  }, true);

  document.addEventListener('keydown', function(e) {
    var key = isPasswordField(e.target) ? '[REDACTED]' : e.key;
    emit('keydown', { key: key, code: e.code }, e.target);
  }, true);

  document.addEventListener('keyup', function(e) {
    var key = isPasswordField(e.target) ? '[REDACTED]' : e.key;
    emit('keyup', { key: key, code: e.code }, e.target);
  }, true);

  document.addEventListener('input', function(e) {
    var data = isPasswordField(e.target) ? '[REDACTED]' : e.data;
    emit('input', { data: data }, e.target);
  }, true);

  document.addEventListener('change', function(e) {
    var val = isPasswordField(e.target) ? '[REDACTED]' : (e.target && 'value' in e.target ? e.target.value : undefined);
    emit('change', { value: val, checked: e.target ? e.target.checked : undefined }, e.target);
  }, true);

  document.addEventListener('focus', function(e) {
    emit('focus', {}, e.target);
  }, true);

  document.addEventListener('blur', function(e) {
    emit('blur', {}, e.target);
  }, true);

  // SPA navigation hooks
  var originalPushState = history.pushState;
  history.pushState = function(state, title, url) {
    var res = originalPushState.apply(this, arguments);
    emit('navigation', { url: window.location.href, type: 'spa-pushState' });
    return res;
  };

  var originalReplaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    var res = originalReplaceState.apply(this, arguments);
    emit('navigation', { url: window.location.href, type: 'spa-replaceState' });
    return res;
  };

  window.addEventListener('popstate', function() {
    emit('navigation', { url: window.location.href, type: 'spa-popstate' });
  });

  window.addEventListener('hashchange', function() {
    emit('navigation', { url: window.location.href, type: 'hashchange' });
  });
})();
`;

  try {
    (document.head || document.documentElement).appendChild(scriptEl);
    scriptEl.remove();
  } catch (err) {
    console.error('[Trace2Code] Script injection failed:', err);
  }

  // Forward events to background service worker
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'trace2code-inpage') {
      return;
    }

    const payload = event.data.event;
    payload.frameId = frameId;

    try {
      chrome.runtime.sendMessage({
        type: 'RAW_EVENT',
        event: payload,
      });
    } catch (_) {
      // Background worker might be reloading
    }
  });
})();
