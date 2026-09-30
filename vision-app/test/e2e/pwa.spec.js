// @ts-check
/**
 * A10 — PWA: manifest, icons, service worker scope, offline reload, /api/* never cached.
 */
import { test, expect } from '@playwright/test';
import { apiRegister, seedProfile, waitForApp, collectErrors, uniqueEmail, PASSWORD } from './helpers.js';

/** PNG width/height from the IHDR chunk. @param {Buffer} buf */
function pngSize(buf) {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test('manifest is valid: name, start_url/scope /app/, icons exist with the declared sizes', async ({ request, page }) => {
  await page.goto('/app/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifestUrl = new URL(String(href), page.url()).pathname;
  expect(manifestUrl).toBe('/app/manifest.webmanifest');
  const res = await request.get(manifestUrl);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/manifest+json');
  const m = await res.json();
  expect(m.name).toBe('SeeTuned');
  expect(m.short_name).toBeTruthy();
  expect(m.short_name.length).toBeLessThanOrEqual(12);
  expect(m.start_url).toBe('/app/');
  expect(m.scope).toBe('/app/');
  expect(m.id).toBe('/app/');
  expect(m.display).toBe('standalone');
  expect(m.lang).toBe('he');
  expect(m.dir).toBe('rtl');
  expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  const icons = [...m.icons, ...(m.shortcuts || []).flatMap((s) => s.icons || [])];
  expect(m.icons.some((i) => i.sizes === '192x192' && (i.purpose || 'any').includes('any'))).toBe(true);
  expect(m.icons.some((i) => i.sizes === '512x512' && (i.purpose || 'any').includes('any'))).toBe(true);
  expect(m.icons.some((i) => (i.purpose || '').includes('maskable'))).toBe(true);
  for (const icon of icons) {
    const r = await request.get(new URL(icon.src, `http://x${manifestUrl}`).pathname);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()['content-type']).toBe(icon.type || 'image/png');
    const { w, h } = pngSize(await r.body());
    expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
  }
  // Shortcuts and share target stay inside the scope.
  for (const s of m.shortcuts || []) expect(s.url.startsWith('/app/')).toBe(true);
  if (m.share_target) expect(m.share_target.action.startsWith('/app/')).toBe(true);
  // iOS home-screen icon.
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const a = await request.get(new URL(String(apple), page.url()).pathname);
  expect(a.status()).toBe(200);
  expect(pngSize(await a.body())).toEqual({ w: 180, h: 180 });
});

test('service worker registers with scope /app/ and controls the app', async ({ page, baseURL }) => {
  const errors = collectErrors(page);
  await page.goto('/app/');
  await waitForApp(page);
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, script: r.active?.scriptURL };
  });
  expect(reg.scope).toBe(`${baseURL}/app/`);
  expect(reg.script).toBe(`${baseURL}/app/sw.js`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const swRes = await page.request.get('/app/sw.js');
  expect(swRes.headers()['cache-control']).toBe('no-cache');
  expect(errors).toEqual([]);
});

test('offline reload of /app/ works after the first visit; /api/* is never served from cache', async ({ page, context }) => {
  await page.goto('/app/');
  await waitForApp(page);
  await apiRegister(page);
  await seedProfile(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Second online visit: the page is now controlled, so lazily loaded modules are runtime-cached.
  await page.reload();
  await waitForApp(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(page.getByTestId('screen-home')).toBeVisible();
  // Visit the main screens once so their modules are cached.
  for (const r of ['/results', '/guide', '/settings', '/home']) {
    await page.evaluate((p) => { location.hash = `#${p}`; }, r);
    await expect(page.locator('html')).toHaveAttribute('data-route', r);
  }

  // Online: API responses bypass the service worker entirely.
  const apiRes = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/me');
  await page.reload();
  expect((await apiRes).fromServiceWorker()).toBe(false);
  await waitForApp(page);

  const cachedUrls = await page.evaluate(async () => {
    const out = [];
    for (const key of await caches.keys()) {
      const c = await caches.open(key);
      for (const req of await c.keys()) out.push(new URL(req.url).pathname);
    }
    return out;
  });
  expect(cachedUrls.length).toBeGreaterThan(5);
  expect(cachedUrls.filter((u) => u.startsWith('/api/'))).toEqual([]);
  expect(cachedUrls.filter((u) => u.startsWith('/app/dev/'))).toEqual([]);

  // Offline: the shell reloads from cache and shows the on-device profile.
  await context.setOffline(true);
  try {
    await page.reload();
    await waitForApp(page);
    await expect(page.getByTestId('screen-home')).toBeVisible();
    await expect(page.getByTestId('home-summary')).toBeVisible();
    for (const r of ['/results', '/guide', '/settings']) {
      await page.evaluate((p) => { location.hash = `#${p}`; }, r);
      await expect(page.locator('html')).toHaveAttribute('data-route', r);
      await expect(page.locator('main h1')).toBeVisible();
    }
    // /api/* is not answered from any cache while offline.
    const api = await page.evaluate(async () => {
      try { const r = await fetch('/api/health', { cache: 'force-cache' }); return `status ${r.status}`; } catch (e) { return `error ${e.name}`; }
    });
    expect(api).toBe('error TypeError');
  } finally {
    await context.setOffline(false);
  }
});

test('offline reload straight after the very first visit (precache only, logged-in user with a profile)', async ({ page, context, baseURL }) => {
  // Log in BEFORE the first page load, so the very first visit is the one that installs the service worker.
  const reg = await page.request.post('/api/auth/register', {
    headers: { Origin: String(baseURL), 'Content-Type': 'application/json' },
    data: JSON.stringify({ email: uniqueEmail('pwa'), password: PASSWORD, lang: 'he', acceptTerms: true }),
  });
  expect(reg.status()).toBe(201);
  await page.goto('/app/');
  await waitForApp(page);
  await seedProfile(page);
  await page.evaluate(() => { location.hash = '#/home'; }); // first visit routed to onboarding (no profile yet)
  await expect(page.getByTestId('screen-home')).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  try {
    await page.reload();
    await waitForApp(page);
    await expect(page.getByTestId('screen-home')).toBeVisible();
    await expect(page.getByTestId('banner-offline')).toBeVisible();
    for (const r of ['/results', '/guide', '/settings', '/viewer/reader']) {
      await page.evaluate((p) => { location.hash = `#${p}`; }, r);
      await expect(page.locator('html')).toHaveAttribute('data-route', r);
    }
    await expect(page.getByTestId('reader')).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
