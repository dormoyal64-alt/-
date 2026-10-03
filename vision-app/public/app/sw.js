// @ts-check
/**
 * Service worker for the PWA (scope /app/).
 * - Versioned precache of the app shell (each file added individually; missing files are tolerated).
 * - Navigations: network first, offline fallback to the cached index.
 * - /app/ static assets: cache first (runtime-cached on first use). /app/vendor/**: stale-while-revalidate.
 * - NEVER caches /api/** (not even inside the scope) and ignores /app/dev/**.
 * - Web Share Target: POST /app/share-target stores the shared files/text in a private cache, 303 -> #/share.
 * Bump VERSION on every deploy (together with APP_VERSION in js/shell/brand.js).
 */
/** ServiceWorkerGlobalScope (typed loosely: the project tsconfig uses the DOM lib, not webworker). */
const sw = /** @type {any} */ (self);

const VERSION = '0.1.0-3';
const SHELL_CACHE = `va-shell-${VERSION}`;
const VENDOR_CACHE = 'va-vendor-v1';
const SHARE_CACHE = 'va-share-v1';
const SHARE_META = '/app/__share/meta';

/** Relative to the scope (/app/). Other agents' modules are listed by contract path; missing ones are skipped. */
const PRECACHE = [
  './', 'index.html', 'manifest.webmanifest', 'css/base.css', 'css/app.css',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'js/app.js',
  'js/core/dom.js', 'js/core/i18n.js', 'js/core/storage.js', 'js/core/types.js', 'js/core/ui.js',
  'js/shell/brand.js', 'js/shell/components.js', 'js/shell/dialog.js', 'js/shell/format.js', 'js/shell/guards.js',
  'js/shell/icons.js', 'js/shell/layout.js', 'js/shell/modules.js', 'js/shell/prefs.js', 'js/shell/route-utils.js',
  'js/shell/router.js', 'js/shell/routes.js', 'js/shell/screen-types.js', 'js/shell/store.js', 'js/shell/strings.js',
  'js/shell/sw-client.js',
  'js/account/account.js', 'js/account/api.js', 'js/account/entitlement.js', 'js/account/errors.js', 'js/account/login.js',
  'js/account/password.js', 'js/account/paywall.js', 'js/account/register.js', 'js/account/reset.js', 'js/account/session.js',
  'js/account/strings.js', 'js/account/welcome.js',
  'js/flows/forms.js', 'js/flows/onboarding.js', 'js/flows/onboarding-plan.js', 'js/flows/rx.js', 'js/flows/stage.js', 'js/flows/strings.js',
  'js/screens/flag-messages.js', 'js/screens/guide.js', 'js/screens/guide-progress.js', 'js/screens/handoff.js', 'js/screens/help.js',
  'js/screens/home.js', 'js/screens/not-found.js', 'js/screens/profiles.js', 'js/screens/results.js', 'js/screens/settings.js',
  'js/screens/share.js', 'js/screens/strings.js', 'js/screens/summary.js', 'js/screens/viewer.js',
  // Other modules (contract paths in docs/ARCHITECTURE.md)
  'js/calibration/screen-calibration-view.js', 'js/calibration/distance-calibration-view.js', 'js/calibration/distance-tracker.js',
  'js/calibration/focus-range-view.js', 'js/calibration/calibration-math.js',
  'js/tests/acuity/acuity-view.js', 'js/tests/reading/reading-view.js', 'js/tests/contrast/contrast-view.js',
  'js/tests/astigmatism/astigmatism-view.js', 'js/tests/color/color-view.js',
  'js/engine/profile.js', 'js/engine/system-guide.js', 'js/engine/color-math.js',
  'js/render/apply-ui.js', 'js/render/filter-renderer.js',
  'js/viewers/photo-viewer.js', 'js/viewers/video-viewer.js', 'js/viewers/live-magnifier.js', 'js/viewers/reader.js', 'js/viewers/viewers.css',
  // Their dependencies (statically imported; without them a first offline start/retest fails to load a view).
  // test/unit/shell/sw-precache.test.js checks this list against public/app/js (the research simulator js/sim/** is not shipped).
  'js/calibration/calibration-ui.js', 'js/calibration/face-iris.js', 'js/calibration/strings.js',
  'js/engine/summary.js', 'js/engine/strings/flag-strings.js', 'js/engine/strings/glasses-free-strings.js',
  'js/engine/strings/guide-strings.js', 'js/engine/strings/summary-strings.js',
  'js/render/filter-math.js', 'js/render/view-math.js',
  'js/tests/acuity/acuity-math.js', 'js/tests/acuity/acuity-procedure.js', 'js/tests/acuity/optotype.js', 'js/tests/acuity/quest.js',
  'js/tests/acuity/random.js', 'js/tests/acuity/stimulus-canvas.js', 'js/tests/acuity/view-kit.js',
  'js/tests/astigmatism/astigmatism-math.js', 'js/tests/color/color-plates.js', 'js/tests/color/color-procedure.js',
  'js/tests/contrast/contrast-math.js', 'js/tests/contrast/contrast-procedure.js',
  'js/tests/reading/reading-math.js', 'js/tests/reading/sentences.js',
  'js/viewers/reader-text.js', 'js/viewers/viewer-kit.js', 'js/viewers/viewer-math.js',
];

const scope = () => new URL(sw.registration.scope);

sw.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const base = scope();
    await Promise.all(PRECACHE.map(async (rel) => {
      try {
        await cache.add(new Request(new URL(rel, base).href, { cache: 'reload' }));
      } catch { /* not built yet / offline: tolerated */ }
    }));
  })());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, VENDOR_CACHE, SHARE_CACHE]);
    for (const key of await caches.keys()) if (key.startsWith('va-') && !keep.has(key)) await caches.delete(key);
    await sw.clients.claim();
  })());
});

sw.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cached, never intercepted
  const base = scope().pathname; // "/app/"
  if (req.method === 'POST' && url.pathname === `${base}share-target`) { event.respondWith(handleShare(req)); return; }
  if (req.method !== 'GET' || !url.pathname.startsWith(base)) return;
  if (url.pathname.startsWith(`${base}dev/`) || url.pathname.startsWith(`${base}__share/`)) return;
  if (req.mode === 'navigate') { event.respondWith(networkFirstNavigation(req)); return; }
  if (url.pathname.startsWith(`${base}vendor/`)) { event.respondWith(staleWhileRevalidate(req, event)); return; }
  event.respondWith(cacheFirst(req));
});

/** @param {Request} req */
async function networkFirstNavigation(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && new URL(req.url).pathname === scope().pathname) void cache.put(new URL('index.html', scope()).href, res.clone());
    return res;
  } catch {
    const cached = await cache.match(new URL('index.html', scope()).href) || await cache.match(scope().href);
    return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

/** @param {Request} req */
async function cacheFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') void cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Retry URLs (?retry=n) and similar: fall back to the same file without the query.
    const loose = await cache.match(req, { ignoreSearch: true });
    if (loose) return loose;
    throw err;
  }
}

/** @param {Request} req @param {{waitUntil: (p: Promise<unknown>) => void}} event */
async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(VENDOR_CACHE);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') return cache.put(req, res.clone()).then(() => res);
    return res;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => undefined));
    return hit;
  }
  return refresh;
}

/** Store shared files/text privately, then open #/share. @param {Request} req */
async function handleShare(req) {
  const target = new URL('#/share', scope()).href;
  try {
    const form = await req.formData();
    const cache = await caches.open(SHARE_CACHE);
    for (const key of await cache.keys()) await cache.delete(key);
    /** @type {Array<{key: string, name: string, type: string}>} */
    const files = [];
    const entries = form.getAll('media').filter((f) => typeof f !== 'string');
    for (const [i, f] of entries.slice(0, 10).entries()) {
      const file = /** @type {File} */ (f);
      if (!file.size || !/^(image|video)\//.test(file.type)) continue;
      const key = `/app/__share/file-${Date.now()}-${i}`;
      await cache.put(key, new Response(file, { headers: { 'Content-Type': file.type } }));
      files.push({ key, name: file.name || `shared-${i}`, type: file.type });
    }
    const str = (/** @type {string} */ k) => { const v = form.get(k); return typeof v === 'string' ? v.slice(0, 100_000) : ''; };
    const meta = { files, title: str('title'), text: str('text'), url: str('url'), at: new Date().toISOString() };
    await cache.put(SHARE_META, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* fall through: #/share shows "nothing shared" */ }
  return Response.redirect(target, 303);
}
