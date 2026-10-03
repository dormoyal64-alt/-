// @ts-check
/**
 * Lazy loading of modules owned by other agents (calibration, tests, engine, render, viewers).
 * Every load is a dynamic import at the moment it is needed; failures resolve to {ok:false} so screens can
 * show a friendly "not available yet" state instead of crashing.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { SHELL_STRINGS } from './strings.js';
import { emptyState, actionButton, linkButton } from './components.js';

/** Paths relative to this file (public/app/js/shell/). Keep in sync with docs/ARCHITECTURE.md. */
export const MODULE_PATHS = Object.freeze({
  screenCalibration: '../calibration/screen-calibration-view.js',
  distanceCalibration: '../calibration/distance-calibration-view.js',
  distanceTracker: '../calibration/distance-tracker.js',
  focusRange: '../calibration/focus-range-view.js',
  acuity: '../tests/acuity/acuity-view.js',
  reading: '../tests/reading/reading-view.js',
  contrast: '../tests/contrast/contrast-view.js',
  astigmatism: '../tests/astigmatism/astigmatism-view.js',
  color: '../tests/color/color-view.js',
  profile: '../engine/profile.js',
  engineSummary: '../engine/summary.js',
  systemGuide: '../engine/system-guide.js',
  applyUi: '../render/apply-ui.js',
  photoViewer: '../viewers/photo-viewer.js',
  videoViewer: '../viewers/video-viewer.js',
  liveMagnifier: '../viewers/live-magnifier.js',
  reader: '../viewers/reader.js',
});

/** @typedef {keyof typeof MODULE_PATHS} ModuleKey */
/** @typedef {{ok: boolean, mod?: any, reason?: 'offline'|'missing'|'error', error?: unknown}} LoadResult */

/** @type {Map<string, Promise<any>>} */
const loaded = new Map();
/** @type {Map<string, number>} */
const attempts = new Map();

/**
 * @param {ModuleKey|string} key
 * @param {string} [requiredExport]  the function the caller needs (e.g. 'runAcuityTest')
 * @returns {Promise<LoadResult>}
 */
export async function loadModule(key, requiredExport) {
  const rel = /** @type {Record<string, string>} */ (MODULE_PATHS)[key];
  if (!rel) return { ok: false, reason: 'missing' };
  try {
    let p = loaded.get(key);
    if (!p) {
      // Browsers cache failed module fetches per URL; a retry uses a fresh URL so it really refetches.
      const n = attempts.get(key) || 0;
      attempts.set(key, n + 1);
      const url = new URL(rel, import.meta.url);
      if (n > 0) url.searchParams.set('retry', String(n));
      p = import(/* @vite-ignore */ url.href);
      loaded.set(key, p);
    }
    const mod = await p;
    if (requiredExport && typeof mod[requiredExport] !== 'function') {
      loaded.delete(key);
      return { ok: false, reason: 'missing' };
    }
    return { ok: true, mod };
  } catch (error) {
    loaded.delete(key);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return { ok: false, reason: offline ? 'offline' : 'missing', error };
  }
}

/**
 * Friendly "not available yet" state.
 * @param {import('../core/types.js').Lang} lang
 * @param {{reason?: 'offline'|'missing'|'error', onRetry?: () => void, homeHref?: string|null, headingLevel?: 1|2, title?: string, body?: string, testId?: string, extraActions?: Node[]}} [opts]
 */
export function unavailableState(lang, opts = {}) {
  const t = makeT(SHELL_STRINGS, lang);
  const actions = [];
  if (opts.onRetry) actions.push(actionButton(t('retry'), { iconName: 'retest', onClick: opts.onRetry, testId: 'unavailable-retry' }));
  if (opts.extraActions) actions.push(...opts.extraActions);
  if (opts.homeHref !== null) actions.push(linkButton(t('goHome'), opts.homeHref || '#/home', { variant: 'secondary', iconName: 'home' }));
  const body = [opts.body || t('unavailableBody')];
  if (opts.reason === 'offline') body.push(t('unavailableOffline'));
  return h('div', { class: 'va-unavailable' }, emptyState({
    iconName: 'clock', title: opts.title || t('unavailableTitle'), body, actions,
    testId: opts.testId || 'unavailable', headingLevel: opts.headingLevel ?? 1,
  }));
}
