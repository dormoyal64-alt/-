// @ts-check
/**
 * A10 — accessibility checks (WCAG 2.1 AA / IS 5568 oriented) on the main screens, Hebrew and English:
 * accessible names (Chromium's computed AX tree), one h1, html lang/dir, touch targets >= 44x44 CSS px,
 * no horizontal scroll at 320 px, text contrast >= 4.5:1 (3:1 for large text), visible focus on Tab.
 * Every check is a soft assertion so one run reports every problem on a screen.
 */
import { test, expect } from '@playwright/test';
import { apiRegister, seedProfile, waitForApp, gotoRoute, collectErrors } from './helpers.js';

const SCREENS = [
  { name: 'welcome', route: '/welcome', auth: false, profile: false },
  { name: 'register', route: '/register', auth: false, profile: false },
  { name: 'paywall', route: '/paywall', auth: true, profile: false },
  { name: 'home', route: '/home', auth: true, profile: true },
  { name: 'results', route: '/results', auth: true, profile: true },
  { name: 'guide', route: '/guide', auth: true, profile: true },
  { name: 'settings', route: '/settings', auth: true, profile: true },
];

const INTERACTIVE_ROLES = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'switch', 'slider', 'combobox', 'spinbutton',
  'searchbox', 'menuitem', 'tab', 'listbox', 'option', 'DisclosureTriangle']);

/** Interactive AX nodes without a computed accessible name (Chromium's accname implementation). */
async function unnamedControls(page) {
  const client = await page.context().newCDPSession(page);
  try {
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const bad = [];
    for (const n of nodes) {
      if (n.ignored) continue;
      const role = n.role?.value;
      if (!INTERACTIVE_ROLES.has(role)) continue;
      const name = String(n.name?.value ?? '').trim();
      if (!name) {
        let desc = '';
        if (n.backendDOMNodeId) {
          try {
            const { object } = await client.send('DOM.resolveNode', { backendNodeId: n.backendDOMNodeId });
            const r = await client.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, functionDeclaration: 'function(){return this.outerHTML.slice(0,160)}' });
            desc = r.result.value;
          } catch { /* detached */ }
        }
        bad.push(`${role}: ${desc}`);
      }
    }
    return bad;
  } finally {
    await client.detach();
  }
}

/** In-page audit: h1 count, lang/dir, touch targets, contrast. */
function pageAudit() {
  const vis = (/** @type {Element} */ el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    if (el.closest('[hidden],[aria-hidden="true"],.va-visually-hidden,.va-print-head')) return false;
    if (r.bottom < 0 || r.right < 0 || r.left > document.documentElement.scrollWidth) return false; // off-screen skip links
    return true;
  };
  // --- colour helpers (canvas normalises any CSS colour syntax to sRGB bytes) ---
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d', { willReadFrequently: true }));
  const rgba = (/** @type {string} */ c) => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = '#000';
    g.fillStyle = c;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const blend = (/** @type {number[]} */ top, /** @type {number[]} */ under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = (/** @type {number[]} */ c) => {
    const f = (/** @type {number} */ v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (/** @type {number[]} */ a, /** @type {number[]} */ b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const backgroundOf = (/** @type {Element} */ el) => {
    const chain = [];
    for (let e = /** @type {Element|null} */ (el); e; e = e.parentElement) chain.push(e);
    let bg = [255, 255, 255, 1];
    for (const e of chain.reverse()) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // gradient/image: not computable
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) bg = blend(c, bg);
    }
    return bg;
  };

  const h1s = [...document.querySelectorAll('h1')].filter(vis).map((h) => h.textContent?.trim().slice(0, 60));

  // --- touch targets ---
  const small = [];
  const controls = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])')];
  for (const el of controls) {
    const input = el instanceof HTMLInputElement && ['radio', 'checkbox', 'range'].includes(el.type) ? el : null;
    const target = input ? (input.closest('label') || (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) || input) : el;
    if (!vis(target) && !(input && vis(input))) continue;
    const cs = getComputedStyle(el);
    // WCAG 2.5.5/2.5.8 inline exception: links inside a sentence.
    if (el.tagName === 'A' && cs.display === 'inline') {
      const parentText = (el.parentElement?.textContent || '').trim();
      if (parentText.length > (el.textContent || '').trim().length + 3) continue;
    }
    const r = target.getBoundingClientRect();
    const w = Math.round(r.width * 10) / 10; const hgt = Math.round(r.height * 10) / 10;
    if (w < 44 || hgt < 44) small.push(`${w}x${hgt} ${target.outerHTML.slice(0, 110)}`);
  }

  // --- text contrast ---
  const lowContrast = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent || !n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || !vis(el)) continue;
    seen.add(el);
    if (el.closest('svg, canvas, .va-test-surface, [data-testid="size-figure"]')) continue;
    const cs = getComputedStyle(el);
    const bg = backgroundOf(el);
    if (!bg) continue;
    let fg = rgba(cs.color);
    fg = blend(fg, bg);
    let op = 1;
    for (let e = /** @type {Element|null} */ (el); e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    if (op < 1) fg = blend([...fg.slice(0, 3), op], bg);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    const cr = ratio(fg, bg);
    if (cr + 1e-6 < need) lowContrast.push(`${cr.toFixed(2)}:1 (need ${need}) fg=${fg.slice(0, 3).map(Math.round)} bg=${bg.slice(0, 3).map(Math.round)} "${n.textContent.trim().slice(0, 40)}" <${el.tagName.toLowerCase()} class="${el.className}">`);
  }
  return {
    checked: { controls: controls.length, textElements: seen.size },
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    h1s,
    small,
    lowContrast,
  };
}

/** Tab through the page and verify each focused element shows a focus indicator. */
async function focusAudit(page, maxTabs = 12) {
  await page.evaluate(() => { /** @type {HTMLElement} */ (document.activeElement)?.blur?.(); window.scrollTo(0, 0); });
  await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => {});
  const missing = [];
  let visited = 0;
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = /** @type {HTMLElement|null} */ (document.activeElement);
      if (!el || el === document.body) return null;
      const has = (/** @type {Element|null} */ e) => {
        if (!e) return false;
        const cs = getComputedStyle(e);
        const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
        const shadow = cs.boxShadow && cs.boxShadow !== 'none';
        return outline || shadow;
      };
      const ok = has(el) || has(el.closest('label')) || has(/** @type {Element|null} */ (el.nextElementSibling)) || has(el.parentElement);
      return { ok, focusVisible: el.matches(':focus-visible'), html: el.outerHTML.slice(0, 120) };
    });
    if (!r) continue;
    visited++;
    if (!r.ok || !r.focusVisible) missing.push(r.html);
  }
  return { visited, missing };
}

/** BUG-03 (known): the standalone "cancellation policy" link on the paywall is ~20 px tall. */
const isKnownSmallTarget = (/** @type {string} */ item) => /href="\/legal\/(en\/)?cancellation\.html"/.test(item);

/** BUG-04 (known): dark theme danger button = white on #ff8a80 (2.28:1). */
const isKnownLowContrast = (/** @type {string} */ item) => / fg=255,255,255 bg=255,138,128 /.test(item);

/**
 * Open a screen as a real user would see it (logged in / profile when the route needs it).
 * @param {import('@playwright/test').Page} page @param {typeof SCREENS[number]} s @param {'he'|'en'} lang @param {{adapt?: boolean}} [o]
 */
async function openScreen(page, s, lang, o = {}) {
  await page.addInitScript(([l, a]) => {
    try { localStorage.setItem('va.lang', l); if (a !== null) localStorage.setItem('va.adaptUi', a); } catch { /* ignore */ }
  }, [lang, o.adapt === undefined ? null : o.adapt ? '1' : '0']);
  await page.goto('/app/');
  await waitForApp(page);
  if (s.auth) await apiRegister(page, { lang });
  if (s.profile) await seedProfile(page);
  if (s.auth) { await page.reload(); await waitForApp(page); }
  await gotoRoute(page, s.route);
  await expect(page.getByTestId(`screen-${s.name}`)).toBeVisible();
  if (s.name === 'paywall') await expect(page.locator('[data-testid^="plan-card-"]')).toHaveCount(3);
  await page.waitForTimeout(300); // let lazy content settle
}

/** @param {import('@playwright/test').Page} page */
async function horizontalOverflow(page) {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const de = document.documentElement;
    const W = de.clientWidth;
    const out = (/** @type {Element} */ e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > W + 1 || b.left < -1); };
    const leaves = [...document.querySelectorAll('body *')].filter((e) => out(e) && ![...e.children].some(out));
    return { scrollWidth: de.scrollWidth, clientWidth: W, culprits: leaves.slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className)} "${(e.textContent || '').trim().slice(0, 24)}"`) };
  });
}

for (const variant of /** @type {const} */ ([
  { lang: 'he', scheme: 'light' }, { lang: 'en', scheme: 'light' }, { lang: 'he', scheme: 'dark' },
])) {
  const { lang, scheme } = variant;
  test.describe(`accessibility (${lang}, ${scheme})`, () => {
    test.use({ locale: lang === 'he' ? 'he-IL' : 'en-US', colorScheme: scheme });

    for (const s of SCREENS) {
      test(`${s.name} screen`, async ({ page }) => {
        const errors = collectErrors(page);
        await openScreen(page, s, lang);

        const unnamed = await unnamedControls(page);
        const audit = await page.evaluate(pageAudit);
        const focus = await focusAudit(page);
        const report = { unnamed, ...audit, focus };
        await test.info().attach(`a11y-${s.name}-${lang}-${scheme}.json`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });

        expect(audit.checked.controls, 'audit saw the controls').toBeGreaterThan(2);
        expect(audit.checked.textElements, 'audit saw the text').toBeGreaterThan(5);
        expect.soft(audit.lang, 'html lang').toBe(lang);
        expect.soft(audit.dir, 'html dir').toBe(lang === 'he' ? 'rtl' : 'ltr');
        expect.soft(unnamed, 'controls without an accessible name').toEqual([]);
        expect.soft(audit.h1s.length, `exactly one visible h1 (got ${JSON.stringify(audit.h1s)})`).toBe(1);
        expect.soft(audit.small.filter((x) => !isKnownSmallTarget(x)), 'touch targets smaller than 44x44 CSS px').toEqual([]);
        expect.soft(audit.lowContrast.filter((x) => !isKnownLowContrast(x)), 'text below WCAG AA contrast').toEqual([]);
        expect.soft(focus.visited, 'Tab reaches interactive elements').toBeGreaterThan(0);
        expect.soft(focus.missing, 'focused elements without a visible focus indicator').toEqual([]);
        expect.soft(errors, 'no page/console errors').toEqual([]);
      });
    }

    if (scheme === 'dark') {
      test('BUG-04: dark-theme danger button text meets 4.5:1', async ({ page }) => {
        await openScreen(page, SCREENS.find((x) => x.name === 'settings'), lang);
        const audit = await page.evaluate(pageAudit);
        expect(audit.lowContrast.filter(isKnownLowContrast)).toEqual([]);
      });
    }

    if (scheme === 'light') {
      test('no horizontal scroll at 320 px (UI adaptation off)', async ({ page }) => {
        for (const s of SCREENS) {
          await page.setViewportSize({ width: 412, height: 900 });
          await openScreen(page, s, lang, { adapt: false });
          const o = await horizontalOverflow(page);
          expect.soft(o.scrollWidth, `${s.name}: ${o.culprits.join(' | ')}`).toBeLessThanOrEqual(o.clientWidth);
        }
      });

      // BUG-02: with the profile's own text scale applied (demo profile => --va-font-scale ≈ 2.5), the app bar
      // (brand name), the tab bar labels, the skip link and some headings do not wrap, so screens scroll sideways
      // at 320 px — WCAG 1.4.10 Reflow fails exactly for the users the adaptation is meant for.
      test('BUG-02: no horizontal scroll at 320 px with the adapted UI (large text scale)', async ({ page }) => {
        const bad = [];
        for (const s of SCREENS.filter((x) => x.profile || x.auth)) {
          await page.setViewportSize({ width: 412, height: 900 });
          await openScreen(page, s, lang, { adapt: true });
          const o = await horizontalOverflow(page);
          if (o.scrollWidth > o.clientWidth) bad.push(`${s.name}: ${o.scrollWidth}px ${o.culprits.join(' | ')}`);
        }
        await test.info().attach(`bug-02-${lang}.txt`, { body: bad.join('\n'), contentType: 'text/plain' });
        expect(bad).toEqual([]);
      });

      test('BUG-03: paywall "cancellation policy" link is a >= 44 px touch target', async ({ page }) => {
        await openScreen(page, SCREENS.find((x) => x.name === 'paywall'), lang);
        const box = await page.locator('main a[href*="cancellation"]').first().boundingBox();
        expect(box && box.height).toBeGreaterThanOrEqual(44);
      });
    }
  });
}
