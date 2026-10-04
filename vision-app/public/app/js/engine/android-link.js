// @ts-check
/**
 * LINK TO THE SEETUNED ANDROID APP — pure (no DOM).
 *
 * On Android / Samsung Galaxy the web app cannot change system settings. The companion Android app
 * (vision-app/android) can, once the user grants it access. This module builds the "recipe" it receives:
 * display values only (text size, bold, contrast, colour filter, display size, and the photo/video lens
 * parameters), never the eye-test measurements. The recipe travels on the device only, inside an Android
 * intent link that Chrome and Samsung Internet hand to the app.
 *
 * Format (version 1), as the query of seetuned://apply:
 *   v=1  lang=he|en
 *   font=<Android font scale, 0.85..2>   fontx=1 when even the largest step is below the recommended size
 *   ds=<Display size / Screen zoom steps above default, 0..6>   dsmax=1 for "the largest"
 *   bold=1  contrast=medium|high  cvd=protan|deutan|tritan  cvdi=<0..1>  dim=1  dark=1  mag=1
 *   Lens (FilterParams of profile.media): lm=<9 numbers, row-major linear RGB>  lc lb ls lsa lss lz lw  linv=1
 * The Android side (android/core Recipe.kt) re-validates and clamps every value; keep both in sync.
 */
import { androidSettings } from './system-guide.js';
import { sanitizeParams, isIdentityMatrix } from '../render/filter-math.js';

/** @typedef {import('../core/types.js').VisionProfile} VisionProfile */
/** @typedef {import('../core/types.js').Lang} Lang */

export const ANDROID_PACKAGE = 'com.seetuned.companion';
export const ANDROID_SCHEME = 'seetuned';
export const RECIPE_VERSION = 1;

/** @param {number} v @param {number} [d] */
function fmt(v, d = 4) {
  const f = 10 ** d;
  const r = Math.round(v * f) / f;
  return String(Object.is(r, -0) ? 0 : r);
}

/**
 * The recipe for a profile, as URLSearchParams (stable key order, so links are reproducible).
 * @param {Partial<VisionProfile>|null|undefined} profile
 * @param {Lang} lang
 * @returns {URLSearchParams}
 */
export function buildAndroidRecipe(profile, lang) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const and = androidSettings(/** @type {any} */ (p.system));
  const tg = and.target;
  const q = new URLSearchParams();
  q.set('v', String(RECIPE_VERSION));
  q.set('lang', lang === 'en' ? 'en' : 'he');
  q.set('font', fmt(and.fontStep.scale, 2));
  if (and.fontStep.exceeds) q.set('fontx', '1');
  if (and.displaySteps > 0) q.set('ds', String(Math.min(6, and.displaySteps)));
  if (and.displayMax) q.set('dsmax', '1');
  if (tg.boldText) q.set('bold', '1');
  if (tg.increaseContrast) q.set('contrast', tg.contrastLevel === 'high' ? 'high' : 'medium');
  if (tg.colorFilter) {
    q.set('cvd', tg.colorFilter.type);
    q.set('cvdi', fmt(tg.colorFilter.intensity, 2));
  }
  if (tg.reduceWhitePoint) q.set('dim', '1');
  if (tg.darkMode) q.set('dark', '1');
  if (and.magnification) q.set('mag', '1');

  const m = sanitizeParams(/** @type {any} */ (p.media));
  if (!isIdentityMatrix(m.colorMatrix)) q.set('lm', m.colorMatrix.map((x) => fmt(x)).join(','));
  if (m.contrast !== 1) q.set('lc', fmt(m.contrast, 3));
  if (m.brightness !== 1) q.set('lb', fmt(m.brightness, 3));
  if (m.saturation !== 1) q.set('ls', fmt(m.saturation, 3));
  if (m.sharpenAmount > 0) {
    q.set('lsa', fmt(m.sharpenAmount, 3));
    q.set('lss', fmt(m.sharpenSigmaPx, 3));
  }
  if (m.zoom !== 1) q.set('lz', fmt(m.zoom, 3));
  if (m.warmth > 0) q.set('lw', fmt(m.warmth, 3));
  if (m.invert) q.set('linv', '1');
  return q;
}

/**
 * The link a page opens to hand the recipe to the Android app. With the app installed, Chrome / Samsung
 * Internet open it directly; without it they load `fallbackUrl` (must be http/https) instead.
 * @param {URLSearchParams} recipe
 * @param {string} fallbackUrl
 */
export function androidIntentUrl(recipe, fallbackUrl) {
  const parts = [`scheme=${ANDROID_SCHEME}`, `package=${ANDROID_PACKAGE}`];
  if (/^https?:\/\//i.test(fallbackUrl || '')) parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`);
  return `intent://apply?${recipe.toString()}#Intent;${parts.join(';')};end`;
}

/** The same recipe as a plain app link (used by tests and by `adb shell am start -d`). @param {URLSearchParams} recipe */
export function androidAppLink(recipe) {
  return `${ANDROID_SCHEME}://apply?${recipe.toString()}`;
}
