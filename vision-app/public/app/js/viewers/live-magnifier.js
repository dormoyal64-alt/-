// @ts-check
/**
 * Live magnifier: rear camera through the enhancement pipeline. Zoom 1×–10× (camera zoom when the track
 * supports it, digital zoom beyond / otherwise), torch, freeze frame (then pan / zoom the still), and the
 * classic low-vision colour modes. The camera image is only displayed — never recorded or sent.
 */
import { h, clear } from '../core/dom.js';
import { makeT, dirFor, formatNumber } from '../core/i18n.js';
import { createFilterRenderer } from '../render/filter-renderer.js';
import { suspendUiFilter } from '../render/apply-ui.js';
import { identityView, clampView, zoomAtPoint, panByPixels } from '../render/view-math.js';
import { clamp } from '../render/filter-math.js';
import {
  splitZoom, classifyCameraError, magnifierPreset, MAGNIFIER_MODES, MAGNIFIER_MIN_ZOOM, MAGNIFIER_MAX_ZOOM,
} from './viewer-math.js';
import {
  ensureViewerStyles, createDisposer, iconButton, setButtonIcon, attachGestures, attachStageKeys, rangeField, uniqueId,
} from './viewer-kit.js';

const STRINGS = {
  he: {
    title: 'זכוכית מגדלת',
    starting: 'מפעילים את המצלמה…',
    stageLabel: 'תצוגת מצלמה מוגדלת',
    stageHint: 'צבטו להגדלה, גררו להזזה. במקלדת: + ו־− להגדלה, חיצים להזזה, רווח להקפאה.',
    zoom: 'הגדלה',
    zoomIn: 'הגדלה',
    zoomOut: 'הקטנה',
    freeze: 'הקפאת תמונה',
    unfreeze: 'חזרה לתצוגה חיה',
    frozen: 'התמונה הוקפאה. אפשר להגדיל ולהזיז אותה.',
    live: 'תצוגה חיה.',
    torchOn: 'הדלקת פנס',
    torchOff: 'כיבוי פנס',
    torchFailed: 'לא הצלחנו להפעיל את הפנס.',
    mode: 'מצב צבעים',
    mode_profile: 'הפרופיל שלי',
    mode_contrast: 'ניגודיות גבוהה',
    mode_inverted: 'צבעים הפוכים',
    mode_yellow: 'צהוב על שחור',
    privacy: 'התמונה מוצגת על המסך בלבד — שום דבר לא מוקלט או נשלח.',
    retry: 'נסו שוב',
    denied_title: 'אין גישה למצלמה',
    denied_body: 'כדי להשתמש בזכוכית המגדלת צריך לאשר גישה למצלמה. המצלמה משמשת רק להצגה על המסך — שום דבר לא מוקלט או נשלח.',
    denied_step1: 'אנדרואיד (Chrome): הקישו על סמל ההגדרות או המנעול שליד כתובת האתר ← הרשאות ← מצלמה ← אישור.',
    denied_step2: 'iPhone ו־iPad (Safari): הקישו על ״aA״ בשורת הכתובת ← הגדרות אתר ← מצלמה ← אישור. אפשר גם: הגדרות ← Safari ← מצלמה ← אישור.',
    denied_step3: 'אחר כך חזרו לכאן והקישו על ״נסו שוב״.',
    nocamera_title: 'לא נמצאה מצלמה',
    nocamera_body: 'לא מצאנו מצלמה במכשיר הזה. הזכוכית המגדלת פועלת בטלפון או בטאבלט עם מצלמה.',
    busy_title: 'המצלמה בשימוש',
    busy_body: 'ייתכן שאפליקציה אחרת משתמשת במצלמה. סגרו אותה ונסו שוב.',
    insecure_title: 'נדרש חיבור מאובטח',
    insecure_body: 'הדפדפן מאפשר שימוש במצלמה רק בחיבור מאובטח (https). פתחו את האפליקציה מהכתובת הרשמית שלה.',
    other_title: 'לא הצלחנו להפעיל את המצלמה',
    other_body: 'אירעה שגיאה בהפעלת המצלמה ({name}). נסו שוב, ואם הבעיה חוזרת — הפעילו מחדש את הדפדפן.',
    stopped_title: 'המצלמה נעצרה',
    stopped_body: 'המצלמה הפסיקה לפעול (למשל כשעברתם לאפליקציה אחרת). הקישו על ״נסו שוב״ כדי להפעיל אותה מחדש.',
  },
  en: {
    title: 'Magnifier',
    starting: 'Starting the camera…',
    stageLabel: 'Magnified camera view',
    stageHint: 'Pinch to zoom, drag to move. Keyboard: + and − to zoom, arrows to move, Space to freeze.',
    zoom: 'Magnification',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    freeze: 'Freeze image',
    unfreeze: 'Back to live view',
    frozen: 'Image frozen. You can zoom and move it.',
    live: 'Live view.',
    torchOn: 'Turn light on',
    torchOff: 'Turn light off',
    torchFailed: 'Couldn’t switch the light on.',
    mode: 'Colour mode',
    mode_profile: 'My profile',
    mode_contrast: 'High contrast',
    mode_inverted: 'Inverted',
    mode_yellow: 'Yellow on black',
    privacy: 'The image is only shown on screen — nothing is recorded or sent.',
    retry: 'Try again',
    denied_title: 'Camera access is blocked',
    denied_body: 'The magnifier needs permission to use the camera. The camera is only used to show the image on screen — nothing is recorded or sent.',
    denied_step1: 'Android (Chrome): tap the settings or lock icon next to the web address → Permissions → Camera → Allow.',
    denied_step2: 'iPhone and iPad (Safari): tap “aA” in the address bar → Website Settings → Camera → Allow. Or: Settings → Safari → Camera → Allow.',
    denied_step3: 'Then come back here and tap “Try again”.',
    nocamera_title: 'No camera found',
    nocamera_body: 'We couldn’t find a camera on this device. The magnifier works on phones and tablets with a camera.',
    busy_title: 'The camera is busy',
    busy_body: 'Another app may be using the camera. Close it and try again.',
    insecure_title: 'A secure connection is required',
    insecure_body: 'Browsers only allow the camera over a secure (https) connection. Open the app from its official address.',
    other_title: 'Couldn’t start the camera',
    other_body: 'Something went wrong while starting the camera ({name}). Try again; if it keeps happening, restart your browser.',
    stopped_title: 'The camera stopped',
    stopped_body: 'The camera stopped (for example when you switched to another app). Tap “Try again” to restart it.',
  },
};

/**
 * @param {HTMLElement} container
 * @param {{lang?: import('../core/types.js').Lang, profile?: import('../core/types.js').VisionProfile|null, signal?: AbortSignal}} [options]
 * @returns {{destroy: () => void}}
 */
export function mountLiveMagnifier(container, options = {}) {
  const { lang = 'he', profile = null, signal } = options;
  const doc = container.ownerDocument;
  const win = doc.defaultView || window;
  ensureViewerStyles(doc);
  const t = makeT(STRINGS, lang);
  const d = createDisposer();
  d.add(suspendUiFilter(doc));

  /** @type {import('./viewer-math.js').MagnifierMode} */
  let mode = 'profile';
  let zoomLevel = clamp(Math.max(2, Number(profile?.media?.zoom) || 1), MAGNIFIER_MIN_ZOOM, MAGNIFIER_MAX_ZOOM);
  let view = identityView();
  let frozen = false;
  let frozenRatio = 1;
  let torchOn = false;
  let destroyed = false;
  let startToken = 0;
  /** @type {MediaStream|null} */ let stream = null;
  /** @type {MediaStreamTrack|null} */ let track = null;
  /** @type {{min: number, max: number, step?: number}|null} */ let zoomCap = null;
  let trackRatio = 1;
  /** @type {HTMLCanvasElement|null} */ let frozenCanvas = null;

  const hintId = uniqueId('va-mag-hint');
  const status = h('p', { class: 'va-viewer__status', role: 'status', 'aria-live': 'polite', 'data-testid': 'magnifier-status' });
  const say = (/** @type {string} */ msg) => { status.textContent = msg; };

  const video = h('video', { class: 'va-viewer__media', playsinline: true, 'webkit-playsinline': true, muted: true, autoplay: true, 'aria-hidden': 'true', tabindex: '-1', 'data-testid': 'magnifier-video' });
  video.muted = true;
  video.disablePictureInPicture = true;
  const canvas = h('canvas', { class: 'va-viewer__canvas', 'aria-hidden': 'true', 'data-testid': 'magnifier-canvas' });
  const badge = h('div', { class: 'va-viewer__badge', 'aria-hidden': 'true' });
  const overlay = h('div', { class: 'va-viewer__overlay', 'data-testid': 'magnifier-starting' }, h('p', null, t('starting')));
  const stage = h('div', {
    class: 'va-viewer__stage', tabindex: '0', role: 'img', 'aria-label': t('stageLabel'), 'aria-describedby': hintId,
    'data-testid': 'magnifier-stage',
  }, video, canvas, badge, overlay);

  const fmtZoom = (/** @type {number} */ z) => `×${formatNumber(z, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  const zoomField = rangeField({
    label: t('zoom'), min: MAGNIFIER_MIN_ZOOM, max: MAGNIFIER_MAX_ZOOM, step: 0.1, value: zoomLevel, format: fmtZoom,
    testId: 'magnifier-zoom', onInput: (v) => setZoomLevel(v),
  });
  const zoomOutBtn = iconButton({ icon: 'minus', label: t('zoomOut'), testId: 'magnifier-zoom-out', onClick: () => setZoomLevel(zoomLevel / 1.25) });
  const zoomInBtn = iconButton({ icon: 'plus', label: t('zoomIn'), testId: 'magnifier-zoom-in', onClick: () => setZoomLevel(zoomLevel * 1.25) });
  const freezeBtn = iconButton({ icon: 'freeze', label: t('freeze'), showLabel: true, variant: 'primary', className: 'va-viewer__grow', testId: 'magnifier-freeze', onClick: () => (frozen ? unfreeze() : freeze()) });
  freezeBtn.setAttribute('aria-pressed', 'false');
  const torchBtn = iconButton({ icon: 'torch', label: t('torchOn'), showLabel: true, className: 'va-viewer__grow', testId: 'magnifier-torch', onClick: () => { void toggleTorch(); } });
  torchBtn.hidden = true;
  torchBtn.setAttribute('aria-pressed', 'false');

  const modeName = uniqueId('va-mag-mode');
  const modeInputs = MAGNIFIER_MODES.map((m) => {
    const inp = h('input', { type: 'radio', name: modeName, value: m, checked: m === mode, 'data-testid': `magnifier-mode-${m}` });
    inp.addEventListener('change', () => { if (inp.checked) { mode = m; applyParams(); } });
    return h('label', { class: `va-choice va-choice--${m}` }, inp, h('span', null, t(`mode_${m}`)));
  });
  const modes = h('fieldset', { class: 'va-choices' }, h('legend', null, t('mode')), h('div', { class: 'va-choices__grid' }, ...modeInputs));

  const controls = h('div', { class: 'va-viewer__panel', 'data-testid': 'magnifier-controls' },
    h('div', { class: 'va-viewer__row' }, zoomOutBtn, zoomField.el, zoomInBtn),
    h('div', { class: 'va-viewer__row' }, freezeBtn, torchBtn),
    modes);
  const errorBox = h('div', { class: 'va-viewer__error va-card', role: 'alert', hidden: true, 'data-testid': 'magnifier-error' });

  const root = h('section', { class: 'va-viewer va-magnifier', dir: dirFor(lang), lang, 'data-testid': 'live-magnifier', 'aria-label': t('title') },
    h('div', { class: 'va-viewer__bar' }, h('h2', { class: 'va-viewer__title' }, t('title'))),
    stage,
    h('p', { id: hintId, class: 'va-visually-hidden' }, t('stageHint')),
    controls,
    errorBox,
    h('p', { class: 'va-viewer__note' }, t('privacy')),
    status);
  clear(container);
  container.appendChild(root);

  const renderer = createFilterRenderer(canvas, { background: [0, 0, 0], fit: 'cover', onError: (err) => console.warn('[live-magnifier]', err) });
  d.add(() => renderer.destroy());
  root.dataset.backend = renderer.backend;

  function applyParams() {
    renderer.setParams(magnifierPreset(mode, profile?.media));
  }
  applyParams();

  /** @returns {[number, number, number, number]|null} */
  const metrics = () => {
    const sz = renderer.getSourceSize();
    return sz && canvas.clientWidth && canvas.clientHeight ? [sz.width, sz.height, canvas.clientWidth, canvas.clientHeight] : null;
  };
  /** @param {import('../render/view-math.js').View} v */
  function setViewClamped(v) {
    const m = metrics();
    view = m ? clampView(v, ...m, { minZoom: 1, maxZoom: MAGNIFIER_MAX_ZOOM, fit: 'cover' }) : { zoom: Math.max(1, v.zoom), panX: 0, panY: 0 };
    renderer.setView(view);
  }

  // ---- zoom: camera zoom first (sharper), digital zoom for the rest ----
  let zoomBusy = false;
  /** @type {number|null} */ let pendingTrackZoom = null;
  /** @param {number} z */
  async function setTrackZoom(z) {
    pendingTrackZoom = z;
    if (zoomBusy) return;
    zoomBusy = true;
    while (pendingTrackZoom !== null && track && !destroyed) {
      const v = pendingTrackZoom;
      pendingTrackZoom = null;
      try {
        await track.applyConstraints(/** @type {any} */ ({ advanced: [{ zoom: v }] }));
      } catch (err) {
        console.warn('[live-magnifier] camera zoom unavailable, using digital zoom', err);
        zoomCap = null;
        trackRatio = 1;
        setZoomLevel(zoomLevel);
        break;
      }
    }
    zoomBusy = false;
  }

  /** @param {number} z @param {number} [ax] @param {number} [ay] */
  function setZoomLevel(z, ax, ay) {
    zoomLevel = clamp(Number.isFinite(z) ? z : 1, MAGNIFIER_MIN_ZOOM, MAGNIFIER_MAX_ZOOM);
    let digital;
    if (frozen) digital = Math.max(1, zoomLevel / frozenRatio);
    else {
      const split = splitZoom(zoomLevel, zoomCap);
      digital = split.digital;
      if (split.track !== null && track) {
        trackRatio = split.trackRatio;
        void setTrackZoom(split.track);
      } else trackRatio = 1;
    }
    const m = metrics();
    if (m) setViewClamped(zoomAtPoint(view, digital, ax ?? m[2] / 2, ay ?? m[3] / 2, ...m, 'cover'));
    else setViewClamped({ ...view, zoom: digital });
    zoomField.set(Math.round(zoomLevel * 10) / 10);
    badge.textContent = fmtZoom(zoomLevel);
  }

  // ---- freeze ----
  function freeze() {
    if (!video.videoWidth || frozen) return;
    const c = frozenCanvas || doc.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).drawImage(video, 0, 0, c.width, c.height);
    frozenCanvas = c;
    frozen = true;
    frozenRatio = trackRatio;
    renderer.setSource(c);
    video.pause();
    setButtonIcon(freezeBtn, 'play', t('unfreeze'));
    freezeBtn.setAttribute('aria-pressed', 'true');
    root.dataset.frozen = 'true';
    say(t('frozen'));
  }
  function unfreeze() {
    if (!frozen) return;
    frozen = false;
    renderer.setSource(video);
    video.play().catch(() => {});
    setButtonIcon(freezeBtn, 'freeze', t('freeze'));
    freezeBtn.setAttribute('aria-pressed', 'false');
    delete root.dataset.frozen;
    setZoomLevel(zoomLevel);
    say(t('live'));
  }

  async function toggleTorch() {
    if (!track) return;
    const want = !torchOn;
    try {
      await track.applyConstraints(/** @type {any} */ ({ advanced: [{ torch: want }] }));
      torchOn = want;
      setButtonIcon(torchBtn, 'torch', t(torchOn ? 'torchOff' : 'torchOn'));
      torchBtn.setAttribute('aria-pressed', String(torchOn));
    } catch {
      say(t('torchFailed'));
    }
  }

  // ---- camera lifecycle ----
  function stopStream() {
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
    track = null;
    torchOn = false;
    video.pause();
    video.srcObject = null;
  }

  /** @param {'denied'|'nocamera'|'busy'|'insecure'|'other'|'stopped'} kind @param {string} [name] */
  function showError(kind, name = '') {
    stage.hidden = true;
    controls.hidden = true;
    errorBox.hidden = false;
    say('');
    root.dataset.error = kind;
    const retry = iconButton({ icon: 'retry', label: t('retry'), showLabel: true, variant: 'primary', testId: 'magnifier-retry', onClick: () => { void start(); } });
    const steps = kind === 'denied' ? h('ol', null, h('li', null, t('denied_step1')), h('li', null, t('denied_step2')), h('li', null, t('denied_step3'))) : null;
    errorBox.replaceChildren(
      h('h2', { tabindex: '-1' }, t(`${kind}_title`)),
      h('p', null, t(`${kind}_body`, { name })),
      steps,
      kind === 'nocamera' || kind === 'insecure' ? null : retry,
    );
    /** @type {HTMLElement} */ (errorBox.firstChild).focus({ preventScroll: true });
  }

  function onTrackEnded() {
    if (destroyed || frozen) return;
    stopStream();
    showError('stopped');
  }

  async function start() {
    const token = ++startToken;
    stopStream();
    errorBox.hidden = true;
    delete root.dataset.error;
    stage.hidden = false;
    controls.hidden = false;
    overlay.hidden = false;
    if (frozen) { frozen = false; setButtonIcon(freezeBtn, 'freeze', t('freeze')); freezeBtn.setAttribute('aria-pressed', 'false'); }
    const md = win.navigator.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') {
      showError(classifyCameraError({ name: 'NoApiError' }, win.isSecureContext !== false));
      return;
    }
    say(t('starting'));
    /** @type {MediaStream} */
    let s;
    try {
      s = await md.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (err) {
      if (destroyed || token !== startToken) return;
      showError(classifyCameraError(err, win.isSecureContext !== false), String(/** @type {any} */ (err)?.name || err));
      return;
    }
    if (destroyed || token !== startToken) { s.getTracks().forEach((tr) => tr.stop()); return; }
    stream = s;
    track = s.getVideoTracks()[0] || null;
    track?.addEventListener('ended', onTrackEnded);
    const caps = /** @type {any} */ (track && typeof track.getCapabilities === 'function' ? track.getCapabilities() : {});
    zoomCap = caps?.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step } : null;
    torchBtn.hidden = caps?.torch !== true;
    root.dataset.cameraZoom = zoomCap ? 'track' : 'digital';
    video.srcObject = s;
    renderer.setSource(video);
    try { await video.play(); } catch { /* autoplay of a muted stream is allowed; ignore */ }
    if (destroyed || token !== startToken) return;
    const ready = () => {
      if (destroyed || token !== startToken) return;
      overlay.hidden = true;
      root.dataset.state = 'live';
      setZoomLevel(zoomLevel);
      say(t('live'));
    };
    if (video.readyState >= 2) ready(); else video.addEventListener('loadeddata', ready, { once: true });
  }

  d.add(attachGestures(stage, {
    onPan: (dx, dy) => { const m = metrics(); if (m) setViewClamped(panByPixels(view, dx, dy, ...m, 'cover')); },
    onZoom: (f, x, y) => setZoomLevel(zoomLevel * f, x, y),
  }));
  d.add(attachStageKeys(stage, {
    pan: (dx, dy) => { const m = metrics(); if (m) setViewClamped(panByPixels(view, dx, dy, ...m, 'cover')); },
    zoomBy: (f) => setZoomLevel(zoomLevel * f),
    reset: () => setZoomLevel(1),
    extra: (e) => { if (e.key === ' ' || e.key === 'f') { if (frozen) unfreeze(); else freeze(); return true; } return false; },
  }));
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => setViewClamped(view));
    ro.observe(stage);
    d.add(() => ro.disconnect());
  }
  badge.textContent = fmtZoom(zoomLevel);
  void start();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    signal?.removeEventListener('abort', destroy);
    track?.removeEventListener('ended', onTrackEnded);
    stopStream();
    d.run();
    if (frozenCanvas) { frozenCanvas.width = 0; frozenCanvas.height = 0; frozenCanvas = null; }
    root.remove();
  }
  signal?.addEventListener('abort', destroy, { once: true });
  return { destroy };
}
