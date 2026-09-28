// @ts-check
/**
 * Adaptive Bayesian (QUEST-type) acuity procedure — vision-science.md §3.4, §3.5, items 12–14.
 * Pure and deterministic given an injected RNG. No DOM.
 *
 * Trial plan: trials 1–2 familiarisation at posterior mean + 0.3; catch trials (posterior mean + 0.5) at
 * overall trials 9 and 17; every other trial at the posterior mean clipped to [−0.5, 1.5] and to the
 * renderable range. Stop after 24 non-catch trials (familiarisation counts), or early after ≥ 18 when the
 * posterior SD ≤ 0.035; hard cap 30 presented trials. All trials (including catch) enter the likelihood.
 */
import { createQuest, reliabilityReasons, roundTo, clamp, psi } from './quest.js';
import { mulberry32, nextOrientation, randomDirection, DIRECTIONS } from './random.js';

/** @typedef {import('./random.js').Direction} Direction */

export const ACUITY_PARAMS = Object.freeze({
  gamma: 0.25,
  lambda: 0.03,
  beta: 6.0,
  gridMin: -0.6,
  gridMax: 1.6,
  gridStep: 0.01,
  priorSD: 0.6,
  priorMeanYoung: 0.0,   // age < 50
  priorMeanDefault: 0.2, // age ≥ 50 or unknown
  familiarisationTrials: 2,
  familiarisationOffset: 0.3,
  catchTrialNumbers: Object.freeze([9, 17]),
  catchOffset: 0.5,
  placementMin: -0.5,
  placementMax: 1.5,
  mainTrials: 24,        // non-catch trials, familiarisation included
  earlyStopMinTrials: 18,
  earlyStopSD: 0.035,
  hardCap: 30,
  reportStep: 0.02,
});

/**
 * @typedef {Object} AcuityTrial
 * @property {number} index            1-based overall trial number
 * @property {'familiarisation'|'main'|'catch'} kind
 * @property {number} requestedLogMAR  level the algorithm asked for
 * @property {number} logMAR           level actually presented (after clipping to the renderable range)
 * @property {boolean} floorClamped    requested level was below the smallest renderable level
 * @property {boolean} ceilingClamped  requested level was above the largest level that fits the screen
 * @property {Direction} orientation
 */

/**
 * @typedef {Object} AcuityEstimate
 * @property {number} logMAR          posterior mean rounded to 0.02 (floor value when floorLimited)
 * @property {number} mean            unrounded posterior mean
 * @property {number} sd              posterior SD
 * @property {[number, number]} ci95  95% credible interval
 * @property {boolean} floorLimited   resolved the smallest renderable size: true acuity may be better
 * @property {boolean} ceilingLimited needed a letter larger than the screen could show
 * @property {boolean} reliable
 * @property {string[]} reasons       reliability problems (empty when reliable)
 * @property {number} trials          presented trials, catch trials included
 * @property {number} meanDistanceMm  mean of per-trial distances (NaN if none were given)
 */

/**
 * @param {{age?: number, rng?: () => number, params?: Partial<typeof ACUITY_PARAMS>}} [opts]
 */
export function createAcuityProcedure(opts = {}) {
  const P = { ...ACUITY_PARAMS, ...(opts.params || {}) };
  const rng = opts.rng || mulberry32((Date.now() ^ 0x5eed) >>> 0);
  const priorMean = typeof opts.age === 'number' && opts.age < 50 ? P.priorMeanYoung : P.priorMeanDefault;
  const quest = createQuest({ ...P, priorMean });
  /** @type {Array<AcuityTrial & {correct: boolean, response: string, rtMs?: number, blanked?: boolean, distanceMm?: number}>} */
  const done = [];
  /** @type {AcuityTrial|null} */
  let pending = null;
  let nonCatch = 0;
  let lastFloor = -Infinity;
  let lastCeiling = Infinity;
  let finished = false;

  function checkFinished() {
    if (nonCatch >= P.mainTrials || done.length >= P.hardCap) finished = true;
    else if (nonCatch >= P.earlyStopMinTrials && quest.sd() <= P.earlyStopSD) finished = true;
    return finished;
  }

  return {
    params: P,
    priorMean,
    /** True when the stopping rule has been met. */
    isDone() { return finished; },
    /** Fraction complete (0..1) for progress bars. */
    progress() { return finished ? 1 : Math.min(1, nonCatch / P.mainTrials); },
    posteriorMean: () => quest.mean(),
    posteriorSD: () => quest.sd(),
    /**
     * Plan the next trial.
     * @param {{minLogMAR?: number, maxLogMAR?: number}} [limits] renderable range at the current distance
     * @returns {AcuityTrial|null}
     */
    next(limits = {}) {
      if (finished) return null;
      if (pending) return pending;
      const floor = limits.minLogMAR ?? -Infinity;
      const ceiling = limits.maxLogMAR ?? Infinity;
      lastFloor = floor;
      lastCeiling = ceiling;
      const index = done.length + 1;
      const mean = quest.mean();
      /** @type {AcuityTrial['kind']} */
      let kind = 'main';
      let requested = clamp(mean, P.placementMin, P.placementMax);
      if (index <= P.familiarisationTrials) { kind = 'familiarisation'; requested = clamp(mean + P.familiarisationOffset, P.placementMin, P.placementMax); }
      else if (P.catchTrialNumbers.includes(index)) { kind = 'catch'; requested = clamp(mean + P.catchOffset, P.placementMin, P.placementMax); }
      const hi = Math.max(floor, ceiling);
      const logMAR = clamp(requested, floor, hi);
      pending = {
        index, kind, requestedLogMAR: requested, logMAR,
        floorClamped: requested < floor, ceilingClamped: requested > hi,
        orientation: nextOrientation(rng, done.map((t) => t.orientation)),
      };
      return pending;
    },
    /**
     * Record the answer to the pending trial. "unsure" becomes a random forced-choice guess, which keeps
     * the 4AFC likelihood model exact.
     * @param {Direction|'unsure'} response
     * @param {{rtMs?: number, blanked?: boolean, distanceMm?: number}} [meta]
     * @returns {{correct: boolean, done: boolean}}
     */
    respond(response, meta = {}) {
      if (!pending) throw new Error('no pending trial');
      const trial = pending;
      pending = null;
      const effective = response === 'unsure' ? randomDirection(rng) : response;
      const correct = effective === trial.orientation;
      quest.update(trial.logMAR, correct);
      done.push({ ...trial, correct, response, ...meta });
      if (trial.kind !== 'catch') nonCatch++;
      return { correct, done: checkFinished() };
    },
    /** Trial log (copies). */
    history() { return done.map((t) => ({ ...t })); },
    /**
     * Final estimate.
     * @returns {AcuityEstimate}
     */
    result() {
      const mean = quest.mean();
      const sd = quest.sd();
      const floorLimited = Number.isFinite(lastFloor) && mean < lastFloor;
      const ceilingLimited = Number.isFinite(lastCeiling) && mean > lastCeiling;
      // Floor-limited: report the smallest renderable level, rounded conservatively ("at least as good as").
      const logMAR = floorLimited ? roundTo(Math.ceil(lastFloor / P.reportStep - 1e-9) * P.reportStep, P.reportStep) : roundTo(mean, P.reportStep);
      const reasons = reliabilityReasons(done, sd);
      const dists = done.map((t) => t.distanceMm).filter((v) => typeof v === 'number' && v > 0);
      return {
        logMAR, mean, sd,
        ci95: [quest.quantile(0.025), quest.quantile(0.975)],
        floorLimited, ceilingLimited,
        reliable: reasons.length === 0,
        reasons,
        trials: done.length,
        meanDistanceMm: dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : NaN,
      };
    },
  };
}

/**
 * Simulated observer for tests and pilots: answers with probability ψ(L; T) using the §3.4 model.
 * @param {{trueLogMAR: number, beta?: number, lambda?: number, rng: () => number}} o
 * @returns {(trial: AcuityTrial) => Direction}
 */
export function simulatedObserver({ trueLogMAR, beta = ACUITY_PARAMS.beta, lambda = ACUITY_PARAMS.lambda, rng }) {
  return (trial) => {
    // P(correct) = ψ(L; T) exactly; errors are spread uniformly over the three wrong directions.
    const p = psi(trial.logMAR, trueLogMAR, { gamma: 0.25, lambda, beta });
    if (rng() < p) return trial.orientation;
    const wrong = DIRECTIONS.filter((d) => d !== trial.orientation);
    return wrong[Math.min(2, Math.floor(rng() * 3))];
  };
}
