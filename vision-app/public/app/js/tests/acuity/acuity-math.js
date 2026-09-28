// @ts-check
/**
 * Acuity geometry and conversions (vision-science.md §1.3, §3.1, items 4 and 10). Pure module, no DOM.
 * logMAR `L`, distance `d` in mm, sizes in mm / CSS px / device px.
 */

/** 1 arcmin in radians (π/10800). */
export const ARCMIN_RAD = Math.PI / 10800;

/** Minimum stroke width in device pixels for any presented acuity level (§1.3 rule 5). */
export const MIN_STROKE_DEV_PX = 1.0;

/** Surround bars (§3.3): 1 stroke thick, 5 strokes long, 2.5 strokes edge-to-edge gap. */
export const SURROUND = Object.freeze({ thickness: 1, length: 5, gap: 2.5 });

/** Total stimulus extent in strokes, letter plus surround bars on both sides: 5 + 2·(2.5 + 1) = 12. */
export const STIMULUS_EXTENT_STROKES = 5 + 2 * (SURROUND.gap + SURROUND.thickness);

/**
 * Physical letter height (item 10): h = 2·d·tan((5·10^L arcmin)/2).
 * @param {number} L @param {number} dMm
 */
export function letterHeightMm(L, dMm) {
  return 2 * dMm * Math.tan((5 * 10 ** L * ARCMIN_RAD) / 2);
}

/**
 * Stroke (= gap = MAR) width (item 4): stroke = 2·d·tan(10^L · π/21600).
 * The drawn letter is exactly 5 strokes.
 * @param {number} L @param {number} dMm
 */
export function strokeMm(L, dMm) {
  return 2 * dMm * Math.tan((10 ** L * Math.PI) / 21600);
}

/** mm → CSS px. @param {number} mm @param {number} cssPxPerMm */
export function mmToCssPx(mm, cssPxPerMm) {
  return mm * cssPxPerMm;
}

/**
 * Physical millimetres per device pixel: mmPerDev = mmPerCss / dpr.
 * @param {number} cssPxPerMm @param {number} dpr
 */
export function mmPerDevicePx(cssPxPerMm, dpr) {
  return 1 / (cssPxPerMm * dpr);
}

/**
 * Stroke width in CSS px for logMAR L at distance d.
 * @param {number} L @param {number} dMm @param {number} cssPxPerMm
 */
export function strokeCssPx(L, dMm, cssPxPerMm) {
  return strokeMm(L, dMm) * cssPxPerMm;
}

/**
 * Stroke width in device px: stroke_dev = 2·d·tan(MAR·π/21600) / mmPerDev.
 * @param {number} L @param {number} dMm @param {number} cssPxPerMm @param {number} dpr
 */
export function strokeDevicePx(L, dMm, cssPxPerMm, dpr) {
  return strokeMm(L, dMm) / mmPerDevicePx(cssPxPerMm, dpr);
}

/**
 * Letter height in CSS px (5 strokes).
 * @param {number} L @param {number} dMm @param {number} cssPxPerMm
 */
export function optotypeCssPx(L, dMm, cssPxPerMm) {
  return 5 * strokeCssPx(L, dMm, cssPxPerMm);
}

/**
 * logMAR whose stroke is `strokeMmValue` at distance d (inverse of strokeMm).
 * @param {number} strokeMmValue @param {number} dMm
 */
export function logMARForStrokeMm(strokeMmValue, dMm) {
  const marArcmin = (2 * Math.atan(strokeMmValue / (2 * dMm))) / ARCMIN_RAD;
  return Math.log10(marArcmin);
}

/**
 * Smallest logMAR that can be rendered with stroke_dev ≥ minStrokeDevPx (§1.3 rule 5).
 * @param {number} dMm @param {number} cssPxPerMm @param {number} dpr @param {number} [minStrokeDevPx]
 */
export function minRenderableLogMAR(dMm, cssPxPerMm, dpr, minStrokeDevPx = MIN_STROKE_DEV_PX) {
  return logMARForStrokeMm(minStrokeDevPx * mmPerDevicePx(cssPxPerMm, dpr), dMm);
}

/**
 * Largest logMAR whose full stimulus (letter + surround bars, 12 strokes) fits into `availableCssPx`.
 * @param {number} dMm @param {number} cssPxPerMm @param {number} availableCssPx
 * @param {number} [extentStrokes]
 */
export function maxFittingLogMAR(dMm, cssPxPerMm, availableCssPx, extentStrokes = STIMULUS_EXTENT_STROKES) {
  return logMARForStrokeMm(availableCssPx / extentStrokes / cssPxPerMm, dMm);
}

/** Decimal acuity V = 10^−L. @param {number} L */
export function decimalFromLogMAR(L) {
  return 10 ** -L;
}

// Conventional rounded chart denominators, one per 0.1 logMAR step within a decade (§3.1 table).
const SNELLEN6 = [6, 7.5, 9.5, 12, 15, 19, 24, 30, 38, 48];
const SNELLEN20 = [20, 25, 32, 40, 50, 63, 80, 100, 125, 160];

/** @param {number} L @param {number[]} series */
function chartDenominator(L, series) {
  const k = Math.round(L * 10);
  const decade = Math.floor(k / 10);
  const within = k - decade * 10;
  return Number((series[within] * 10 ** decade).toPrecision(4));
}

/** Snellen metric "6/x" using the conventional chart denominators (nearest 0.1 logMAR line). @param {number} L */
export function snellen6(L) {
  return `6/${chartDenominator(L, SNELLEN6)}`;
}

/** Snellen imperial "20/x" using the conventional chart denominators. @param {number} L */
export function snellen20(L) {
  return `20/${chartDenominator(L, SNELLEN20)}`;
}

/** M-units at distance d: M = d_m · 10^L. @param {number} L @param {number} dMm */
export function mUnits(L, dMm) {
  return (dMm / 1000) * 10 ** L;
}

/** ETDRS letter score ≈ 85 − 50·L. @param {number} L */
export function etdrsLetters(L) {
  return 85 - 50 * L;
}
