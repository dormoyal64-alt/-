// @ts-check
/**
 * DEV HARNESS — mount one view in isolation for manual and Playwright testing.
 * Query params:
 *   src=js/tests/acuity/acuity-view.js   module path relative to /app/
 *   fn=runAcuityTest                  exported function name
 *   mode=test|viewer                  test: fn returns Promise<result>; viewer: fn returns {destroy()}
 *   lang=he|en  eye=right|left|both  cssPxPerMm=<n>  distanceMm=<n>  age=<n>  profile=demo  tracker=1
 * Result is written as JSON to #result with data-status = running|done|error|aborted|mounted.
 */
import { applyLangToDocument } from '../js/core/i18n.js';
import { DEFAULT_CSS_PX_PER_MM } from '../js/core/types.js';
import { demoProfile } from '../js/core/demo-profile.js';

const q = new URLSearchParams(location.search);
const lang = q.get('lang') === 'en' ? 'en' : 'he';
applyLangToDocument(lang);
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const out = /** @type {HTMLElement} */ (document.getElementById('result'));
const label = /** @type {HTMLElement} */ (document.getElementById('harness-label'));
const controller = new AbortController();

/** @param {string} status @param {unknown} [data] */
function report(status, data) {
  out.dataset.status = status;
  out.textContent = data === undefined ? '' : JSON.stringify(data, null, 2);
}

async function main() {
  const src = q.get('src');
  const fn = q.get('fn');
  const mode = q.get('mode') === 'viewer' ? 'viewer' : 'test';
  if (!src || !fn || src.includes('..') || /^[a-z]+:/i.test(src)) { report('error', { message: 'missing/invalid src or fn' }); return; }
  label.textContent = `${src} :: ${fn} (${mode})`;
  const now = new Date().toISOString();
  const cssPxPerMm = Number(q.get('cssPxPerMm')) || DEFAULT_CSS_PX_PER_MM;
  const ctx = {
    lang,
    eye: /** @type {any} */ (q.get('eye') || 'right'),
    screen: { cssPxPerMm, dpr: window.devicePixelRatio || 1, method: 'default', screenWidthCssPx: screen.width, screenHeightCssPx: screen.height, measuredAt: now },
    distance: { distanceMm: Number(q.get('distanceMm')) || 400, method: 'manual', measuredAt: now },
    age: q.get('age') ? Number(q.get('age')) : undefined,
    signal: controller.signal,
    distanceTracker: null,
    profile: q.get('profile') === 'demo' ? demoProfile() : undefined,
    onProgress: (/** @type {number} */ f) => { document.body.dataset.progress = String(Math.round(f * 100)); },
  };
  const mod = await import(`../${src}`);
  if (typeof mod[fn] !== 'function') { report('error', { message: `export ${fn} not found` }); return; }
  if (q.get('tracker') === '1') {
    try {
      const trackerPath = '../js/calibration/distance-tracker.js';
      const { createDistanceTracker } = await import(trackerPath);
      ctx.distanceTracker = await createDistanceTracker({ screen: ctx.screen, distance: ctx.distance });
    } catch (err) { console.warn('tracker unavailable', err); }
  }
  report('running');
  if (mode === 'viewer') {
    const handle = await mod[fn](stage, ctx);
    report('mounted', { ok: true });
    document.getElementById('harness-abort')?.addEventListener('click', () => { handle?.destroy?.(); report('aborted', { destroyed: true, stageChildren: stage.childElementCount }); });
    return;
  }
  document.getElementById('harness-abort')?.addEventListener('click', () => controller.abort());
  try {
    const result = await mod[fn](stage, ctx);
    report('done', result);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') report('aborted', { stageChildren: stage.childElementCount });
    else { console.error(err); report('error', { message: String(err?.message || err), stack: String(err?.stack || '') }); }
  }
}

main().catch((err) => { console.error(err); report('error', { message: String(err?.message || err) }); });
