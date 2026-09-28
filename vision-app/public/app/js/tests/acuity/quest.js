// @ts-check
/**
 * Bayesian (QUEST-type) threshold estimation on a discrete grid, plus the shared response-pattern
 * reliability checks of vision-science.md §3.5 / item 14. Used by the acuity and contrast procedures.
 * Pure module, no DOM.
 */

/**
 * Psychometric function (vision-science.md §3.4, item 12):
 *   ψ(x; T) = γ + (1 − γ − λ) · (1 − exp(−10^(β·(x − T))))
 * x = stimulus value (larger = easier), T = threshold.
 * @param {number} x @param {number} T @param {{gamma: number, lambda: number, beta: number}} p
 */
export function psi(x, T, { gamma, lambda, beta }) {
  return gamma + (1 - gamma - lambda) * (1 - Math.exp(-(10 ** (beta * (x - T)))));
}

/**
 * @typedef {Object} QuestOptions
 * @property {number} gridMin
 * @property {number} gridMax
 * @property {number} gridStep
 * @property {number} priorMean
 * @property {number} priorSD
 * @property {number} gamma
 * @property {number} lambda
 * @property {number} beta
 */

/**
 * @param {QuestOptions} opts
 */
export function createQuest(opts) {
  const { gridMin, gridMax, gridStep, priorMean, priorSD } = opts;
  const n = Math.round((gridMax - gridMin) / gridStep) + 1;
  const grid = new Float64Array(n);
  const logPost = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    grid[i] = gridMin + i * gridStep;
    const z = (grid[i] - priorMean) / priorSD;
    logPost[i] = -0.5 * z * z;
  }

  /** Normalised posterior probabilities. */
  function posterior() {
    let max = -Infinity;
    for (let i = 0; i < n; i++) if (logPost[i] > max) max = logPost[i];
    const p = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) { p[i] = Math.exp(logPost[i] - max); sum += p[i]; }
    for (let i = 0; i < n; i++) p[i] /= sum;
    return p;
  }

  return {
    grid,
    /**
     * Multiply the posterior by ψ (correct) or 1 − ψ (incorrect) for a trial at stimulus value x.
     * @param {number} x @param {boolean} correct
     */
    update(x, correct) {
      for (let i = 0; i < n; i++) {
        const p = psi(x, grid[i], opts);
        logPost[i] += Math.log(Math.max(1e-300, correct ? p : 1 - p));
      }
    },
    posterior,
    /** Posterior mean. */
    mean() {
      const p = posterior();
      let m = 0;
      for (let i = 0; i < n; i++) m += p[i] * grid[i];
      return m;
    },
    /** Posterior standard deviation. */
    sd() {
      const p = posterior();
      let m = 0;
      for (let i = 0; i < n; i++) m += p[i] * grid[i];
      let v = 0;
      for (let i = 0; i < n; i++) v += p[i] * (grid[i] - m) ** 2;
      return Math.sqrt(v);
    },
    /**
     * Posterior quantile (e.g. 0.025 / 0.975 for the 95% credible interval).
     * @param {number} q
     */
    quantile(q) {
      const p = posterior();
      let c = 0;
      for (let i = 0; i < n; i++) {
        c += p[i];
        if (c >= q) return grid[i];
      }
      return grid[n - 1];
    },
  };
}

/** Round to a step without floating-point noise (e.g. roundTo(0.1234, 0.02) === 0.12). */
export function roundTo(x, step) {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
  return Number((Math.round(x / step) * step).toFixed(decimals)) + 0;
}

/** @param {number} a @param {number} lo @param {number} hi */
export function clamp(a, lo, hi) {
  return Math.min(hi, Math.max(lo, a));
}

/** @param {number[]} xs */
export function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Longest run of identical consecutive responses; "unsure" answers break a run.
 * @param {string[]} responses
 */
export function longestIdenticalRun(responses) {
  let best = 0; let run = 0; let prev = null;
  for (const r of responses) {
    if (r === 'unsure') { run = 0; prev = null; continue; }
    run = r === prev ? run + 1 : 1;
    prev = r;
    if (run > best) best = run;
  }
  return best;
}

/**
 * @typedef {Object} TrialRecord
 * @property {'familiarisation'|'main'|'catch'} kind
 * @property {boolean} correct
 * @property {string} response        direction or 'unsure'
 * @property {number} [rtMs]
 * @property {boolean} [blanked]      distance was out of tolerance when the trial was due
 */

/** Reliability thresholds (vision-science.md §3.5 and item 14). */
export const RELIABILITY = Object.freeze({
  maxPosteriorSD: 0.08,
  minMedianRtMs: 300,
  maxIdenticalRun: 4,          // 5 or more identical responses in a row => unreliable
  maxBlankedFraction: 0.2,
  maxFamCatchMisses: 2,        // 3 or more misses among familiarisation + catch trials => unreliable
});

/**
 * Apply the §3.5 response-pattern rules. Returns machine-readable reasons (empty => reliable).
 * @param {TrialRecord[]} trials
 * @param {number} posteriorSD
 * @param {{maxPosteriorSD?: number}} [opts]
 * @returns {string[]}
 */
export function reliabilityReasons(trials, posteriorSD, opts = {}) {
  const reasons = [];
  const catches = trials.filter((t) => t.kind === 'catch');
  if (catches.length >= 2 && catches.every((t) => !t.correct)) reasons.push('both-catch-missed');
  const famCatchMisses = trials.filter((t) => t.kind !== 'main' && !t.correct).length;
  if (famCatchMisses > RELIABILITY.maxFamCatchMisses) reasons.push('familiarisation-catch-misses');
  if (posteriorSD > (opts.maxPosteriorSD ?? RELIABILITY.maxPosteriorSD)) reasons.push('posterior-sd');
  const rts = trials.map((t) => t.rtMs).filter((v) => typeof v === 'number');
  if (rts.length && median(rts) < RELIABILITY.minMedianRtMs) reasons.push('fast-responses');
  if (longestIdenticalRun(trials.map((t) => t.response)) > RELIABILITY.maxIdenticalRun) reasons.push('identical-run');
  const blanked = trials.filter((t) => t.blanked).length;
  if (trials.length && blanked / trials.length > RELIABILITY.maxBlankedFraction) reasons.push('distance-out-of-range');
  return reasons;
}
