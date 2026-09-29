// @ts-check
/**
 * Pure calibration math (no DOM). Implements docs/research/vision-science.md §1 (screen), §2 (distance)
 * and §9 (focus range) plus the IMPLEMENTATION SPEC SUMMARY items 1, 2, 6–9 and 34–37.
 * Every function is deterministic and unit-tested in test/unit/calibration/.
 */

// ---------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------

/** ISO/IEC 7810 ID-1 card long side (mm) [V]. */
export const CARD_WIDTH_MM = 85.60;
/** ISO/IEC 7810 ID-1 card short side (mm) [V]. */
export const CARD_HEIGHT_MM = 53.98;
/** ID-1 corner radius (mm) [U]. */
export const CARD_CORNER_RADIUS_MM = 3.18;
/** Two card matches must agree within this relative difference, else a third match + median [D]. */
export const CARD_MATCH_TOLERANCE = 0.015;
/** Accepted device pixel pitch (mm per device pixel) = about 210–635 ppi [D]. */
export const PIXEL_PITCH_MIN_MM = 0.040;
export const PIXEL_PITCH_MAX_MM = 0.120;
/** Warn when a card match disagrees with a known device model by more than this [D]. */
export const KNOWN_DEVICE_TOLERANCE = 0.03;
/** Length of the on-screen ruler used by the no-card fallback (mm) [D]. */
export const RULER_LENGTH_MM = 80;

/** Blind-spot ("virtual chinrest") protocol constants, spec §2.1 / summary item 6. */
export const BLIND_SPOT = Object.freeze({
  /** Eccentricity of the blind spot's nasal edge [V]. */
  angleDeg: 13.5,
  /** Disc and fixation-square size (visual angle) [D]. */
  discDeg: 0.5,
  fixationDeg: 0.5,
  /** Disc speed, converted to mm/s from the initial distance guess [D]. */
  speedDegPerS: 2.0,
  initialGuessMm: 350,
  /** "Disappear" trials start 4° from fixation and move outwards; "reappear" trials start at 16° and move in. */
  disappearStartDeg: 4,
  reappearStartDeg: 16,
  trialsPerType: 4,
  /** Keep trials whose offset lies within 4°–22° of the current estimate. */
  keepMinDeg: 4,
  keepMaxDeg: 22,
  /** Reject a run whose coefficient of variation exceeds 10%; repeat when eyes differ by more than 12%. */
  maxCv: 0.10,
  maxEyeDiff: 0.12,
  /** Minimum kept trials per eye run, and per trial type (keeps the reaction-time cancellation) [D]. */
  minKeptPerRun: 4,
  minKeptPerType: 2,
  /** A disc must be able to start at 16° for a 300 mm viewer, else ask for landscape / a wider screen [D]. */
  minFeasibleDistanceMm: 300,
  /** Fixation-mark centre and far-edge margins (mm) [D]. */
  fixationMarginMm: 7,
  edgeMarginMm: 4,
});

/** Population horizontal visible iris diameter (mm), Rüfer et al. 2005 [S]. */
export const IRIS_MM = 11.71;
/** Constant used by MediaPipe's own iris_to_depth_calculator.cc [V] (kept for reference). */
export const MEDIAPIPE_IRIS_MM = 11.8;
/** MediaPipe Face Landmarker iris landmark indices [V]. "right"/"left" are the subject's eyes. */
export const RIGHT_IRIS = Object.freeze({ center: 468, contour: Object.freeze([469, 470, 471, 472]) });
export const LEFT_IRIS = Object.freeze({ center: 473, contour: Object.freeze([474, 475, 476, 477]) });
/** focalLengthPx is stored width-normalised to a 640 px wide frame (core/types.js). */
export const FOCAL_NORM_WIDTH_PX = 640;
/** Plausible normalised focal length: horizontal FOV of roughly 25°–130° [D]. */
export const FOCAL_MIN_PX = 150;
export const FOCAL_MAX_PX = 1500;
/** Exponential smoothing d_s = 0.9·d_s + 0.1·d_new, defined at MediaPipe's 30 fps reference frame rate [V/D]. */
export const SMOOTHING_KEEP = 0.9;
export const SMOOTHING_REF_FRAME_MS = 1000 / 30;
/** Accept camera frames only with |yaw| and |pitch| under 20° [D]. */
export const MAX_HEAD_YAW_DEG = 20;
export const MAX_HEAD_PITCH_DEG = 20;

/** Default viewing distances [D]. */
export const DEFAULT_DISTANCE_PHONE_MM = 350;
export const DEFAULT_DISTANCE_TABLET_MM = 400;
/** Plausible eye-to-screen distance for a handheld device (camera floor 15 cm … 1 m) [D]. */
export const MIN_PLAUSIBLE_DISTANCE_MM = 150;
export const MAX_PLAUSIBLE_DISTANCE_MM = 1000;

/** Focus range (§9) constants. */
export const FOCUS = Object.freeze({
  /** Camera cannot track below about 15 cm: near points below are reported as "≤ 150 mm". */
  cameraFloorMm: 150,
  /** Far points are measurable only up to arm's length. */
  farPointMaxMm: 650,
  /** Near-point target: x-height at max(L + 0.2, 0.3) logMAR. */
  nearOffsetLogMAR: 0.2,
  nearMinLogMAR: 0.3,
  /** Far-point target: logMAR 0.1, or the user's best acuity + 0.1. */
  farLogMAR: 0.1,
  farOffsetLogMAR: 0.1,
  /** Show "move more slowly" above 3 cm/s. */
  maxSpeedMmPerS: 30,
  runs: 3,
  nearStartMm: 400,
  farStartMm: 200,
});

/** One arcminute in radians. */
const ARCMIN = Math.PI / 10800;

// ---------------------------------------------------------------------------------------------------------------
// Small statistics helpers
// ---------------------------------------------------------------------------------------------------------------

/** @param {number} deg */
export function degToRad(deg) { return (deg * Math.PI) / 180; }
/** @param {number} rad */
export function radToDeg(rad) { return (rad * 180) / Math.PI; }

/** @param {number[]} values @returns {number} NaN for an empty list */
export function median(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** @param {number[]} values */
export function mean(values) {
  if (!values.length) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n − 1). 0 for fewer than two values. @param {number[]} values */
export function sampleSd(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

/** Coefficient of variation (sample SD / mean). @param {number[]} values */
export function coefficientOfVariation(values) {
  const m = mean(values);
  return m ? sampleSd(values) / m : NaN;
}

/** |a − b| relative to their mean. @param {number} a @param {number} b */
export function relativeDifference(a, b) {
  return Math.abs(a - b) / ((a + b) / 2);
}

/** @param {number} v @param {number} lo @param {number} hi */
export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/** @param {unknown} v @returns {v is number} */
function isPositive(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; }

/** @param {string} name @param {unknown} v */
function requirePositive(name, v) {
  if (!isPositive(v)) throw new RangeError(`${name} must be a positive finite number (got ${String(v)})`);
}

// ---------------------------------------------------------------------------------------------------------------
// Screen calibration (§1)
// ---------------------------------------------------------------------------------------------------------------

/**
 * CSS px per mm from the on-screen length of the card's long side (85.60 mm).
 * @param {number} cardWidthCssPx  long side of the matched rectangle in CSS px
 */
export function cssPxPerMmFromCard(cardWidthCssPx) {
  requirePositive('cardWidthCssPx', cardWidthCssPx);
  return cardWidthCssPx / CARD_WIDTH_MM;
}

/**
 * CSS px per mm from any matched physical length (ruler fallback).
 * @param {number} lengthCssPx @param {number} lengthMm
 */
export function cssPxPerMmFromLength(lengthCssPx, lengthMm) {
  requirePositive('lengthCssPx', lengthCssPx);
  requirePositive('lengthMm', lengthMm);
  return lengthCssPx / lengthMm;
}

/**
 * Physical device pixel pitch in mm: mmPerDev = mmPerCss / dpr (spec §0.2, summary item 2).
 * Note: the spec's plausibility sentence writes "mmPerCss·dpr" but names the quantity "device pixel pitch"
 * with the 210–635 ppi range, which is mmPerCss / dpr; that is what we check.
 * @param {number} cssPxPerMm @param {number} dpr
 */
export function devicePixelPitchMm(cssPxPerMm, dpr) {
  requirePositive('cssPxPerMm', cssPxPerMm);
  requirePositive('dpr', dpr);
  return 1 / (cssPxPerMm * dpr);
}

/**
 * Plausibility check: device pixel pitch between 0.040 and 0.120 mm.
 * @param {number} cssPxPerMm @param {number} dpr
 */
export function isPlausibleCssPxPerMm(cssPxPerMm, dpr) {
  if (!isPositive(cssPxPerMm) || !isPositive(dpr)) return false;
  const pitch = devicePixelPitchMm(cssPxPerMm, dpr);
  return pitch >= PIXEL_PITCH_MIN_MM - 1e-12 && pitch <= PIXEL_PITCH_MAX_MM + 1e-12;
}

/**
 * The range of CSS px per mm that passes the plausibility check at this dpr.
 * @param {number} dpr @returns {{min: number, max: number}}
 */
export function plausibleCssPxPerMmRange(dpr) {
  requirePositive('dpr', dpr);
  return { min: 1 / (PIXEL_PITCH_MAX_MM * dpr), max: 1 / (PIXEL_PITCH_MIN_MM * dpr) };
}

/**
 * Combine repeated card (or ruler) matches: two matches that agree within 1.5% → their mean;
 * otherwise a third match is needed and the median of all matches is used.
 * @param {number[]} matches  CSS px per mm of each match, in order
 * @returns {{status: 'accept', cssPxPerMm: number, spread: number} | {status: 'repeat', spread: number}}
 */
export function evaluateCardMatches(matches) {
  const vals = matches.filter(isPositive);
  if (vals.length < 2) return { status: 'repeat', spread: NaN };
  const spread = (Math.max(...vals) - Math.min(...vals)) / mean(vals);
  if (vals.length === 2) {
    if (relativeDifference(vals[0], vals[1]) <= CARD_MATCH_TOLERANCE + 1e-12) {
      return { status: 'accept', cssPxPerMm: mean(vals), spread };
    }
    return { status: 'repeat', spread };
  }
  return { status: 'accept', cssPxPerMm: median(vals), spread };
}

/**
 * Popular devices whose CSS px size can be inferred from screen size + dpr (portrait CSS px, dpr → ppi).
 * Cross-check only, never the only source [U: vendor specifications]. Down-sampled models are omitted.
 */
const KNOWN_APPLE_DEVICES = Object.freeze([
  { w: 390, h: 844, dpr: 3, ppi: 460 },   // iPhone 12/13/14, 12/13 Pro
  { w: 393, h: 852, dpr: 3, ppi: 460 },   // iPhone 14 Pro, 15, 15 Pro, 16
  { w: 402, h: 874, dpr: 3, ppi: 460 },   // iPhone 16 Pro
  { w: 428, h: 926, dpr: 3, ppi: 458 },   // iPhone 12/13 Pro Max, 14 Plus
  { w: 430, h: 932, dpr: 3, ppi: 460 },   // iPhone 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  { w: 440, h: 956, dpr: 3, ppi: 460 },   // iPhone 16 Pro Max
  { w: 414, h: 896, dpr: 2, ppi: 326 },   // iPhone XR, 11
  { w: 414, h: 896, dpr: 3, ppi: 458 },   // iPhone XS Max, 11 Pro Max
  { w: 375, h: 667, dpr: 2, ppi: 326 },   // iPhone 6/7/8, SE 2/3
  { w: 320, h: 568, dpr: 2, ppi: 326 },   // iPhone SE 1
  { w: 744, h: 1133, dpr: 2, ppi: 326 },  // iPad mini 6
  { w: 768, h: 1024, dpr: 2, ppi: 264 },  // iPad 9.7"
  { w: 810, h: 1080, dpr: 2, ppi: 264 },  // iPad 7–9th gen
  { w: 820, h: 1180, dpr: 2, ppi: 264 },  // iPad 10th gen, iPad Air 4/5
  { w: 834, h: 1194, dpr: 2, ppi: 264 },  // iPad Pro 11"
  { w: 1024, h: 1366, dpr: 2, ppi: 264 }, // iPad Pro 12.9"
]);

/**
 * ppi of a known Apple device model inferred from screen size and dpr, or null.
 * @param {{screenWidthCssPx: number, screenHeightCssPx: number, dpr: number, apple: boolean}} p
 * @returns {number|null}
 */
export function knownDevicePpi({ screenWidthCssPx, screenHeightCssPx, dpr, apple }) {
  if (!apple) return null;
  const w = Math.min(screenWidthCssPx, screenHeightCssPx);
  const hgt = Math.max(screenWidthCssPx, screenHeightCssPx);
  const hit = KNOWN_APPLE_DEVICES.find((d) => d.w === w && d.h === hgt && Math.abs(d.dpr - dpr) < 0.01);
  return hit ? hit.ppi : null;
}

/** CSS px per mm implied by a physical ppi and dpr. @param {number} ppi @param {number} dpr */
export function cssPxPerMmFromPpi(ppi, dpr) {
  requirePositive('ppi', ppi);
  requirePositive('dpr', dpr);
  return ppi / (25.4 * dpr);
}

/**
 * Compare a measured calibration with a known model; warn above 3% disagreement.
 * @param {number} cssPxPerMm @param {number|null} expectedCssPxPerMm
 * @returns {{relDiff: number|null, warn: boolean}}
 */
export function crossCheckKnownDevice(cssPxPerMm, expectedCssPxPerMm) {
  if (!isPositive(expectedCssPxPerMm) || !isPositive(cssPxPerMm)) return { relDiff: null, warn: false };
  const relDiff = Math.abs(cssPxPerMm - expectedCssPxPerMm) / expectedCssPxPerMm;
  return { relDiff, warn: relDiff > KNOWN_DEVICE_TOLERANCE };
}

/** A device whose shorter screen side is at least 600 CSS px is treated as a tablet. @param {number} w @param {number} hgt */
export function isTabletSize(w, hgt) {
  return Math.min(w, hgt) >= 600;
}

/**
 * Best-guess CSS px per mm when the user cannot calibrate (method 'default'): the known-model table first,
 * then platform conventions (Android 160 dp/in; iPhone ≈ 153 CSS px/in; iPad ≈ 132; desktop 96).
 * @param {{screenWidthCssPx: number, screenHeightCssPx: number, dpr: number, apple: boolean, touch: boolean}} p
 */
export function defaultCssPxPerMm(p) {
  const ppi = knownDevicePpi(p);
  if (ppi) return cssPxPerMmFromPpi(ppi, p.dpr);
  if (!p.touch) return 96 / 25.4;
  const tablet = isTabletSize(p.screenWidthCssPx, p.screenHeightCssPx);
  if (p.apple) return (tablet ? 132 : 153) / 25.4;
  return 160 / 25.4;
}

// ---------------------------------------------------------------------------------------------------------------
// Viewing distance: blind spot (§2.1)
// ---------------------------------------------------------------------------------------------------------------

/** Physical offset (mm) at which a visual angle `angleDeg` is seen from `distanceMm`. @param {number} distanceMm @param {number} angleDeg */
export function offsetMmForAngle(distanceMm, angleDeg) {
  return distanceMm * Math.tan(degToRad(angleDeg));
}

/** Visual angle (deg) of an offset seen from a distance. @param {number} offsetMm @param {number} distanceMm */
export function angleDegForOffset(offsetMm, distanceMm) {
  return radToDeg(Math.atan(offsetMm / distanceMm));
}

/**
 * Viewing distance from the blind-spot offset: d = offset_mm / tan(13.5°).
 * @param {{offsetCssPx: number, cssPxPerMm: number, angleDeg?: number}} p
 * @returns {number} distance in mm
 */
export function distanceFromBlindSpot({ offsetCssPx, cssPxPerMm, angleDeg = BLIND_SPOT.angleDeg }) {
  requirePositive('cssPxPerMm', cssPxPerMm);
  requirePositive('angleDeg', angleDeg);
  if (!Number.isFinite(offsetCssPx)) throw new RangeError('offsetCssPx must be finite');
  return (Math.abs(offsetCssPx) / cssPxPerMm) / Math.tan(degToRad(angleDeg));
}

/** Disc speed in mm/s: 2°/s at the initial distance guess. @param {number} [guessMm] */
export function blindSpotSpeedMmPerS(guessMm = BLIND_SPOT.initialGuessMm) {
  return offsetMmForAngle(guessMm, BLIND_SPOT.speedDegPerS);
}

/**
 * Trial order for one eye: alternating disappear / reappear, starting with disappear (so that the first
 * estimate exists before the first reappear trial). 4 + 4 by default.
 * @param {number} [perType]
 * @returns {Array<'disappear'|'reappear'>}
 */
export function blindSpotTrialSchedule(perType = BLIND_SPOT.trialsPerType) {
  /** @type {Array<'disappear'|'reappear'>} */
  const out = [];
  for (let i = 0; i < perType; i++) out.push('disappear', 'reappear');
  return out;
}

/**
 * Screen geometry for one blind-spot run. Fixation sits near the right edge for the LEFT eye (disc moves left)
 * and near the left edge for the RIGHT eye (disc moves right). Positions are absolute (never mirrored).
 * @param {{surfaceWidthCssPx: number, cssPxPerMm: number, eye: 'left'|'right', insetLeftCssPx?: number, insetRightCssPx?: number}} p
 * @returns {{fixationXCssPx: number, direction: 1|-1, maxTravelMm: number, usableWidthMm: number}}
 */
export function blindSpotLayout({ surfaceWidthCssPx, cssPxPerMm, eye, insetLeftCssPx = 0, insetRightCssPx = 0 }) {
  const margin = BLIND_SPOT.fixationMarginMm * cssPxPerMm;
  const edge = BLIND_SPOT.edgeMarginMm * cssPxPerMm;
  const usablePx = Math.max(0, surfaceWidthCssPx - insetLeftCssPx - insetRightCssPx);
  const fixationXCssPx = eye === 'left' ? surfaceWidthCssPx - insetRightCssPx - margin : insetLeftCssPx + margin;
  const maxTravelPx = Math.max(0, usablePx - margin - edge);
  return {
    fixationXCssPx,
    direction: eye === 'left' ? -1 : 1,
    maxTravelMm: maxTravelPx / cssPxPerMm,
    usableWidthMm: usablePx / cssPxPerMm,
  };
}

/**
 * Whether a surface is wide enough to run the blind-spot procedure (the "reappear" start at 16° must fit
 * for a viewer at 300 mm). Phones in portrait fail → ask to rotate to landscape.
 * @param {number} maxTravelMm
 */
export function isBlindSpotFeasible(maxTravelMm) {
  return maxTravelMm >= offsetMmForAngle(BLIND_SPOT.minFeasibleDistanceMm, BLIND_SPOT.reappearStartDeg);
}

/**
 * Starting offset (mm from fixation) of a trial.
 * @param {'disappear'|'reappear'} type @param {number} estimateMm @param {number} maxTravelMm
 */
export function blindSpotStartOffsetMm(type, estimateMm, maxTravelMm) {
  const deg = type === 'disappear' ? BLIND_SPOT.disappearStartDeg : BLIND_SPOT.reappearStartDeg;
  return Math.min(offsetMmForAngle(estimateMm, deg), maxTravelMm);
}

/**
 * Keep-window for trial offsets given the current estimate: 4°–22°.
 * @param {number} estimateMm @returns {{minMm: number, maxMm: number}}
 */
export function blindSpotKeepWindow(estimateMm) {
  return {
    minMm: offsetMmForAngle(estimateMm, BLIND_SPOT.keepMinDeg),
    maxMm: offsetMmForAngle(estimateMm, BLIND_SPOT.keepMaxDeg),
  };
}

/**
 * @typedef {Object} BlindSpotTrial
 * @property {'disappear'|'reappear'} type
 * @property {number|null} offsetMm   Disc-centre distance from fixation at the tap, or null if missed.
 */

/**
 * @typedef {Object} BlindSpotRunResult
 * @property {boolean} ok
 * @property {'too-few'|'unstable'|null} reason
 * @property {number} distanceMm    median of kept per-trial distances (NaN if none)
 * @property {number[]} keptDistancesMm
 * @property {number} cv            coefficient of variation of kept distances
 * @property {number} kept
 * @property {number} discarded
 */

/**
 * Evaluate one eye's run. Per-trial d_i = offset/tan(13.5°); discard trials whose offset lies outside 4°–22°
 * of the current estimate (default: median of all valid trials); reject the run if CV > 10% or too few trials.
 * @param {BlindSpotTrial[]} trials
 * @param {{estimateMm?: number}} [opts]
 * @returns {BlindSpotRunResult}
 */
export function evaluateBlindSpotRun(trials, opts = {}) {
  const tanA = Math.tan(degToRad(BLIND_SPOT.angleDeg));
  const valid = trials.filter((t) => isPositive(t.offsetMm));
  const allD = valid.map((t) => /** @type {number} */ (t.offsetMm) / tanA);
  const estimate = isPositive(opts.estimateMm) ? opts.estimateMm : median(allD);
  if (!valid.length || !isPositive(estimate)) {
    return { ok: false, reason: 'too-few', distanceMm: NaN, keptDistancesMm: [], cv: NaN, kept: 0, discarded: trials.length };
  }
  const { minMm, maxMm } = blindSpotKeepWindow(estimate);
  const kept = valid.filter((t) => /** @type {number} */ (t.offsetMm) >= minMm && /** @type {number} */ (t.offsetMm) <= maxMm);
  const keptD = kept.map((t) => /** @type {number} */ (t.offsetMm) / tanA);
  const cv = keptD.length >= 2 ? coefficientOfVariation(keptD) : NaN;
  const perType = (/** @type {'disappear'|'reappear'} */ type) => kept.filter((t) => t.type === type).length;
  const enough = kept.length >= BLIND_SPOT.minKeptPerRun
    && perType('disappear') >= BLIND_SPOT.minKeptPerType && perType('reappear') >= BLIND_SPOT.minKeptPerType;
  /** @type {'too-few'|'unstable'|null} */
  let reason = null;
  if (!enough) reason = 'too-few';
  else if (!(cv <= BLIND_SPOT.maxCv + 1e-12)) reason = 'unstable';
  return {
    ok: reason === null, reason, distanceMm: median(keptD), keptDistancesMm: keptD, cv,
    kept: kept.length, discarded: trials.length - kept.length,
  };
}

/**
 * Current running estimate during a run (median of trials that pass the keep-window around the previous
 * estimate), used to place the next "reappear" trial. Falls back to `fallbackMm`.
 * @param {BlindSpotTrial[]} trials @param {number} fallbackMm
 */
export function blindSpotRunningEstimate(trials, fallbackMm) {
  const tanA = Math.tan(degToRad(BLIND_SPOT.angleDeg));
  const d = trials.filter((t) => isPositive(t.offsetMm)).map((t) => /** @type {number} */ (t.offsetMm) / tanA)
    .filter(isPlausibleDistanceMm);
  return d.length ? median(d) : fallbackMm;
}

/**
 * Combine the two eyes' runs: repeat when they differ by more than 12%; D_bs = median of all kept trials.
 * @param {BlindSpotRunResult} left @param {BlindSpotRunResult} right
 * @returns {{ok: boolean, reason: 'eyes-differ'|'run-rejected'|'implausible'|null, eyeDifference: number, distanceMm: number}}
 */
export function combineBlindSpotEyes(left, right) {
  if (!left.ok || !right.ok) return { ok: false, reason: 'run-rejected', eyeDifference: NaN, distanceMm: NaN };
  const eyeDifference = relativeDifference(left.distanceMm, right.distanceMm);
  const distanceMm = median([...left.keptDistancesMm, ...right.keptDistancesMm]);
  if (eyeDifference > BLIND_SPOT.maxEyeDiff + 1e-12) return { ok: false, reason: 'eyes-differ', eyeDifference, distanceMm };
  if (!isPlausibleDistanceMm(distanceMm)) return { ok: false, reason: 'implausible', eyeDifference, distanceMm };
  return { ok: true, reason: null, eyeDifference, distanceMm };
}

/** Eye-to-screen distance plausibility for a handheld device: 150–1000 mm. @param {number} mm */
export function isPlausibleDistanceMm(mm) {
  return isPositive(mm) && mm >= MIN_PLAUSIBLE_DISTANCE_MM && mm <= MAX_PLAUSIBLE_DISTANCE_MM;
}

/** Default viewing distance: phone 350 mm, tablet 400 mm. @param {boolean} tablet */
export function defaultDistanceMm(tablet) {
  return tablet ? DEFAULT_DISTANCE_TABLET_MM : DEFAULT_DISTANCE_PHONE_MM;
}

// ---------------------------------------------------------------------------------------------------------------
// Viewing distance: camera + iris (§2.2)
// ---------------------------------------------------------------------------------------------------------------

/**
 * MediaPipe's depth formula: depth = IRIS_MM · sqrt(f² + r²) / iris_px (r = iris-centre offset from the image
 * centre, in the same pixel units as f and iris_px).
 * @param {{irisDiameterPx: number, focalLengthPx: number, offCenterPx?: number, irisMm?: number}} p
 * @returns {number} distance in mm
 */
export function distanceFromIris({ irisDiameterPx, focalLengthPx, offCenterPx = 0, irisMm = IRIS_MM }) {
  requirePositive('irisDiameterPx', irisDiameterPx);
  requirePositive('focalLengthPx', focalLengthPx);
  requirePositive('irisMm', irisMm);
  const r = Number.isFinite(offCenterPx) ? offCenterPx : 0;
  return (irisMm * Math.sqrt(focalLengthPx ** 2 + r ** 2)) / irisDiameterPx;
}

/**
 * Inverse of distanceFromIris: the focal length (px) that makes the iris formula return `distanceMm`.
 * With irisMm = IRIS_MM this is the spec's per-device f_px = D_bs·I0/11.71; because the tracker uses the same
 * constant, D = K / iris_px with K = D_bs·I0, i.e. the user's own iris size cancels out.
 * @param {{irisDiameterPx: number, distanceMm: number, irisMm?: number, offCenterPx?: number}} p
 * @returns {number} focal length in px (NaN if the off-centre offset makes it impossible)
 */
export function focalLengthFromKnownDistance({ irisDiameterPx, distanceMm, irisMm = IRIS_MM, offCenterPx = 0 }) {
  requirePositive('irisDiameterPx', irisDiameterPx);
  requirePositive('distanceMm', distanceMm);
  requirePositive('irisMm', irisMm);
  const p = (distanceMm * irisDiameterPx) / irisMm;
  const r = Number.isFinite(offCenterPx) ? offCenterPx : 0;
  const f2 = p * p - r * r;
  return f2 > 0 ? Math.sqrt(f2) : NaN;
}

/** Scale a pixel quantity measured on a frame to the 640 px normalised frame. @param {number} px @param {number} frameWidthPx */
export function normalisePx(px, frameWidthPx) {
  requirePositive('frameWidthPx', frameWidthPx);
  return (px * FOCAL_NORM_WIDTH_PX) / frameWidthPx;
}

/** @param {number} f640 */
export function isPlausibleFocalLength(f640) {
  return isPositive(f640) && f640 >= FOCAL_MIN_PX && f640 <= FOCAL_MAX_PX;
}

/**
 * @typedef {{x: number, y: number, z?: number}} Landmark
 * @typedef {{diameterPx: number, centerXPx: number, centerYPx: number, offCenterPx: number}} IrisMeasurement
 */

/**
 * Iris diameter (mean of the two contour diameters, i.e. of horizontal and vertical) and the centre's offset
 * from the image centre, in image pixels, from normalised MediaPipe landmarks.
 * @param {Landmark[]} landmarks  478 normalised landmarks
 * @param {number} widthPx @param {number} heightPx
 * @param {'right'|'left'} eye  subject's eye
 * @returns {IrisMeasurement|null}
 */
export function irisFromLandmarks(landmarks, widthPx, heightPx, eye) {
  const idx = eye === 'right' ? RIGHT_IRIS : LEFT_IRIS;
  const pts = idx.contour.map((i) => landmarks?.[i]);
  const c = landmarks?.[idx.center];
  if (!c || pts.some((p) => !p)) return null;
  const px = (/** @type {Landmark} */ p) => [p.x * widthPx, p.y * heightPx];
  const [a, b, cc, d] = pts.map((p) => px(/** @type {Landmark} */ (p)));
  const d1 = Math.hypot(a[0] - cc[0], a[1] - cc[1]);
  const d2 = Math.hypot(b[0] - d[0], b[1] - d[1]);
  const diameterPx = (d1 + d2) / 2;
  if (!(diameterPx > 0)) return null;
  const [cx, cy] = px(c);
  return { diameterPx, centerXPx: cx, centerYPx: cy, offCenterPx: Math.hypot(cx - widthPx / 2, cy - heightPx / 2) };
}

/**
 * Head yaw/pitch (deg) from MediaPipe's 4×4 facial transformation matrix. Uses the face's forward axis
 * (third basis column, column-major data); the magnitude of both angles is insensitive to row/column order.
 * @param {ArrayLike<number>|null|undefined} data 16 numbers
 * @returns {{yawDeg: number, pitchDeg: number}|null}
 */
export function headPoseFromMatrix(data) {
  if (!data || data.length < 16) return null;
  const fx = data[8]; const fy = data[9]; const fz = data[10];
  const n = Math.hypot(fx, fy, fz);
  if (!(n > 0)) return null;
  return {
    yawDeg: radToDeg(Math.atan2(fx / n, fz / n)),
    pitchDeg: radToDeg(Math.atan2(fy / n, Math.hypot(fx, fz) / n)),
  };
}

/** @param {{yawDeg: number, pitchDeg: number}|null} pose */
export function isFrontalPose(pose) {
  if (!pose) return true; // no matrix available: do not reject
  return Math.abs(pose.yawDeg) <= MAX_HEAD_YAW_DEG && Math.abs(pose.pitchDeg) <= MAX_HEAD_PITCH_DEG;
}

/**
 * Exponential smoothing d_s = 0.9·d_s + 0.1·d_new per reference frame (1/30 s). With frame throttling, the
 * factor is applied per elapsed reference frame so the time response matches MediaPipe's 30 fps graph.
 * @param {number|null} prev @param {number} next @param {number} [dtMs]
 */
export function smoothDistance(prev, next, dtMs = SMOOTHING_REF_FRAME_MS) {
  if (prev === null || !Number.isFinite(prev)) return next;
  const frames = clamp(dtMs / SMOOTHING_REF_FRAME_MS, 0, 30);
  const keep = SMOOTHING_KEEP ** frames;
  return keep * prev + (1 - keep) * next;
}

/**
 * Viewing distance to a stimulus Δ mm from the camera in the screen plane: d = sqrt(D_cam² + Δ²).
 * @param {number} cameraDistanceMm @param {number} deltaMm
 */
export function distanceToStimulus(cameraDistanceMm, deltaMm) {
  return Math.sqrt(cameraDistanceMm ** 2 + deltaMm ** 2);
}

// ---------------------------------------------------------------------------------------------------------------
// Focus range (§9)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Physical x-height (mm) for a logMAR level at a distance: x = 2·d·tan(5·10^L arcmin / 2).
 * @param {number} distanceMm @param {number} logMAR
 */
export function xHeightMmForLogMAR(distanceMm, logMAR) {
  return 2 * distanceMm * Math.tan((5 * 10 ** logMAR * ARCMIN) / 2);
}

/**
 * CSS font size that yields a physical x-height.
 * @param {number} xHeightMm @param {number} xHeightRatio  x-height / font size (e.g. 0.52)
 * @param {number} cssPxPerMm
 */
export function fontPxForXHeight(xHeightMm, xHeightRatio, cssPxPerMm) {
  requirePositive('xHeightRatio', xHeightRatio);
  return (xHeightMm / xHeightRatio) * cssPxPerMm;
}

/** Near-point target level: max(L + 0.2, 0.3) logMAR (L unknown → 0.3). @param {number|null|undefined} userLogMAR */
export function nearTargetLogMAR(userLogMAR) {
  const L = Number.isFinite(userLogMAR) ? /** @type {number} */ (userLogMAR) : 0;
  return Math.max(L + FOCUS.nearOffsetLogMAR, FOCUS.nearMinLogMAR);
}

/** Far-point target level: best acuity + 0.1, or logMAR 0.1 when unknown. @param {number|null|undefined} userLogMAR */
export function farTargetLogMAR(userLogMAR) {
  return Number.isFinite(userLogMAR) ? /** @type {number} */ (userLogMAR) + FOCUS.farOffsetLogMAR : FOCUS.farLogMAR;
}

/**
 * Median of the near-point runs. Runs that reached the camera floor are recorded as ≤ 150 mm.
 * @param {number[]} runsMm @returns {{nearPointMm: number|null, floorLimited: boolean}}
 */
export function combineNearPointRuns(runsMm) {
  const vals = runsMm.filter(isPositive).map((v) => Math.max(v, FOCUS.cameraFloorMm));
  if (!vals.length) return { nearPointMm: null, floorLimited: false };
  const m = median(vals);
  return { nearPointMm: Math.round(m), floorLimited: m <= FOCUS.cameraFloorMm };
}

/**
 * Median of the far-point runs; `null` entries mean "still sharp at arm's length". The result is null
 * ("beyond measurable range") when the median is beyond 650 mm.
 * @param {Array<number|null>} runs @returns {number|null}
 */
export function combineFarPointRuns(runs) {
  const vals = runs.map((v) => (isPositive(v) ? v : Infinity));
  if (!vals.length) return null;
  const m = median(vals);
  return Number.isFinite(m) && m <= FOCUS.farPointMaxMm ? Math.round(m) : null;
}

/**
 * Movement speed (mm/s) over the most recent `windowMs` of a distance history.
 * @param {Array<{t: number, mm: number}>} history  chronological samples (t in ms)
 * @param {number} [windowMs]
 */
export function movementSpeedMmPerS(history, windowMs = 500) {
  if (history.length < 2) return 0;
  const last = history[history.length - 1];
  let first = last;
  for (let i = history.length - 2; i >= 0; i--) {
    if (last.t - history[i].t > windowMs) break;
    first = history[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? Math.abs(last.mm - first.mm) / (dt / 1000) : 0;
}
