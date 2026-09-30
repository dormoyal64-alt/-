// @ts-check
/**
 * A10 — security checks against the real server (NODE_ENV=test) plus a second, production-configured server
 * started by this file (NODE_ENV=production, PayPlus with dummy credentials, in-memory DB).
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { collectErrors, uniqueEmail, PASSWORD, apiRegister, seedProfile, waitForApp, gotoRoute } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXPECTED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
];

/** Raw HTTP request (no URL normalisation by the client). */
function raw(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const portOf = (baseURL) => Number(new URL(String(baseURL)).port);

test.describe('HTTP security headers', () => {
  for (const path of ['/', '/app/', '/api/health']) {
    test(`headers on ${path}`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const h = res.headers();
      const csp = (h['content-security-policy'] || '').split(';').map((d) => d.trim()).filter(Boolean);
      expect(csp).toEqual(EXPECTED_CSP);
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(h['permissions-policy']).toBe('camera=(self), microphone=(), geolocation=(), payment=(self)');
      expect(h['cross-origin-opener-policy']).toBe('same-origin');
      expect(h['x-powered-by']).toBeUndefined();
      if (path.startsWith('/api/')) expect(h['cache-control']).toBe('no-store');
      else expect(h['cache-control']).toBe('no-cache');
    });
  }

  test('no CORS: cross-origin reads of the API are not allowed', async ({ request }) => {
    const res = await request.get('/api/me', { headers: { Origin: 'https://evil.example' } });
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
    expect(res.headers()['access-control-allow-credentials']).toBeUndefined();
    const pre = await request.fetch('/api/auth/login', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    expect(pre.headers()['access-control-allow-origin']).toBeUndefined();
  });

  // Evidence for SEC-02: the app does not need style-src 'unsafe-inline' (all styles go through CSSOM).
  test("the app runs without CSP violations under a stricter style-src 'self'", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block' }); // every document goes through the route
    const page = await context.newPage();
    await page.route('**/app/**', async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const res = await route.fetch();
      const headers = { ...res.headers(), 'content-security-policy': res.headers()['content-security-policy'].replace("style-src 'self' 'unsafe-inline'", "style-src 'self'") };
      await route.fulfill({ response: res, headers });
    });
    await page.addInitScript(() => {
      /** @type {any} */ (window).__cspv = [];
      document.addEventListener('securitypolicyviolation', (e) => /** @type {any} */ (window).__cspv.push(`${e.violatedDirective} ${e.blockedURI} ${e.sample}`));
    });
    await page.goto('/app/');
    await waitForApp(page);
    expect(await page.evaluate(() => document.querySelector('meta[http-equiv]'))).toBeNull();
    await apiRegister(page);
    await seedProfile(page);
    await page.reload();
    await waitForApp(page);
    const violations = [];
    for (const r of ['/home', '/results', '/guide', '/settings', '/paywall', '/account', '/viewer/reader', '/help', '/profiles']) {
      await gotoRoute(page, r);
      await page.waitForTimeout(250);
      violations.push(...(await page.evaluate(() => /** @type {any} */ (window).__cspv.splice(0))).map((v) => `${r}: ${v}`));
    }
    expect(violations).toEqual([]);
    // Prove the stricter policy was really in force: an injected inline <style> must be blocked.
    const probe = await page.evaluate(async () => {
      const st = document.createElement('style');
      st.textContent = 'html{--csp-probe:1}';
      document.head.appendChild(st);
      await new Promise((r) => setTimeout(r, 50));
      return getComputedStyle(document.documentElement).getPropertyValue('--csp-probe');
    });
    expect(probe).toBe('');
    await context.close();
  });
});

test.describe('CSRF / content-type guard on state-changing API calls', () => {
  test('foreign, missing and "null" Origin → 403 BAD_ORIGIN; non-JSON → 403 JSON_REQUIRED', async ({ page, baseURL }) => {
    await page.goto('/app/');
    const reg = await apiRegister(page);
    const origin = String(baseURL);
    const cases = [
      { path: '/api/auth/login', data: { email: reg.email, password: PASSWORD } },
      { path: '/api/billing/checkout', data: { planId: 'monthly' } },
      { path: '/api/billing/cancel', data: {} },
      { path: '/api/auth/logout', data: undefined },
    ];
    for (const c of cases) {
      for (const bad of ['https://evil.example', 'null', undefined, `${origin}.evil.example`]) {
        const headers = { 'Content-Type': 'application/json' };
        if (bad !== undefined) headers.Origin = bad;
        const res = await page.request.post(c.path, { headers, data: c.data === undefined ? '' : JSON.stringify(c.data) });
        expect(res.status(), `${c.path} with Origin=${bad}`).toBe(403);
        expect((await res.json()).error.code).toBe('BAD_ORIGIN');
      }
      for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
        const res = await page.request.post(c.path, { headers: { Origin: origin, 'Content-Type': type }, data: 'a=b' });
        expect(res.status(), `${c.path} as ${type}`).toBe(403);
        expect((await res.json()).error.code).toBe('JSON_REQUIRED');
      }
    }
    // The session is still intact (none of the rejected calls logged us out or cancelled anything).
    const me = await page.request.get('/api/me');
    expect(me.status()).toBe(200);
    expect((await me.json()).entitlement.status).toBe('trial');
    // DELETE /api/me is protected the same way.
    const del = await page.request.delete('/api/me', { headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, data: JSON.stringify({ password: PASSWORD }) });
    expect(del.status()).toBe(403);
  });
});

test.describe('authentication', () => {
  test('login brute force → 429 with Retry-After', async ({ request, baseURL }) => {
    const email = uniqueEmail('brute');
    const statuses = [];
    let retryAfter = null;
    for (let i = 0; i < 12; i++) {
      const res = await request.post('/api/auth/login', {
        headers: { Origin: String(baseURL), 'Content-Type': 'application/json' },
        data: JSON.stringify({ email, password: `wrong-${i}` }),
      });
      statuses.push(res.status());
      if (res.status() === 429) {
        retryAfter = res.headers()['retry-after'];
        expect((await res.json()).error.code).toBe('RATE_LIMITED');
        break;
      }
    }
    expect(statuses.slice(0, 10).every((s) => s === 401), statuses.join(',')).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  test('session cookie flags; logout invalidates the session server-side', async ({ request, baseURL }) => {
    const email = uniqueEmail('cookie');
    const reg = await request.post('/api/auth/register', {
      headers: { Origin: String(baseURL), 'Content-Type': 'application/json' },
      data: JSON.stringify({ email, password: PASSWORD, lang: 'he', acceptTerms: true }),
    });
    expect(reg.status()).toBe(201);
    const setCookie = reg.headersArray().filter((x) => x.name.toLowerCase() === 'set-cookie').map((x) => x.value);
    expect(setCookie).toHaveLength(1);
    const c = setCookie[0];
    expect(c).toMatch(/^sid=[A-Za-z0-9_-]{43};/);
    expect(c).toMatch(/;\s*HttpOnly/i);
    expect(c).toMatch(/;\s*SameSite=Lax/i);
    expect(c).toMatch(/;\s*Path=\/(;|$)/);
    const token = c.match(/^sid=([^;]+)/)[1];
    expect(JSON.stringify(await reg.json())).not.toContain(token); // token never in the body

    const port = portOf(baseURL);
    const meBefore = await raw(port, { path: '/api/me', headers: { Cookie: `sid=${token}` } });
    expect(meBefore.status).toBe(200);
    const out = await raw(port, { method: 'POST', path: '/api/auth/logout', headers: { Cookie: `sid=${token}`, Origin: String(baseURL) } });
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/sid=;.*Expires=Thu, 01 Jan 1970/);
    // Replaying the old cookie must fail: the session row is gone.
    const meAfter = await raw(port, { path: '/api/me', headers: { Cookie: `sid=${token}` } });
    expect(meAfter.status).toBe(401);
    expect(JSON.parse(meAfter.body).error.code).toBe('UNAUTHENTICATED');
  });

  test('login rotates the session id (no fixation)', async ({ request, baseURL }) => {
    const email = uniqueEmail('rotate');
    const headers = { Origin: String(baseURL), 'Content-Type': 'application/json' };
    const reg = await request.post('/api/auth/register', { headers, data: JSON.stringify({ email, password: PASSWORD, acceptTerms: true }) });
    const first = reg.headers()['set-cookie'].match(/sid=([^;]+)/)[1];
    const login = await request.post('/api/auth/login', { headers, data: JSON.stringify({ email, password: PASSWORD }) });
    expect(login.status()).toBe(200);
    const second = login.headers()['set-cookie'].match(/sid=([^;]+)/)[1];
    expect(second).not.toBe(first);
    const old = await raw(portOf(baseURL), { path: '/api/me', headers: { Cookie: `sid=${first}` } });
    expect(old.status).toBe(401);
  });

  test('password reset request does not reveal whether an e-mail exists', async ({ page, baseURL }) => {
    await page.goto('/app/');
    const { email } = await apiRegister(page);
    const headers = { Origin: String(baseURL), 'Content-Type': 'application/json' };
    const ask = async (e) => {
      const t0 = Date.now();
      const r = await page.request.post('/api/auth/password-reset/request', { headers, data: JSON.stringify({ email: e }) });
      return { status: r.status(), body: await r.text(), ms: Date.now() - t0, headers: r.headers() };
    };
    const known = await ask(email);
    const unknown = await ask(uniqueEmail('nobody'));
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toBe(unknown.body);
    expect(Object.keys(known.headers).sort()).toEqual(Object.keys(unknown.headers).sort());
    // Invalid reset tokens are uniformly rejected.
    const bad = await page.request.post('/api/auth/password-reset/confirm', { headers, data: JSON.stringify({ token: 'x'.repeat(43), password: 'Another-Long-Password-1' }) });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.code).toBe('INVALID_TOKEN');
  });

  test('HTML in e-mail is rejected at registration', async ({ request, baseURL }) => {
    const res = await request.post('/api/auth/register', {
      headers: { Origin: String(baseURL), 'Content-Type': 'application/json' },
      data: JSON.stringify({ email: '<script>alert(1)</script>@example.com', password: PASSWORD, acceptTerms: true }),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_EMAIL');
  });
});

test.describe('XSS probes (rendered as text, nothing injected, nothing executed)', () => {
  const PAYLOAD = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b id="xss-b">bold</b>';

  test('profile name and reader text with HTML are rendered as text', async ({ page }) => {
    const errors = collectErrors(page);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.goto('/app/');
    await waitForApp(page);
    await apiRegister(page);
    await seedProfile(page, { name: PAYLOAD.slice(0, 40) });
    const shown = PAYLOAD.slice(0, 40);
    await page.reload();
    await waitForApp(page);
    for (const route of ['/home', '/results', '/profiles']) {
      await gotoRoute(page, route);
      await expect(page.locator('main')).toContainText(shown);
      expect(await page.locator('main img[src="x"], main script, #xss-b').count(), route).toBe(0);
    }
    // Onboarding basics accept the same text and keep it inert.
    await gotoRoute(page, '/viewer/reader');
    await page.getByTestId('reader-input').fill(PAYLOAD);
    await page.getByTestId('reader-show').click();
    await expect(page.getByTestId('reader-surface')).toContainText('<script>window.__xss=2</script>');
    expect(await page.getByTestId('reader-surface').locator('img, script, b').count()).toBe(0);
    expect(await page.evaluate(() => /** @type {any} */ (window).__xss)).toBeUndefined();
    expect(dialogs).toEqual([]);
    expect(errors.filter((e) => !/Failed to load resource.*404/.test(e))).toEqual([]);
  });

  test('hash-route and returnTo injection are inert', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.goto('/app/#/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
    await waitForApp(page);
    expect(await page.locator('main img[src="x"]').count()).toBe(0);
    const email = uniqueEmail('rt');
    await page.goto('/app/#/welcome');
    await apiRegister(page, { email });
    await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
    // Deep links into guarded routes are remembered as a "returnTo" target; hostile targets must be dropped.
    for (const evil of ['//evil.example/x', '/\\evil.example', '/javascript:alert(1)']) {
      await page.goto('about:blank'); // force a full boot (a hash-only goto would be a same-document navigation)
      await page.goto(`/app/#${evil}`);
      await waitForApp(page);
      await page.evaluate(() => { location.hash = '#/login'; });
      await page.getByTestId('login-email').fill(email);
      await page.getByTestId('login-password').fill(PASSWORD);
      await page.getByTestId('login-submit').click();
      await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/app\/#\/(home|onboarding)/);
      await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
    }
    expect(dialogs).toEqual([]);
  });
});

// SEC-06: the Web Share Target endpoint is handled by the service worker for ANY POST navigation, so a foreign
// site can auto-submit a form and make the app open attacker-chosen text in the reader (content spoofing; the
// text is still inert — no script runs). Expected secure behaviour: cross-site posts are ignored or confirmed first.
test('SEC-06: a cross-site form post to /app/share-target does not open attacker text in the reader', async ({ page, baseURL }) => {
  await page.goto('/app/');
  await waitForApp(page);
  await apiRegister(page);
  await seedProfile(page);
  await page.reload();
  await waitForApp(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const MARK = 'ATTACKER-CONTROLLED TEXT: call 1-800-EVIL to renew';
  await page.route('http://evil.test/attack.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><form id="f" method="post" enctype="multipart/form-data" action="${baseURL}/app/share-target">`
      + `<input name="text" value="${MARK}"></form><script>document.getElementById('f').submit()</script>`,
  }));
  await page.goto('http://evil.test/attack.html');
  await page.waitForURL(/127\.0\.0\.1:\d+\/app\//);
  await waitForApp(page);
  await page.waitForTimeout(1500);
  const shown = await page.locator('main').innerText();
  expect(shown).not.toContain(MARK);
});

test.describe('server hardening (test env)', () => {
  test('static serving: no path traversal, no dotfiles, no source outside public/', async ({ baseURL }) => {
    const port = portOf(baseURL);
    const probes = ['/%2e%2e/package.json', '/app/%2e%2e/%2e%2e/package.json', '/..%2fpackage.json', '/app/..%2f..%2fserver%2fconfig.js',
      '/%2e%2e%2f%2e%2e%2fserver/.env.example', '/..%5c..%5cpackage.json', '/server/config.js', '/package.json', '/.env', '/app/.htaccess',
      '/%00/package.json', '/app/js/%2e%2e/%2e%2e/%2e%2e/server/db.js'];
    for (const path of probes) {
      const r = await raw(port, { path });
      expect([400, 403, 404], `${path} -> ${r.status}`).toContain(r.status);
      expect(r.body).not.toMatch(/"name":\s*"vision-app"|import express|SESSION_SECRET/);
      expect(r.body).not.toMatch(/at \S+ \(|node_modules|\/home\//); // no stack traces or paths
    }
  });

  test('errors do not leak internals', async ({ request, baseURL }) => {
    const headers = { Origin: String(baseURL), 'Content-Type': 'application/json' };
    const badJson = await request.post('/api/auth/login', { headers, data: '{"email":' });
    expect(badJson.status()).toBe(400);
    expect(await badJson.json()).toEqual({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
    const big = await request.post('/api/auth/login', { headers, data: JSON.stringify({ email: 'a@b.cd', password: 'x'.repeat(40_000) }) });
    expect(big.status()).toBe(413);
    const notFound = await request.get('/api/does-not-exist');
    expect(await notFound.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    const typeConfusion = await request.post('/api/auth/login', { headers, data: JSON.stringify({ email: ['a'], password: { $gt: '' } }) });
    expect(typeConfusion.status()).toBe(400);
    const sqlish = await request.post('/api/auth/login', { headers, data: JSON.stringify({ email: "' OR 1=1 --@x.io", password: "' OR '1'='1" }) });
    expect(sqlish.status()).toBe(401);
    for (const r of [badJson, big, notFound, typeConfusion, sqlish]) expect(await r.text()).not.toMatch(/at \S+ \(|\/home\/|node:internal|SQLITE/);
  });

  test('webhooks require a valid signature; checkout pages are per-user', async ({ browser, request, baseURL }) => {
    const unsigned = await request.post('/api/webhooks/mock', { headers: { 'Content-Type': 'application/json' }, data: JSON.stringify({ id: 'e1', type: 'subscription.activated' }) });
    expect(unsigned.status()).toBe(400);
    expect((await unsigned.json()).error.code).toBe('INVALID_SIGNATURE');
    const forged = await request.post('/api/webhooks/mock', { headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'a'.repeat(64) }, data: '{"id":"e1","type":"subscription.activated"}' });
    expect(forged.status()).toBe(400);
    expect((await request.post('/api/webhooks/unknown', { data: '{}' })).status()).toBe(404);
    expect((await request.post('/api/webhooks/payplus', { data: '{}' })).status()).toBe(404); // not configured in test

    // User A starts a checkout; user B must not be able to open or pay it (IDOR).
    const ctxA = await browser.newContext({ baseURL });
    const ctxB = await browser.newContext({ baseURL });
    try {
      const a = await ctxA.newPage();
      await a.goto('/app/');
      await apiRegister(a);
      const co = await a.request.post('/api/billing/checkout', { headers: { Origin: String(baseURL), 'Content-Type': 'application/json' }, data: JSON.stringify({ planId: 'monthly' }) });
      expect(co.status()).toBe(200);
      const url = (await co.json()).url;
      expect(new URL(url).origin).toBe(new URL(String(baseURL)).origin);
      const b = await ctxB.newPage();
      await b.goto('/app/');
      await apiRegister(b);
      const peek = await b.request.get(url);
      expect(peek.status()).toBe(404);
      const pay = await b.request.post(`${url}/pay`, { headers: { Origin: String(baseURL), 'Content-Type': 'application/x-www-form-urlencoded' }, data: 'csrf=x' });
      expect(pay.status()).toBe(404);
      // A cannot pay own checkout without the per-page CSRF token.
      const noTok = await a.request.post(`${url}/pay`, { headers: { Origin: String(baseURL), 'Content-Type': 'application/x-www-form-urlencoded' }, data: 'csrf=nope' });
      expect(noTok.status()).toBe(403);
      expect((await (await a.request.get('/api/me')).json()).entitlement.status).toBe('trial');
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('billing return URL uses the request Host in dev/test (host-header dependent; see SEC report)', async ({ baseURL }) => {
    const r = await raw(portOf(baseURL), { path: '/api/billing/return/success', headers: { Host: 'evil.example' } });
    expect(r.status).toBe(303);
    // Documented behaviour outside production: base URL is derived from Host. Production pins PUBLIC_BASE_URL (tested below).
    expect(r.headers.location).toBe('http://evil.example/app/#/account?checkout=success');
    expect((await raw(portOf(baseURL), { path: '/api/billing/return/elsewhere' })).status).toBe(404);
  });
});

test.describe('production configuration', () => {
  test.describe.configure({ mode: 'serial' });
  /** @type {import('node:child_process').ChildProcess|null} */
  let child = null;
  let port = 0;
  let logs = '';
  const PUBLIC = 'https://example.test';
  const prodEnv = (extra = {}) => ({
    PATH: process.env.PATH, HOME: process.env.HOME,
    NODE_ENV: 'production', HOST: '127.0.0.1', DATA_DIR: ':memory:', PUBLIC_BASE_URL: PUBLIC,
    SESSION_SECRET: 'p'.repeat(48), PAYMENT_PROVIDER: 'payplus', PAYPLUS_ENV: 'production',
    PAYPLUS_API_KEY: 'dummy-key', PAYPLUS_SECRET_KEY: 'dummy-secret', PAYPLUS_PAGE_UID: 'dummy-page', PAYPLUS_TERMINAL_UID: 'dummy-terminal',
    RENEWAL_INTERVAL_MINUTES: '0', ...extra,
  });

  test.beforeAll(async () => {
    port = 4190 + (test.info().project.name === 'phone' ? 1 : 2);
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, env: prodEnv({ PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { logs += d; });
    child.stderr.on('data', (d) => { logs += d; });
    const deadline = Date.now() + 15_000;
    for (;;) {
      try { if ((await raw(port, { path: '/api/health' })).status === 200) break; } catch { /* not up yet */ }
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`production server did not start:\n${logs}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  });

  test.afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM'); // only the process this file started, by PID
      await exited;
    }
  });

  test('dev harness is 404 in production (incl. encoded / case / dot-segment variants)', async () => {
    for (const path of ['/app/dev/harness.html', '/app/dev/', '/app/dev', '/app/dev/sample-view.js', '/app/%64ev/harness.html',
      '/app//dev/harness.html', '/app/./dev/harness.html', '/app/js/../dev/harness.html', '/APP/DEV/harness.html', '/app/Dev/harness.html',
      '/app/dev%2Fharness.html', '/app%2Fdev%2Fharness.html']) {
      const r = await raw(port, { path });
      expect(r.status, `${path} -> ${r.status}`).toBe(404);
      expect(r.body).not.toContain('harness');
    }
    expect((await raw(port, { path: '/app/' })).status).toBe(200);
  });

  test('mock checkout and mock webhook do not exist in production', async () => {
    const reg = await raw(port, {
      method: 'POST', path: '/api/auth/register', headers: { Origin: PUBLIC, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: uniqueEmail('prod'), password: PASSWORD, acceptTerms: true }),
    });
    expect(reg.status).toBe(201);
    const cookie = String(reg.headers['set-cookie']);
    expect(cookie).toMatch(/^__Host-sid=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\//);
    expect(cookie).not.toMatch(/Domain=/i);
    const sid = cookie.match(/^(__Host-sid=[^;]+)/)[1];
    const mockRef = `mock_cs_${'a'.repeat(43)}`;
    const get = await raw(port, { path: `/api/billing/mock/checkout/${mockRef}`, headers: { Cookie: sid } });
    expect(get.status).toBe(404);
    // A form post is stopped by the CSRF guard (403 JSON_REQUIRED: the mock form exception is off); JSON reaches the 404.
    const form = await raw(port, { method: 'POST', path: `/api/billing/mock/checkout/${mockRef}/pay`, headers: { Cookie: sid, Origin: PUBLIC, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'csrf=x' });
    expect(form.status).toBe(403);
    expect(JSON.parse(form.body).error.code).toBe('JSON_REQUIRED');
    const json = await raw(port, { method: 'POST', path: `/api/billing/mock/checkout/${mockRef}/pay`, headers: { Cookie: sid, Origin: PUBLIC, 'Content-Type': 'application/json' }, body: '{}' });
    expect(json.status).toBe(404);
    const wh = await raw(port, { method: 'POST', path: '/api/webhooks/mock', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(wh.status).toBe(404);
    const pp = await raw(port, { method: 'POST', path: '/api/webhooks/payplus', headers: { 'Content-Type': 'application/json', 'User-Agent': 'PayPlus', hash: 'AAAA' }, body: '{}' });
    expect(pp.status).toBe(400);
    expect(JSON.parse(pp.body).error.code).toBe('INVALID_SIGNATURE');
  });

  test('production headers: HSTS, CSP form-action limited to the payment provider, Origin pinned to PUBLIC_BASE_URL', async () => {
    const r = await raw(port, { path: '/' });
    expect(r.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    const formAction = String(r.headers['content-security-policy']).split(';').map((s) => s.trim()).find((d) => d.startsWith('form-action'));
    expect(formAction).toMatch(/^form-action 'self'( https:\/\/[a-z0-9.-]+)*$/);
    // A request whose Host matches but whose Origin is the plain-http local origin is rejected (Origin must be PUBLIC_BASE_URL).
    const bad = await raw(port, { method: 'POST', path: '/api/auth/login', headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' }, body: '{}' });
    expect(bad.status).toBe(403);
    // Return URLs ignore a spoofed Host header in production.
    const ret = await raw(port, { path: '/api/billing/return/cancel', headers: { Host: 'evil.example' } });
    expect(ret.status).toBe(303);
    expect(ret.headers.location).toBe(`${PUBLIC}/app/#/account?checkout=cancel`);
    expect(logs).not.toMatch(/Error|at \S+ \(/);
  });

  test('production refuses unsafe configuration (mock payments, short secret, http base URL)', async () => {
    const run = (extra) => new Promise((resolve) => {
      const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, env: prodEnv({ PORT: '0', ...extra }), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      const timer = setTimeout(() => p.kill('SIGTERM'), 8000);
      p.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
    const mock = await run({ PAYMENT_PROVIDER: 'mock' });
    expect(mock.code).toBe(1);
    expect(mock.out).toContain('PAYMENT_PROVIDER=mock is refused in production');
    const shortSecret = await run({ SESSION_SECRET: 'short' });
    expect(shortSecret.code).toBe(1);
    expect(shortSecret.out).toContain('SESSION_SECRET must be at least 32 characters');
    const httpBase = await run({ PUBLIC_BASE_URL: 'http://example.test' });
    expect(httpBase.code).toBe(1);
    expect(httpBase.out).toContain('PUBLIC_BASE_URL must use https://');
  });
});
