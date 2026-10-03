// @ts-check
/**
 * SIMULATED ONBOARDING — runs the REAL pure procedures for one simulated person, exactly in the order and with the
 * parameters the onboarding flow uses (flows/onboarding-plan.js PLAN), then builds the ProfileInput with the real
 * buildProfileInput (wearsCorrection: false) and runs the real engine. Validation-only code.
 *
 * What is simulated around the procedures (the DOM views are not run):
 * - Screen calibration: 3 credit-card matches, each off by N(0, 0.75 %) (95 % within ±1.5 %), combined by
 *   evaluateCardMatches (calibration-math.js).
 * - Distance calibration: blind-spot offset off by N(0, 3.5 %) (95 % within ±7 %, individual blind-spot angle),
 *   converted by distanceFromBlindSpot with the MEASURED px/mm. The live camera tracker is assumed calibrated against
 *   that distance, so it inherits the same relative error, plus 1 % frame jitter.
 * - The person keeps the phone at their habitual distance during the tests.
 * - Views: acuity stimulus box = min(width − 32, height − 420) CSS px; reading test in Hebrew with the spec's x-height
 *   fallback 0.58 and a widest line of 12 em; the focus test gets no acuity value (as onboarding.js passes none), so
 *   its targets are the absolute 0.3 (near) / 0.1 (far) levels.
 */
import { createAcuityProcedure } from '../tests/acuity/acuity-procedure.js';
import { minRenderableLogMAR, maxFittingLogMAR, decimalFromLogMAR, snellen6, snellen20 } from '../tests/acuity/acuity-math.js';
import { mulberry32 } from '../tests/acuity/random.js';
import { createContrastProcedure } from '../tests/contrast/contrast-procedure.js';
import {
  READING_PARAMS, largestFittingPrintSize, smallestRenderablePrintSize, printSizeSequence, fontPxForPrintSize,
  printSizeForFontPx, standardWords, wordsPerMinute, analyseReading, shouldStopReading,
} from '../tests/reading/reading-math.js';
import { SENTENCES } from '../tests/reading/sentences.js';
import { DIAL, spokeAngles, inferFromAnswers } from '../tests/astigmatism/astigmatism-math.js';
import {
  CARD_WIDTH_MM, BLIND_SPOT, FOCUS, cssPxPerMmFromCard, evaluateCardMatches, offsetMmForAngle, distanceFromBlindSpot,
  nearTargetLogMAR, farTargetLogMAR, combineNearPointRuns, combineFarPointRuns, median,
} from '../calibration/calibration-math.js';
import { buildProfileInput } from '../flows/onboarding-plan.js';
import { computeProfile } from '../engine/profile.js';
import { gauss, acuityObserver, contrastObserver, readingModel, readSentence, dialObserver, focusSweep } from './observers.js';
import { eyesFor, hashSeed } from './cohort.js';

/** @typedef {import('./cohort.js').SimUser} SimUser */
/** @typedef {import('./eye-model.js').SimulatedEye} SimulatedEye */
/** @typedef {import('../core/types.js').AcuityResult} AcuityResult */
/** @typedef {import('../core/types.js').ProfileInput} ProfileInput */
/** @typedef {import('../core/types.js').VisionProfile} VisionProfile */

const NOW = Date.parse('2026-10-03T09:00:00Z');
const ISO = new Date(NOW).toISOString();

/**
 * @typedef {Object} SimContext
 * @property {SimUser} user
 * @property {{right: SimulatedEye, left: SimulatedEye}} eyes
 * @property {number} pxTrue
 * @property {number} pxApp      measured CSS px per mm
 * @property {number} dTrue      true viewing distance during the tests (habitual)
 * @property {number} dApp       distance the app believes (blind spot)
 * @property {() => number} rng
 */

/** Live camera reading. @param {SimContext} c */
const camMm = (c) => c.dApp * (1 + 0.01 * gauss(c.rng));
/** Log-size error of a stimulus sized for (dCam, pxApp) but seen at (dTrue, pxTrue). @param {SimContext} c @param {number} dCam */
const seenBias = (c, dCam) => Math.log10(dCam / c.dTrue) + Math.log10(c.pxApp / c.pxTrue);

/**
 * Acuity test (one eye or both) through the real QUEST procedure.
 * @param {SimContext} c @param {'right'|'left'|'both'} eye
 * @returns {AcuityResult}
 */
export function runAcuity(c, eye) {
  const eyes = eye === 'both' ? [c.eyes.right, c.eyes.left] : [c.eyes[eye]];
  const proc = createAcuityProcedure({ age: c.user.age, rng: mulberry32(Math.floor(c.rng() * 2 ** 32)) });
  const side = Math.min(c.user.device.widthCssPx - 32, c.user.device.heightCssPx - 420);
  let durationMs = 0;
  for (let guard = 0; guard < 100 && !proc.isDone(); guard++) {
    const dCam = camMm(c);
    const trial = proc.next({
      minLogMAR: minRenderableLogMAR(dCam, c.pxApp, c.user.device.dpr),
      maxLogMAR: maxFittingLogMAR(dCam, c.pxApp, side),
    });
    if (!trial) break;
    const obs = acuityObserver({ eyes, dTrue: c.dTrue, bias: seenBias(c, dCam), rng: c.rng });
    proc.respond(obs(trial), { distanceMm: dCam, rtMs: 1500 });
    durationMs += 2500;
  }
  const est = proc.result();
  return {
    eye, logMAR: est.logMAR, decimal: Math.round(decimalFromLogMAR(est.logMAR) * 100) / 100,
    snellen6: snellen6(est.logMAR), snellen20: snellen20(est.logMAR),
    distanceMm: Math.round(Number.isFinite(est.meanDistanceMm) ? est.meanDistanceMm : c.dApp),
    reliable: est.reliable, floorLimited: est.floorLimited, trials: est.trials, durationMs,
  };
}

/**
 * Reading test (binocular), mirroring reading-view.js.
 * @param {SimContext} c @param {'he'|'en'} lang
 */
export function runReading(c, lang) {
  const xRatio = READING_PARAMS.xRatioFallback[lang];
  const set = SENTENCES[lang];
  const availableCss = Math.min(640, c.user.device.widthCssPx - 32 - 24);
  const lineEm = lang === 'he' ? 12 : 11.5;
  const maxFontPx = availableCss / lineEm;
  const d0 = camMm(c);
  const pStart = largestFittingPrintSize({ widestLineEm: lineEm, availableCssPx: availableCss, dMm: d0, cssPxPerMm: c.pxApp, xRatio });
  const pMin = Math.min(pStart, smallestRenderablePrintSize({ dMm: d0, cssPxPerMm: c.pxApp, dpr: c.user.device.dpr }));
  const sizes = printSizeSequence(pStart, pMin);
  const model = readingModel({ eyes: [c.eyes.right, c.eyes.left], dTrue: c.dTrue, hebrew: lang === 'he' });
  /** @type {Array<{p: number, wpm: number, passed: boolean, timeMs: number, dMm: number}>} */
  const history = [];
  for (let i = 0; i < sizes.length; i++) {
    const sentence = set.sentences[i % set.sentences.length];
    const dMm = camMm(c);
    const fontPx = Math.min(maxFontPx, fontPxForPrintSize(sizes[i], dMm, c.pxApp, xRatio));
    const pActual = printSizeForFontPx(fontPx, dMm, c.pxApp, xRatio);
    const words = standardWords(sentence.text);
    const r = readSentence({ model, pSeen: pActual + seenBias(c, dMm), words, rng: c.rng });
    const passed = r.choice === 'done' && r.correct;
    const wpm = passed ? wordsPerMinute(words, r.timeMs) : 0;
    history.push({ p: pActual, wpm, passed, timeMs: r.choice === 'done' ? r.timeMs : 0, dMm });
    if (shouldStopReading(history, i === sizes.length - 1)) break;
  }
  const a = analyseReading(history);
  const notRead = Math.round((pStart + READING_PARAMS.stepLog) * 100) / 100;
  const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  const meanD = history.reduce((s, q) => s + q.dMm, 0) / Math.max(1, history.length);
  return {
    criticalPrintSizeLogMAR: a.cps === null ? notRead : r2(a.cps),
    readingAcuityLogMAR: a.readingAcuity === null ? notRead : r2(a.readingAcuity),
    maxReadingSpeedWpm: Math.round(a.mrs),
    distanceMm: Math.round(meanD || c.dApp),
    reliable: a.reliable,
  };
}

/** Contrast test (binocular). @param {SimContext} c */
export function runContrast(c) {
  const proc = createContrastProcedure({ rng: mulberry32(Math.floor(c.rng() * 2 ** 32)) });
  const obs = contrastObserver({ eyes: [c.eyes.right, c.eyes.left], dTrue: c.dTrue, rng: c.rng });
  for (let guard = 0; guard < 100 && !proc.isDone(); guard++) {
    const trial = proc.next();
    if (!trial) break;
    proc.respond(obs(trial), { distanceMm: camMm(c) });
  }
  const est = proc.result();
  return { eye: /** @type {const} */ ('both'), logCS: est.logCS, reliable: est.reliable };
}

/** Line-dial check (one eye), mirroring astigmatism-view.js. @param {SimContext} c @param {'right'|'left'} eye */
export function runDial(c, eye) {
  const obs = dialObserver({ eye: c.eyes[eye], dTrue: c.dTrue, rng: c.rng });
  /** @type {Array<number|'equal'>} */
  const results = [];
  for (let n = 1; n <= DIAL.presentations; n++) results.push(obs(spokeAngles(c.rng() * DIAL.spokeStepDeg)));
  const inf = inferFromAnswers(results);
  return { eye, suspected: inf.suspected, axisDeg: inf.axisDeg };
}

/**
 * Focus-range test (binocular), mirroring focus-range-view.js cameraProcedure.
 * @param {SimContext} c @param {number} criterion personal "first blur" criterion (log units)
 */
export function runFocus(c, criterion) {
  const eyes = [c.eyes.right, c.eyes.left];
  const camBias = c.dApp / c.dTrue - 1;
  const pxBias = Math.log10(c.pxApp / c.pxTrue);
  const base = { eyes, criterion, camBias, pxBias, rng: c.rng, floorMm: FOCUS.cameraFloorMm, maxMm: FOCUS.farPointMaxMm };
  /** @type {number[]} */
  const nearRuns = [];
  for (let n = 1; n <= FOCUS.runs; n++) {
    const r = focusSweep({ ...base, kind: 'near', level: nearTargetLogMAR(undefined), startMm: FOCUS.nearStartMm });
    nearRuns.push(/** @type {number} */ (r.mm));
  }
  /** @type {Array<number|null>} */
  const farRuns = [];
  for (let n = 1; n <= FOCUS.runs; n++) {
    const r = focusSweep({ ...base, kind: 'far', level: farTargetLogMAR(undefined), startMm: FOCUS.farStartMm });
    farRuns.push(r.mm);
    if (farRuns.filter((v) => v === null).length >= 2) break;
  }
  const near = combineNearPointRuns(nearRuns);
  return { eye: /** @type {const} */ ('both'), nearPointMm: near.nearPointMm, farPointMm: combineFarPointRuns(farRuns) };
}

/**
 * @typedef {Object} SimRun
 * @property {SimUser} user
 * @property {{right: SimulatedEye, left: SimulatedEye}} eyes
 * @property {number} rep
 * @property {number} pxApp
 * @property {number} dApp
 * @property {AcuityResult} acuityBoth  extra binocular acuity run (measurement accuracy only; not in the plan)
 * @property {ProfileInput} input
 * @property {VisionProfile} profile
 * @property {number} criterion
 */

/**
 * Run the whole onboarding for one person and one repetition.
 * @param {SimUser} user
 * @param {{rep?: number, lang?: 'he'|'en', withFocus?: boolean, engine?: (input: ProfileInput) => VisionProfile}} [o]
 * @returns {SimRun}
 */
export function simulateUser(user, { rep = 0, lang = 'he', withFocus = true, engine } = {}) {
  const eyes = eyesFor(user);
  const rng = mulberry32(hashSeed(`${user.id}#${rep}`));
  const dev = user.device;
  // Screen calibration: three card matches.
  const matches = [0, 1, 2].map(() => cssPxPerMmFromCard(CARD_WIDTH_MM * dev.cssPxPerMm * (1 + 0.0075 * gauss(rng))));
  const ev = evaluateCardMatches(matches);
  const pxApp = ev.status === 'accept' ? ev.cssPxPerMm : median(matches);
  // Distance calibration: blind spot.
  const offsetCssPx = offsetMmForAngle(user.habitualMm, BLIND_SPOT.angleDeg) * dev.cssPxPerMm * (1 + 0.035 * gauss(rng));
  const dApp = distanceFromBlindSpot({ offsetCssPx, cssPxPerMm: pxApp });
  /** @type {SimContext} */
  const c = { user, eyes, pxTrue: dev.cssPxPerMm, pxApp, dTrue: user.habitualMm, dApp, rng };
  const criterion = 0.1 * mulberry32(hashSeed(`criterion:${user.id}`))();

  /** @type {Record<string, any>} */
  const results = {
    screen: { cssPxPerMm: pxApp, dpr: dev.dpr, method: 'card', screenWidthCssPx: dev.widthCssPx, screenHeightCssPx: dev.heightCssPx, measuredAt: ISO },
    distance: { distanceMm: Math.round(dApp), method: 'blindspot', measuredAt: ISO },
  };
  results['acuity-right'] = runAcuity(c, 'right');
  results['acuity-left'] = runAcuity(c, 'left');
  results.reading = runReading(c, lang);
  results.contrast = runContrast(c);
  results['astig-right'] = runDial(c, 'right');
  results['astig-left'] = runDial(c, 'left');
  if (withFocus) results.focus = runFocus(c, criterion);
  const acuityBoth = runAcuity(c, 'both');

  const draft = /** @type {import('../flows/onboarding-plan.js').OnboardingDraft} */ ({
    v: 1, startedAt: ISO, updatedAt: ISO, target: { mode: 'new', profileId: `sim-${user.id}` }, introDone: true,
    mode: 'none', glassesOffDone: true, // glasses-free onboarding (the flow turns under-18s into 'wear' mode itself)
    basics: { name: user.id, age: user.age, wearsCorrection: false, hasRx: false, lightSensitivity: 'normal' },
    rx: {}, results, skipped: withFocus ? [] : ['focus'], fallbacks: [],
  });
  const input = buildProfileInput(draft, { theme: 'auto', screenFallback: results.screen, now: NOW });
  const profile = (engine || ((i) => computeProfile(i, { id: `sim-${user.id}-${rep}`, name: user.id, now: new Date(NOW) })))(input);
  return { user, eyes, rep, pxApp, dApp, acuityBoth, input, profile, criterion };
}
