// @ts-check
/**
 * SIMULATED OBSERVERS — answer the REAL pure test procedures the way a person with a given (uncorrected) eye would.
 * Validation-only code (scripts/sim/**, test/unit/sim/**). Every observer takes an injected RNG (mulberry32).
 *
 * Geometry errors: the app sizes stimuli for the distance and px/mm it BELIEVES (calibration results); the eye sees
 * them at the true distance on the true screen. A stimulus the app labels L is seen at
 *   L_seen = L + log10(d_app / d_true) + log10(pxPerMm_app / pxPerMm_true).
 *
 * Psychometric model of the simulated person (deliberately NOT the procedure's own Weibull): 4AFC logistic in logMAR,
 *   P(correct) = γ + (1 − γ − λ) / (1 + exp(−(L_seen − T)/s)),  γ = 0.25, λ = 0.02, s = 0.04 (≈ 0.25 log from chance to
 *   ceiling, as for letter charts), T = the eye-model threshold at the viewing distance. Near threshold the person
 *   sometimes taps "not sure" (the procedure turns it into a random guess).
 */
import { DIRECTIONS } from '../tests/acuity/random.js';
import { eyeState, binocularLogMARAt, blurDiskArcmin, COMFORT_FRACTION } from './eye-model.js';
import { lineAngleDiff } from '../tests/astigmatism/astigmatism-math.js';

/** @typedef {import('./eye-model.js').SimulatedEye} SimulatedEye */
/** @typedef {import('../tests/acuity/random.js').Direction} Direction */

/** Standard normal deviate from a uniform RNG (Box–Muller). @param {() => number} rng */
export function gauss(rng) {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** @param {number} z */
const logistic = (z) => 1 / (1 + Math.exp(-z));

export const OBSERVER = Object.freeze({
  gamma: 0.25,
  lambda: 0.02,
  slope: 0.04,
  unsureBand: 0.06,
  unsureRate: 0.3,
  contrastSlope: 0.07,
});

/**
 * 4AFC answer for one trial.
 * @param {{seen: number, threshold: number, orientation: Direction, rng: () => number, slope?: number}} o
 * @returns {Direction|'unsure'}
 */
export function answer4afc({ seen, threshold, orientation, rng, slope = OBSERVER.slope }) {
  const z = (seen - threshold) / slope;
  if (Math.abs(seen - threshold) < OBSERVER.unsureBand && rng() < OBSERVER.unsureRate) return 'unsure';
  const p = OBSERVER.gamma + (1 - OBSERVER.gamma - OBSERVER.lambda) * logistic(z);
  if (rng() < p) return orientation;
  const wrong = DIRECTIONS.filter((d) => d !== orientation);
  return wrong[Math.min(2, Math.floor(rng() * 3))];
}

/** Viewing-geometry bias (log units) of a stimulus sized for the app's beliefs. */
export function geometryBias({ dApp, dTrue, pxApp, pxTrue }) {
  return Math.log10(dApp / dTrue) + Math.log10(pxApp / pxTrue);
}

/**
 * Acuity observer for the acuity procedure: threshold of `eyes` (one eye = monocular; several = binocular) at the
 * true distance, full accommodation (a short test).
 * @param {{eyes: SimulatedEye[], dTrue: number, bias: number, rng: () => number}} o
 * @returns {(trial: {logMAR: number, orientation: Direction}) => Direction|'unsure'}
 */
export function acuityObserver({ eyes, dTrue, bias, rng }) {
  const T = binocularLogMARAt(eyes, dTrue, 'max');
  return (trial) => answer4afc({ seen: trial.logMAR + bias, threshold: T, orientation: trial.orientation, rng });
}

/** First-kind Bessel J1 (polynomial approximations, Abramowitz & Stegun 9.4.4/9.4.6). @param {number} x */
export function besselJ1(x) {
  const ax = Math.abs(x);
  if (ax < 3) {
    const y = (x / 3) ** 2;
    return x * (0.5 - 0.56249985 * y + 0.21093573 * y ** 2 - 0.03954289 * y ** 3 + 0.00443319 * y ** 4 - 0.00031761 * y ** 5 + 0.00001109 * y ** 6);
  }
  const y = 3 / ax;
  const f = 0.79788456 + 0.00000156 * y + 0.01659667 * y ** 2 + 0.00017105 * y ** 3 - 0.00249511 * y ** 4 + 0.00113653 * y ** 5 - 0.00020033 * y ** 6;
  const t = ax - 2.35619449 + 0.12499612 * y + 0.0000565 * y ** 2 - 0.00637879 * y ** 3 + 0.00074348 * y ** 4 + 0.00079824 * y ** 5 - 0.00029166 * y ** 6;
  const r = (f * Math.cos(t)) / Math.sqrt(ax);
  return x < 0 ? -r : r;
}

/** MTF of a uniform blur disk of diameter βdeg at f c/deg: 2·J1(πβf)/(πβf). @param {number} betaDeg @param {number} cpd */
export function pillboxMtf(betaDeg, cpd) {
  const x = Math.PI * betaDeg * cpd;
  return x < 1e-6 ? 1 : (2 * besselJ1(x)) / x;
}

/** Age norm for Pelli-Robson-like logCS (after Elliott et al. 1990 / Mäntyjärvi & Laitinen 2001). @param {number} age */
export function contrastNorm(age) {
  return 1.92 - 0.006 * Math.max(0, age - 45);
}

/**
 * True logCS for the contrast test's large letters (2.8°): age norm minus the blur attenuation of the letter-identifying
 * band (≈ 3 cycles per letter, Solomon & Pelli 1994): Δ = −log10 |MTF|, floored at MTF 0.05. Large letters are robust
 * to defocus (Bradley et al. 1991), which this reproduces (≈ 0.03 log at 1 D, ≈ 0.3 log at 3 D for a 3.7 mm pupil).
 * @param {SimulatedEye[]} eyes @param {number} dTrue @param {number} [letterDeg]
 */
export function trueLogCS(eyes, dTrue, letterDeg = 2.8) {
  const cpd = 3 / letterDeg;
  let best = -Infinity;
  for (const e of eyes) {
    const st = eyeState(e, dTrue, { mode: 'max' });
    const betaDeg = blurDiskArcmin(e.pupilMm, st.blurD) / 60;
    const mtf = Math.max(0.05, Math.abs(pillboxMtf(betaDeg, cpd)));
    best = Math.max(best, contrastNorm(e.age) + Math.log10(mtf));
  }
  return best;
}

/**
 * Contrast observer: 4AFC logistic in log10 contrast around −logCS_true.
 * @param {{eyes: SimulatedEye[], dTrue: number, rng: () => number, offset?: number}} o
 * @returns {(trial: {logC: number, orientation: Direction}) => Direction|'unsure'}
 */
export function contrastObserver({ eyes, dTrue, rng, offset = 0 }) {
  const T = -(trueLogCS(eyes, dTrue) + offset);
  return (trial) => answer4afc({ seen: trial.logC, threshold: T, orientation: trial.orientation, rng, slope: OBSERVER.contrastSlope });
}

/**
 * Reading model (MNREAD-style) of the person at the true distance. Print size p = logMAR of the x-height.
 * Reading acuity RA = T + 0.05 (+0.05 for Hebrew, the spec's ×1.12 margin); critical print size CPS = RA + 0.25;
 * speed curve RS(p) = MRS·(1 − exp(−(p − p0)/τ)), p0 = RA − 0.05, τ = (CPS − p0)/ln 5 (CPS at 80 % of MRS);
 * MRS 200 wpm at ≤ 40 y, −0.4 %/y after (Legge 2007; Calabrèse et al. 2016 norms are 180–220 wpm).
 * Under defocus RA and CPS follow the acuity threshold (Chung, Jarvis & Cheung 2007).
 * @param {{eyes: SimulatedEye[], dTrue: number, hebrew?: boolean, mode?: 'max'|'comfortable'}} o
 */
export function readingModel({ eyes, dTrue, hebrew = true, mode = 'max' }) {
  const T = binocularLogMARAt(eyes, dTrue, mode);
  const RA = T + 0.05 + (hebrew ? 0.05 : 0);
  const CPS = RA + 0.25;
  const p0 = RA - 0.05;
  const tau = (CPS - p0) / Math.log(5);
  const age = eyes[0]?.age ?? 40;
  const MRS = 200 * (1 - 0.004 * Math.max(0, age - 40));
  return { T, RA, CPS, p0, tau, MRS, speed: (/** @type {number} */ p) => (p > p0 ? MRS * (1 - Math.exp(-(p - p0) / tau)) : 0) };
}

/**
 * One sentence of the reading test: did the person read it, how long did it take, did they pass the word check?
 * @param {{model: ReturnType<typeof readingModel>, pSeen: number, words: number, rng: () => number}} o
 * @returns {{choice: 'done'|'cant', timeMs: number, correct: boolean}}
 */
export function readSentence({ model, pSeen, words, rng }) {
  const canRead = rng() < logistic((pSeen - model.RA) / 0.04);
  if (!canRead) {
    if (rng() < 0.7) return { choice: 'cant', timeMs: 3000 + 4000 * rng(), correct: false };
    return { choice: 'done', timeMs: 8000 + 8000 * rng(), correct: rng() < 0.5 };
  }
  const wpm = Math.max(5, model.speed(pSeen)) * 10 ** (0.06 * gauss(rng));
  return { choice: 'done', timeMs: (60000 * words) / wpm, correct: rng() < 0.98 };
}

/**
 * Clock-dial observer (one eye). The eye looks at the dial at the test distance with a small accommodative lag at near
 * (0.3 D, Charman 1986 lag at 33–40 cm) — in a myope beyond the far point the eye is naturally "fogged" (both focal
 * lines in front of the retina), which is the condition the rule of 30 assumes; at near without fogging the lag puts
 * them behind the retina and the reported line is rotated by 90°.
 * The line triplet (3 × 1.5′ lines, 1.5′ gaps → a 7.5′ band) loses darkness when the blur ACROSS the line exceeds the
 * band width; visibility v(φ) = 7.5 / max(7.5, w⊥(φ)). The person reports the darkest spoke when the darkest–lightest
 * difference exceeds 0.12 (noisy), else "all look the same".
 * @param {{eye: SimulatedEye, dTrue: number, rng: () => number, lagD?: number}} o
 * @returns {(spokes: number[]) => number|'equal'}
 */
export function dialObserver({ eye, dTrue, rng, lagD = 0.3 }) {
  const st = eyeState(eye, dTrue, { mode: 'max', lagD });
  const [b1, b2] = st.blurDiskArcmin;
  const theta = 180 - eye.axisDeg; // screen angle of the axis meridian
  /** blur width across a line at screen angle φ @param {number} phi */
  const widthAcross = (phi) => {
    const n = ((phi + 90 - theta) * Math.PI) / 180;
    return Math.hypot(b1 * Math.cos(n), b2 * Math.sin(n));
  };
  return (spokes) => {
    const vis = spokes.map((phi) => 7.5 / Math.max(7.5, widthAcross(phi)) + 0.03 * gauss(rng));
    const max = Math.max(...vis);
    const min = Math.min(...vis);
    if (max - min < 0.12) return 'equal';
    let k = vis.indexOf(max);
    if (rng() < 0.2) k = (k + (rng() < 0.5 ? 1 : spokes.length - 1)) % spokes.length; // taps a neighbouring spoke
    return spokes[k];
  };
}

/**
 * Focus-range sweep (one run). Text is held at a constant angular level by the app (from the camera distance);
 * the person reports the FIRST blur, i.e. when their threshold reaches the level minus a personal criterion δ
 * (0–0.1 log, drawn per person) while the blur is not improving in the direction of movement, and some blur exists
 * (threshold > best + 0.03). Distances are what the camera reports (true × (1 + bias) with jitter).
 * @param {{kind: 'near'|'far', eyes: SimulatedEye[], level: number, criterion: number, camBias: number, pxBias: number,
 *   rng: () => number, startMm: number, floorMm: number, maxMm: number}} o
 * @returns {{mm: number|null, floor?: boolean}}
 */
export function focusSweep({ kind, eyes, level, criterion, camBias, pxBias, rng, startMm, floorMm, maxMm }) {
  const step = kind === 'near' ? -2 : 2;
  const cam = (/** @type {number} */ dTrue) => dTrue * (1 + camBias) * (1 + 0.01 * gauss(rng));
  let dTrue = startMm / (1 + camBias);
  for (let i = 0; i < 1000; i++) {
    const dCam = cam(dTrue);
    if (kind === 'near' && dCam <= floorMm) return { mm: floorMm, floor: true };
    if (kind === 'far' && dCam >= maxMm) return { mm: null };
    // Level actually seen: the app sizes for the camera distance and its px/mm.
    const seen = level + Math.log10(dCam / dTrue) + pxBias;
    const T = binocularLogMARAt(eyes, dTrue, 'max');
    // Text that is blurry but getting clearer as the phone moves is not "becoming blurry": the person keeps going.
    const worsening = binocularLogMARAt(eyes, dTrue + step, 'max') >= T - 1e-4;
    const someBlur = T > Math.min(...eyes.map((e) => e.floorLogMAR)) + 0.03;
    if (T >= seen - criterion && worsening && someBlur) {
      const overshoot = 1 + (kind === 'near' ? -1 : 1) * 0.03 * Math.abs(gauss(rng)); // reaction while moving
      const mm = cam(dTrue * overshoot);
      if (kind === 'near' && mm <= floorMm) return { mm: floorMm, floor: true };
      return { mm: Math.round(mm) };
    }
    dTrue += step;
  }
  return { mm: null };
}

/** Comfortable accommodation in use at a distance (for reporting). @param {SimulatedEye} eye @param {number} dMm */
export function comfortableAccommodation(eye, dMm) {
  return Math.min(COMFORT_FRACTION * eye.ampD, Math.max(0, eyeState(eye, dMm).demandD));
}

/** Line orientation error helper re-exported for reports. */
export { lineAngleDiff };
