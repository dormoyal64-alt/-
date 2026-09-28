// Shared helpers for server integration tests: start createApp() on an ephemeral port with a
// temporary DATA_DIR, a capturing mailer, a controllable clock and a tiny cookie-jar fetch client.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../../server/config.js';
import { createApp } from '../../../server/app.js';

export const SILENT = { info() {}, warn() {}, error() {} };

/**
 * @param {{env?: Record<string,string>, configOverrides?: object, provider?: object, fetchImpl?: Function, now?: () => number}} [opts]
 */
export async function startTestServer(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'va-server-test-'));
  const env = {
    NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', DATA_DIR: dir,
    SESSION_SECRET: 'test-secret-test-secret-test-secret-000', MOCK_WEBHOOK_SECRET: 'whsec-test',
    ...opts.env,
  };
  const config = { ...loadConfig(env), ...opts.configOverrides };
  const mail = [];
  const mailer = { id: 'capture', async send(msg) { mail.push(msg); } };
  const clock = { t: Date.now() };
  const now = opts.now ?? (() => clock.t);
  const app = createApp(config, { mailer, logger: SILENT, now, provider: opts.provider, fetchImpl: opts.fetchImpl, maintenanceTimer: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = config.publicBaseUrl ?? base;
  return {
    app, config, base, origin, mail, clock, services: app.locals.services,
    /** advance the fake clock */
    advance(ms) { clock.t += ms; },
    client() { return new Client(base, origin); },
    async close() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      app.locals.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export class Client {
  constructor(base, origin) {
    this.base = base;
    this.origin = origin;
    /** @type {Map<string,string>} */
    this.jar = new Map();
    /** raw Set-Cookie headers of the last response */
    this.lastSetCookie = [];
  }

  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {{json?: any, body?: any, headers?: Record<string,string>, origin?: string|false, redirect?: RequestRedirect}} [o]
   */
  async req(method, path, o = {}) {
    const headers = { ...o.headers };
    if (this.jar.size) headers.cookie = this.cookieHeader();
    if (o.origin !== false && method !== 'GET' && method !== 'HEAD') headers.origin = o.origin ?? this.origin;
    let body = o.body;
    if (o.json !== undefined) {
      headers['content-type'] ??= 'application/json';
      body = JSON.stringify(o.json);
    }
    const res = await fetch(this.base + path, { method, headers, body, redirect: o.redirect ?? 'manual' });
    this.lastSetCookie = res.headers.getSetCookie();
    for (const sc of this.lastSetCookie) {
      const [pair, ...attrs] = sc.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*expires=thu, 01 jan 1970/i.test(a) || /^\s*max-age=0\s*$/i.test(a));
      if (!value || expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, headers: res.headers, data, text };
  }

  get(path, o) { return this.req('GET', path, o); }
  post(path, json, o = {}) { return this.req('POST', path, { json: json ?? {}, ...o }); }
  del(path, json, o = {}) { return this.req('DELETE', path, { json, ...o }); }
}

export const PASSWORD = 'Correct-Horse-9';

/** Registers a fresh user and returns {client, user, entitlement}. */
export async function registerUser(t, email = `u${Math.random().toString(36).slice(2)}@example.com`, extra = {}) {
  const client = t.client();
  const r = await client.post('/api/auth/register', { email, password: PASSWORD, lang: 'he', acceptTerms: true, ...extra });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${r.text}`);
  return { client, email, ...r.data };
}

/** Starts a mock checkout for `planId` and pays it on the hosted test page. Returns the final redirect. */
export async function payWithMock(client, planId) {
  const co = await client.post('/api/billing/checkout', { planId });
  if (co.status !== 200) throw new Error(`checkout failed: ${co.status} ${co.text}`);
  const url = new URL(co.data.url);
  const page = await client.get(url.pathname);
  const csrf = /name="csrf" value="([0-9a-f]+)"/.exec(page.text)?.[1];
  const paid = await client.req('POST', `${url.pathname}/pay`, {
    body: new URLSearchParams({ csrf }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  return { checkoutUrl: url, page, paid };
}

/**
 * A fetch stand-in for provider APIs: `routes` maps "METHOD path-suffix" to (body, init) => [status, json].
 * Every call is recorded in `calls`.
 */
export function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method, headers: init.headers ?? {}, body });
    const key = Object.keys(routes).find((k) => {
      const [m, suffix] = k.split(' ');
      return m === method && String(url).endsWith(suffix);
    });
    if (!key) return new Response(JSON.stringify({ error: 'no route' }), { status: 404 });
    const out = await routes[key](body, init);
    if (out instanceof Error) throw out;
    const [status, json] = out;
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
