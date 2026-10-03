// @ts-check
/**
 * EVALUATION against ground truth (validation-only). Given a SimRun (pipeline.js) it scores:
 * (a) measurement accuracy, (b) legibility WITHOUT glasses (acuity reserve of the rendered body text for the TRUE eye,
 * at the recommended distance and with comfortable accommodation), and the default 16 px at the habitual distance as
 * the "no app" baseline, (c) practicality (characters per line on a 360-CSS-px phone, distance range).
 *
 * Reserve = rendered x-height angle / threshold x-height angle (5·10^T arcmin). Latin uses x-height 0.52 em;
 * Hebrew uses body height 0.58 em AND the ×1.12 Hebrew legibility margin (spec §4.2) — the smaller reserve counts.
 * PASS ≥ 2.0 (0.3 log, fluent reading), READABLE 1.4–2.0, FAIL < 1.4.
 */
import { binocularLogMARAt, farPointMm, nearPointMm, sharpRangeMm, sphericalEquivalent } from './eye-model.js';
import { XR_LATIN, XR_HEBREW, HEBREW_MARGIN } from '../engine/profile.js';

/** @typedef {import('./pipeline.js').SimRun} SimRun */

const ARCMIN_RAD = Math.PI / 10800;
/** Usable line width on a 360-CSS-px phone (16 px side padding). */
export const LINE_WIDTH_CSS = 360 - 32;
/** Average advance width per character incl. spaces (em): Latin system sans ≈ 0.50, Hebrew ≈ 0.56. */
export const CHAR_EM = Object.freeze({ latin: 0.5, hebrew: 0.56 });
export const PASS_RESERVE = 2.0;
export const READABLE_RESERVE = 1.4;

/** @param {number} r */
export const legibilityClass = (r) => (r >= PASS_RESERVE ? 'PASS' : r >= READABLE_RESERVE ? 'READABLE' : 'FAIL');

/**
 * Acuity reserve of body text for the true eyes.
 * @param {{eyes: import('./eye-model.js').SimulatedEye[], fontPx: number, distanceMm: number, pxPerMm: number, mode?: 'max'|'comfortable'}} o
 */
export function textReserve({ eyes, fontPx, distanceMm, pxPerMm, mode = 'comfortable' }) {
  const T = binocularLogMARAt(eyes, distanceMm, mode);
  const thr = 5 * 10 ** T;
  const ang = (/** @type {number} */ xr) => (2 * Math.atan((fontPx * xr) / pxPerMm / (2 * distanceMm))) / ARCMIN_RAD;
  const latin = ang(XR_LATIN) / thr;
  const hebrew = ang(XR_HEBREW) / HEBREW_MARGIN / thr;
  return { T, latin, hebrew, reserve: Math.min(latin, hebrew) };
}

/** Characters per line at a font size. @param {number} fontPx @param {number} [letterSpacingEm] */
export function charsPerLine(fontPx, letterSpacingEm = 0) {
  return {
    latin: Math.floor(LINE_WIDTH_CSS / (fontPx * (CHAR_EM.latin + letterSpacingEm))),
    hebrew: Math.floor(LINE_WIDTH_CSS / (fontPx * (CHAR_EM.hebrew + letterSpacingEm))),
  };
}

/**
 * Score one simulated run.
 * @param {SimRun} run
 */
export function evaluateRun(run) {
  const { user, eyes, profile, input } = run;
  const both = [eyes.right, eyes.left];
  const pxTrue = user.device.cssPxPerMm;
  const dh = user.habitualMm;
  const gf = profile.glassesFree || null;
  const dRec = gf?.recommendedDistanceMm ?? profile.viewing.recommendedDistanceMm ?? null;
  const dEval = dRec ?? dh;
  // (a) measurement accuracy — truth at the distance the test was taken (habitual), full accommodation (brief test)
  const truthR = binocularLogMARAt([eyes.right], dh, 'max');
  const truthL = binocularLogMARAt([eyes.left], dh, 'max');
  const truthB = binocularLogMARAt(both, dh, 'max');
  const acc = {
    right: { measured: input.acuity.right?.logMAR ?? null, truth: truthR, floorLimited: !!input.acuity.right?.floorLimited, reliable: input.acuity.right?.reliable !== false },
    left: { measured: input.acuity.left?.logMAR ?? null, truth: truthL, floorLimited: !!input.acuity.left?.floorLimited, reliable: input.acuity.left?.reliable !== false },
    both: { measured: run.acuityBoth.logMAR, truth: truthB, floorLimited: !!run.acuityBoth.floorLimited, reliable: run.acuityBoth.reliable },
  };
  const fp = [farPointMm(eyes.right), farPointMm(eyes.left)].filter((v) => v !== null);
  const npts = [nearPointMm(eyes.right), nearPointMm(eyes.left)].filter((v) => v !== null);
  const focus = {
    farMeasured: input.focus?.farPointMm ?? null,
    farTrue: fp.length ? Math.max(.../** @type {number[]} */ (fp)) : null, // binocular: the farther-seeing eye
    nearMeasured: input.focus?.nearPointMm ?? null,
    nearTrue: npts.length ? Math.min(.../** @type {number[]} */ (npts)) : null,
  };
  const sharp = sharpRangeMm(both, { mode: 'comfortable', maxLossLogMAR: 0.1, minMm: 80, maxMm: 6000 });
  // (b) legibility
  const app = textReserve({ eyes: both, fontPx: profile.text.baseFontPx, distanceMm: dEval, pxPerMm: pxTrue });
  const base = textReserve({ eyes: both, fontPx: 16, distanceMm: dh, pxPerMm: pxTrue });
  // (c) practicality
  const cpl = charsPerLine(profile.text.baseFontPx, profile.text.letterSpacingEm);
  const minD = user.age < 18 ? 330 : 250;
  const distanceOk = dEval >= minD - 1e-9 && dEval <= 600 + 1e-9;
  return {
    id: user.id, group: user.group, label: user.label, age: user.age, rep: run.rep, habitualMm: dh,
    se: sphericalEquivalent(eyes.right), cylR: eyes.right.cyl,
    acc, focus, sharp, criterion: run.criterion,
    calib: { pxErr: run.pxApp / pxTrue - 1, dErr: run.dApp / dh - 1 },
    feasible: gf?.feasible ?? null, reasons: gf?.reasons ?? [], gf,
    dRec, dEval, baseFontPx: profile.text.baseFontPx,
    reserve: app.reserve, reserveLatin: app.latin, reserveHebrew: app.hebrew, Tcomf: app.T, legibility: legibilityClass(app.reserve),
    baseReserve: base.reserve, baseLegibility: legibilityClass(base.reserve), Tbase: base.T,
    cpl, distanceOk,
    dial: { suspected: !!input.astigmatism?.right?.suspected, axisDeg: input.astigmatism?.right?.axisDeg ?? null, trueAxis: eyes.right.axisDeg, cyl: eyes.right.cyl, sphere: eyes.right.sphere },
    flags: profile.flags.map((f) => f.code),
  };
}
