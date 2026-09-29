// @ts-check
/**
 * Pure onboarding sequencing: the ordered step plan, the draft (persisted after every completed step so an
 * interrupted onboarding resumes where it stopped), resume decisions and ProfileInput assembly.
 * No DOM here: unit-tested in test/unit/shell/onboarding-plan.test.js.
 */

/** @typedef {import('../core/types.js').Eye} Eye */
/** @typedef {import('../core/types.js').Rx} Rx */
/** @typedef {import('../core/types.js').ProfileInput} ProfileInput */
/** @typedef {import('../core/types.js').ScreenCalibration} ScreenCalibration */
/** @typedef {import('../core/types.js').DistanceCalibration} DistanceCalibration */

/**
 * @typedef {Object} PlanStep
 * @property {string} id
 * @property {string} module       key in shell/modules.js
 * @property {string} fn           exported run* function
 * @property {Eye} [eye]
 * @property {boolean} [optional]  user may skip it up-front
 * @property {string} [group]      optional steps skipped together
 * @property {'screen'|'distance'} [fallback]  standard values available when the step can't run
 */

/** @type {readonly PlanStep[]} */
export const PLAN = Object.freeze([
  { id: 'screen', module: 'screenCalibration', fn: 'runScreenCalibration', fallback: 'screen' },
  { id: 'distance', module: 'distanceCalibration', fn: 'runDistanceCalibration', fallback: 'distance' },
  { id: 'acuity-right', module: 'acuity', fn: 'runAcuityTest', eye: 'right' },
  { id: 'acuity-left', module: 'acuity', fn: 'runAcuityTest', eye: 'left' },
  { id: 'reading', module: 'reading', fn: 'runReadingTest', eye: 'both' },
  { id: 'contrast', module: 'contrast', fn: 'runContrastTest', eye: 'both' },
  { id: 'color', module: 'color', fn: 'runColorTest', eye: 'both' },
  { id: 'astig-right', module: 'astigmatism', fn: 'runAstigmatismTest', eye: 'right' },
  { id: 'astig-left', module: 'astigmatism', fn: 'runAstigmatismTest', eye: 'left' },
  { id: 'focus', module: 'focusRange', fn: 'runFocusRangeTest', eye: 'both', optional: true },
]);

export const DRAFT_KEY = 'onboarding';
/** Drafts older than this are offered as "start over" first (results may no longer reflect today's vision). */
export const DRAFT_STALE_MS = 14 * 86_400_000;
export const DEFAULT_DISTANCE_MM = 400;

/**
 * @typedef {Object} Basics
 * @property {string} name
 * @property {number|null} age
 * @property {boolean} wearsCorrection
 * @property {boolean} hasRx
 * @property {'low'|'normal'|'high'} [lightSensitivity]  How bright screens feel (drives warmth/dimming).
 */

/**
 * @typedef {Object} OnboardingDraft
 * @property {1} v
 * @property {string} startedAt
 * @property {string} updatedAt
 * @property {{mode: 'new'|'retest', profileId: string}} target
 * @property {boolean} introDone
 * @property {Basics|null} basics
 * @property {{right?: Rx, left?: Rx}|null} rx     null = not answered yet ({} = skipped / nothing entered)
 * @property {Record<string, any>} results          keyed by PlanStep.id
 * @property {string[]} skipped
 * @property {string[]} fallbacks                   step ids completed with standard values
 */

/**
 * @typedef {{kind: 'intro'} | {kind: 'basics'} | {kind: 'rx'} | {kind: 'step', step: PlanStep, index: number} | {kind: 'compute'}} Phase
 */

/**
 * @param {{mode: 'new'|'retest', profileId: string}} target
 * @param {number} now
 * @returns {OnboardingDraft}
 */
export function newDraft(target, now) {
  const iso = new Date(now).toISOString();
  return { v: 1, startedAt: iso, updatedAt: iso, target, introDone: false, basics: null, rx: null, results: {}, skipped: [], fallbacks: [] };
}

/** @param {unknown} d @returns {d is OnboardingDraft} */
export function isValidDraft(d) {
  const x = /** @type {any} */ (d);
  return !!x && x.v === 1 && !!x.target && typeof x.target.profileId === 'string'
    && (x.target.mode === 'new' || x.target.mode === 'retest')
    && typeof x.results === 'object' && x.results !== null && Array.isArray(x.skipped);
}

/** @param {OnboardingDraft} d @param {string} id */
function isDone(d, id) {
  return Object.prototype.hasOwnProperty.call(d.results, id) || d.skipped.includes(id);
}

/**
 * What comes next for this draft.
 * @param {OnboardingDraft} d
 * @returns {Phase}
 */
export function nextPhase(d) {
  if (!d.introDone) return { kind: 'intro' };
  if (!d.basics) return { kind: 'basics' };
  if (d.basics.hasRx && d.rx === null) return { kind: 'rx' };
  const index = PLAN.findIndex((s) => !isDone(d, s.id));
  if (index >= 0) return { kind: 'step', step: PLAN[index], index };
  return { kind: 'compute' };
}

/** Number of measurement steps done (completed or skipped). @param {OnboardingDraft} d */
export function completedSteps(d) {
  return PLAN.filter((s) => isDone(d, s.id)).length;
}

/** Has the user done anything worth resuming? @param {OnboardingDraft|null|undefined} d */
export function hasProgress(d) {
  return !!d && (d.introDone || !!d.basics || completedSteps(d) > 0);
}

/**
 * Resume decision when (re-)entering the onboarding route.
 * @param {OnboardingDraft|null|undefined} draft
 * @param {{mode: 'new'|'retest'|null, profileId: string|null}} requested  mode null = plain "#/onboarding" (continue)
 * @param {number} now
 * @returns {'fresh'|'resume'|'ask'}  ask = an unrelated or stale unfinished check exists
 */
export function resumeDecision(draft, requested, now) {
  if (!isValidDraft(draft) || !hasProgress(draft)) return 'fresh';
  const updated = Date.parse(draft.updatedAt);
  if (!Number.isFinite(updated) || now - updated > DRAFT_STALE_MS) return 'ask';
  if (requested.mode === null) return 'resume';
  if (requested.mode === 'retest' && draft.target.mode === 'retest' && requested.profileId === draft.target.profileId) return 'resume';
  return 'ask';
}

/** @param {OnboardingDraft} d @param {number} now @param {Partial<OnboardingDraft>} patch @returns {OnboardingDraft} */
function update(d, now, patch) {
  return { ...d, ...patch, updatedAt: new Date(now).toISOString() };
}

/** @param {OnboardingDraft} d @param {number} now */
export function completeIntro(d, now) {
  return update(d, now, { introDone: true });
}

/** @param {OnboardingDraft} d @param {Basics} basics @param {number} now */
export function setBasics(d, basics, now) {
  return update(d, now, { basics, rx: basics.hasRx ? d.rx : null });
}

/** @param {OnboardingDraft} d @param {{right?: Rx, left?: Rx}} rx @param {number} now */
export function setRx(d, rx, now) {
  return update(d, now, { rx });
}

/**
 * @param {OnboardingDraft} d @param {string} stepId @param {unknown} result @param {number} now
 * @param {{fallback?: boolean}} [opts]
 */
export function recordResult(d, stepId, result, now, opts = {}) {
  const fallbacks = opts.fallback ? [...new Set([...(d.fallbacks || []), stepId])] : (d.fallbacks || []).filter((id) => id !== stepId);
  return update(d, now, {
    results: { ...d.results, [stepId]: result },
    skipped: d.skipped.filter((id) => id !== stepId),
    fallbacks,
  });
}

/**
 * Skip a step; with `wholeGroup`, also skip the remaining (not yet done) steps of its group.
 * @param {OnboardingDraft} d @param {string} stepId @param {number} now @param {{wholeGroup?: boolean}} [opts]
 */
export function recordSkip(d, stepId, now, opts = {}) {
  const step = PLAN.find((s) => s.id === stepId);
  const ids = [stepId];
  if (opts.wholeGroup && step?.group) {
    for (const s of PLAN) if (s.group === step.group && s.id !== stepId && !isDone(d, s.id)) ids.push(s.id);
  }
  return update(d, now, { skipped: [...new Set([...d.skipped, ...ids])] });
}

/** Is this the first not-yet-done step of its optional group (where the "skip health check" choice is offered)? @param {OnboardingDraft} d @param {PlanStep} step */
export function isGroupStart(d, step) {
  if (!step.optional) return false;
  if (!step.group) return true;
  const first = PLAN.find((s) => s.group === step.group);
  return first?.id === step.id;
}

/**
 * Standard values used when calibration can't run (less accurate, flagged in `fallbacks`).
 * @param {{cssPxPerMm: number, dpr: number, screenWidthCssPx: number, screenHeightCssPx: number}} env
 * @param {number} now
 * @returns {ScreenCalibration}
 */
export function fallbackScreen(env, now) {
  return {
    cssPxPerMm: env.cssPxPerMm, dpr: env.dpr, method: 'default',
    screenWidthCssPx: env.screenWidthCssPx, screenHeightCssPx: env.screenHeightCssPx, measuredAt: new Date(now).toISOString(),
  };
}

/** @param {number} now @returns {DistanceCalibration} */
export function fallbackDistance(now) {
  return { distanceMm: DEFAULT_DISTANCE_MM, method: 'manual', measuredAt: new Date(now).toISOString() };
}

/**
 * Assemble the engine input from a finished draft. Missing tests are simply omitted.
 * @param {OnboardingDraft} d
 * @param {{theme?: 'light'|'dark'|'auto', screenFallback: ScreenCalibration, now: number}} opts
 * @returns {ProfileInput}
 */
export function buildProfileInput(d, opts) {
  const r = d.results;
  /** @type {ProfileInput} */
  const input = {
    screen: r.screen ?? opts.screenFallback,
    distance: r.distance ?? fallbackDistance(opts.now),
    acuity: pick({ right: r['acuity-right'], left: r['acuity-left'] }),
  };
  if (typeof d.basics?.age === 'number') input.age = d.basics.age;
  if (d.basics) input.wearsCorrection = !!d.basics.wearsCorrection;
  if (d.rx && (d.rx.right || d.rx.left)) input.rx = pick({ right: d.rx.right, left: d.rx.left });
  if (r.reading) input.reading = r.reading;
  if (r.contrast) input.contrast = r.contrast;
  if (r.color) input.color = r.color;
  const astig = pick({ right: r['astig-right'], left: r['astig-left'] });
  if (Object.keys(astig).length) input.astigmatism = astig;
  if (r.focus) input.focus = r.focus;
  const ls = d.basics?.lightSensitivity;
  if (opts.theme || ls) {
    input.prefs = {};
    if (opts.theme) input.prefs.theme = opts.theme;
    if (ls === 'low' || ls === 'normal' || ls === 'high') input.prefs.lightSensitivity = ls;
  }
  return input;
}

/** @template {Record<string, any>} T @param {T} obj @returns {Partial<T>} */
function pick(obj) {
  /** @type {Partial<T>} */
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[/** @type {keyof T} */ (k)] = v;
  return out;
}
