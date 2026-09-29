// @ts-check
/**
 * #/onboarding — intro -> basics -> (optional Rx) -> calibration + tests in order via the module contracts ->
 * computeProfile -> save -> #/results. Every completed step is persisted as a draft so an interrupted check resumes
 * where it stopped. Query: ?new=1 (add a profile) or ?retest=<profileId>.
 */
import { h, clear, isAbortError } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { DEFAULT_CSS_PX_PER_MM } from '../core/types.js';
import {
  saveDraft, loadDraft, clearDraft, getProfile, listProfiles, saveProfile, setActiveProfileId, newId,
} from '../core/storage.js';
import { FLOW_STRINGS } from './strings.js';
import { createStage } from './stage.js';
import { introForm, basicsForm, rxForm } from './forms.js';
import {
  PLAN, DRAFT_KEY, newDraft, isValidDraft, nextPhase, completedSteps, resumeDecision, completeIntro, setBasics, setRx,
  recordResult, recordSkip, isGroupStart, fallbackScreen, fallbackDistance, buildProfileInput,
} from './onboarding-plan.js';
import { loadModule } from '../shell/modules.js';
import { getTheme } from '../shell/prefs.js';
import { actionButton, notice, spinner, pageHeader } from '../shell/components.js';
import { icon } from '../shell/icons.js';

/** @typedef {import('./onboarding-plan.js').OnboardingDraft} OnboardingDraft */
/** @typedef {import('./onboarding-plan.js').PlanStep} PlanStep */
/** @typedef {import('../core/types.js').DistanceTracker} DistanceTracker */

const TRACKER_TIMEOUT_MS = 15000;

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const t = makeT(FLOW_STRINGS, ctx.lang);
  const stage = createStage({ t, onExit: () => void requestExit() });
  const body = stage.body;
  /** @type {OnboardingDraft} */
  let draft;
  /** @type {AbortController|null} */
  let controller = null;
  /** @type {DistanceTracker|null} */
  let tracker = null;
  let trackerTried = false;
  let running = false;
  let exiting = false;
  let destroyed = false;
  /** @type {any} */
  let wakeLock = null;

  ctx.shell.pauseAdaptation(true);
  void keepAwake();
  const onVisible = () => { if (document.visibilityState === 'visible' && !destroyed) void keepAwake(); };
  document.addEventListener('visibilitychange', onVisible);

  const q = ctx.route.query;
  const retestProfile = q.retest ? getProfile(q.retest) : null;
  /** @type {{mode: 'new'|'retest'|null, profileId: string|null}} */
  const requested = retestProfile ? { mode: 'retest', profileId: retestProfile.id } : q.new ? { mode: 'new', profileId: null } : { mode: null, profileId: null };

  const now = () => Date.now();
  const save = () => saveDraft(DRAFT_KEY, draft);

  function freshDraft() {
    return newDraft(retestProfile ? { mode: 'retest', profileId: retestProfile.id } : { mode: 'new', profileId: newId() }, now());
  }

  // Start: fresh, resume, or ask.
  const existing = loadDraft(DRAFT_KEY);
  const decision = resumeDecision(isValidDraft(existing) ? existing : null, requested, now());
  if (decision === 'resume' && isValidDraft(existing)) {
    draft = existing;
    ctx.shell.announce(t('resume.welcomeBack'));
    queueMicrotask(advance);
  } else if (decision === 'ask' && isValidDraft(existing)) {
    draft = existing;
    queueMicrotask(() => askResume(existing));
  } else {
    draft = freshDraft();
    queueMicrotask(advance);
  }

  /** @param {OnboardingDraft} old */
  function askResume(old) {
    const updated = Date.parse(old.updatedAt);
    const stale = !Number.isFinite(updated) || now() - updated > 14 * 86_400_000;
    stage.setHeader({ label: t('beforeStart'), title: t('resume.title') });
    clear(body);
    body.append(h('div', { class: 'va-page va-page--narrow va-flow', 'data-testid': 'onboarding-resume' },
      pageHeader({ title: t('resume.title'), lead: t(stale ? 'resume.bodyStale' : 'resume.body', { done: completedSteps(old), total: PLAN.length }) }),
      h('div', { class: 'va-actions' },
        actionButton(t('resume.continue'), { testId: 'resume-continue', variant: stale ? 'secondary' : 'primary', onClick: () => { draft = old; advance(); } }),
        actionButton(t('resume.restart'), {
          testId: 'resume-restart', variant: stale ? 'primary' : 'secondary',
          onClick: () => { clearDraft(DRAFT_KEY); draft = freshDraft(); advance(); },
        }),
      )));
    /** @type {HTMLElement|null} */ (body.querySelector('h1'))?.focus();
  }

  async function advance() {
    if (destroyed || exiting) return;
    const phase = nextPhase(draft);
    if (phase.kind === 'intro') {
      stage.setHeader({ label: t('beforeStart'), title: t('intro.title') });
      stage.setProgress(0);
      await introForm(body, t);
      if (destroyed) return;
      draft = completeIntro(draft, now());
      save();
      advance();
    } else if (phase.kind === 'basics') {
      stage.setHeader({ label: t('beforeStart'), title: t('basics.title') });
      stage.setProgress(0.5);
      const firstProfile = listProfiles().length === 0;
      const initial = draft.basics || (retestProfile ? {
        name: retestProfile.name, age: retestProfile.input?.age ?? null, wearsCorrection: retestProfile.input?.wearsCorrection,
        hasRx: !!(retestProfile.input?.rx?.right || retestProfile.input?.rx?.left),
      } : { name: firstProfile ? t('basics.defaultName') : '' });
      const basics = await basicsForm(body, t, initial);
      if (destroyed) return;
      draft = setBasics(draft, basics, now());
      save();
      advance();
    } else if (phase.kind === 'rx') {
      stage.setHeader({ label: t('beforeStart'), title: t('rx.title') });
      stage.setProgress(0.75);
      const rx = await rxForm(body, t, draft.rx ?? retestProfile?.input?.rx ?? null);
      if (destroyed) return;
      draft = setRx(draft, rx, now());
      save();
      advance();
    } else if (phase.kind === 'step') {
      await runStep(phase.step, phase.index);
    } else {
      await runCompute();
    }
  }

  /** @param {PlanStep} step @param {number} index */
  function header(step, index) {
    stage.setHeader({ step: index + 1, total: PLAN.length, title: t(`step.${step.id}`), done: completedSteps(draft) });
  }

  /** @param {PlanStep} step @param {number} index */
  async function runStep(step, index) {
    if (destroyed) return;
    header(step, index);
    stage.setProgress(0);
    if (step.optional && isGroupStart(draft, step)) {
      const go = await optionalIntro(step);
      if (destroyed) return;
      if (!go) { draft = recordSkip(draft, step.id, now(), { wholeGroup: true }); save(); advance(); return; }
    }
    clear(body);
    body.append(spinner(ctx.t('loading')));
    const res = await loadModule(step.module, step.fn);
    if (destroyed) return;
    if (!res.ok) { showProblem(step, index, 'unavailable', res.reason); return; }
    if (step.id !== 'screen' && step.id !== 'distance') await ensureTracker();
    if (destroyed) return;

    controller = new AbortController();
    /** @type {import('../core/types.js').TestContext} */
    const tctx = {
      lang: ctx.lang, screen: draft.results.screen, distance: draft.results.distance, eye: step.eye, signal: controller.signal,
      distanceTracker: tracker, onProgress: (f) => stage.setProgress(f), age: draft.basics?.age ?? undefined,
    };
    clear(body);
    running = true;
    try {
      const result = await res.mod[step.fn](body, tctx);
      running = false;
      if (destroyed || exiting) return;
      draft = recordResult(draft, step.id, result, now());
      save();
      stage.setProgress(1);
      ctx.shell.announce(t('stepDone', { step: t(`step.${step.id}`) }));
      clear(body);
      advance();
    } catch (err) {
      running = false;
      if (destroyed || exiting || isAbortError(err)) return;
      console.warn(`onboarding step ${step.id} failed`, err);
      showProblem(step, index, 'error');
    } finally {
      controller = null;
    }
  }

  /** @param {PlanStep} step @returns {Promise<boolean>} */
  function optionalIntro(step) {
    return new Promise((resolve) => {
      clear(body);
      body.append(h('div', { class: 'va-page va-page--narrow va-flow', 'data-testid': `optional-${step.id}` },
        h('p', { class: 'va-badge' }, t('optional.badge')),
        pageHeader({ title: t(`step.${step.id}`), lead: t(`optional.${step.group || step.id}`) }),
        h('div', { class: 'va-actions' },
          actionButton(t('optional.start'), { testId: 'optional-start', onClick: () => resolve(true) }),
          actionButton(t('optional.skip'), { variant: 'secondary', testId: 'optional-skip', onClick: () => resolve(false) }),
        )));
      /** @type {HTMLElement|null} */ (body.querySelector('h1'))?.focus();
    });
  }

  /**
   * @param {PlanStep} step @param {number} index @param {'unavailable'|'error'} kind @param {string} [reason]
   */
  function showProblem(step, index, kind, reason) {
    const actions = [actionButton(t('problem.retry'), { iconName: 'retest', testId: 'step-retry', onClick: () => void runStep(step, index) })];
    let warn = t('problem.skipWarn');
    if (step.fallback) {
      warn = t('problem.fallbackWarn');
      actions.push(actionButton(t('problem.fallback'), {
        variant: 'secondary', testId: 'step-fallback',
        onClick: () => {
          const env = { cssPxPerMm: DEFAULT_CSS_PX_PER_MM, dpr: window.devicePixelRatio || 1, screenWidthCssPx: screen.width, screenHeightCssPx: screen.height };
          const value = step.fallback === 'screen' ? fallbackScreen(env, now()) : fallbackDistance(now());
          draft = recordResult(draft, step.id, value, now(), { fallback: true });
          save();
          advance();
        },
      }));
    } else {
      actions.push(actionButton(t('problem.skip'), {
        variant: 'secondary', testId: 'step-skip',
        onClick: () => { draft = recordSkip(draft, step.id, now()); save(); advance(); },
      }));
    }
    actions.push(actionButton(t('problem.exit'), { variant: 'ghost', testId: 'step-exit', onClick: () => void requestExit(true) }));
    clear(body);
    body.append(h('div', { class: 'va-page va-page--narrow va-flow', 'data-testid': `step-problem-${kind}` },
      h('div', { class: 'va-empty' },
        h('div', { class: 'va-empty__icon' }, icon(kind === 'unavailable' ? 'clock' : 'warning', { size: 40 })),
        h('h1', { class: 'va-title', tabindex: '-1' }, t(kind === 'unavailable' ? 'problem.unavailableTitle' : 'problem.errorTitle')),
        h('p', { class: 'va-empty__text' }, t(kind === 'unavailable' ? 'problem.unavailableBody' : 'problem.errorBody')),
        reason === 'offline' ? h('p', { class: 'va-empty__text' }, ctx.t('unavailableOffline')) : null,
        notice('info', warn),
        h('div', { class: 'va-actions va-actions--center' }, ...actions),
      )));
    /** @type {HTMLElement|null} */ (body.querySelector('h1'))?.focus();
  }

  /** Optional live distance tracking via the front camera. Never blocks: the user can always continue. */
  async function ensureTracker() {
    if (tracker || trackerTried || !draft.results.screen || !draft.results.distance) return;
    trackerTried = true;
    const res = await loadModule('distanceTracker', 'createDistanceTracker');
    if (!res.ok || destroyed) return;
    /** @type {Promise<DistanceTracker|null>} */
    let p;
    try { p = Promise.resolve(res.mod.createDistanceTracker({ screen: draft.results.screen, distance: draft.results.distance })); } catch { return; }
    /** @type {(v: null) => void} */
    let skip = () => {};
    const skipped = new Promise((resolve) => { skip = resolve; });
    const timer = setTimeout(() => skip(null), TRACKER_TIMEOUT_MS);
    // Only show the prompt if starting the camera takes a moment (permission dialog, model download).
    const promptTimer = setTimeout(() => {
      clear(body);
      body.append(h('div', { class: 'va-page va-page--narrow va-flow', 'data-testid': 'tracker-prompt' },
        pageHeader({ title: t('tracker.title'), lead: t('tracker.body') }),
        spinner(ctx.t('loading')),
        h('div', { class: 'va-actions' }, actionButton(t('tracker.skip'), { variant: 'secondary', testId: 'tracker-skip', onClick: () => skip(null) }))));
    }, 600);
    let result = null;
    try { result = await Promise.race([p.catch(() => null), skipped]); } finally { clearTimeout(timer); clearTimeout(promptTimer); }
    if (result && !destroyed) { tracker = result; return; }
    // Not used: make sure a late tracker is released.
    p.then((late) => { if (late && late !== tracker) late.stop(); }).catch(() => {});
    if (result && destroyed) result.stop();
  }

  async function runCompute() {
    stage.setHeader({ step: PLAN.length, total: PLAN.length, title: t('step.compute'), done: PLAN.length });
    stage.setProgress(1);
    clear(body);
    body.append(spinner(t('compute.working')));
    const res = await loadModule('profile', 'computeProfile');
    if (destroyed) return;
    if (!res.ok) { computeProblem('unavailable'); return; }
    const input = buildProfileInput(draft, {
      theme: getTheme(), now: now(),
      screenFallback: fallbackScreen({ cssPxPerMm: DEFAULT_CSS_PX_PER_MM, dpr: window.devicePixelRatio || 1, screenWidthCssPx: screen.width, screenHeightCssPx: screen.height }, now()),
    });
    let profile;
    try {
      profile = res.mod.computeProfile(input, { id: draft.target.profileId, name: draft.basics?.name || t('basics.defaultName') });
    } catch (err) {
      console.warn('computeProfile failed', err);
      computeProblem('error');
      return;
    }
    const previous = draft.target.mode === 'retest' ? getProfile(draft.target.profileId) : null;
    if (previous?.createdAt) profile = { ...profile, createdAt: previous.createdAt };
    saveProfile(profile);
    setActiveProfileId(profile.id);
    clearDraft(DRAFT_KEY);
    tracker?.stop();
    tracker = null;
    exiting = true;
    ctx.shell.toast(t('compute.done'), { kind: 'success' });
    ctx.navigate('/results', { replace: true, query: { fresh: 1 } });
  }

  /** @param {'unavailable'|'error'} kind */
  function computeProblem(kind) {
    clear(body);
    body.append(h('div', { class: 'va-page va-page--narrow va-flow', 'data-testid': `compute-${kind}` },
      h('div', { class: 'va-empty' },
        h('div', { class: 'va-empty__icon' }, icon(kind === 'unavailable' ? 'clock' : 'warning', { size: 40 })),
        h('h1', { class: 'va-title', tabindex: '-1' }, t(kind === 'unavailable' ? 'compute.unavailableTitle' : 'compute.errorTitle')),
        h('p', { class: 'va-empty__text' }, t(kind === 'unavailable' ? 'compute.unavailableBody' : 'compute.errorBody')),
        h('div', { class: 'va-actions va-actions--center' },
          actionButton(t('problem.retry'), { iconName: 'retest', testId: 'compute-retry', onClick: () => void runCompute() }),
          actionButton(ctx.t('goHome'), { variant: 'secondary', iconName: 'home', testId: 'compute-home', onClick: () => { exiting = true; ctx.navigate('/home'); } }),
        ))));
    /** @type {HTMLElement|null} */ (body.querySelector('h1'))?.focus();
  }

  async function confirmStop() {
    return ctx.shell.confirm({ title: t('exitTitle'), body: t('exitBody'), confirmLabel: t('exitConfirm'), cancelLabel: t('exitCancel'), testId: 'exit-dialog' });
  }

  /** @param {boolean} [skipConfirm] */
  async function requestExit(skipConfirm = false) {
    if (!skipConfirm && (running || completedSteps(draft) > 0 || draft.basics) && !(await confirmStop())) return;
    exiting = true;
    controller?.abort();
    ctx.navigate('/home');
  }

  async function keepAwake() {
    try {
      const nav = /** @type {any} */ (navigator);
      if (nav.wakeLock && !wakeLock) {
        wakeLock = await nav.wakeLock.request('screen');
        wakeLock.addEventListener?.('release', () => { wakeLock = null; });
      }
    } catch { /* not supported / not allowed */ }
  }

  return {
    el: stage.el,
    async canLeave() {
      if (exiting || destroyed) return true;
      if (!running && !draft?.basics && completedSteps(draft) === 0) return true;
      const ok = await confirmStop();
      if (ok) { exiting = true; controller?.abort(); }
      return ok;
    },
    destroy() {
      destroyed = true;
      controller?.abort();
      tracker?.stop();
      tracker = null;
      document.removeEventListener('visibilitychange', onVisible);
      try { wakeLock?.release?.(); } catch { /* ignore */ }
      ctx.shell.pauseAdaptation(false);
    },
  };
}
