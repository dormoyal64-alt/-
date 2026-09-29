// @ts-check
/**
 * Device-local UI preferences: theme and "adapt this app to my profile". Applies them to the document.
 */
import { BRAND } from './brand.js';
import { loadModule } from './modules.js';

/** @typedef {'auto'|'light'|'dark'} Theme */

const THEME_KEY = 'va.theme';
const ADAPT_KEY = 'va.adaptUi';

/** @returns {Storage|null} */
function store() {
  try { return window.localStorage; } catch { return null; }
}

/** @returns {Theme} */
export function getTheme() {
  const v = store()?.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

/** @param {Theme} theme */
export function setTheme(theme) {
  try { if (theme === 'auto') store()?.removeItem(THEME_KEY); else store()?.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
}

/** @param {Theme} theme */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  let meta = /** @type {HTMLMetaElement|null} */ (document.querySelector('meta[name="theme-color"]:not([media])'));
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = dark ? BRAND.themeColorDark : BRAND.themeColor;
}

/** Default on: the whole point of the app is to adapt to the user. */
export function getAdaptUi() {
  return store()?.getItem(ADAPT_KEY) !== '0';
}

/** @param {boolean} on */
export function setAdaptUi(on) {
  try { store()?.setItem(ADAPT_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

let paused = false;
let lastApplied = /** @type {string|null} */ (null);

/**
 * Apply (or remove) the profile's UI adaptation via render/apply-ui.js. Silently no-ops when that module
 * isn't available yet. `force` re-applies even when nothing changed (required after any theme change).
 * @param {import('../core/types.js').VisionProfile|null} profile
 * @param {{force?: boolean}} [opts]
 */
export async function applyAdaptation(profile, opts = {}) {
  const effective = paused || !getAdaptUi() ? null : profile;
  const sig = effective ? `${effective.id}:${effective.updatedAt}` : 'none';
  if (sig === lastApplied && !opts.force) return;
  const res = await loadModule('applyUi', 'applyProfileToDocument');
  if (!res.ok) return;
  try {
    res.mod.applyProfileToDocument(effective, document);
    lastApplied = sig;
    // apply-ui may set data-theme from the profile; an explicit choice in Settings wins.
    const theme = getTheme();
    if (theme !== 'auto') applyTheme(theme); else applyTheme(effective?.input?.prefs?.theme === 'dark' || effective?.input?.prefs?.theme === 'light' ? /** @type {Theme} */ (effective.input.prefs.theme) : 'auto');
    document.documentElement.classList.toggle('va-adapted', !!effective);
  } catch (err) {
    console.warn('UI adaptation failed', err);
  }
}

/** Pause adaptation (e.g. during tests, whose stimuli must not be altered). @param {boolean} on */
export function setAdaptationPaused(on) {
  paused = on;
}
