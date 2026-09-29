// @ts-check
/**
 * Bayesian (QUEST) contrast-threshold procedure — vision-science.md §5.2, item 22. Pure, no DOM.
 * x = log10(Weber contrast). ψ with γ = 0.25, λ = 0.03, β = 3.5; grid −2.5 … 0.0 (0.01); prior −1.7 (SD 0.5).
 * Trial plan (mirrors the acuity procedure): familiarisation trials at C = 50 % and 25 %, catch trials at
 * C = 50 % as overall trials 9 and 17 (a miss counts as a lapse), all other trials at the posterior mean.
 * 24 non-catch trials (familiarisation included). Each presented level is the ACTUAL bit-stolen contrast,
 * which is what enters the likelihood. Result: logCS = −T̂ rounded to 0.05.
 */
import { createQuest, reliabilityReasons, roundTo, clamp, psi } from '../acuity/quest.js';
import { mulberry32, nextOrientation, randomDirection, DIRECTIONS } from '../acuity/random.js';
import { bitStealColour } from './contrast-math.js';

/** @typedef {import('../acuity/random.js').Direction} Direction */

export const CONTRAST_PARAMS = Object.freeze({
  gamma: 0.25,
  lambda: 0.03,
  beta: 3.5,
  gridMin: -2.5,
  gridMax: 0.0,
  gridStep: 0.01,
  priorMean: -1.7,
  priorSD: 0.5,
  familiarisationContrasts: Object.freeze([0.5, 0.25]),
  catchTrialNumbers: Object.freeze([9, 17]),
  catchContrast: 0.5,
  mainTrials: 24,
  reportStep: 0.05,
  // §5.2: "Reliability rules are the same as §3.5" => posterior SD > 0.08 is unreliable. With β = 3.5 an
  // ideal simulated observer exceeds 0.08 in ~10 % of runs (see test/unit/tests/contrast.test.js).
  // Manager decision: scaled to 0.137 so an ideal observer's false "unreliable" rate matches the acuity
  // test's (a few %), instead of ~10 % at 0.08 with the shallower contrast psychometric slope.
  maxPosteriorSD: 0.137,
});

/**
 * @typedef {Object} ContrastTrial
 * @property {number} index
 * @property {'familiarisation'|'main'|'catch'} kind
 * @property {number} requestedLogC
 * @property {number} logC           actual presented log10 contrast (after 8-bit bit-stealing)
 * @property {number} contrast
 * @property {{r: number, g: number, b: number, css: string}} colour
 * @property {Direction} orientation
 */

/**
 * @param {{rng?: () => number, params?: Partial<typeof CONTRAST_PARAMS>}} [opts]
 */
export function createContrastProcedure(opts = {}) {
  const P = { ...CONTRAST_PARAMS, ...(opts.params || {}) };
  const rng = opts.rng || mulberry32((Date.now() ^ 0xc0ffee) >>> 0);
  const quest = createQuest(P);
  /** @type {Array<ContrastTrial & {correct: boolean, response: string, rtMs?: number, blanked?: boolean, distanceMm?: number}>} */
  const done = [];
  /** @type {ContrastTrial|null} */
  let pending = null;
  let nonCatch = 0;
  let finished = false;

  return {
    params: P,
    isDone() { return finished; },
    progress() { return finished ? 1 : Math.min(1, nonCatch / P.mainTrials); },
    posteriorMean: () => quest.mean(),
    posteriorSD: () => quest.sd(),
    /** @returns {ContrastTrial|null} */
    next() {
      if (finished) return null;
      if (pending) return pending;
      const index = done.length + 1;
      /** @type {ContrastTrial['kind']} */
      let kind = 'main';
      let requested = clamp(quest.mean(), P.gridMin, P.gridMax);
      if (index <= P.familiarisationContrasts.length) { kind = 'familiarisation'; requested = Math.log10(P.familiarisationContrasts[index - 1]); }
      else if (P.catchTrialNumbers.includes(index)) { kind = 'catch'; requested = Math.log10(P.catchContrast); }
      const c = bitStealColour(10 ** requested);
      pending = {
        index, kind, requestedLogC: requested, logC: c.logC, contrast: c.contrast,
        colour: { r: c.r, g: c.g, b: c.b, css: c.css },
        orientation: nextOrientation(rng, done.map((t) => t.orientation)),
      };
      return pending;
    },
    /**
     * @param {Direction|'unsure'} response
     * @param {{rtMs?: number, blanked?: boolean, distanceMm?: number}} [meta]
     */
    respond(response, meta = {}) {
      if (!pending) throw new Error('no pending trial');
      const trial = pending;
      pending = null;
      const effective = response === 'unsure' ? randomDirection(rng) : response;
      const correct = effective === trial.orientation;
      quest.update(trial.logC, correct);
      done.push({ ...trial, correct, response, ...meta });
      if (trial.kind !== 'catch') nonCatch++;
      if (nonCatch >= P.mainTrials) finished = true;
      return { correct, done: finished };
    },
    history() { return done.map((t) => ({ ...t })); },
    result() {
      const mean = quest.mean();
      const sd = quest.sd();
      const reasons = reliabilityReasons(done, sd, { maxPosteriorSD: P.maxPosteriorSD });
      return {
        logCS: roundTo(clamp(-mean, -P.gridMax, -P.gridMin), P.reportStep),
        mean, sd,
        ci95: /** @type {[number, number]} */ ([-quest.quantile(0.975), -quest.quantile(0.025)]),
        reliable: reasons.length === 0,
        reasons,
        trials: done.length,
      };
    },
  };
}

/**
 * Simulated observer: P(correct) = ψ(logC; T) with T = −trueLogCS.
 * @param {{trueLogCS: number, beta?: number, lambda?: number, rng: () => number}} o
 * @returns {(trial: ContrastTrial) => Direction}
 */
export function simulatedContrastObserver({ trueLogCS, beta = CONTRAST_PARAMS.beta, lambda = CONTRAST_PARAMS.lambda, rng }) {
  return (trial) => {
    if (rng() < psi(trial.logC, -trueLogCS, { gamma: 0.25, lambda, beta })) return trial.orientation;
    const wrong = DIRECTIONS.filter((d) => d !== trial.orientation);
    return wrong[Math.min(2, Math.floor(rng() * 3))];
  };
}
