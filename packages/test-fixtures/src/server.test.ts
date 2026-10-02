import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { startFixtureServer, type FixtureServerInstance } from './server.js';

describe('Test Fixture Server', () => {
  let instance: FixtureServerInstance;

  beforeAll(async () => {
    instance = await startFixtureServer();
  });

  afterAll(async () => {
    if (instance) {
      await instance.close();
    }
  });

  it('serves main fixture page with all required controls', async () => {
    const res = await fetch(instance.url);
    expect(res.status).toBe(200);
    const html = await res.text();

    // Check required controls
    expect(html).toContain('id="sample-text"'); // text field
    expect(html).toContain('id="sample-btn"'); // button
    expect(html).toContain('id="sample-check"'); // checkbox
    expect(html).toContain('id="country-select"'); // select
    expect(html).toContain('id="custom-dropdown"'); // custom dropdown
    expect(html).toContain('id="file-upload"'); // upload input
    expect(html).toContain('id="drag-source"'); // drag-and-drop
    expect(html).toContain('id="drop-target"');
    expect(html).toContain('id="test-modal"'); // modal
    expect(html).toContain('nav-second-page'); // multi-page navigation
    expect(html).toContain('spa-route-a-btn'); // SPA route change
    expect(html).toContain('id="test-iframe"'); // iframe
    expect(html).toContain('insert-dynamic-btn'); // dynamically inserted element
    expect(html).toContain('id="shipping-email"'); // duplicate labels
    expect(html).toContain('id="billing-email"');
    expect(html).toContain('id="login-form"'); // fake login form
    expect(html).toContain('type="password"');
  });

  it('serves multi-page navigation target', async () => {
    const res = await fetch(`${instance.url}/second-page.html`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Second Page Reached');
  });

  it('serves iframe content', async () => {
    const res = await fetch(`${instance.url}/iframe.html`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Inside Embedded Iframe');
  });

  it('handles SPA route rewrites', async () => {
    const res = await fetch(`${instance.url}/spa/route-a`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Trace2Code Deterministic Test Benchmark');
  });
});
