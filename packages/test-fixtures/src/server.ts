import http from 'node:http';
import { AddressInfo } from 'node:net';

export const MAIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Trace2Code Fixture Application</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 2rem; }
    section { border: 1px solid #ccc; padding: 1.5rem; margin-bottom: 1.5rem; border-radius: 8px; }
    .row { margin-bottom: 1rem; }
    .drop-zone { width: 200px; height: 100px; border: 2px dashed #999; display: flex; align-items: center; justify-content: center; }
    .draggable { width: 100px; padding: 8px; background: #e0e7ff; border: 1px solid #6366f1; cursor: grab; text-align: center; }
    .custom-dropdown { position: relative; width: 200px; }
    .dropdown-trigger { padding: 8px; border: 1px solid #999; cursor: pointer; background: white; }
    .dropdown-menu { display: none; position: absolute; top: 100%; left: 0; right: 0; border: 1px solid #999; background: white; list-style: none; margin: 0; padding: 0; }
    .dropdown-menu.open { display: block; }
    .dropdown-item { padding: 8px; cursor: pointer; }
    .dropdown-item:hover { background: #f3f4f6; }
    dialog { border: 1px solid #666; border-radius: 8px; padding: 2rem; }
  </style>
</head>
<body>
  <h1>Trace2Code Deterministic Test Benchmark</h1>

  <!-- 1. Text Field & Button -->
  <section id="section-basic">
    <h2>1. Basic Controls</h2>
    <div class="row">
      <label for="sample-text">Sample Text Input</label>
      <input type="text" id="sample-text" name="sampleText" placeholder="Enter text" aria-label="Sample Text">
      <button id="sample-btn" data-testid="sample-button">Click Me</button>
      <span id="click-feedback" aria-live="polite"></span>
    </div>
  </section>

  <!-- 2. Checkbox & Select -->
  <section id="section-form-controls">
    <h2>2. Form Controls</h2>
    <div class="row">
      <input type="checkbox" id="sample-check" name="sampleCheck">
      <label for="sample-check">Agree to Terms</label>
      <span id="checkbox-feedback"></span>
    </div>
    <div class="row">
      <label for="country-select">Country</label>
      <select id="country-select" name="country">
        <option value="">--Select Country--</option>
        <option value="us">United States</option>
        <option value="ca">Canada</option>
        <option value="uk">United Kingdom</option>
      </select>
    </div>
  </section>

  <!-- 3. Custom Dropdown -->
  <section id="section-custom-dropdown">
    <h2>3. Custom Dropdown</h2>
    <div class="custom-dropdown" id="custom-dropdown">
      <div class="dropdown-trigger" id="dropdown-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false">Select Option</div>
      <ul class="dropdown-menu" id="dropdown-menu" role="listbox">
        <li class="dropdown-item" role="option" data-value="alpha">Alpha Option</li>
        <li class="dropdown-item" role="option" data-value="beta">Beta Option</li>
        <li class="dropdown-item" role="option" data-value="gamma">Gamma Option</li>
      </ul>
      <input type="hidden" id="custom-dropdown-val" name="customDropdownVal" value="">
    </div>
  </section>

  <!-- 4. Upload Input -->
  <section id="section-upload">
    <h2>4. Upload Input</h2>
    <div class="row">
      <label for="file-upload">Choose document</label>
      <input type="file" id="file-upload" data-testid="file-upload-input">
      <span id="upload-feedback"></span>
    </div>
  </section>

  <!-- 5. Drag and Drop -->
  <section id="section-drag-drop">
    <h2>5. Drag and Drop</h2>
    <div class="row" style="display: flex; gap: 2rem; align-items: center;">
      <div id="drag-source" class="draggable" draggable="true" role="button">Drag Card</div>
      <div id="drop-target" class="drop-zone">Drop Here</div>
      <span id="drag-feedback"></span>
    </div>
  </section>

  <!-- 6. Modal Dialog -->
  <section id="section-modal">
    <h2>6. Modal Dialog</h2>
    <button id="open-modal-btn">Open Dialog</button>
    <dialog id="test-modal">
      <h3>Modal Confirmation</h3>
      <p>Please review and confirm this action.</p>
      <button id="confirm-modal-btn">Confirm Modal</button>
      <button id="close-modal-btn">Close Modal</button>
    </dialog>
  </section>

  <!-- 7. Navigation: Multi-page & SPA -->
  <section id="section-navigation">
    <h2>7. Navigation</h2>
    <div class="row">
      <a id="nav-second-page" href="/second-page.html">Go to Multi-page Link</a>
    </div>
    <div class="row">
      <button id="spa-route-a-btn">SPA Route A</button>
      <button id="spa-route-b-btn">SPA Route B</button>
      <div id="spa-content">Current SPA View: Home</div>
    </div>
  </section>

  <!-- 8. Iframe -->
  <section id="section-iframe">
    <h2>8. Embedded Iframe</h2>
    <iframe id="test-iframe" src="/iframe.html" width="400" height="150" title="Embedded Test Frame"></iframe>
  </section>

  <!-- 9. Dynamically Inserted Element -->
  <section id="section-dynamic">
    <h2>9. Dynamic Elements</h2>
    <button id="insert-dynamic-btn">Insert Dynamic Card</button>
    <div id="dynamic-container"></div>
  </section>

  <!-- 10. Duplicate Labels -->
  <section id="section-duplicate-labels">
    <h2>10. Duplicate Labels (Disambiguation Test)</h2>
    <div id="shipping-address-group" class="row">
      <h3>Shipping Contact</h3>
      <label for="shipping-email">Email Address</label>
      <input type="text" id="shipping-email" name="shippingEmail" data-testid="shipping-email">
    </div>
    <div id="billing-address-group" class="row">
      <h3>Billing Contact</h3>
      <label for="billing-email">Email Address</label>
      <input type="text" id="billing-email" name="billingEmail" data-testid="billing-email">
    </div>
  </section>

  <!-- 11. Fake Login Form (Redaction Test) -->
  <section id="section-login">
    <h2>11. Authentication (Redaction Test)</h2>
    <form id="login-form" onsubmit="event.preventDefault(); document.getElementById('login-status').innerText = 'Logged in as ' + document.getElementById('login-username').value;">
      <div class="row">
        <label for="login-username">Username</label>
        <input type="text" id="login-username" name="username" data-testid="username-field">
      </div>
      <div class="row">
        <label for="login-password">Password</label>
        <input type="password" id="login-password" name="password" data-testid="password-field">
      </div>
      <button type="submit" id="login-submit" data-testid="login-submit-btn">Sign In</button>
      <div id="login-status"></div>
    </form>
  </section>

  <script>
    // Click feedback
    document.getElementById('sample-btn').addEventListener('click', () => {
      document.getElementById('click-feedback').innerText = 'Clicked!';
    });

    // Checkbox feedback
    document.getElementById('sample-check').addEventListener('change', (e) => {
      document.getElementById('checkbox-feedback').innerText = e.target.checked ? 'Checked' : 'Unchecked';
    });

    // Custom dropdown
    const trigger = document.getElementById('dropdown-trigger');
    const menu = document.getElementById('dropdown-menu');
    const hiddenVal = document.getElementById('custom-dropdown-val');
    trigger.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        trigger.innerText = item.innerText;
        hiddenVal.value = item.dataset.value;
        menu.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      });
    });

    // File upload
    document.getElementById('file-upload').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      document.getElementById('upload-feedback').innerText = file ? 'Uploaded: ' + file.name : '';
    });

    // Drag and drop
    const dragSource = document.getElementById('drag-source');
    const dropTarget = document.getElementById('drop-target');
    dragSource.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', 'card-1');
    });
    dropTarget.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    dropTarget.addEventListener('drop', (e) => {
      e.preventDefault();
      document.getElementById('drag-feedback').innerText = 'Dropped Successfully!';
    });

    // Modal
    const modal = document.getElementById('test-modal');
    document.getElementById('open-modal-btn').addEventListener('click', () => modal.showModal());
    document.getElementById('confirm-modal-btn').addEventListener('click', () => {
      modal.close();
      document.getElementById('click-feedback').innerText = 'Modal Confirmed!';
    });
    document.getElementById('close-modal-btn').addEventListener('click', () => modal.close());

    // SPA routes
    function updateSpa(route) {
      document.getElementById('spa-content').innerText = 'Current SPA View: ' + route;
      history.pushState({ route }, '', '/spa/' + route.toLowerCase());
    }
    document.getElementById('spa-route-a-btn').addEventListener('click', () => updateSpa('Route-A'));
    document.getElementById('spa-route-b-btn').addEventListener('click', () => updateSpa('Route-B'));
    window.addEventListener('popstate', (e) => {
      const route = e.state && e.state.route ? e.state.route : 'Home';
      document.getElementById('spa-content').innerText = 'Current SPA View: ' + route;
    });

    // Dynamic Element insertion
    document.getElementById('insert-dynamic-btn').addEventListener('click', () => {
      setTimeout(() => {
        const item = document.createElement('div');
        item.id = 'dynamic-card-item';
        item.dataset.testid = 'dynamic-card-item';
        item.innerText = 'Newly Spawned Dynamic Card';
        document.getElementById('dynamic-container').appendChild(item);
      }, 100);
    });
  </script>
</body>
</html>
`;

export const SECOND_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Trace2Code Second Page</title>
</head>
<body>
  <h1>Second Page Reached</h1>
  <p id="page-message">You have navigated across full page boundary.</p>
  <a id="back-home-link" href="/">Back to Main Fixture</a>
</body>
</html>
`;

export const IFRAME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Iframe Document</title>
</head>
<body>
  <h4>Inside Embedded Iframe</h4>
  <input type="text" id="iframe-input" data-testid="iframe-input" placeholder="Iframe text">
  <button id="iframe-btn" data-testid="iframe-btn">Iframe Action</button>
  <span id="iframe-status"></span>
  <script>
    document.getElementById('iframe-btn').addEventListener('click', () => {
      document.getElementById('iframe-status').innerText = 'Iframe button clicked!';
    });
  </script>
</body>
</html>
`;

export interface FixtureServerInstance {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export function startFixtureServer(requestedPort = 0): Promise<FixtureServerInstance> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '/';

      if (url === '/' || url.startsWith('/spa/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(MAIN_PAGE_HTML);
      } else if (url === '/second-page.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(SECOND_PAGE_HTML);
      } else if (url === '/iframe.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(IFRAME_HTML);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    });

    server.listen(requestedPort, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      const port = addr.port;
      const url = `http://127.0.0.1:${port}`;

      resolve({
        url,
        port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });

    server.on('error', reject);
  });
}
