export interface InPageScriptOptions {
  sampleHz?: number;
  capturePointerMove?: boolean;
}

export function buildInPageInstrumentationScript(options: InPageScriptOptions = {}): string {
  const sampleHz = options.sampleHz ?? 20;
  const capturePointerMove = options.capturePointerMove ?? true;
  const throttleMs = Math.floor(1000 / sampleHz);

  return `
(function() {
  if (window.__trace2code_installed) return;
  window.__trace2code_installed = true;

  var throttleMs = ${throttleMs};
  var capturePointerMove = ${capturePointerMove};
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

      if (typeof window.__trace2code_emit === 'function') {
        window.__trace2code_emit(JSON.stringify(eventObj));
      } else {
        window.postMessage({ source: 'trace2code-inpage', event: eventObj }, '*');
      }
    } catch (e) {
      console.error('[Trace2Code] Emit error:', e);
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
    
    // Test IDs
    var testIds = {};
    ['data-testid', 'data-test', 'data-cy', 'data-qa'].forEach(function(attr) {
      var val = el.getAttribute(attr);
      if (val) testIds[attr] = val;
    });

    // Accessible name and role
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
    if (!accessibleName) {
      var labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        var labelEl = document.getElementById(labelledBy);
        if (labelEl) accessibleName = labelEl.innerText.trim();
      }
    }
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

    // CSS candidates
    var cssCandidates = [];
    if (el.id) cssCandidates.push('#' + CSS.escape(el.id));
    for (var k in testIds) {
      cssCandidates.push('[' + k + '="' + CSS.escape(testIds[k]) + '"]');
    }
    if (el.name) {
      cssCandidates.push(tag + '[name="' + CSS.escape(el.name) + '"]');
    }
    if (el.className && typeof el.className === 'string') {
      var classes = el.className.trim().split(/\\s+/).filter(Boolean);
      if (classes.length > 0) {
        cssCandidates.push(tag + '.' + classes.map(CSS.escape).join('.'));
      }
    }

    // XPath
    var xpath = '';
    try {
      var curr = el;
      var paths = [];
      while (curr && curr.nodeType === 1) {
        var index = 1;
        for (var sib = curr.previousSibling; sib; sib = sib.previousSibling) {
          if (sib.nodeType === 1 && sib.tagName === curr.tagName) index++;
        }
        paths.unshift(curr.tagName.toLowerCase() + '[' + index + ']');
        curr = curr.parentNode;
      }
      xpath = '/' + paths.join('/');
    } catch (_) {}

    // Bounding rect
    var rect;
    try {
      var r = el.getBoundingClientRect();
      rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    } catch (_) {}

    // Value handling with privacy redaction
    var val = undefined;
    if ('value' in el) {
      if (isPasswordField(el)) {
        val = { kind: 'redacted', reason: 'password-field' };
      } else {
        val = String(el.value);
      }
    }

    // Nearby text
    var nearbyText = [];
    try {
      if (el.parentElement) {
        var parentText = (el.parentElement.innerText || '').trim().split('\\n').filter(Boolean);
        nearbyText = parentText.slice(0, 3);
      }
    } catch (_) {}

    // Ancestor summary
    var ancestorSummary = [];
    try {
      var p = el.parentElement;
      while (p && ancestorSummary.length < 4 && p !== document.body) {
        ancestorSummary.push(p.tagName.toLowerCase() + (p.id ? '#' + p.id : ''));
        p = p.parentElement;
      }
    } catch (_) {}

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
      xpathCandidate: xpath || undefined,
      rect: rect,
      nearbyText: nearbyText.length > 0 ? nearbyText : undefined,
      ancestorSummary: ancestorSummary.length > 0 ? ancestorSummary : undefined
    };
  }

  // Pointer & mouse listeners
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

  if (capturePointerMove) {
    document.addEventListener('pointermove', function(e) {
      var now = Date.now();
      if (now - lastPointerMoveTime >= throttleMs) {
        lastPointerMoveTime = now;
        emit('pointermove', { x: e.clientX, y: e.clientY }, e.target);
      }
    }, true);
  }

  document.addEventListener('wheel', function(e) {
    var now = Date.now();
    if (now - lastWheelTime >= 100) {
      lastWheelTime = now;
      emit('wheel', { deltaX: e.deltaX, deltaY: e.deltaY }, e.target);
    }
  }, true);

  // Keyboard listeners
  document.addEventListener('keydown', function(e) {
    var key = e.key;
    if (isPasswordField(e.target)) {
      key = '[REDACTED]';
    }
    emit('keydown', { key: key, code: e.code, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey }, e.target);
  }, true);

  document.addEventListener('keyup', function(e) {
    var key = e.key;
    if (isPasswordField(e.target)) {
      key = '[REDACTED]';
    }
    emit('keyup', { key: key, code: e.code }, e.target);
  }, true);

  // Form input/change
  document.addEventListener('input', function(e) {
    var data = e.data;
    if (isPasswordField(e.target)) {
      data = '[REDACTED]';
    }
    emit('input', { data: data, inputType: e.inputType }, e.target);
  }, true);

  document.addEventListener('change', function(e) {
    var val = e.target && 'value' in e.target ? e.target.value : undefined;
    if (isPasswordField(e.target)) {
      val = '[REDACTED]';
    }
    emit('change', { value: val, checked: e.target.checked }, e.target);
  }, true);

  document.addEventListener('focus', function(e) {
    emit('focus', {}, e.target);
  }, true);

  document.addEventListener('blur', function(e) {
    emit('blur', {}, e.target);
  }, true);

  // Drag and drop listeners
  document.addEventListener('dragstart', function(e) {
    emit('pointerdown', { drag: true }, e.target);
  }, true);

  document.addEventListener('drop', function(e) {
    emit('pointerup', { drop: true }, e.target);
  }, true);

  // SPA Navigation hooks
  var originalPushState = history.pushState;
  history.pushState = function(state, title, url) {
    var result = originalPushState.apply(this, arguments);
    emit('navigation', { url: window.location.href, type: 'spa-pushState' });
    return result;
  };

  var originalReplaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    var result = originalReplaceState.apply(this, arguments);
    emit('navigation', { url: window.location.href, type: 'spa-replaceState' });
    return result;
  };

  window.addEventListener('popstate', function() {
    emit('navigation', { url: window.location.href, type: 'spa-popstate' });
  });

  window.addEventListener('hashchange', function() {
    emit('navigation', { url: window.location.href, type: 'hashchange' });
  });
})();
`;
}
