// @ts-check
/**
 * Reading-test math (vision-science.md §4.2–4.4, items 16–21). Pure module, no DOM.
 * Print size `p` is logMAR of the x-height (Hebrew: body height) at distance d, MNREAD convention:
 * the x-height subtends 5·10^p arcmin.
 */
import { letterHeightMm } from '../acuity/acuity-math.js';

export const READING_PARAMS = Object.freeze({
  stepLog: 0.1,              // print sizes in 0.1-log steps
  maxPrintSize: 1.3,         // MNREAD-like largest size
  minPrintSize: -0.5,        // MNREAD-like smallest size
  minXHeightDevPx: 3,        // below this the glyphs cannot be rendered legibly at all
  maxSentenceMs: 20000,      // stop when a sentence takes more than 20 s
  consecutiveFailuresToStop: 2,
  charsPerStandardWord: 6,   // 60-character sentence = 10 standard-length words
  cpsFraction: 0.8,          // CPS at 80 % of MRS (Cheung et al. 2008)
  fallbackTopN: 3,
  fallbackMinSizes: 4,       // "if the fit fails (fewer than 4 sizes)"
  xRatioFallback: Object.freeze({ he: 0.58, en: 0.52 }),
  maxPlausibleWpm: 700,      // faster than this on a 10-word sentence = tapped through without reading
});

/**
 * Physical x-height (mm) for print size p at distance d: x = 2·d·tan(5·10^p arcmin / 2).
 * @param {number} p @param {number} dMm
 */
export function xHeightMm(p, dMm) {
  return letterHeightMm(p, dMm);
}

/**
 * CSS font-size (px) for print size p (§4.3 steps 4–5): fs = x_mm / xr / mmPerCss.
 * @param {number} p @param {number} dMm @param {number} cssPxPerMm @param {number} xRatio x-height / em
 */
export function fontPxForPrintSize(p, dMm, cssPxPerMm, xRatio) {
  return (xHeightMm(p, dMm) / xRatio) * cssPxPerMm;
}

/**
 * Inverse of fontPxForPrintSize.
 * @param {number} fontPx @param {number} dMm @param {number} cssPxPerMm @param {number} xRatio
 */
export function printSizeForFontPx(fontPx, dMm, cssPxPerMm, xRatio) {
  const xMm = (fontPx * xRatio) / cssPxPerMm;
  const arcmin = (2 * Math.atan(xMm / (2 * dMm))) / (Math.PI / 10800);
  return Math.log10(arcmin / 5);
}

/**
 * Descending print-size sequence in 0.1-log steps, from `start` down to `min` (both rounded to 0.1).
 * @param {number} start @param {number} min
 * @returns {number[]}
 */
export function printSizeSequence(start, min) {
  const hi = Math.round(start * 10);
  const lo = Math.round(min * 10);
  const out = [];
  for (let k = hi; k >= lo; k--) out.push(k / 10);
  return out;
}

/**
 * Largest 0.1-step print size whose widest line (measured as `widestLineEm` ems) fits `availableCssPx`,
 * capped at READING_PARAMS.maxPrintSize.
 * @param {{widestLineEm: number, availableCssPx: number, dMm: number, cssPxPerMm: number, xRatio: number}} o
 */
export function largestFittingPrintSize({ widestLineEm, availableCssPx, dMm, cssPxPerMm, xRatio }) {
  const p = printSizeForFontPx(availableCssPx / widestLineEm, dMm, cssPxPerMm, xRatio);
  return Math.min(READING_PARAMS.maxPrintSize, Math.floor(p * 10 + 1e-9) / 10);
}

/**
 * Smallest 0.1-step print size whose x-height is at least `minXHeightDevPx` device px, floored at −0.5.
 * @param {{dMm: number, cssPxPerMm: number, dpr: number}} o
 */
export function smallestRenderablePrintSize({ dMm, cssPxPerMm, dpr }) {
  const xMm = READING_PARAMS.minXHeightDevPx / (cssPxPerMm * dpr);
  const arcmin = (2 * Math.atan(xMm / (2 * dMm))) / (Math.PI / 10800);
  const p = Math.log10(arcmin / 5);
  return Math.max(READING_PARAMS.minPrintSize, Math.ceil(p * 10 - 1e-9) / 10);
}

/** Standard-length words in a text (characters incl. spaces ÷ 6). @param {string} text */
export function standardWords(text) {
  return text.length / READING_PARAMS.charsPerStandardWord;
}

/**
 * Reading speed in words per minute: 60 × words / time_s.
 * @param {number} words @param {number} timeMs
 */
export function wordsPerMinute(words, timeMs) {
  return timeMs > 0 ? (60 * words) / (timeMs / 1000) : 0;
}

/**
 * @typedef {Object} ReadingPoint
 * @property {number} p        print size (logMAR)
 * @property {number} wpm      reading speed (0 for "can't read" / failed check)
 * @property {boolean} passed  sentence read and check answered correctly
 */

/**
 * Least-squares fit of RS(p) = MRS·(1 − exp(−(p − p0)/τ)) for p > p0 (0 otherwise), item 21.
 * MRS has a closed-form optimum for each (p0, τ); p0 and τ are grid-searched.
 * @param {Array<{p: number, wpm: number}>} points
 * @returns {{mrs: number, p0: number, tau: number, cps: number, sse: number}|null}
 */
export function fitReadingCurve(points) {
  if (points.length < 3) return null;
  const ps = points.map((q) => q.p);
  const pMin = Math.min(...ps);
  const pMax = Math.max(...ps);
  let best = null;
  for (let p0 = pMin - 1.0; p0 <= pMax; p0 += 0.005) {
    for (let j = 0; j <= 120; j++) {
      const tau = 0.01 * 10 ** (j / 50); // 0.01 … ~2.5, log-spaced
      let sfy = 0; let sff = 0;
      const f = points.map((q) => (q.p > p0 ? 1 - Math.exp(-(q.p - p0) / tau) : 0));
      for (let i = 0; i < points.length; i++) { sfy += f[i] * points[i].wpm; sff += f[i] * f[i]; }
      if (sff <= 0) continue;
      const mrs = sfy / sff;
      if (mrs <= 0) continue;
      let sse = 0;
      for (let i = 0; i < points.length; i++) sse += (points[i].wpm - mrs * f[i]) ** 2;
      if (!best || sse < best.sse) best = { mrs, p0, tau, sse, cps: p0 + tau * Math.log(5), atEdge: j === 0 || j === 120 };
    }
  }
  if (!best) return null;
  const { atEdge, ...rest } = best;
  return atEdge ? null : rest;
}

/**
 * @typedef {Object} ReadingAnalysis
 * @property {number|null} cps          critical print size (logMAR)
 * @property {number|null} readingAcuity smallest print size read (logMAR)
 * @property {number} mrs               maximum reading speed (wpm)
 * @property {'fit'|'fallback'|'none'} method
 * @property {boolean} reliable
 * @property {string[]} reasons
 */

/**
 * CPS / reading acuity / maximum reading speed per §4.4.
 * - Fit the exponential-rise model (failed sentences enter as 0 wpm). CPS = p0 + τ·ln 5 (80 % of MRS).
 * - If the fit fails (fewer than 4 sizes read, no plateau inside the tested range, or no convergence):
 *   CPS = smallest size whose speed is ≥ 80 % of the mean of the 3 fastest sizes; MRS = that mean.
 * @param {ReadingPoint[]} points
 * @returns {ReadingAnalysis}
 */
export function analyseReading(points) {
  const P = READING_PARAMS;
  const passed = points.filter((q) => q.passed && q.wpm > 0);
  const reasons = [];
  if (!passed.length) return { cps: null, readingAcuity: null, mrs: 0, method: 'none', reliable: false, reasons: ['nothing-read'] };
  const readingAcuity = Math.min(...passed.map((q) => q.p));
  const speeds = [...passed].sort((a, b) => b.wpm - a.wpm);
  const top = speeds.slice(0, P.fallbackTopN);
  const topMean = top.reduce((a, q) => a + q.wpm, 0) / top.length;

  /** @type {number|null} */
  let cps = null;
  let mrs = topMean;
  /** @type {ReadingAnalysis['method']} */
  let method = 'fallback';
  if (passed.length >= P.fallbackMinSizes) {
    const fit = fitReadingCurve(points.map((q) => ({ p: q.p, wpm: q.passed ? q.wpm : 0 })));
    const pMax = Math.max(...points.map((q) => q.p));
    if (fit && fit.cps <= pMax && fit.cps >= readingAcuity - 0.2 && fit.mrs <= 1.5 * speeds[0].wpm) {
      cps = Math.max(readingAcuity, fit.cps);
      mrs = fit.mrs;
      method = 'fit';
    }
  }
  if (cps === null) {
    const ok = passed.filter((q) => q.wpm >= P.cpsFraction * topMean);
    cps = Math.min(...ok.map((q) => q.p));
  }
  if (passed.length < 3) reasons.push('too-few-sentences');
  if (passed.some((q) => q.wpm > P.maxPlausibleWpm)) reasons.push('implausibly-fast');
  const bigFailures = points.filter((q) => !q.passed && q.p >= readingAcuity + 0.2).length;
  if (bigFailures >= 2) reasons.push('inconsistent');
  return { cps, readingAcuity, mrs, method, reliable: reasons.length === 0, reasons };
}

/**
 * Stopping rule (§4.4): stop after a sentence that took more than 20 s, or after failures at 2 consecutive
 * sizes, or when the smallest size has been shown.
 * @param {Array<{passed: boolean, timeMs: number}>} history @param {boolean} atSmallest
 */
export function shouldStopReading(history, atSmallest) {
  const P = READING_PARAMS;
  if (atSmallest) return true;
  const last = history[history.length - 1];
  if (!last) return false;
  if (last.timeMs > P.maxSentenceMs) return true;
  const tail = history.slice(-P.consecutiveFailuresToStop);
  return tail.length === P.consecutiveFailuresToStop && tail.every((h) => !h.passed);
}
