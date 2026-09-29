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

/** @typedef {import('../core/types.js').ProfileInput} ProfileInput */
/** @typedef {import('../core/types.js').VisionProfile} VisionProfile */
/** @typedef {import('../core/types.js').TextParams} TextParams */
/** @typedef {import('../core/types.js').FilterParams} FilterParams */
/** @typedef {import('../core/types.js').SystemSettingsTarget} SystemSettingsTarget */
/** @typedef {import('../core/types.js').ProfileFlag} ProfileFlag */
/** @typedef {import('../core/types.js').AcuityResult} AcuityResult */

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
/** Margin above the critical print size: +0.1 log [17]. */
export const CPS_MARGIN_LOG = 0.1;
/** x-height / em fallbacks when runtime measurement is unavailable [19]. */
export const XR_LATIN = 0.52;
export const XR_HEBREW = 0.58;
/** Never recommend below the platform default body (CSS / Android 16 px; iOS 17 pt handled by the guide) [18]. */
export const PLATFORM_DEFAULT_PX = 16;
/** Largest body size we apply to the app UI; beyond this, magnification is recommended instead. */
export const MAX_UI_FONT_PX = 64;
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
  const cps = rd && rd.reliable !== false && isNum(rd.criticalPrintSizeLogMAR) ? clamp(rd.criticalPrintSizeLogMAR, -0.3, 1.6) : null;
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
      if (r.consistent === true) { lines.consistent = true; lines.consistentEyes.push(eye); }
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
      ampD = Math.max(0, 1000 / nearMm - (farMm !== null ? 1000 / farMm : 0));
      minComfortMm = ampD > 0.05 ? 2000 / ampD : Infinity;
      if (minComfortMm > 600) recommendedDistanceMm = habitualMm; // no comfortable near distance: keep habitual, enlarge text
      else {
        const hi = Math.min(farMm ?? 600, 600);
        const lo = 250;
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
  return {
    cssPxPerMm, mmPerCss, screenCalibrated, habitualMm, textDistanceMm, testDistanceMm,
    eyes, L, acuitySource, ceilingLimited, cps, sizeSource, logCS, contrastTier: tier, lines, color,
    focus, recommendedDistanceMm,
    fsLatin, fsHebrew, fsNeeded, fsAcuityLatin: fsLatin,
    lightSensitivity: ls === 'low' || ls === 'high' ? ls : 'normal',
    theme: th === 'light' || th === 'dark' ? th : 'auto',
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
  let letter = 0;
  if (m.lines.suspected) letter = m.lines.consistent ? 0.04 : 0.02; // §6.4: +0.02–0.05 em
  if (lowCS) letter = Math.max(letter, 0.02);
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
    else if (farMm !== null && minComfortMm !== null && farMm < minComfortMm) add('recommend', 'FOCUS_RANGE_LIMITED');
    if (farMm !== null && farMm <= 650 && input.wearsCorrection === false) {
      add('recommend', 'DISTANCE_FOCUS_LIMITED', { cm: Math.round(farMm / 10) });
    }
  }
  // R11 (single run: informational) — unreliable tests
  const unreliable = [];
  for (const eye of /** @type {const} */ (['right', 'left', 'both'])) if (m.eyes[eye] && !m.eyes[eye].reliable) unreliable.push(`acuity-${eye}`);
  if (input.reading && input.reading.reliable === false) unreliable.push('reading');
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
