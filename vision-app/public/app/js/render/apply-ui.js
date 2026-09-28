// @ts-check
/**
 * Adapts the app's OWN UI to a VisionProfile:
 *   - typography: --va-font-scale, --va-font-weight, --va-line-height, --va-letter-spacing, --va-word-spacing on :root
 *     (consumed by css/base.css) from profile.text;
 *   - colour: profile.ui (colour matrix in linear RGB, then warmth/brightness/contrast, saturation, invert in sRGB —
 *     same order as filter-math.js) as ONE SVG <filter id="va-ui-filter"> referenced by `filter` on the ROOT element.
 *     The root element is the one element where `filter` does not create a containing block for fixed-position
 *     descendants (Filter Effects 1 §5), so fixed headers/dialogs keep working.
 *     A neutral profile.ui (identity matrix, contrast 1, …) installs NO filter (zero cost);
 *   - theme: data-theme from profile.input.prefs.theme ('light' | 'dark'; 'auto' removes it).
 * applyProfileToDocument(null) removes every change.
 *
 * Media viewers render photos/video through their own (stronger) pipeline; they call suspendUiFilter() while
 * mounted so media is not filtered twice.
 *
 * The pure helpers (profileToCssVars, matrixToFeColorMatrixValues, uiFilterPrimitives) have no DOM dependency.
 */
import { isIdentityMatrix, sanitizeParams, LUMA, WARMTH_GREEN, WARMTH_BLUE, clamp } from './filter-math.js';

/** @typedef {import('../core/types.js').VisionProfile} VisionProfile */
/** @typedef {import('../core/types.js').FilterParams} FilterParams */
/** @typedef {{tag: string, attrs: Record<string, string>, children?: Array<{tag: string, attrs: Record<string, string>}>}} Primitive */

export const UI_FILTER_ID = 'va-ui-filter';
export const UI_FILTER_SVG_ID = 'va-ui-filter-svg';
export const CSS_VAR_NAMES = Object.freeze(['--va-font-scale', '--va-font-weight', '--va-line-height', '--va-letter-spacing', '--va-word-spacing']);
const FILTER_VALUE = `url(#${UI_FILTER_ID})`;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Compact number formatting for attribute values. @param {number} n */
function fmt(n) {
  const r = Math.round(n * 1e6) / 1e6;
  return String(Object.is(r, -0) ? 0 : r);
}

/**
 * CSS custom properties for the profile's typography. Values are clamped to sane ranges.
 * @param {VisionProfile|null|undefined} profile
 * @returns {Record<string, string>}  empty when there is no profile / text params
 */
export function profileToCssVars(profile) {
  const t = profile?.text;
  if (!t || typeof t !== 'object') return {};
  /** @type {Record<string, string>} */
  const out = {};
  const scale = Number.isFinite(t.scale) && t.scale > 0 ? t.scale : (Number.isFinite(t.baseFontPx) ? t.baseFontPx / 16 : NaN);
  if (Number.isFinite(scale)) out['--va-font-scale'] = fmt(clamp(scale, 0.75, 4));
  if (Number.isFinite(t.fontWeight)) out['--va-font-weight'] = String(Math.round(clamp(t.fontWeight, 100, 900)));
  if (Number.isFinite(t.lineHeight)) out['--va-line-height'] = fmt(clamp(t.lineHeight, 1, 3));
  if (Number.isFinite(t.letterSpacingEm)) out['--va-letter-spacing'] = `${fmt(clamp(t.letterSpacingEm, -0.05, 0.5))}em`;
  if (Number.isFinite(t.wordSpacingEm)) out['--va-word-spacing'] = `${fmt(clamp(t.wordSpacingEm, -0.1, 1))}em`;
  return out;
}

/**
 * Row-major 3x3 -> the 20 values of an SVG feColorMatrix type="matrix" (4x5, alpha untouched).
 * @param {ArrayLike<number>} m
 */
export function matrixToFeColorMatrixValues(m) {
  const v = [
    m[0], m[1], m[2], 0, 0,
    m[3], m[4], m[5], 0, 0,
    m[6], m[7], m[8], 0, 0,
    0, 0, 0, 1, 0,
  ];
  return v.map(fmt).join(' ');
}

/**
 * Describe the SVG filter primitives needed for profile.ui (pure). Empty array => no filter needed.
 * Order matches filter-math.js: matrix (linearRGB) -> warmth·brightness·contrast (sRGB, one linear transfer)
 * -> saturation (sRGB, Rec.709 luma) -> invert (sRGB). Sharpening and zoom do not apply to the UI.
 * @param {Partial<FilterParams>|null|undefined} ui
 * @returns {Primitive[]}
 */
export function uiFilterPrimitives(ui) {
  if (!ui) return [];
  const p = sanitizeParams(ui);
  /** @type {Primitive[]} */
  const prims = [];
  if (!isIdentityMatrix(p.colorMatrix)) {
    prims.push({ tag: 'feColorMatrix', attrs: { type: 'matrix', values: matrixToFeColorMatrixValues(p.colorMatrix), 'color-interpolation-filters': 'linearRGB' } });
  }
  if (p.warmth !== 0 || p.brightness !== 1 || p.contrast !== 1) {
    const k = p.brightness * p.contrast;
    const intercept = fmt(0.5 * (1 - p.contrast));
    const slopes = [k, (1 - WARMTH_GREEN * p.warmth) * k, (1 - WARMTH_BLUE * p.warmth) * k];
    prims.push({
      tag: 'feComponentTransfer', attrs: { 'color-interpolation-filters': 'sRGB' },
      children: ['feFuncR', 'feFuncG', 'feFuncB'].map((tag, i) => ({ tag, attrs: { type: 'linear', slope: fmt(slopes[i]), intercept } })),
    });
  }
  if (p.saturation !== 1) {
    const s = p.saturation;
    const row = (/** @type {number} */ i) => [0, 1, 2].map((j) => (1 - s) * LUMA[j] + (i === j ? s : 0)).concat([0, 0]);
    const values = [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0].map(fmt).join(' ');
    prims.push({ tag: 'feColorMatrix', attrs: { type: 'matrix', values, 'color-interpolation-filters': 'sRGB' } });
  }
  if (p.invert) {
    prims.push({
      tag: 'feComponentTransfer', attrs: { 'color-interpolation-filters': 'sRGB' },
      children: ['feFuncR', 'feFuncG', 'feFuncB'].map((tag) => ({ tag, attrs: { type: 'linear', slope: '-1', intercept: '1' } })),
    });
  }
  return prims;
}

/** @type {WeakMap<Document, {suspended: number, want: boolean}>} */
const docState = new WeakMap();
/** @param {Document} doc */
function stateFor(doc) {
  let st = docState.get(doc);
  if (!st) { st = { suspended: 0, want: false }; docState.set(doc, st); }
  return st;
}

/** @param {Document} doc */
function syncRootFilter(doc) {
  const st = stateFor(doc);
  const style = doc.documentElement.style;
  if (st.want && st.suspended === 0) {
    if (style.filter !== FILTER_VALUE) style.filter = FILTER_VALUE;
  } else if (style.filter === FILTER_VALUE) {
    style.removeProperty('filter');
  }
}

/**
 * @param {Document} doc
 * @param {Primitive[]} prims
 */
function installFilter(doc, prims) {
  const key = JSON.stringify(prims);
  let svg = /** @type {SVGSVGElement|null} */ (doc.getElementById(UI_FILTER_SVG_ID));
  if (!svg) {
    svg = /** @type {SVGSVGElement} */ (doc.createElementNS(SVG_NS, 'svg'));
    svg.setAttribute('id', UI_FILTER_SVG_ID);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.style.overflow = 'hidden';
    svg.style.pointerEvents = 'none';
    const defs = doc.createElementNS(SVG_NS, 'defs');
    const filter = doc.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', UI_FILTER_ID);
    filter.setAttribute('color-interpolation-filters', 'linearRGB');
    // Generous region so fixed-position content outside the root's box (short pages) is not clipped.
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('x', '-100000');
    filter.setAttribute('y', '-100000');
    filter.setAttribute('width', '200000');
    filter.setAttribute('height', '200000');
    defs.appendChild(filter);
    svg.appendChild(defs);
    (doc.body || doc.documentElement).appendChild(svg);
  }
  if (svg.dataset.vaKey === key) return;
  const filter = /** @type {SVGFilterElement} */ (svg.querySelector('filter'));
  while (filter.firstChild) filter.removeChild(filter.firstChild);
  for (const p of prims) {
    const el = doc.createElementNS(SVG_NS, p.tag);
    for (const [k, v] of Object.entries(p.attrs)) el.setAttribute(k, v);
    for (const c of p.children || []) {
      const ch = doc.createElementNS(SVG_NS, c.tag);
      for (const [k, v] of Object.entries(c.attrs)) ch.setAttribute(k, v);
      el.appendChild(ch);
    }
    filter.appendChild(el);
  }
  svg.dataset.vaKey = key;
}

/**
 * Apply (or with null, remove) the profile's UI adaptation to a document.
 * @param {VisionProfile|null|undefined} profile
 * @param {Document} [doc]
 */
export function applyProfileToDocument(profile, doc = document) {
  const root = doc.documentElement;
  const vars = profileToCssVars(profile);
  for (const name of CSS_VAR_NAMES) {
    if (vars[name] !== undefined) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }
  const theme = profile?.input?.prefs?.theme;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');

  const prims = profile ? uiFilterPrimitives(profile.ui) : [];
  const st = stateFor(doc);
  if (prims.length) {
    installFilter(doc, prims);
    st.want = true;
  } else {
    st.want = false;
    doc.getElementById(UI_FILTER_SVG_ID)?.remove();
  }
  syncRootFilter(doc);
}

/**
 * Temporarily lift the UI colour filter (e.g. while a media viewer shows content through its own pipeline).
 * Reference-counted; returns an idempotent release function.
 * @param {Document} [doc]
 * @returns {() => void}
 */
export function suspendUiFilter(doc = document) {
  const st = stateFor(doc);
  st.suspended++;
  syncRootFilter(doc);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    st.suspended = Math.max(0, st.suspended - 1);
    syncRootFilter(doc);
  };
}
