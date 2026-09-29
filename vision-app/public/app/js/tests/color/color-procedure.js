// @ts-check
/**
 * COLOUR-TEST PROCEDURE — pure (no DOM). vision-science.md §7.3 and items 29–30:
 *  - three interleaved Bayesian staircases (protan / deutan / tritan cone-isolating axes), 4AFC, γ = 0.25,
 *    16 trials per axis, each trial placed at the posterior mean of the log threshold;
 *  - thresholds are expressed as X = cone contrast ÷ CCT normal limit (so X = 1 is the normal limit);
 *  - the stimulus is capped at the in-gamut maximum; two failures AT the cap = "ceiling" (dichromat-like) and
 *    that staircase stops early;
 *  - a "can't see" answer is scored as a non-detection (likelihood 1 − F), not as a random guess;
 *  - 3 luminance-defined catch trials (visible to every observer) check reliability;
 *  - classification exactly as item 30; if red–green but neither P/D nor D/P ≥ 1.25, the optional §7.3
 *    tie-breaker (luminance match of a pure red against a grey; protan-like observers set red much darker)
 *    decides between protan and deutan when available.
 * Randomness is injected (`rng`) so runs are reproducible in unit tests.
 */
import {
  AXES, DIRECTIONS, NORMAL_LIMIT_C, NORMAL_LIMIT_DUV, CEILING_RATIO, duvOfContrast, mulberry32,
} from './color-plates.js';

/** @typedef {import('./color-plates.js').Axis} Axis */
/** @typedef {import('./color-plates.js').Direction} Direction */
/** @typedef {import('../../core/types.js').ColorResult} ColorResult */

/**
 * @typedef {Object} ColorTrial
 * @property {number} index           0-based position in the whole run
 * @property {'axis'|'catch'} kind
 * @property {Axis|null} axis         null for catch trials
 * @property {number} x               log10(X), X = contrast in multiples of the normal limit (catch: NaN)
 * @property {number} c               cone contrast shown (catch: 0)
 * @property {boolean} atCeiling      the staircase asked for ≥ the gamut ceiling (c was capped)
 * @property {Direction} gap
 * @property {number} seed            plate layout seed
 */

/**
 * @typedef {Object} ColorDetails
 * @property {'normal'|'red-green'|'blue-yellow'|'generalised'|'mixed'} pattern
 * @property {boolean} typeUncertain    red–green with P/D and D/P both < 1.25
 * @property {{protan: number, deutan: number, tritan: number}} thresholds   X per axis (× normal limit)
 * @property {{protan: number, deutan: number, tritan: number}} duv          threshold in Δu′v′ × 10⁻⁴
 * @property {{protan: boolean, deutan: boolean, tritan: boolean}} ceiling
 * @property {number|null} redLuminanceMatch  grey/red luminance ratio set by the user (tie-breaker), or null
 * @property {number} trials
 * @property {number} catchTrials
 * @property {number} catchMissed
 * @property {string[]} reasons               why the run was marked unreliable (empty when reliable)
 */

/** @typedef {ColorResult & {details: ColorDetails}} ColorTestResult */

/** Psychometric parameters (4AFC). β on log10 contrast, as for the contrast test (item 22). */
export const PSYCH = Object.freeze({ gamma: 0.25, lambda: 0.03, beta: 3.5 });

export const PROCEDURE = Object.freeze({
  trialsPerAxis: 16,
  /** A catch trial is inserted after this many staircase trials. */
  catchAfter: Object.freeze([12, 26, 40]),
  gridMin: -1.4,
  gridStep: 0.02,
  /** Grid extends this far (log10) above the gamut ceiling so a dichromat's posterior can leave the range. */
  gridAboveCeiling: 0.6,
  /** Prior on log10(X): centred just below the normal limit, wide enough to reach the ceiling. */
  priorMean: Math.log10(0.6),
  priorSD: 0.6,
  /** First (familiarisation) trial of each axis at 4× the normal limit (or the ceiling if lower). */
  firstTrialX: Math.log10(4),
  ceilingFailures: 2,
  stimulusMs: 1500,
});

/** Classification constants (item 30) + tie-breaker. */
export const CLASSIFY = Object.freeze({
  normalMax: 1,
  redGreenTritanMax: 1.5,
  typeRatio: 1.25,
  tritanMin: 1.5,
  tritanRedGreenMax: 1.5,
  generalisedMin: 1.5,
  /** Grey/red luminance match below this => protan-like (normal ≈ 1.0; protan-like ≈ 0.4–0.8). */
  protanLuminanceMax: 0.85,
});

export const RELIABILITY = Object.freeze({
  maxCatchMissed: 1,
  maxIdenticalRun: 5,
  minMedianRtMs: 300,
});

/** Linear luminance of pure red (sRGB 255, 0, 0): the Y row of the sRGB→XYZ matrix. */
export const RED_LUMINANCE = 0.2126729;

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
/** @param {number} v @param {number} [step] */
function round(v, step = 0.01) { return Math.round(v / step) * step; }

/**
 * Detection probability F(x; T) = 1 − exp(−10^(β(x − T))).
 * @param {number} x @param {number} T
 */
export function detectProb(x, T) {
  return 1 - Math.exp(-(10 ** (PSYCH.beta * (x - T))));
}

/**
 * Likelihood of a response at log-contrast x given threshold T.
 * @param {number} x @param {number} T @param {'correct'|'wrong'|'unsure'} outcome
 */
export function responseLikelihood(x, T, outcome) {
  const F = detectProb(x, T);
  const pc = PSYCH.gamma + (1 - PSYCH.gamma - PSYCH.lambda) * F;
  if (outcome === 'correct') return pc;
  if (outcome === 'wrong') return 1 - pc;
  return 0.02 + 0.96 * (1 - F);
}

/**
 * One Bayesian staircase on x = log10(X).
 * @param {Axis} axis
 */
function createStaircase(axis) {
  const xCeil = Math.log10(CEILING_RATIO[axis]);
  const gridMax = xCeil + PROCEDURE.gridAboveCeiling;
  const n = Math.round((gridMax - PROCEDURE.gridMin) / PROCEDURE.gridStep) + 1;
  const grid = new Float64Array(n);
  const logPost = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    grid[i] = PROCEDURE.gridMin + i * PROCEDURE.gridStep;
    const z = (grid[i] - PROCEDURE.priorMean) / PROCEDURE.priorSD;
    logPost[i] = -0.5 * z * z;
  }
  const posterior = () => {
    let max = -Infinity;
    for (let i = 0; i < n; i++) if (logPost[i] > max) max = logPost[i];
    const p = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) { p[i] = Math.exp(logPost[i] - max); sum += p[i]; }
    for (let i = 0; i < n; i++) p[i] /= sum;
    return p;
  };
  const st = {
    axis, xCeil, grid, trials: 0, capFailures: 0, ceiling: false,
    posterior,
    mean() {
      const p = posterior();
      let m = 0;
      for (let i = 0; i < n; i++) m += p[i] * grid[i];
      return m;
    },
    sd() {
      const p = posterior();
      const m = st.mean();
      let v = 0;
      for (let i = 0; i < n; i++) v += p[i] * (grid[i] - m) ** 2;
      return Math.sqrt(v);
    },
    /** @param {number} x @param {'correct'|'wrong'|'unsure'} outcome */
    update(x, outcome) {
      for (let i = 0; i < n; i++) logPost[i] += Math.log(responseLikelihood(x, grid[i], outcome));
    },
    get done() { return st.ceiling || st.trials >= PROCEDURE.trialsPerAxis; },
  };
  return st;
}

/**
 * Random gap direction that never repeats three times in a row.
 * @param {() => number} rng @param {Direction[]} history
 * @returns {Direction}
 */
export function nextGap(rng, history) {
  const n = history.length;
  const banned = n >= 2 && history[n - 1] === history[n - 2] ? history[n - 1] : null;
  const pool = banned ? DIRECTIONS.filter((d) => d !== banned) : DIRECTIONS;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/**
 * Item-30 classification of thresholds X (multiples of the normal limit).
 * @param {{protan: number, deutan: number, tritan: number}} X
 * @param {{redLuminanceMatch?: number|null}} [opts]
 * @returns {{type: ColorResult['type'], pattern: ColorDetails['pattern'], typeUncertain: boolean, severity: number}}
 */
export function classifyThresholds(X, { redLuminanceMatch = null } = {}) {
  const P = X.protan; const D = X.deutan; const T = X.tritan;
  const sev = (/** @type {Axis} */ axis) => clamp(Math.log(Math.max(1, X[axis])) / Math.log(CEILING_RATIO[axis]), 0, 1);
  const worst = () => Math.max(sev('protan'), sev('deutan'), sev('tritan'));
  if (P <= CLASSIFY.normalMax && D <= CLASSIFY.normalMax && T <= CLASSIFY.normalMax) {
    return { type: 'normal', pattern: 'normal', typeUncertain: false, severity: 0 };
  }
  if (P > CLASSIFY.generalisedMin && D > CLASSIFY.generalisedMin && T > CLASSIFY.generalisedMin) {
    return { type: 'unclassified', pattern: 'generalised', typeUncertain: false, severity: worst() };
  }
  if (Math.max(P, D) > CLASSIFY.normalMax && T <= CLASSIFY.redGreenTritanMax) {
    if (P / D >= CLASSIFY.typeRatio) return { type: 'protan', pattern: 'red-green', typeUncertain: false, severity: sev('protan') };
    if (D / P >= CLASSIFY.typeRatio) return { type: 'deutan', pattern: 'red-green', typeUncertain: false, severity: sev('deutan') };
    const protan = typeof redLuminanceMatch === 'number' && Number.isFinite(redLuminanceMatch)
      ? redLuminanceMatch < CLASSIFY.protanLuminanceMax
      : P >= D;
    const type = protan ? 'protan' : 'deutan';
    return { type, pattern: 'red-green', typeUncertain: true, severity: sev(type) };
  }
  if (T > CLASSIFY.tritanMin && P <= CLASSIFY.tritanRedGreenMax && D <= CLASSIFY.tritanRedGreenMax) {
    return { type: 'tritan', pattern: 'blue-yellow', typeUncertain: false, severity: sev('tritan') };
  }
  if (Math.max(P, D) <= CLASSIFY.normalMax && T <= CLASSIFY.redGreenTritanMax) {
    // Only the blue–yellow axis is slightly above the limit but below the 1.5 tritan criterion: within norms.
    return { type: 'normal', pattern: 'normal', typeUncertain: false, severity: 0 };
  }
  return { type: 'unclassified', pattern: 'mixed', typeUncertain: false, severity: worst() };
}

/**
 * Longest run of identical direction answers ("can't see" breaks nothing and is not counted).
 * @param {Array<Direction|'unsure'>} answers
 */
export function longestIdenticalRun(answers) {
  let best = 0; let run = 0; /** @type {string|null} */ let prev = null;
  for (const a of answers) {
    if (a === 'unsure') continue;
    run = a === prev ? run + 1 : 1;
    prev = a;
    if (run > best) best = run;
  }
  return best;
}

/**
 * @param {{rng: () => number, trialsPerAxis?: number}} opts
 */
export function createColorProcedure({ rng, trialsPerAxis = PROCEDURE.trialsPerAxis }) {
  const cfg = { ...PROCEDURE, trialsPerAxis };
  /** @type {Record<Axis, ReturnType<typeof createStaircase>>} */
  const stairs = /** @type {any} */ ({});
  for (const a of AXES) stairs[a] = createStaircase(a);
  const isDone = (/** @type {Axis} */ a) => stairs[a].ceiling || stairs[a].trials >= cfg.trialsPerAxis;
  /** @type {Axis[]} */
  let block = [];
  /** @type {Direction[]} */
  const gaps = [];
  /** @type {Array<{trial: ColorTrial, answer: Direction|'unsure', correct: boolean, rtMs: number}>} */
  const log = [];
  let mainDone = 0;
  let catchShown = 0;
  let catchMissed = 0;
  let catchIdx = 0;
  /** @type {number|null} */
  let redLuminanceMatch = null;
  /** @type {ColorTrial|null} */
  let pending = null;

  const remainingMain = () => AXES.reduce((s, a) => s + (isDone(a) ? 0 : cfg.trialsPerAxis - stairs[a].trials), 0);
  const remainingCatch = () => {
    const total = mainDone + remainingMain();
    return cfg.catchAfter.slice(catchIdx).filter((k) => k < total).length;
  };

  /** @param {Axis|null} axis @param {'axis'|'catch'} kind @returns {ColorTrial} */
  const makeTrial = (axis, kind) => {
    const gap = nextGap(rng, gaps);
    gaps.push(gap);
    const seed = Math.floor(rng() * 0x7fffffff);
    if (kind === 'catch' || !axis) return { index: log.length, kind: 'catch', axis: null, x: NaN, c: 0, atCeiling: false, gap, seed };
    const st = stairs[axis];
    const want = st.trials === 0 ? Math.min(cfg.firstTrialX, st.xCeil) : st.mean();
    const x = clamp(want, cfg.gridMin, st.xCeil);
    const c = NORMAL_LIMIT_C[axis] * 10 ** x;
    return { index: log.length, kind: 'axis', axis, x, c, atCeiling: x >= st.xCeil - 1e-9, gap, seed };
  };

  const api = {
    /** @returns {ColorTrial|null} next trial, or null when the staircase phase is complete. */
    next() {
      if (pending) return pending;
      if (catchIdx < cfg.catchAfter.length && mainDone >= cfg.catchAfter[catchIdx] && remainingMain() > 0) {
        catchIdx++;
        pending = makeTrial(null, 'catch');
        return pending;
      }
      block = block.filter((a) => !isDone(a));
      if (!block.length) {
        const active = AXES.filter((a) => !isDone(a));
        if (!active.length) return null;
        block = active.slice();
        for (let i = block.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [block[i], block[j]] = [block[j], block[i]];
        }
      }
      const axis = /** @type {Axis} */ (block.shift());
      pending = makeTrial(axis, 'axis');
      return pending;
    },
    /**
     * @param {ColorTrial} trial @param {Direction|'unsure'} answer @param {number} [rtMs]
     */
    respond(trial, answer, rtMs = 0) {
      if (!pending || trial !== pending) throw new Error('respond() must answer the trial returned by next()');
      pending = null;
      const correct = answer === trial.gap;
      log.push({ trial, answer, correct, rtMs });
      if (trial.kind === 'catch') {
        catchShown++;
        if (!correct) catchMissed++;
        return;
      }
      const st = stairs[/** @type {Axis} */ (trial.axis)];
      st.trials++;
      mainDone++;
      const outcome = answer === 'unsure' ? 'unsure' : correct ? 'correct' : 'wrong';
      st.update(trial.x, outcome);
      if (trial.atCeiling && !correct) {
        st.capFailures++;
        if (st.capFailures >= cfg.ceilingFailures) st.ceiling = true;
      }
    },
    /** True when every staircase is complete (no trial pending). */
    finished() {
      return !pending && AXES.every(isDone);
    },
    /** Fraction complete (staircase phase), 0..1. */
    progress() {
      const done = log.length;
      const total = done + remainingMain() + remainingCatch();
      return total ? clamp(done / total, 0, 1) : 1;
    },
    /** Current point estimates X per axis (multiples of the normal limit). */
    thresholds() {
      /** @type {{protan: number, deutan: number, tritan: number}} */
      const X = { protan: 0, deutan: 0, tritan: 0 };
      for (const a of AXES) X[a] = stairs[a].ceiling ? CEILING_RATIO[a] : Math.min(CEILING_RATIO[a], 10 ** stairs[a].mean());
      return X;
    },
    /** True when the staircases are finished and the red–green type needs the luminance tie-breaker. */
    needsLuminanceMatch() {
      if (!api.finished()) return false;
      const cls = classifyThresholds(api.thresholds());
      return cls.pattern === 'red-green' && cls.typeUncertain;
    },
    /**
     * Record the tie-breaker: grey luminance the user matched to pure red ÷ red's luminance (geometric mean of
     * the settings). null = skipped.
     * @param {number|null} ratio
     */
    setLuminanceMatch(ratio) {
      redLuminanceMatch = typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio : null;
    },
    /** @returns {ColorTestResult} */
    result() {
      const X = api.thresholds();
      const cls = classifyThresholds(X, { redLuminanceMatch });
      // Confidence = agreement of the classification over posterior samples (and luminance-match noise).
      const mc = mulberry32(0x51ed);
      const cdfs = AXES.map((a) => {
        const p = stairs[a].posterior();
        const cdf = new Float64Array(p.length);
        let s = 0;
        for (let i = 0; i < p.length; i++) { s += p[i]; cdf[i] = s; }
        return cdf;
      });
      const N = 400;
      let agree = 0;
      for (let k = 0; k < N; k++) {
        /** @type {{protan: number, deutan: number, tritan: number}} */
        const sample = { protan: 0, deutan: 0, tritan: 0 };
        AXES.forEach((a, ai) => {
          if (stairs[a].ceiling) { sample[a] = CEILING_RATIO[a]; return; }
          const u = mc();
          const cdf = cdfs[ai];
          let i = 0;
          while (i < cdf.length - 1 && cdf[i] < u) i++;
          sample[a] = Math.min(CEILING_RATIO[a], 10 ** stairs[a].grid[i]);
        });
        const lum = redLuminanceMatch === null ? null : redLuminanceMatch * 10 ** (0.05 * gauss(mc));
        if (classifyThresholds(sample, { redLuminanceMatch: lum }).type === cls.type) agree++;
      }
      let confidence = agree / N;
      if (cls.typeUncertain && redLuminanceMatch === null) confidence = Math.min(confidence, 0.5);

      const answers = log.map((l) => l.answer);
      const rts = log.map((l) => l.rtMs).filter((v) => v > 0).sort((a, b) => a - b);
      const medianRt = rts.length ? rts[Math.floor(rts.length / 2)] : null;
      /** @type {string[]} */
      const reasons = [];
      if (catchMissed > RELIABILITY.maxCatchMissed) reasons.push('catch-missed');
      if (longestIdenticalRun(answers) > RELIABILITY.maxIdenticalRun) reasons.push('identical-run');
      if (medianRt !== null && medianRt < RELIABILITY.minMedianRtMs) reasons.push('too-fast');
      const reliable = reasons.length === 0;
      if (!reliable) confidence *= 0.5;

      /** @type {{protan: number, deutan: number, tritan: number}} */
      const duv = { protan: 0, deutan: 0, tritan: 0 };
      for (const a of AXES) duv[a] = round(duvOfContrast(a, NORMAL_LIMIT_C[a] * X[a]) * 1e4, 1);
      return {
        type: cls.type,
        severity: round(cls.severity),
        confidence: round(confidence),
        reliable,
        details: {
          pattern: cls.pattern,
          typeUncertain: cls.typeUncertain,
          thresholds: { protan: round(X.protan), deutan: round(X.deutan), tritan: round(X.tritan) },
          duv,
          ceiling: { protan: stairs.protan.ceiling, deutan: stairs.deutan.ceiling, tritan: stairs.tritan.ceiling },
          redLuminanceMatch: redLuminanceMatch === null ? null : round(redLuminanceMatch, 0.001),
          trials: log.length,
          catchTrials: catchShown,
          catchMissed,
          reasons,
        },
      };
    },
    /** Normal limits (Δu′v′) the thresholds are expressed against. */
    limits: NORMAL_LIMIT_DUV,
  };
  return api;
}

/** Standard normal deviate (Box–Muller). @param {() => number} rng */
export function gauss(rng) {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
