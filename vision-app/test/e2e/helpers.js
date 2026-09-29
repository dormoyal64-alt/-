// @ts-check
/**
 * Shared helpers for the A10 end-to-end suites (journey, security, pwa, a11y).
 * Everything here drives the REAL server started by playwright.config.js (NODE_ENV=test, mock payments).
 */
import { expect } from '@playwright/test';

let counter = 0;
/** A unique, valid e-mail per call (parallel workers + projects never collide). */
export function uniqueEmail(tag = 'qa') {
  counter += 1;
  return `${tag}-${process.pid}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

export const PASSWORD = 'Correct-Horse-Battery-9';

/**
 * Collect page errors and console errors. The anonymous GET /api/me -> 401 is expected (session probe) and is
 * filtered precisely: only a console "Failed to load resource ... 401" whose location is exactly /api/me.
 * @param {import('@playwright/test').Page} page
 */
export function collectErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const loc = msg.location()?.url || '';
    if (/status of 401/.test(text) && new URL(loc, 'http://x').pathname === '/api/me') return;
    errors.push(`console.error: ${text} @ ${loc}`);
  });
  return errors;
}

/**
 * Register a fresh account through the API using the page's cookie jar (same origin => passes the CSRF guard).
 * @param {import('@playwright/test').Page} page  must already be on the app origin
 * @param {{email?: string, lang?: 'he'|'en'}} [o]
 */
export async function apiRegister(page, o = {}) {
  const email = o.email || uniqueEmail('api');
  const res = await page.evaluate(async ({ email, password, lang }) => {
    const r = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ email, password, lang, acceptTerms: true }),
    });
    return { status: r.status, body: await r.json() };
  }, { email, password: PASSWORD, lang: o.lang || 'he' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { email, ...res.body };
}

/**
 * Save a VisionProfile on the device exactly as onboarding does (engine computeProfile on the demo input),
 * optionally with a custom name. Also acknowledges the disclaimer.
 * @param {import('@playwright/test').Page} page
 * @param {{name?: string}} [o]
 */
export async function seedProfile(page, o = {}) {
  return page.evaluate(async ({ name }) => {
    const storage = await import('/app/js/core/storage.js');
    const demo = await import('/app/js/core/demo-profile.js');
    const engine = await import('/app/js/engine/profile.js');
    const input = demo.demoProfile().input;
    const profile = engine.computeProfile(input, { id: storage.newId(), name: name || 'QA', now: Date.now() });
    storage.saveProfile(profile);
    storage.setActiveProfileId(profile.id);
    try { localStorage.setItem('va.disclaimerAck', new Date().toISOString()); } catch { /* ignore */ }
    return profile.id;
  }, { name: o.name || 'QA' });
}

/** Navigate inside the PWA by hash and wait for the routed screen to be ready. */
export async function gotoRoute(page, path) {
  await page.evaluate((p) => { location.hash = `#${p}`; }, path);
  await expect(page.locator('html')).toHaveAttribute('data-route', path);
}

/**
 * Wait for the app shell to finish booting on /app/.
 * @param {import('@playwright/test').Page} page
 */
export async function waitForApp(page) {
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
}

/**
 * Drive the measurement steps of onboarding (from the screen calibration to the end) like a scripted observer:
 * it answers every stimulus using the test hooks the views expose (data-orientation / data-answer /
 * data-correct) and records the sequence of stage titles it went through.
 * @param {import('@playwright/test').Page} page
 * @param {{untilHash: RegExp, maxMs?: number, readingDwellMs?: number, onScreen?: (id: string) => Promise<boolean|void>}} opts
 *   onScreen may handle a screen itself (return true) before the default handler runs.
 * @returns {Promise<string[]>} stage titles in order of appearance
 */
export async function autopilot(page, { untilHash, maxMs = 420_000, readingDwellMs = 1200, onScreen }) {
  const titles = [];
  const started = Date.now();
  let idle = 0;
  while (!untilHash.test(new URL(page.url()).hash)) {
    if (Date.now() - started > maxMs) throw new Error(`autopilot timed out; titles so far: ${titles.join(' | ')}`);
    const snap = await page.evaluate(() => {
      const q = (/** @type {string} */ s) => /** @type {HTMLElement|null} */ (document.querySelector(s));
      const vis = (/** @type {Element|null} */ el) => !!el && /** @type {HTMLElement} */ (el).offsetParent !== null;
      const pad = q('.va-pad');
      const stageTitle = q('[data-testid="stage-title"]')?.textContent || '';
      const acuity = q('[data-testid="acuity-canvas"]');
      const contrast = q('[data-testid="contrast-canvas"]');
      const plate = q('[data-testid="color-plate"]');
      const ids = [...document.querySelectorAll('[data-testid]')].filter(vis).map((e) => e.getAttribute('data-testid'));
      return {
        stageTitle,
        ids,
        padEnabled: !!pad && !pad.classList.contains('is-disabled'),
        orientation: acuity?.dataset.orientation || contrast?.dataset.orientation || null,
        plateAnswer: plate?.dataset.answer || null,
      };
    }).catch(() => null);
    if (!snap) { await page.waitForTimeout(200); continue; }
    if (snap.stageTitle && titles[titles.length - 1] !== snap.stageTitle) titles.push(snap.stageTitle);
    const has = (/** @type {string} */ id) => snap.ids.includes(id);
    const tid = (/** @type {string} */ id) => page.getByTestId(id).first();
    let acted = true;
    const custom = onScreen ? await onScreen(snap.ids.join(' ')) : false;
    if (custom) { /* handled by caller */ }
    else if (snap.ids.some((i) => i.startsWith('step-problem-') || i.startsWith('compute-error'))) {
      throw new Error(`onboarding problem screen: ${snap.ids.join(',')} at "${snap.stageTitle}"`);
    } else if (has('tracker-prompt')) await tid('tracker-skip').click();
    else if (has('optional-focus')) await tid('optional-skip').click();
    else if (has('acuity-test') || has('contrast-test')) {
      if (snap.orientation && snap.padEnabled) {
        await tid(`pad-${snap.orientation}`).click();
        await page.waitForFunction(() => {
          const c = document.querySelector('[data-testid="acuity-canvas"],[data-testid="contrast-canvas"]');
          return !c || !(/** @type {HTMLElement} */ (c)).dataset.orientation;
        }, null, { timeout: 5000 }).catch(() => {});
      } else acted = false;
    } else if (has('color-test')) {
      if (snap.plateAnswer && snap.padEnabled) {
        await tid(`pad-${snap.plateAnswer}`).click();
        await page.waitForFunction(() => !(/** @type {HTMLElement|null} */ (document.querySelector('[data-testid="color-plate"]')))?.dataset.answer, null, { timeout: 5000 }).catch(() => {});
      } else acted = false;
    } else if (has('color-match-screen')) await tid('color-match-done').click();
    else if (has('reading-question')) await page.locator('[data-testid^="reading-option-"][data-correct="true"]').first().click();
    else if (has('reading-test')) { await page.waitForTimeout(readingDwellMs); await tid('reading-done').click(); }
    else if (has('astig-test')) await tid('astig-same').click();
    else if (has('instruction-primary')) await tid('instruction-primary').click();
    else acted = false;
    if (!acted) { idle += 1; await page.waitForTimeout(100); } else idle = 0;
    if (idle > 600) throw new Error(`autopilot stuck (60 s without a known screen): ${snap.ids.join(',')} at "${snap.stageTitle}"`);
  }
  return titles;
}

/** Relative luminance (WCAG 2.x) of an sRGB colour string "rgb(r, g, b[, a])". */
export function parseRgb(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}
