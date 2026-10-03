// @ts-check
/**
 * PROFILE ENGINE — pure (no DOM, no globals except an optional crypto.randomUUID for new ids).
 * ProfileInput → VisionProfile, following docs/research/vision-science.md (binding spec):
 *   §4.3 / items 16–19  text size (acuity reserve, 12′ floor, Hebrew margin, CPS rule, platform floor)
 *   §5.5 / item 25      contrast tiers → weight, size step, text contrast
 *   §6.4                line-sharpness ("dial") adaptations → weight, letter spacing
 *   §7.6 / item 33      recolouring matrix (engine/color-math.js daltonizeMatrix)
 *   §9.5 / item 37      focus range → recommended distance
 *   §10.2 / items 38–42 enhancement: sharpening band, gain, magnification
 *   §12.4 / items 43–48 profile → system settings target
 *   §13 / items 51–58   red flags (Amsler is out of scope and ignored)
 *   GLASSES-FREE MODE    (input.wearsCorrection === false) — see "Glasses-free assessment" below and
 *                        docs/validation/SIMULATION-REPORT.md: a defocus model locates the user's sharp distance
 *                        window from the measured focus range, picks the viewing distance inside it and sizes the text
 *                        for THAT distance; VisionProfile.glassesFree carries the yes / partial / no verdict.
 *
 * WHICH INPUT WINS FOR TEXT SIZE (item 17): a RELIABLE reading test (critical print size, CPS) wins over acuity,
 * because CPS directly measures the smallest print the user reads at full speed — exactly the quantity we size
 * text for — whereas "acuity × 2 reserve" is a population rule of thumb. Otherwise we use binocular acuity, else
 * the better eye (reliable results before unreliable ones). No acuity at all → the 12′ floor (platform default).
 *
 * SCRIPT: the app is bilingual and the language can change without re-testing, so the size is computed for both
 * Hebrew (body-height ratio 0.58, ×1.12 margin) and Latin (x-height ratio 0.52) — the spec's measurement fallbacks —
 * and the larger wins (spec §4.2: "compute the size for Hebrew and let Latin follow the same font-size").
 *
 * Every number that leaves this module is finite and clamped (see SAFE_RANGES).
 */
import { IDENTITY3, neutralFilterParams, DEFAULT_CSS_PX_PER_MM } from '../core/types.js';
import { daltonizeMatrix } from './color-math.js';
import { describeFlag } from './summary.js';
import { FOCUS } from '../calibration/calibration-math.js';

/** @typedef {import('../core/types.js').ProfileInput} ProfileInput */
/** @typedef {import('../core/types.js').VisionProfile} VisionProfile */
/** @typedef {import('../core/types.js').TextParams} TextParams */
/** @typedef {import('../core/types.js').FilterParams} FilterParams */
/** @typedef {import('../core/types.js').SystemSettingsTarget} SystemSettingsTarget */
/** @typedef {import('../core/types.js').ProfileFlag} ProfileFlag */
/** @typedef {import('../core/types.js').AcuityResult} AcuityResult */
/** @typedef {import('../core/types.js').GlassesFreeAssessment} GlassesFreeAssessment */

/**
 * SystemSettingsTarget plus one optional engine field (proposed addition to core/types.js):
 * `contrastLevel` distinguishes spec §12.4 step 4 "medium" (logCS < 1.65) from "high" (logCS < 1.35).
 * @typedef {SystemSettingsTarget & {contrastLevel?: 'medium'|'high'}} SystemTargetEx
 */

// Re-exported so consumers (screens/results.js looks for `describeFlag` on this module) get the engine wording.
export { describeFlag };

// ---------------------------------------------------------------------------------------------------------------
// Constants (spec item numbers in brackets)
// ---------------------------------------------------------------------------------------------------------------
const ARCMIN_RAD = Math.PI / 10800;
const DEG_RAD = Math.PI / 180;
const EPS = 1e-9;

/** Acuity reserve R = 2:1 (fluent reading) [16]. */
export const ACUITY_RESERVE = 2;
/** Body-text floor: 0.2° x-height = 12′ (Legge & Bigelow) [17]. */
export const FLOOR_ARCMIN = 12;
/** Hebrew safety margin ×1.12 (+0.05 log) [17]. */
export const HEBREW_MARGIN = 1.12;
/** A critical print size more than this below the letter acuity is implausible and ignored (see deriveMetrics). */
export const CPS_BELOW_ACUITY_TOL = 0.1;
/** The critical print size is capped at reading acuity + this (see deriveMetrics). */
export const CPS_ABOVE_RA_MAX = 0.4;
/** Margin above the critical print size: +0.1 log [17]. */
export const CPS_MARGIN_LOG = 0.1;
/** x-height / em fallbacks when runtime measurement is unavailable [19]. */
export const XR_LATIN = 0.52;
export const XR_HEBREW = 0.58;
/** Never recommend below the platform default body (CSS / Android 16 px; iOS 17 pt handled by the guide) [18]. */
export const PLATFORM_DEFAULT_PX = 16;
/** Largest body size we apply to the app UI; beyond this, magnification is recommended instead. */
export const MAX_UI_FONT_PX = 64;
/** A comfortable sharp range (far point − comfortable near limit) narrower than this raises FOCUS_RANGE_LIMITED. */
export const FOCUS_RANGE_MIN_MM = 100;
/** Default viewing distance when none was measured (phone) [9]. */
export const DEFAULT_DISTANCE_MM = 350;
/** Android's largest font step gives 28 dp for 16 sp body; iOS AX5 body is 53 pt [43–44]. */
export const ANDROID_MAX_TEXT_PX = 28;
export const IOS_MAX_TEXT_PX = 53;
/** Contrast tiers (§5.5, item 25): lower bound of logCS → size multiplier. */
const CONTRAST_TIERS = Object.freeze([
  { min: 1.65, sizeMult: 1.0, weight: 400 },
  { min: 1.35, sizeMult: 1.12, weight: 500 },
  { min: 1.0, sizeMult: 1.26, weight: 700 },
  { min: -Infinity, sizeMult: 1.41, weight: 700 },
]);

/** Output clamps. */
export const SAFE_RANGES = Object.freeze({
  baseFontPx: [PLATFORM_DEFAULT_PX, MAX_UI_FONT_PX],
  fontWeight: [400, 700],
  lineHeight: [1.4, 1.8],
  letterSpacingEm: [0, 0.12],
  wordSpacingEm: [0, 0.16],
  textScale: [1, 8],
  displayZoom: [1, 2],
  mediaContrast: [1, 1.35],
  uiContrast: [1, 1.15],
  sharpenAmount: [0, 1.5],
  sharpenSigmaPx: [0.5, 8],
  zoom: [1, 8],
  warmth: [0, 1],
  distanceMm: [150, 1000],
  recommendedDistanceMm: [150, 600],
});

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------
/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** @param {number} v @param {readonly number[]} r */
const clampR = (v, r) => clamp(isNum(v) ? v : r[0], r[0], r[1]);
/** @param {number} v @param {number} [dp] */
const round = (v, dp = 2) => { const f = 10 ** dp; return Math.round(v * f) / f; };

/**
 * "Screen detail" score 0–100 (item 60): clamp(round(100·(1.0 − L)/1.2), 0, 100). Null for a missing value.
 * @param {number|null|undefined} logMAR
 * @returns {number|null}
 */
export function detailScore(logMAR) {
  if (!isNum(logMAR)) return null;
  return clamp(Math.round((100 * (1.0 - logMAR)) / 1.2), 0, 100);
}

/**
 * Target x-height angle in arcmin (item 17).
 * Acuity path: θ = max(5·10^L·R, 12′), then ×1.12 for Hebrew.
 * Reading path (reliable CPS): θ = max(floor, 5·10^(CPS+0.1)), where floor = 12′ (×1.12 for Hebrew). The margin is
 * not applied on top of CPS, because the reading test was read in the app's own script and font.
 * @param {{logMAR?: number|null, cps?: number|null, reserve?: number, hebrew?: boolean}} p
 */
export function targetXHeightArcmin({ logMAR = null, cps = null, reserve = ACUITY_RESERVE, hebrew = false }) {
  const margin = hebrew ? HEBREW_MARGIN : 1;
  if (isNum(cps)) return Math.max(FLOOR_ARCMIN * margin, 5 * 10 ** (cps + CPS_MARGIN_LOG));
  const base = isNum(logMAR) ? Math.max(5 * 10 ** logMAR * reserve, FLOOR_ARCMIN) : FLOOR_ARCMIN;
  return base * margin;
}

/**
 * CSS font-size (px) whose x-height subtends `arcmin` at `distanceMm` (items 18): x = 2·d·tan(θ/2); fs = x/xr/mmPerCss.
 * @param {number} arcmin @param {number} distanceMm @param {number} xr @param {number} mmPerCss
 */
export function fontPxForAngle(arcmin, distanceMm, xr, mmPerCss) {
  const xMm = 2 * distanceMm * Math.tan((arcmin * ARCMIN_RAD) / 2);
  return xMm / xr / mmPerCss;
}

/**
 * Gaussian sigma (CSS px) of the enhancement band for logMAR L (items 38): f_c = 30/10^L, f0 = 0.35·f_c,
 * σ1 = ppd/(2π·f0) with ppd = d·tan(1°)/mmPerCss (CSS px per degree; the renderer multiplies by dpr).
 * @param {number} L @param {number} distanceMm @param {number} mmPerCss
 */
export function sharpenSigmaCssPx(L, distanceMm, mmPerCss) {
  const f0 = 0.35 * (30 / 10 ** L);
  const ppd = (distanceMm * Math.tan(DEG_RAD)) / mmPerCss;
  return ppd / (2 * Math.PI * f0);
}

/**
 * Enhancement gain (item 40 plus an acuity term [D]). Spec: k = clamp(1.25·(1.80 − logCS), 0, 1.5). Because the
 * band-pass boost also helps detail that is visible but attenuated by reduced acuity (§10.2 step 1), and logCS is
 * often not measured, we add an acuity term kL = clamp(1.5·(L − 0.2), 0, 1.5) and use the larger of the two.
 * @param {number|null} logCS @param {number|null} L
 */
export function enhancementGain(logCS, L) {
  const kCS = isNum(logCS) ? clamp(1.25 * (1.8 - logCS), 0, 1.5) : 0;
  const kL = isNum(L) ? clamp(1.5 * (L - 0.2), 0, 1.5) : 0;
  return Math.max(kCS, kL);
}

/** @param {number|null} logCS @returns {0|1|2|3|null} contrast tier index (§5.5), null when unknown */
export function contrastTier(logCS) {
  if (!isNum(logCS)) return null;
  return /** @type {0|1|2|3} */ (CONTRAST_TIERS.findIndex((t) => logCS >= t.min - EPS));
}

// ---------------------------------------------------------------------------------------------------------------
// Input analysis
// ---------------------------------------------------------------------------------------------------------------
/**
 * @typedef {Object} EyeAcuity
 * @property {number} L
 * @property {boolean} reliable
 * @property {boolean} floorLimited
 * @property {boolean} ceilingLimited
 * @property {number|null} distanceMm
 */

/** @param {AcuityResult|undefined|null} r @returns {EyeAcuity|null} */
function eyeAcuity(r) {
  if (!r || !isNum(r.logMAR)) return null;
  return {
    L: clamp(r.logMAR, -0.5, 2),
    reliable: r.reliable !== false,
    floorLimited: !!r.floorLimited,
    ceilingLimited: !!r.ceilingLimited,
    distanceMm: isNum(r.distanceMm) && r.distanceMm > 0 ? r.distanceMm : null,
  };
}

/**
 * @typedef {Object} Metrics  Intermediate values (also used by summary/technical details). All finite or null.
 * @property {number} cssPxPerMm
 * @property {number} mmPerCss
 * @property {boolean} screenCalibrated
 * @property {number} habitualMm
 * @property {number} textDistanceMm        distance the text size is computed for (d_rec when known, else habitual)
 * @property {number|null} testDistanceMm   distance the acuity/reading result refers to
 * @property {{right: EyeAcuity|null, left: EyeAcuity|null, both: EyeAcuity|null}} eyes
 * @property {number|null} L                acuity used for sizing (binocular, else better eye)
 * @property {'both'|'better-eye'|'unreliable'|'none'} acuitySource
 * @property {boolean} ceilingLimited
 * @property {number|null} cps              reliable critical print size (logMAR), else null
 * @property {boolean} cpsImplausible       a "reliable" CPS was ignored because it was far below the acuity
 * @property {'reading'|'acuity'|'default'} sizeSource
 * @property {number|null} logCS            reliable logCS, else null
 * @property {0|1|2|3|null} contrastTier
 * @property {{suspected: boolean, consistent: boolean, eyes: Array<'right'|'left'>, consistentEyes: Array<'right'|'left'>}} lines
 * @property {{type: string, severity: number, reliable: boolean, cvd: boolean}|null} color
 * @property {{nearMm: number|null, farMm: number|null, ampD: number|null, minComfortMm: number|null}|null} focus
 * @property {number|null} recommendedDistanceMm
 * @property {number} fsLatin
 * @property {number} fsHebrew
 * @property {number} fsNeeded              recommended body px (platform floor applied, UI cap NOT applied)
 * @property {number} fsAcuityLatin         acuity/CPS size without contrast step or Hebrew margin (for magnification)
 * @property {'low'|'normal'|'high'} lightSensitivity
 * @property {'light'|'dark'|'auto'} theme
 * @property {GlassesFreeAssessment|null} glassesFree  only when the tests were done without correction
 * @property {GlassesFreePlan|null} glassesFreePlan     internal model values behind glassesFree (technical details)
 */

/**
 * Derive every intermediate quantity from a (possibly partial or malformed) ProfileInput.
 * @param {Partial<ProfileInput>|null|undefined} input
 * @returns {Metrics}
 */
export function deriveMetrics(input) {
  const inp = /** @type {Partial<ProfileInput>} */ (input && typeof input === 'object' ? input : {});
  const pxPerMmRaw = inp.screen?.cssPxPerMm;
  const cssPxPerMm = isNum(pxPerMmRaw) && pxPerMmRaw >= 1 && pxPerMmRaw <= 40 ? pxPerMmRaw : DEFAULT_CSS_PX_PER_MM;
  const mmPerCss = 1 / cssPxPerMm;
  const screenCalibrated = !!inp.screen && cssPxPerMm === pxPerMmRaw && inp.screen.method !== 'default';
  const habRaw = inp.distance?.distanceMm;
  const habitualMm = isNum(habRaw) && habRaw > 0 ? clampR(habRaw, SAFE_RANGES.distanceMm) : DEFAULT_DISTANCE_MM;

  // --- acuity (item 17: binocular, else better eye; reliable before unreliable)
  const a = inp.acuity || {};
  const eyes = { right: eyeAcuity(a.right), left: eyeAcuity(a.left), both: eyeAcuity(a.both) };
  /** @type {EyeAcuity|null} */
  let chosen = null;
  /** @type {Metrics['acuitySource']} */
  let acuitySource = 'none';
  const mono = [eyes.right, eyes.left].filter(Boolean);
  const reliableMono = mono.filter((e) => e.reliable);
  if (eyes.both?.reliable) { chosen = eyes.both; acuitySource = 'both'; }
  else if (reliableMono.length) { chosen = reliableMono.reduce((b, e) => (e.L < b.L ? e : b)); acuitySource = 'better-eye'; }
  else {
    const any = [eyes.both, ...mono].filter(Boolean);
    if (any.length) { chosen = any.reduce((b, e) => (e.L < b.L ? e : b)); acuitySource = 'unreliable'; }
  }
  const L = chosen ? chosen.L : null;
  const ceilingLimited = !!chosen?.ceilingLimited;

  // --- reading (reliable CPS wins, item 17)
  const rd = inp.reading;
  let cps = rd && rd.reliable !== false && isNum(rd.criticalPrintSizeLogMAR) ? clamp(rd.criticalPrintSizeLogMAR, -0.3, 1.6) : null;
  // Plausibility (validation simulation, docs/validation): the critical print size is normally 0.1–0.4 log LARGER
  // than letter acuity. A CPS clearly below the acuity measured at a similar distance comes from lucky answers on the
  // 2-choice word check (50 % guess rate) and would shrink the text below what the user can read: ignore it.
  let cpsImplausible = false;
  if (cps !== null && L !== null && cps < L - CPS_BELOW_ACUITY_TOL - EPS) {
    const dr = isNum(rd?.distanceMm) && rd.distanceMm > 0 ? rd.distanceMm : null;
    const da = chosen?.distanceMm ?? null;
    if (dr === null || da === null || Math.abs(Math.log10(dr / da)) < 0.1) { cps = null; cpsImplausible = true; }
  }
  // A CPS far above the reading acuity is a curve-fit artefact of noisy single-run speeds (simulation: single-run CPS
  // errors up to +0.4 log): cap it at reading acuity (or letter acuity) + 0.4 (typical CPS − reading acuity 0.1–0.3).
  const raLog = rd?.readingAcuityLogMAR;
  if (cps !== null && isNum(raLog)) cps = Math.min(cps, Math.max(raLog, L ?? raLog) + CPS_ABOVE_RA_MAX);
  const sizeSource = cps !== null ? 'reading' : L !== null ? 'acuity' : 'default';
  const testDistanceMm = (cps !== null && isNum(rd?.distanceMm) && rd.distanceMm > 0 ? rd.distanceMm : chosen?.distanceMm) ?? null;

  // --- contrast
  const cs = inp.contrast;
  const logCS = cs && cs.reliable !== false && isNum(cs.logCS) ? clamp(cs.logCS, 0, 2.5) : null;
  const tier = contrastTier(logCS);

  // --- line sharpness ("dial")
  /** @type {Metrics['lines']} */
  const lines = { suspected: false, consistent: false, eyes: [], consistentEyes: [] };
  for (const eye of /** @type {const} */ (['right', 'left'])) {
    const r = inp.astigmatism?.[eye];
    if (r && r.suspected) {
      lines.suspected = true;
      lines.eyes.push(eye);
      // The dial view reports `suspected` only when ≥ 2 of 3 presentations agreed (astigmatism-math.js
      // inferFromAnswers), so a suspected result without an explicit `consistent` field IS consistent. Only an
      // explicit `consistent: false` (older/other producers) is treated as inconsistent.
      if (r.consistent === true || (r.consistent === undefined && isNum(r.axisDeg))) { lines.consistent = true; lines.consistentEyes.push(eye); }
    }
  }

  // --- colour
  const c = inp.color;
  const color = c && typeof c.type === 'string'
    ? {
      type: c.type,
      severity: clamp(isNum(c.severity) ? c.severity : 0, 0, 1),
      reliable: c.reliable !== false,
      cvd: c.type === 'protan' || c.type === 'deutan' || c.type === 'tritan',
    }
    : null;

  // --- focus range → recommended distance (§9.5, item 37)
  const f = inp.focus;
  const nearMm = f && isNum(f.nearPointMm) && f.nearPointMm > 0 ? f.nearPointMm : null;
  const farMm = f && isNum(f.farPointMm) && f.farPointMm > 0 ? f.farPointMm : null;
  /** @type {Metrics['focus']} */
  let focus = null;
  let recommendedDistanceMm = null;
  if (nearMm !== null || farMm !== null) {
    let ampD = null;
    let minComfortMm = null;
    if (nearMm !== null) {
      const farD = farMm !== null ? 1000 / farMm : 0;
      ampD = Math.max(0, 1000 / nearMm - farD);
      // A near point at the camera floor only bounds the amplitude from below: use at least the age minimum.
      const ampEff = nearMm <= FOCUS.cameraFloorMm + EPS && isNum(inp.age) ? Math.max(ampD, Math.max(0, 15 - 0.25 * inp.age)) : ampD;
      // Comfortable near limit = where the focusing effort reaches half the amplitude. Without correction a myope
      // needs 1000/d − farD of effort, not 1000/d (validation simulation: the spec's 2000/Amp sent "reading glasses"
      // advice to 30–40-year-old myopes who read comfortably at 25 cm).
      minComfortMm = farD + ampEff / 2 > 0.05 ? 1000 / (farD + ampEff / 2) : Infinity;
      if (minComfortMm > 600) recommendedDistanceMm = habitualMm; // no comfortable near distance: keep habitual, enlarge text
      else {
        const hi = Math.min(farMm ?? 600, 600);
        const lo = isNum(inp.age) && inp.age < 18 ? MIN_DISTANCE_CHILD_MM : MIN_DISTANCE_MM;
        recommendedDistanceMm = hi < lo ? hi : clamp(Math.max(habitualMm, minComfortMm), lo, hi);
      }
      recommendedDistanceMm = Math.round(clampR(recommendedDistanceMm, SAFE_RANGES.recommendedDistanceMm) / 10) * 10;
    }
    focus = { nearMm, farMm, ampD: ampD === null ? null : round(ampD, 2), minComfortMm: isNum(minComfortMm) ? Math.round(minComfortMm) : null };
  }
  const textDistanceMm = recommendedDistanceMm ?? habitualMm;

  // --- text size (items 17–18)
  const thetaLat = targetXHeightArcmin({ logMAR: L, cps, hebrew: false });
  const thetaHe = targetXHeightArcmin({ logMAR: L, cps, hebrew: true });
  const fsLatin = fontPxForAngle(thetaLat, textDistanceMm, XR_LATIN, mmPerCss);
  const fsHebrew = fontPxForAngle(thetaHe, textDistanceMm, XR_HEBREW, mmPerCss);
  const sizeMult = tier === null ? 1 : CONTRAST_TIERS[tier].sizeMult;
  const fsNeeded = Math.max(PLATFORM_DEFAULT_PX, Math.max(fsLatin, fsHebrew) * sizeMult);

  const ls = inp.prefs?.lightSensitivity;
  const th = inp.prefs?.theme;
  /** @type {Metrics} */
  const m = {
    cssPxPerMm, mmPerCss, screenCalibrated, habitualMm, textDistanceMm, testDistanceMm,
    eyes, L, acuitySource, ceilingLimited, cps, cpsImplausible, sizeSource, logCS, contrastTier: tier, lines, color,
    focus, recommendedDistanceMm,
    fsLatin, fsHebrew, fsNeeded, fsAcuityLatin: fsLatin,
    lightSensitivity: ls === 'low' || ls === 'high' ? ls : 'normal',
    theme: th === 'light' || th === 'dark' ? th : 'auto',
    glassesFree: null,
    glassesFreePlan: null,
  };
  if (inp.wearsCorrection === false) applyGlassesFree(m, inp, sizeMult);
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Glasses-free assessment (input.wearsCorrection === false)
// ---------------------------------------------------------------------------------------------------------------
/*
 * A normal screen cannot correct blur. What it CAN do for someone reading without glasses/lenses is (1) be held at a
 * distance where the eye is naturally sharp, if such a distance exists within reach, and (2) show text large and
 * heavy enough for what remains. To decide both, the engine uses a population defocus model (the same physics as
 * the validation simulator, public/app/js/sim/eye-model.js, documented in docs/validation/SIMULATION-REPORT.md):
 *   threshold(U) = log10 √(MAR0² + (k·P·max(0, U − z/P))²)          Smith 1991 form, k 0.64, z 0.86 mm·D (fitted)
 *   P = Watson & Yellott 2012 pupil at 150 cd/m² (phone), MAR0 = age-typical best acuity, U = defocus (D).
 * From the measured focus range it estimates, internally and never shown: the far-point vergence F (how far the eye
 * sees sharply) and the accommodation range; comfortable sustained focusing uses at most half of the age-typical
 * amplitude (spec §9.5). The measured threshold at the test distance anchors the prediction (offset Δ absorbs
 * astigmatism and anything the model does not know), so the prediction AT the test distance equals the measurement.
 * The text is then sized (spec §4.3, unchanged rules) for the predicted threshold at the chosen distance.
 */
/** Practical phone distances: 25–60 cm for adults, ≥ 33 cm for under-18s (ergonomic guidance). */
export const MIN_DISTANCE_MM = 250;
export const MIN_DISTANCE_CHILD_MM = 330;
export const MAX_DISTANCE_MM = 600;
/** Closer than this works but is not comfortable for long: verdict at most 'partial'. */
export const COMFORT_MIN_DISTANCE_MM = 300;
/** Characters per line on a 360-CSS-px phone (16 px side padding): ≥ 24 comfortable, < 12 impractical. */
export const PHONE_LINE_CSS_PX = 328;
export const CHAR_EM = Object.freeze({ latin: 0.5, hebrew: 0.56 });
export const CPL_COMFORT = 24;
export const CPL_MIN = 12;
export const GF_MODEL = Object.freeze({
  k: 0.64,
  deadZoneMmD: 0.86,
  luminance: 150,
  fieldDeg2: 270,
  /** Focus test: "first blur" is reported when the threshold is about this far below the target level. */
  blurCriterionLog: 0.05,
  /** "Sharp" = within 0.1 log of the age-typical best. */
  sharpLossLog: 0.1,
  /** A measured far point is ignored when it predicts a threshold this much worse than measured at the test distance. */
  maxInconsistencyLog: 0.2,
  /** Far points are tapped while moving away, after blur is noticed, so they read slightly too far (cf. the 0.17 D
   * bias of a smartphone far-point app, TVST 2022): added to the far-point vergence. */
  farOvershootD: 0.15,
  /** Safety allowance subtracted from the comfortable focusing estimate (D). */
  comfortMarginD: 0.25,
  /** Residual blur (log) that no distance removes before the verdict is capped at 'partial'. */
  residualBlurLog: 0.2,
});

/** Watson & Yellott (2012) binocular pupil (mm) at the phone luminance. @param {number} age */
export function gfPupilMm(age) {
  const x = ((GF_MODEL.luminance * GF_MODEL.fieldDeg2) / 846) ** 0.41;
  const dsd = 7.75 - 5.75 * (x / (x + 2));
  return clamp(dsd + (age - 28.58) * (0.02132 - 0.009562 * dsd), 2, 8);
}
/** Age-typical best logMAR. @param {number} age */
export function gfFloorLogMAR(age) { return -0.08 + 0.0025 * Math.max(0, age - 40); }
/** @param {number} U @param {number} P @param {number} L0 */
export function gfLogMARForBlur(U, P, L0) {
  const eff = Math.max(0, Math.abs(U) - GF_MODEL.deadZoneMmD / P);
  return Math.log10(Math.sqrt(10 ** (2 * L0) + (GF_MODEL.k * P * eff) ** 2));
}
/** @param {number} L @param {number} P @param {number} L0 */
export function gfBlurForLogMAR(L, P, L0) {
  if (!(L > L0)) return 0;
  return Math.sqrt(10 ** (2 * L) - 10 ** (2 * L0)) / (GF_MODEL.k * P) + GF_MODEL.deadZoneMmD / P;
}
/** Hofstetter amplitude (D). @param {number} age */
const hofMean = (age) => Math.max(0, 18.5 - 0.3 * age);

/**
 * Characters per line on a 360-CSS-px-wide phone (the smaller of Hebrew and Latin).
 * @param {number} fontPx @param {number} [letterSpacingEm]
 */
export function charsPerLine(fontPx, letterSpacingEm = 0) {
  const per = (/** @type {number} */ em) => Math.floor(PHONE_LINE_CSS_PX / (Math.max(fontPx, 1) * (em + letterSpacingEm)));
  return Math.min(per(CHAR_EM.latin), per(CHAR_EM.hebrew));
}

/** Letter spacing (§6.4 / §5.5) — shared by buildText and the glasses-free line-length check. @param {Metrics} m */
function letterSpacingEmFor(m) {
  const lowCS = m.contrastTier !== null && m.contrastTier >= 2;
  let letter = 0;
  if (m.lines.suspected) letter = m.lines.consistent ? 0.04 : 0.02; // §6.4: +0.02–0.05 em
  if (lowCS) letter = Math.max(letter, 0.02);
  return letter;
}

/**
 * @typedef {Object} GlassesFreePlan  Internal values (technical details only; never shown in the default UI).
 * @property {number} pupilMm
 * @property {number} floorLogMAR
 * @property {number|null} farVergenceD     estimated far-point vergence (D), 0 = sharp to arm's length or beyond
 * @property {boolean} farIgnored           the measured far point contradicted the measured threshold
 * @property {number|null} ampD             estimated accommodation range beyond the far point (D)
 * @property {number|null} comfortAccD      accommodation used comfortably (D)
 * @property {number} offsetLog             measured − modelled threshold at the test distance (blur no distance removes)
 * @property {number} textDistanceMm
 * @property {number|null} predictedLogMAR  predicted comfortable threshold at textDistanceMm
 * @property {number|null} predictedCps
 * @property {number} fsNeeded
 */

/**
 * Glasses-free plan: estimate the sharp window, choose the distance, re-size the text for it and give a verdict.
 * Mutates the text-size fields of `m` (textDistanceMm, recommendedDistanceMm, fs*) and sets m.glassesFree.
 * @param {Metrics} m @param {Partial<ProfileInput>} inp @param {number} sizeMult contrast-tier size step
 */
function applyGlassesFree(m, inp, sizeMult) {
  const age = isNum(inp.age) ? clamp(inp.age, 3, 110) : null;
  const ageM = age ?? 40;
  const child = age !== null && age < 18;
  const lo = child ? MIN_DISTANCE_CHILD_MM : MIN_DISTANCE_MM;
  const P = gfPupilMm(ageM);
  const L0 = gfFloorLogMAR(ageM);
  const A = (/** @type {number} */ U) => gfLogMARForBlur(U, P, L0);
  const E = (/** @type {number} */ L) => gfBlurForLogMAR(L, P, L0);
  /** @type {string[]} */
  const reasons = [];
  const add = (/** @type {string} */ r) => { if (!reasons.includes(r)) reasons.push(r); };
  if (child) add('CHILD');
  const letter = letterSpacingEmFor(m);
  const dh = m.habitualMm;
  const Lt = m.L;
  if (Lt === null) {
    add('NOT_ENOUGH_DATA');
    m.glassesFree = {
      feasible: child ? 'no' : 'partial', recommendedDistanceMm: null, sharpFromMm: null, sharpToMm: null,
      charsPerLine: charsPerLine(m.fsNeeded, letter), reasons,
    };
    return;
  }
  const dt = m.testDistanceMm ?? dh;
  const cpsT = m.cps;

  // --- focus range → far-point vergence F and accommodation range
  const focusMeasured = m.focus !== null;
  const nearMm = m.focus?.nearMm ?? null;
  const farMm = m.focus?.farMm ?? null;
  const crit = GF_MODEL.blurCriterionLog;
  let F = 0;
  let farIgnored = false;
  if (farMm !== null) {
    F = 1000 / farMm + E(FOCUS.farLogMAR - crit) + GF_MODEL.farOvershootD;
    // A far point this close predicts much more blur at the test distance than was measured: the "blur" seen in the
    // far sweep was not distance blur (e.g. uneven line sharpness blurs at every distance). Ignore it.
    if (A(Math.max(0, F - 1000 / dt)) - Lt > GF_MODEL.maxInconsistencyLog) { F = 0; farIgnored = true; add('FOCUS_INCONSISTENT'); }
    // Tapped at (about) the start of the sweep (20 cm): the far point may be much closer than measured. The threshold
    // measured at the test distance then bounds the far-point vergence better (defocus-model inversion).
    else if (farMm <= 1.15 * FOCUS.farStartMm) F = Math.max(F, 1000 / dt + E(Lt));
  }
  let amp = hofMean(ageM);
  if (nearMm !== null) {
    const measured = Math.max(0, 1000 / nearMm - F - E(FOCUS.nearMinLogMAR - crit));
    // Tapped at (about) the start of the sweep: the target was already blurry at ~40 cm, so the near point is only an
    // upper bound of the focusing range.
    const atStart = nearMm >= 0.9 * FOCUS.nearStartMm;
    if (nearMm <= FOCUS.cameraFloorMm + EPS) amp = Math.max(measured, hofMean(ageM));
    // ...at an age where that is physiologically implausible: blur at every distance, not a focusing limit.
    else if (atStart && ageM < 40 && measured < hofMean(ageM) - 4) add('FOCUS_INCONSISTENT');
    // ...otherwise the threshold measured at the test distance bounds the range better (defocus-model inversion).
    else if (atStart && Lt > L0 + 0.1) amp = Math.min(measured, Math.max(0, 1000 / dt - F - E(Lt)));
    else amp = measured;
  }
  amp = clamp(amp, 0, 15);
  // Half-amplitude comfort rule (§9.5). A range below the age norm may be latent long-sightedness that already uses
  // up focusing effort at distance (indistinguishable from a small amplitude with these tests), so the comfortable part
  // is taken relative to the age-typical (Hofstetter mean) amplitude when that is larger: conservative on purpose
  // (simulation: with the minimum instead, +1 D long-sighted 45-year-olds got 'yes' with too-small text).
  // Minus a 0.25 D allowance for the near-point measurement error (simulation: near points ±0.5 D), so the chosen
  // distance does not sit on the edge of the comfortable range.
  const comfortAcc = Math.max(0, amp - Math.max(amp, hofMean(ageM)) / 2 - GF_MODEL.comfortMarginD);
  const blurAt = (/** @type {number} */ d, /** @type {number} */ acc) => {
    const need = 1000 / d - F;
    return need < 0 ? -need : Math.max(0, need - acc);
  };
  // Anchor to the measurement. A difference within the test's noise (±0.1 log) scales the model; blur beyond that
  // (e.g. uneven line sharpness, non-optical loss) is an independent component and adds in quadrature in MAR (as
  // defocus components do in Smith's formula), so it is carried to every distance without double-counting focus
  // blur. At the test distance with full focusing effort the prediction equals the measurement.
  const offset = clamp(Lt - A(blurAt(dt, amp)), -0.1, 1);
  const marModelT = 10 ** A(blurAt(dt, amp));
  const scale = 10 ** clamp(Lt - Math.log10(marModelT), -0.1, 0.1);
  const extra2 = Math.max(0, 10 ** (2 * Lt) - (scale * marModelT) ** 2);
  const Lpred = (/** @type {number} */ d) => Math.log10(Math.sqrt((scale * 10 ** A(blurAt(d, comfortAcc))) ** 2 + extra2));
  const cpsPred = (/** @type {number} */ d) => (cpsT === null ? null : cpsT + (Lpred(d) - Lt));
  const fsAt = (/** @type {number} */ d) => {
    const L = Lpred(d);
    const cps = cpsPred(d);
    const fl = fontPxForAngle(targetXHeightArcmin({ logMAR: L, cps, hebrew: false }), d, XR_LATIN, m.mmPerCss);
    const fh = fontPxForAngle(targetXHeightArcmin({ logMAR: L, cps, hebrew: true }), d, XR_HEBREW, m.mmPerCss);
    return { L, cps, fl, fh, fs: Math.max(PLATFORM_DEFAULT_PX, Math.max(fl, fh) * sizeMult) };
  };

  // --- sharp window and distance choice
  const sharpLimit = L0 + GF_MODEL.sharpLossLog;
  const Es = E(sharpLimit);
  /** @type {number|null} */ let sharpFromMm = null;
  /** @type {number|null} */ let sharpToMm = null;
  let dRec = dh;
  let windowOk = false;
  if (focusMeasured) {
    const nearV = F + comfortAcc + Es;
    const farV = F - Es;
    const from = nearV > 0 ? 1000 / nearV : null;
    const to = farV > 0 ? 1000 / farV : null; // null: sharp to arm's length and beyond
    if (from !== null && (to === null || to >= from)) {
      sharpFromMm = Math.round(from / 10) * 10;
      sharpToMm = to === null || to > 2000 ? null : Math.round(to / 10) * 10;
    }
    const grid = [];
    for (let d = lo; d <= MAX_DISTANCE_MM + EPS; d += 10) grid.push(d);
    const inWindow = grid.filter((d) => A(blurAt(d, comfortAcc)) <= sharpLimit + EPS);
    if (inWindow.length) {
      windowOk = true;
      // Keep the user's habit when it is inside the window, but not closer than 30 cm when the window allows it.
      dRec = clamp(Math.max(Math.round(dh / 10) * 10, COMFORT_MIN_DISTANCE_MM), inWindow[0], inWindow[inWindow.length - 1]);
    } else {
      // No sharp distance within reach: among the distances that need at most 3 % more than the smallest text, the
      // one closest to the user's habit (not closer than 30 cm). With little focusing left the needed size is nearly
      // the same at every distance (the blur on the screen scales with distance), so habit and comfort decide.
      const fsGrid = grid.map((d) => fsAt(d).fs);
      const minFs = Math.min(...fsGrid);
      const target = clamp(dh, COMFORT_MIN_DISTANCE_MM, MAX_DISTANCE_MM);
      let best = grid[fsGrid.indexOf(minFs)];
      for (let i = 0; i < grid.length; i++) {
        if (fsGrid[i] <= 1.03 * minFs + EPS && Math.abs(grid[i] - target) < Math.abs(best - target)) best = grid[i];
      }
      dRec = best;
    }
  } else if (child) {
    dRec = Math.max(dh, lo);
  }
  dRec = clampR(dRec, SAFE_RANGES.recommendedDistanceMm);
  const sized = fsAt(dRec);
  // Without a focus range there is no evidence to move the user or to extrapolate: the text stays sized from the
  // measurement at the habitual distance (the standard rules), and the verdict says the range was not measured.
  if (focusMeasured || child) {
    m.textDistanceMm = dRec;
    m.recommendedDistanceMm = dRec;
    m.fsLatin = sized.fl;
    m.fsHebrew = sized.fh;
    m.fsAcuityLatin = sized.fl;
    m.fsNeeded = sized.fs;
  }
  const cpl = charsPerLine(m.fsNeeded, letter);

  // --- verdict
  if (focusMeasured) add(windowOk ? 'SHARP_RANGE_OK' : 'NO_COMFORTABLE_DISTANCE');
  else if (age !== null && age < 40 && Lt - L0 <= 0.15) add('SHARP_AT_HABITUAL');
  else add('FOCUS_NOT_MEASURED');
  if (dRec < COMFORT_MIN_DISTANCE_MM - EPS) add('TOO_CLOSE');
  if (cpl < CPL_MIN) add('TEXT_TOO_LARGE');
  else if (cpl < CPL_COMFORT) add('TEXT_LARGE');
  if (m.lines.consistent && offset >= 0.1 - EPS) add('HIGH_ASTIGMATISM');
  else if (offset >= GF_MODEL.residualBlurLog - EPS) add('BLUR_AT_ALL_DISTANCES');
  if (m.acuitySource === 'unreliable') add('UNRELIABLE');
  const r = m.eyes.right;
  const l = m.eyes.left;
  if (r?.reliable && l?.reliable && Math.abs(r.L - l.L) >= 0.2 - EPS) add('EYES_DIFFER');
  const opticalLossAtRec = A(blurAt(dRec, comfortAcc)) - L0;
  /** @type {GlassesFreeAssessment['feasible']} */
  let feasible = 'yes';
  const partialReasons = ['NO_COMFORTABLE_DISTANCE', 'TOO_CLOSE', 'TEXT_LARGE', 'HIGH_ASTIGMATISM', 'BLUR_AT_ALL_DISTANCES',
    'UNRELIABLE', 'FOCUS_NOT_MEASURED', 'FOCUS_INCONSISTENT'];
  if (reasons.some((x) => partialReasons.includes(x))) feasible = 'partial';
  if (child || reasons.includes('TEXT_TOO_LARGE') ||
    (reasons.includes('NO_COMFORTABLE_DISTANCE') && opticalLossAtRec > GF_MODEL.residualBlurLog + EPS)) feasible = 'no';
  m.glassesFree = {
    feasible,
    recommendedDistanceMm: child || !focusMeasured ? null : dRec,
    sharpFromMm, sharpToMm,
    charsPerLine: cpl,
    reasons,
  };
  m.glassesFreePlan = {
    pupilMm: round(P, 2), floorLogMAR: round(L0, 3), farVergenceD: focusMeasured ? round(F, 2) : null, farIgnored,
    ampD: round(amp, 2), comfortAccD: round(comfortAcc, 2), offsetLog: round(offset, 3), textDistanceMm: dRec,
    predictedLogMAR: round(sized.L, 3), predictedCps: sized.cps === null ? null : round(sized.cps, 3), fsNeeded: round(m.fsNeeded, 2),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Output builders
// ---------------------------------------------------------------------------------------------------------------
/** @param {Metrics} m @param {boolean} boldText @returns {TextParams} */
function buildText(m, boldText) {
  const baseFontPx = round(clampR(m.fsNeeded, SAFE_RANGES.baseFontPx), 1);
  let weight = m.contrastTier === null ? 400 : CONTRAST_TIERS[m.contrastTier].weight;
  if (m.lines.suspected) weight = Math.max(weight, 500); // §6.4 heavier strokes resist blur
  if (boldText) weight = Math.max(weight, 600); // match the system Bold Text recommendation (item 45)
  const L = m.L ?? 0;
  const lowCS = m.contrastTier !== null && m.contrastTier >= 2;
  let lineHeight = 1.5; // WCAG 1.4.12 baseline
  if (lowCS || L >= 0.5 - EPS || m.lines.consistent) lineHeight = 1.6;
  const letter = letterSpacingEmFor(m);
  const word = letter > 0 ? letter * 2 + 0.04 : 0;
  return {
    baseFontPx,
    scale: round(baseFontPx / PLATFORM_DEFAULT_PX, 3),
    fontWeight: clampR(weight, SAFE_RANGES.fontWeight),
    lineHeight: clampR(lineHeight, SAFE_RANGES.lineHeight),
    letterSpacingEm: round(clampR(letter, SAFE_RANGES.letterSpacingEm), 3),
    wordSpacingEm: round(clampR(word, SAFE_RANGES.wordSpacingEm), 3),
  };
}

/** Media colour filter when the colour result is reliable and shows a red–green or blue–yellow pattern. @param {Metrics} m */
function mediaColourWarranted(m) {
  return !!m.color && m.color.reliable && m.color.cvd && m.color.severity >= 0.1;
}

/**
 * UI colour filter: milder. Spec §7.6 prefers colour-safe UI design over recolouring the UI, so the app UI is only
 * recoloured (at half strength) when the pattern is at least moderate (severity ≥ 0.5).
 * @param {Metrics} m
 */
function uiColourWarranted(m) {
  return mediaColourWarranted(m) && /** @type {NonNullable<Metrics['color']>} */ (m.color).severity >= 0.5;
}

/** @param {Metrics} m @returns {FilterParams} */
function buildMedia(m) {
  const p = neutralFilterParams();
  if (mediaColourWarranted(m)) {
    const c = /** @type {NonNullable<Metrics['color']>} */ (m.color);
    p.colorMatrix = daltonizeMatrix(/** @type {'protan'|'deutan'|'tritan'} */ (c.type), c.severity, 1);
  }
  // Contrast boost from logCS [D, §5.5 tiers]: 1 + 0.4·(1.65 − logCS), capped at +35 %.
  if (m.logCS !== null) p.contrast = round(clampR(1 + clamp(0.4 * (1.65 - m.logCS), 0, 0.35), SAFE_RANGES.mediaContrast), 3);
  p.sharpenAmount = round(clampR(enhancementGain(m.logCS, m.L), SAFE_RANGES.sharpenAmount), 2);
  p.sharpenSigmaPx = round(clampR(sharpenSigmaCssPx(clamp(m.L ?? 0, -0.3, 1.6), m.textDistanceMm, m.mmPerCss), SAFE_RANGES.sharpenSigmaPx), 2);
  // Magnification (item 42): M = 10^((L + log10 R) − L_detail) with the detail taken to be default-size body text
  // (16 px): M = size the user needs / 16 px. Rounded to 0.25 steps, capped at 8× (beyond → OS zoom / Magnifier).
  const M = m.sizeSource === 'default' ? 1 : m.fsAcuityLatin / PLATFORM_DEFAULT_PX;
  p.zoom = clampR(Math.round(clampR(M, SAFE_RANGES.zoom) * 4) / 4, SAFE_RANGES.zoom);
  p.warmth = m.lightSensitivity === 'high' ? 0.3 : 0;
  return p;
}

/** @param {Metrics} m @returns {FilterParams} */
function buildUi(m) {
  const p = neutralFilterParams();
  if (uiColourWarranted(m)) {
    const c = /** @type {NonNullable<Metrics['color']>} */ (m.color);
    p.colorMatrix = daltonizeMatrix(/** @type {'protan'|'deutan'|'tritan'} */ (c.type), c.severity, 0.5);
  }
  if (m.logCS !== null) p.contrast = round(clampR(1 + clamp(0.2 * (1.65 - m.logCS), 0, 0.15), SAFE_RANGES.uiContrast), 3);
  p.warmth = m.lightSensitivity === 'high' ? 0.2 : 0;
  return p; // never sharpening or zoom on UI text (§10.3)
}

/** @param {Metrics} m @returns {SystemTargetEx} */
function buildSystem(m) {
  const L = m.L;
  const lowCS = m.logCS !== null && m.logCS < 1.65 - EPS;
  const veryLowCS = m.logCS !== null && m.logCS < 1.35 - EPS;
  const fs = m.fsNeeded;
  /** @type {SystemTargetEx} */
  const target = {
    textScale: round(clampR(fs / PLATFORM_DEFAULT_PX, SAFE_RANGES.textScale), 3),
    boldText: lowCS || (L !== null && L >= 0.3 - EPS) || m.lines.consistent,
    increaseContrast: lowCS,
    colorFilter: mediaColourWarranted(m)
      ? { type: /** @type {'protan'|'deutan'|'tritan'} */ (m.color?.type), intensity: round(m.color?.severity ?? 0, 2) }
      : null,
    reduceWhitePoint: m.lightSensitivity === 'high', // symptom-driven only (item 48)
    darkMode: m.theme === 'dark',
    displayZoom: fs > ANDROID_MAX_TEXT_PX + EPS ? round(clampR(fs / ANDROID_MAX_TEXT_PX, SAFE_RANGES.displayZoom), 2) : 1,
    magnificationShortcut: (L !== null && L >= 0.7 - EPS) || m.ceilingLimited || fs > IOS_MAX_TEXT_PX + EPS,
  };
  if (lowCS) target.contrastLevel = veryLowCS ? 'high' : 'medium';
  return target;
}

// ---------------------------------------------------------------------------------------------------------------
// Red flags (§13)
// ---------------------------------------------------------------------------------------------------------------
const LEVEL_ORDER = { urgent: 0, recommend: 1, info: 2 };

/** @param {number|undefined} age */
function examInterval(age) {
  if (!isNum(age)) return null;
  if (age < 40) return '5–10';
  if (age < 55) return '2–4';
  if (age < 65) return '1–3';
  return '1–2';
}

/**
 * @param {Metrics} m
 * @param {Partial<ProfileInput>} input
 * @param {Partial<ProfileInput>|null} baseline  previous measurements (for R5 / R6 drop / R7 change), optional
 * @returns {ProfileFlag[]}
 */
export function computeFlags(m, input, baseline = null) {
  /** @type {ProfileFlag[]} */
  const flags = [];
  const age = isNum(input.age) ? input.age : undefined;
  /** @param {ProfileFlag['level']} level @param {string} code @param {Record<string, string|number>} [params] */
  const add = (level, code, params) => {
    /** @type {ProfileFlag} */
    const f = { level, code };
    const p = { ...(params || {}) };
    if (level !== 'info') p.timeframe = level === 'urgent' ? 'soon' : 'routine';
    if (Object.keys(p).length) f.params = p;
    flags.push(f);
  };

  // R3 / R3a — monocular acuity (binocular only when no monocular result exists)
  const r = m.eyes.right;
  const l = m.eyes.left;
  const monoReliable = [r, l].filter((e) => e && e.reliable);
  const worse = (/** @type {EyeAcuity} */ e) => e.ceilingLimited || e.L > 0.3 + EPS;
  const presbyopiaPattern = isNum(age) && age >= 45 && input.wearsCorrection === false &&
    m.testDistanceMm !== null && m.testDistanceMm <= 450 &&
    r?.reliable && l?.reliable && (worse(r) || worse(l)) && Math.abs(r.L - l.L) < 0.2 - EPS;
  if (presbyopiaPattern) {
    const severe = [r, l].some((e) => e.ceilingLimited || e.L > 1.0 + EPS);
    add(severe ? 'urgent' : 'recommend', 'NEAR_ACUITY_REDUCED');
  } else {
    const list = monoReliable.length ? [['RIGHT', r], ['LEFT', l]] : [['BOTH', m.eyes.both]];
    for (const [suffix, e] of /** @type {Array<[string, EyeAcuity|null]>} */ (list)) {
      if (!e || !e.reliable || !worse(e)) continue;
      const soon = e.ceilingLimited || e.L > 0.5 + EPS;
      add(soon ? 'urgent' : 'recommend', `LOW_ACUITY_${suffix}`, { score: detailScore(e.L) ?? 0 });
    }
  }
  // R4 — interocular difference ≥ 0.20
  if (r?.reliable && l?.reliable && Math.abs(r.L - l.L) >= 0.2 - EPS) {
    const soon = r.L > 0.3 + EPS || l.L > 0.3 + EPS;
    add(soon ? 'urgent' : 'recommend', 'ACUITY_DIFFERENCE', { right: detailScore(r.L) ?? 0, left: detailScore(l.L) ?? 0 });
  }
  // R5 — worsening ≥ 0.20 against the user's own baseline
  const bAcuity = baseline?.acuity || {};
  for (const [eye, suffix] of /** @type {const} */ ([['right', 'RIGHT'], ['left', 'LEFT'], ['both', 'BOTH']])) {
    const now = m.eyes[eye];
    const before = eyeAcuity(bAcuity[eye]);
    if (now?.reliable && before?.reliable && now.L - before.L >= 0.2 - EPS) {
      add('urgent', `ACUITY_WORSENED_${suffix}`, { before: detailScore(before.L) ?? 0, after: detailScore(now.L) ?? 0 });
    }
  }
  // R6 — contrast below the provisional age limit, or a drop ≥ 0.30
  if (m.logCS !== null) {
    const limit = isNum(age) && age >= 60 ? 1.5 : 1.65;
    if (m.logCS < limit - EPS) add(m.logCS < 1.0 - EPS ? 'urgent' : 'recommend', 'LOW_CONTRAST');
    const bcs = baseline?.contrast;
    if (bcs && bcs.reliable !== false && isNum(bcs.logCS) && bcs.logCS - m.logCS >= 0.3 - EPS) {
      add(m.logCS < 1.0 - EPS ? 'urgent' : 'recommend', 'CONTRAST_WORSENED');
    }
  }
  // R7 / R7a — colour
  const c = m.color;
  if (c?.reliable) {
    if (c.type === 'tritan' && c.severity > 0) add('urgent', 'COLOR_BLUE_YELLOW');
    else if (c.type === 'unclassified' && c.severity >= 0.3 - EPS) add('urgent', 'COLOR_GENERAL');
    else if ((c.type === 'protan' || c.type === 'deutan') && c.severity > 0) add('info', 'COLOR_RED_GREEN');
    const bc = baseline?.color;
    if (bc && bc.reliable !== false && typeof bc.type === 'string' && bc.type !== c.type) add('urgent', 'COLOR_CHANGED');
  }
  // R9 — consistent line-dial result
  for (const eye of m.lines.consistentEyes) add('recommend', `LINES_UNEVEN_${eye.toUpperCase()}`);
  // Focus range: R8 (near point vs age minimum, age < 40), §9.5 (no comfortable distance), R10 (measurable far point)
  if (m.focus) {
    const { nearMm, farMm, ampD, minComfortMm } = m.focus;
    // The camera floor is 150 mm (item 35): a near point at the floor only bounds the amplitude from below.
    if (isNum(age) && age < 40 && nearMm !== null && nearMm > 150 && ampD !== null && ampD < 15 - 0.25 * age - 2 - EPS) {
      add('recommend', 'NEAR_FOCUS_REDUCED', { cm: Math.round(nearMm / 10) });
    }
    // minComfortMm is null when the amplitude is ~0 (no comfortable near distance at all).
    if (ampD !== null && (minComfortMm === null || minComfortMm > 600)) add('recommend', 'NEAR_FOCUS_FAR');
    // Measured far point and a comfortable range narrower than 10 cm (e.g. near-sighted with little focusing range).
    else if (farMm !== null && minComfortMm !== null && farMm - minComfortMm < FOCUS_RANGE_MIN_MM - EPS) add('recommend', 'FOCUS_RANGE_LIMITED');
    // Not when the glasses-free model found the far point contradicted by the measured threshold (blur at every
    // distance, not distance blur): the flag would name a wrong distance. The line-dial / acuity flags cover it.
    if (farMm !== null && farMm <= 650 && input.wearsCorrection === false && !m.glassesFreePlan?.farIgnored) {
      add('recommend', 'DISTANCE_FOCUS_LIMITED', { cm: Math.round(farMm / 10) });
    }
  }
  // R11 (single run: informational) — unreliable tests
  const unreliable = [];
  for (const eye of /** @type {const} */ (['right', 'left', 'both'])) if (m.eyes[eye] && !m.eyes[eye].reliable) unreliable.push(`acuity-${eye}`);
  if (input.reading && (input.reading.reliable === false || m.cpsImplausible)) unreliable.push('reading');
  if (input.contrast && input.contrast.reliable === false) unreliable.push('contrast');
  if (input.color && input.color.reliable === false) unreliable.push('color');
  if (unreliable.length) add('info', 'UNRELIABLE', { tests: unreliable.join(',') });
  // Information about the measurement itself
  if (!m.screenCalibrated) add('info', 'DEFAULT_CALIBRATION');
  if (m.acuitySource === 'none') add('info', 'NO_ACUITY');
  if (m.recommendedDistanceMm !== null && m.testDistanceMm !== null &&
    Math.abs(m.recommendedDistanceMm - m.testDistanceMm) / m.testDistanceMm > 0.15 + EPS) {
    add('info', 'RECHECK_AT_DISTANCE', { cm: Math.round(m.recommendedDistanceMm / 10) });
  }
  // R12 — no red flag: exam-interval reminder
  if (!flags.some((f) => f.level !== 'info')) {
    const interval = examInterval(age);
    add('info', 'EXAM_REMINDER', interval ? { interval } : undefined);
  }
  return flags.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level]);
}

// ---------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------
function newId() {
  const c = /** @type {any} */ (globalThis).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** @param {unknown} d */
function isoOf(d) {
  return d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

/** Deep copy of the measurements, without the out-of-scope Amsler results. @param {Partial<ProfileInput>} input */
function storedInput(input) {
  const copy = /** @type {ProfileInput} */ (JSON.parse(JSON.stringify(input || {})));
  delete copy.amsler;
  return copy;
}

/**
 * @param {ProfileInput} input
 * @param {{id?: string, name?: string, now?: Date, baseline?: VisionProfile|ProfileInput|null}} [opts]
 *   `baseline`: the user's previous profile (or its input) on the same device, for change-based red flags (R5–R7).
 * @returns {VisionProfile}
 */
export function computeProfile(input, opts = {}) {
  const inp = /** @type {Partial<ProfileInput>} */ (input && typeof input === 'object' ? input : {});
  const m = deriveMetrics(inp);
  const system = buildSystem(m);
  const b = opts.baseline;
  const baseline = b && typeof b === 'object' ? /** @type {Partial<ProfileInput>} */ ('input' in b ? b.input : b) : null;
  const ts = isoOf(opts.now);
  return {
    version: 1,
    id: typeof opts.id === 'string' && opts.id ? opts.id : newId(),
    name: typeof opts.name === 'string' && opts.name ? opts.name : 'Me',
    createdAt: ts,
    updatedAt: ts,
    input: storedInput(inp),
    text: buildText(m, system.boldText),
    media: buildMedia(m),
    ui: buildUi(m),
    system,
    flags: computeFlags(m, inp, baseline),
    viewing: { recommendedDistanceMm: m.recommendedDistanceMm },
    ...(m.glassesFree ? { glassesFree: m.glassesFree } : {}),
  };
}

/**
 * Re-run the engine on a stored profile's measurements (e.g. after an engine update). Keeps id, name and createdAt.
 * @param {VisionProfile} profile
 * @param {{now?: Date, baseline?: VisionProfile|ProfileInput|null}} [opts]
 * @returns {VisionProfile}
 */
export function recomputeProfile(profile, opts = {}) {
  const p = computeProfile(profile?.input, { id: profile?.id, name: profile?.name, now: opts.now ?? new Date(), baseline: opts.baseline });
  if (typeof profile?.createdAt === 'string' && profile.createdAt) p.createdAt = profile.createdAt;
  return p;
}

/** True when a 3x3 matrix is the identity (within 1e-9). @param {ArrayLike<number>} mtx */
export function isIdentityMatrix(mtx) {
  for (let i = 0; i < 9; i++) if (Math.abs(mtx[i] - IDENTITY3[i]) > 1e-9) return false;
  return true;
}
