// @ts-check
/**
 * #/viewer/{photo,video,magnifier,reader} — mounts the matching viewer from js/viewers/* with the active profile,
 * destroys it on route change.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { getActiveProfile } from '../core/storage.js';
import { SCREEN_STRINGS } from './strings.js';
import { loadModule, unavailableState } from '../shell/modules.js';
import { emptyState, linkButton, actionButton, iconButton, setBusy } from '../shell/components.js';
import { icon } from '../shell/icons.js';
import { formatCm } from '../shell/format.js';
import { takePending } from './handoff.js';
import { recommendedDistanceMm, coachState } from './summary.js';

/** @typedef {import('../core/types.js').DistanceTracker} DistanceTracker */
/** @typedef {import('../core/types.js').VisionProfile} VisionProfile */

const COACH_DISMISS_KEY = 'va.coachDismissed';
/** Viewers that show the distance coach (the magnifier is held wherever the object is). */
const COACHED = new Set(['photo', 'video', 'reader']);

/**
 * Small, dismissible "hold your phone about N cm" hint. On the user's tap only, live camera feedback
 * ("a bit closer / a bit farther / good") via calibration/distance-tracker.js; the camera is stopped on dismiss/leave.
 * @param {{t: (key: string, params?: Record<string, string|number>) => string, lang: import('../core/types.js').Lang, profile: VisionProfile, targetMm: number}} o
 * @returns {{el: HTMLElement, destroy: () => void}}
 */
function distanceCoach({ t, lang, profile, targetMm }) {
  const sig = `${profile.id}:${profile.updatedAt}`;
  /** @type {DistanceTracker|null} */
  let tracker = null;
  /** @type {(() => void)|null} */
  let unsub = null;
  let destroyed = false;
  let starting = false;
  /** @type {string|null} */
  let lastState = null;
  const cm = (/** @type {number} */ mm) => formatCm(mm, lang);

  const state = h('p', { class: 'va-coach__state', 'aria-live': 'polite', 'data-testid': 'coach-live' });
  const now = h('span', { class: 'va-coach__now', 'data-testid': 'coach-now' });
  const live = h('div', { class: 'va-coach__live', hidden: true }, state, now);
  const privacy = h('p', { class: 'va-hint va-coach__privacy', hidden: true }, t('coach.privacy'));
  const canTrack = !!profile.input?.screen && Number.isFinite(profile.input?.distance?.focalLengthPx) && Number(profile.input?.distance?.focalLengthPx) > 0;
  const camBtn = canTrack ? actionButton(t('coach.camera'), { variant: 'secondary', iconName: 'eye', testId: 'coach-camera', className: 'va-coach__btn', onClick: () => void toggleCamera() }) : null;

  const el = h('aside', { class: 'va-coach', 'data-testid': 'distance-coach', 'aria-label': t('coach.label') },
    h('div', { class: 'va-coach__row' },
      h('span', { class: 'va-coach__icon' }, icon('phone', { size: 22 })),
      h('p', { class: 'va-coach__text', 'data-testid': 'coach-text' }, t('coach.hint', { cm: cm(targetMm) })),
      iconButton({ iconName: 'close', label: t('coach.dismiss'), testId: 'coach-dismiss', className: 'va-coach__close', onClick: dismiss })),
    live, privacy,
    camBtn);

  /** @param {number|null} mm */
  function onDistance(mm) {
    const st = coachState(mm, targetMm);
    if (st !== lastState) {
      lastState = st;
      state.textContent = t(`coach.${st}`);
      live.dataset.state = st;
    }
    now.textContent = mm === null ? '' : t('coach.now', { cm: cm(mm) });
  }

  function stopCamera() {
    unsub?.();
    unsub = null;
    tracker?.stop();
    tracker = null;
    lastState = null;
    live.hidden = true;
    privacy.hidden = true;
    if (camBtn) { camBtn.hidden = false; setLabel(t('coach.camera')); }
  }

  /** @param {string} text */
  function setLabel(text) {
    const span = camBtn?.querySelector('span');
    if (span) span.textContent = text;
  }

  async function toggleCamera() {
    if (!camBtn || starting) return;
    if (tracker) { stopCamera(); return; }
    starting = true;
    setBusy(camBtn, true);
    live.hidden = false;
    privacy.hidden = false;
    state.textContent = t('coach.starting');
    now.textContent = '';
    /** @type {DistanceTracker|null} */
    let tr = null;
    try {
      const res = await loadModule('distanceTracker', 'createDistanceTracker');
      if (res.ok) tr = await res.mod.createDistanceTracker({ screen: profile.input.screen, distance: profile.input.distance });
    } catch (err) {
      console.warn('distance coach: tracker failed', err);
    }
    starting = false;
    setBusy(camBtn, false);
    if (destroyed || !el.isConnected) { tr?.stop(); return; }
    if (!tr) {
      state.textContent = t('coach.unavailable');
      privacy.hidden = true;
      camBtn.hidden = true;
      return;
    }
    tracker = tr;
    unsub = tr.subscribe(onDistance);
    onDistance(tr.current());
    setLabel(t('coach.stop'));
  }

  function dismiss() {
    stopCamera();
    try { localStorage.setItem(COACH_DISMISS_KEY, sig); } catch { /* ignore */ }
    el.remove();
  }

  return { el, destroy() { destroyed = true; stopCamera(); } };
}

/** @param {VisionProfile} profile */
function coachDismissed(profile) {
  try { return localStorage.getItem(COACH_DISMISS_KEY) === `${profile.id}:${profile.updatedAt}`; } catch { return false; }
}

const VIEWERS = {
  photo: { module: 'photoViewer', fn: 'mountPhotoViewer', icon: 'photo' },
  video: { module: 'videoViewer', fn: 'mountVideoViewer', icon: 'video' },
  magnifier: { module: 'liveMagnifier', fn: 'mountLiveMagnifier', icon: 'magnifier' },
  reader: { module: 'reader', fn: 'mountReader', icon: 'reader' },
};

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export async function mount(ctx) {
  const t = makeT(SCREEN_STRINGS, ctx.lang);
  const kind = /** @type {keyof typeof VIEWERS} */ (ctx.params?.kind || 'photo');
  const spec = VIEWERS[kind] || VIEWERS.photo;
  const title = ctx.t(`route.viewer.${kind}`);
  const el = h('div', { class: `va-viewer-host va-viewer-host--${kind}`, 'data-testid': `screen-viewer-${kind}` });
  const profile = getActiveProfile();
  if (!profile) {
    el.append(h('div', { class: 'va-page' }, emptyState({
      iconName: spec.icon, title: t('viewer.needProfileTitle'), body: t('viewer.needProfileBody'), testId: 'viewer-noprofile',
      actions: [linkButton(t('viewer.start'), '#/onboarding')],
    })));
    return { el };
  }
  const res = await loadModule(spec.module, spec.fn);
  if (!res.ok) {
    el.append(h('div', { class: 'va-page' }, unavailableState(ctx.lang, { reason: res.reason, onRetry: () => ctx.shell.refresh(), title })));
    return { el };
  }
  // The viewer module renders its own heading-less UI; give the page a (visually hidden) h1 for focus + SR users.
  const heading = h('h1', { class: 'va-visually-hidden', tabindex: '-1' }, title);
  const container = h('div', { class: 'va-viewer-container' });
  const targetMm = COACHED.has(kind) && !coachDismissed(profile) ? recommendedDistanceMm(profile) : null;
  const coach = targetMm ? distanceCoach({ t, lang: ctx.lang, profile, targetMm }) : null;
  el.append(heading);
  if (coach) el.append(coach.el);
  el.append(container);
  const pending = takePending(kind);
  /** @type {{destroy: () => void}|null} */
  let handle = null;
  let destroyed = false;
  // Mount once the host is in the document (the router attaches it after mount() resolves), so the viewer can
  // measure its container.
  const start = async () => {
    if (destroyed) return;
    if (!el.isConnected) { requestAnimationFrame(() => void start()); return; }
    try {
      const hnd = await res.mod[spec.fn](container, { lang: ctx.lang, profile, file: pending?.file, text: pending?.text });
      if (destroyed) hnd?.destroy?.(); else handle = hnd;
    } catch (err) {
      console.warn(`viewer ${kind} failed to mount`, err);
      if (!destroyed) el.replaceChildren(h('div', { class: 'va-page' }, unavailableState(ctx.lang, { reason: 'error', onRetry: () => ctx.shell.refresh(), title })));
    }
  };
  requestAnimationFrame(() => void start());
  return {
    el,
    title,
    destroy() {
      destroyed = true;
      coach?.destroy();
      try { handle?.destroy(); } catch (err) { console.warn('viewer destroy failed', err); }
      handle = null;
    },
  };
}
