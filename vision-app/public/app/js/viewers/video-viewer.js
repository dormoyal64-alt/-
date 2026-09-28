// @ts-check
/**
 * Video viewer: plays a local video through the enhancement pipeline in real time (profile.media).
 * Play/pause, seek, time, mute, full screen, hold-to-compare, strength, pinch/double-tap zoom.
 * Media transport controls are laid out left-to-right in both languages (time direction is not mirrored).
 */
import { h, clear } from '../core/dom.js';
import { makeT, dirFor, formatNumber } from '../core/i18n.js';
import { neutralFilterParams } from '../core/types.js';
import { scaleParams } from '../render/filter-math.js';
import { createFilterRenderer } from '../render/filter-renderer.js';
import { suspendUiFilter } from '../render/apply-ui.js';
import { formatTime } from './viewer-math.js';
import {
  ensureViewerStyles, createDisposer, mediaParamsOf, iconButton, setButtonIcon, attachGestures, createViewController,
  attachStageKeys, holdButton, rangeField, uniqueId,
} from './viewer-kit.js';

const STRINGS = {
  he: {
    title: 'צפייה בסרטונים',
    choose: 'בחירת סרטון',
    chooseOther: 'סרטון אחר',
    empty: 'בחרו סרטון מהמכשיר כדי לצפות בו מותאם לראייה שלכם.',
    privacy: 'הסרטון נשאר במכשיר שלכם ואינו נשלח לשום מקום.',
    stageLabel: 'סרטון מותאם',
    stageHint: 'רווח להפעלה או השהיה, חיצים ימינה ושמאלה לדילוג של 5 שניות. צבטו או הקישו פעמיים להגדלה.',
    play: 'הפעלה',
    pause: 'השהיה',
    mute: 'השתקה',
    unmute: 'ביטול השתקה',
    fullscreen: 'מסך מלא',
    exitFullscreen: 'יציאה ממסך מלא',
    seek: 'מיקום בסרטון',
    timeOf: '{a} מתוך {b}',
    strength: 'עוצמת ההתאמה',
    compare: 'החזיקו להשוואה למקור',
    showingOriginal: 'מוצג המקור ללא התאמה',
    showingAdapted: 'מוצג הסרטון המותאם',
    zoomIn: 'הגדלה',
    zoomOut: 'הקטנה',
    zoomFit: 'התאמה למסך',
    notVideo: 'הקובץ שנבחר אינו סרטון.',
    loading: 'פותחים את הסרטון…',
    loaded: 'נפתח הסרטון {name}. הקישו על הפעלה.',
    loadFailed: 'לא הצלחנו לפתוח את הסרטון. ייתכן שהפורמט אינו נתמך במכשיר זה.',
    noRenderer: 'המכשיר אינו תומך בתצוגה המשופרת.',
  },
  en: {
    title: 'Video viewer',
    choose: 'Choose a video',
    chooseOther: 'Another video',
    empty: 'Choose a video from your device to watch it adapted to your vision.',
    privacy: 'Your video stays on your device and is never uploaded.',
    stageLabel: 'Adapted video',
    stageHint: 'Space to play or pause, left and right arrows to skip 5 seconds. Pinch or double-tap to zoom.',
    play: 'Play',
    pause: 'Pause',
    mute: 'Mute',
    unmute: 'Unmute',
    fullscreen: 'Full screen',
    exitFullscreen: 'Exit full screen',
    seek: 'Position in video',
    timeOf: '{a} of {b}',
    strength: 'Adaptation strength',
    compare: 'Hold to compare with original',
    showingOriginal: 'Showing the original, without adaptation',
    showingAdapted: 'Showing the adapted video',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomFit: 'Fit to screen',
    notVideo: 'The selected file is not a video.',
    loading: 'Opening the video…',
    loaded: 'Opened {name}. Press play.',
    loadFailed: 'Couldn’t open this video. The format may not be supported on this device.',
    noRenderer: 'This device can’t display the enhanced view.',
  },
};

const SEEK_STEPS = 1000;

/**
 * @param {HTMLElement} container
 * @param {{lang?: import('../core/types.js').Lang, profile?: import('../core/types.js').VisionProfile|null, file?: File|null, signal?: AbortSignal}} [options]
 * @returns {{destroy: () => void}}
 */
export function mountVideoViewer(container, options = {}) {
  const { lang = 'he', profile = null, file = null, signal } = options;
  const doc = container.ownerDocument;
  ensureViewerStyles(doc);
  const t = makeT(STRINGS, lang);
  const d = createDisposer();
  d.add(suspendUiFilter(doc));
  const base = mediaParamsOf(profile);
  let strength = 100;
  let comparing = false;
  let destroyed = false;
  let scrubbing = false;
  /** @type {string|null} */ let objectUrl = null;

  const hintId = uniqueId('va-video-hint');
  const status = h('p', { class: 'va-viewer__status', role: 'status', 'aria-live': 'polite', 'data-testid': 'video-status' });
  const say = (/** @type {string} */ msg) => { status.textContent = msg; };

  const input = h('input', { type: 'file', accept: 'video/*', hidden: true, 'data-testid': 'video-file-input' });
  const pick = () => input.click();
  const chooseBtn = iconButton({ icon: 'video', label: t('choose'), showLabel: true, variant: 'primary', onClick: pick, testId: 'video-choose' });

  const video = h('video', { class: 'va-viewer__media', playsinline: true, 'webkit-playsinline': true, preload: 'auto', 'aria-hidden': 'true', tabindex: '-1', 'data-testid': 'video-element' });
  video.disablePictureInPicture = true; // PiP would show the unfiltered video
  /** @type {any} */ (video).disableRemotePlayback = true;
  const canvas = h('canvas', { class: 'va-viewer__canvas', 'aria-hidden': 'true', 'data-testid': 'video-canvas' });
  const badge = h('div', { class: 'va-viewer__badge', hidden: true, 'aria-hidden': 'true' });
  const overlay = h('div', { class: 'va-viewer__overlay', 'data-testid': 'video-empty' },
    h('p', null, t('empty')),
    iconButton({ icon: 'video', label: t('choose'), showLabel: true, variant: 'primary', onClick: pick, testId: 'video-choose-empty' }),
    h('p', { class: 'va-viewer__note' }, t('privacy')));
  const stage = h('div', {
    class: 'va-viewer__stage', tabindex: '0', role: 'img', 'aria-label': t('stageLabel'), 'aria-describedby': hintId,
    'data-testid': 'video-stage',
  }, video, canvas, badge, overlay);

  const playBtn = iconButton({ icon: 'play', label: t('play'), testId: 'video-play', disabled: true, onClick: () => togglePlay() });
  const timeEl = h('span', { class: 'va-viewer__time', 'data-testid': 'video-time', 'aria-hidden': 'true' }, '0:00 / 0:00');
  const seek = h('input', {
    type: 'range', class: 'va-range', min: '0', max: String(SEEK_STEPS), step: '1', value: '0', disabled: true,
    'aria-label': t('seek'), 'data-testid': 'video-seek',
  });
  const muteBtn = iconButton({ icon: 'volume', label: t('mute'), testId: 'video-mute', onClick: () => { video.muted = !video.muted; } });
  const fsBtn = iconButton({ icon: 'fullscreen', label: t('fullscreen'), testId: 'video-fullscreen', onClick: () => toggleFullscreen() });

  const strengthField = rangeField({
    label: t('strength'), min: 0, max: 150, step: 5, value: strength, testId: 'video-strength',
    format: (v) => formatNumber(v / 100, lang, { style: 'percent' }),
    onInput: (v) => { strength = v; applyParams(); },
  });
  const compareBtn = iconButton({ icon: 'eye', label: t('compare'), showLabel: true, className: 'va-vbtn--hold', testId: 'video-compare', disabled: true });
  const zoomOutBtn = iconButton({ icon: 'minus', label: t('zoomOut'), testId: 'video-zoom-out', onClick: () => vc.zoomBy(0.8) });
  const zoomInBtn = iconButton({ icon: 'plus', label: t('zoomIn'), testId: 'video-zoom-in', onClick: () => vc.zoomBy(1.25) });
  const fitBtn = iconButton({ icon: 'fit', label: t('zoomFit'), testId: 'video-zoom-fit', onClick: () => vc.reset() });

  const root = h('section', { class: 'va-viewer va-video-viewer', dir: dirFor(lang), lang, 'data-testid': 'video-viewer', 'aria-label': t('title') },
    h('div', { class: 'va-viewer__bar' }, h('h2', { class: 'va-viewer__title' }, t('title')), chooseBtn, input),
    stage,
    h('p', { id: hintId, class: 'va-visually-hidden' }, t('stageHint')),
    h('div', { class: 'va-viewer__panel' },
      h('div', { class: 'va-viewer__row va-viewer__row--media' }, h('div', { class: 'va-viewer__grow' }, seek)),
      h('div', { class: 'va-viewer__row va-viewer__row--media' }, playBtn, timeEl, h('span', { class: 'va-viewer__grow' }), muteBtn, fsBtn),
      h('div', { class: 'va-viewer__row' }, strengthField.el),
      h('div', { class: 'va-viewer__row' }, compareBtn, zoomOutBtn, zoomInBtn, fitBtn)),
    status);
  clear(container);
  container.appendChild(root);

  const renderer = createFilterRenderer(canvas, { background: [0, 0, 0], onError: (err) => console.warn('[video-viewer]', err) });
  d.add(() => renderer.destroy());
  root.dataset.backend = renderer.backend;
  if (!renderer.supported) say(t('noRenderer'));
  renderer.setSource(video);

  const vc = createViewController(renderer, canvas, {
    maxZoom: 6,
    onChange: (v) => {
      badge.hidden = v.zoom <= 1.01;
      badge.textContent = `×${formatNumber(v.zoom, lang, { maximumFractionDigits: 1 })}`;
    },
  });

  function applyParams() {
    renderer.setParams(comparing ? neutralFilterParams() : scaleParams(base, strength / 100));
  }
  applyParams();

  function togglePlay() {
    if (!video.src) return;
    if (video.paused || video.ended) video.play().catch((err) => console.warn('[video-viewer] play()', err));
    else video.pause();
  }

  function updateTransport() {
    const playing = !video.paused && !video.ended;
    setButtonIcon(playBtn, playing ? 'pause' : 'play', t(playing ? 'pause' : 'play'));
    setButtonIcon(muteBtn, video.muted ? 'mute' : 'volume', t(video.muted ? 'unmute' : 'mute'));
    muteBtn.setAttribute('aria-pressed', String(video.muted));
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    const cur = video.currentTime || 0;
    timeEl.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    if (!scrubbing) seek.value = String(dur > 0 ? Math.round((cur / dur) * SEEK_STEPS) : 0);
    seek.setAttribute('aria-valuetext', t('timeOf', { a: formatTime(cur), b: formatTime(dur) }));
  }
  for (const e of ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'seeked']) d.on(video, e, updateTransport);

  d.on(seek, 'input', () => {
    scrubbing = true;
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    if (dur > 0) {
      const target = (Number(seek.value) / SEEK_STEPS) * dur;
      const v = /** @type {any} */ (video);
      if (typeof v.fastSeek === 'function' && scrubbing) v.fastSeek(target); else video.currentTime = target;
      timeEl.textContent = `${formatTime(target)} / ${formatTime(dur)}`;
    }
  });
  d.on(seek, 'change', () => {
    scrubbing = false;
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    if (dur > 0) video.currentTime = (Number(seek.value) / SEEK_STEPS) * dur;
  });

  d.on(video, 'error', () => { if (video.getAttribute('src')) say(t('loadFailed')); });

  // Full screen: the whole viewer (canvas + controls); pseudo full screen where the Fullscreen API is missing (iPhone).
  const fsElement = () => /** @type {any} */ (doc).fullscreenElement || /** @type {any} */ (doc).webkitFullscreenElement || null;
  const isFs = () => fsElement() === root || root.classList.contains('is-pseudo-fullscreen');
  function updateFsButton() {
    const on = isFs();
    setButtonIcon(fsBtn, on ? 'fullscreenExit' : 'fullscreen', t(on ? 'exitFullscreen' : 'fullscreen'));
    fsBtn.setAttribute('aria-pressed', String(on));
  }
  function toggleFullscreen() {
    const r = /** @type {any} */ (root);
    const dd = /** @type {any} */ (doc);
    if (isFs()) {
      if (root.classList.contains('is-pseudo-fullscreen')) root.classList.remove('is-pseudo-fullscreen');
      else (dd.exitFullscreen || dd.webkitExitFullscreen)?.call(dd)?.catch?.(() => {});
    } else if (r.requestFullscreen || r.webkitRequestFullscreen) {
      const p = (r.requestFullscreen || r.webkitRequestFullscreen).call(r);
      p?.catch?.(() => { root.classList.add('is-pseudo-fullscreen'); updateFsButton(); });
    } else root.classList.add('is-pseudo-fullscreen');
    updateFsButton();
  }
  d.on(doc, 'fullscreenchange', updateFsButton);
  d.on(doc, 'webkitfullscreenchange', updateFsButton);
  /** @param {KeyboardEvent} e */
  const onEsc = (e) => { if (e.key === 'Escape' && root.classList.contains('is-pseudo-fullscreen')) { root.classList.remove('is-pseudo-fullscreen'); updateFsButton(); } };
  d.on(doc, 'keydown', onEsc);

  d.add(attachGestures(stage, {
    onPan: (dx, dy) => vc.pan(dx, dy),
    onZoom: (f, x, y) => vc.zoomBy(f, x, y),
    onDoubleTap: (x, y) => vc.toggle(x, y),
  }));
  d.add(attachStageKeys(stage, {
    zoomBy: (f) => vc.zoomBy(f), reset: () => vc.reset(),
    extra: (e) => {
      if (e.key === ' ' || e.key === 'k') { togglePlay(); return true; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (e.key === 'ArrowRight' ? 5 : -5)));
        return true;
      }
      return false;
    },
  }));
  d.add(holdButton(compareBtn, {
    onStart: () => { comparing = true; applyParams(); say(t('showingOriginal')); },
    onEnd: () => { comparing = false; applyParams(); say(t('showingAdapted')); },
  }));
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => vc.reclamp());
    ro.observe(stage);
    d.add(() => ro.disconnect());
  }
  d.on(input, 'change', () => { const f = input.files?.[0]; if (f) load(f); input.value = ''; });

  /** @param {File} f */
  function load(f) {
    if (!f.type.startsWith('video/') && !/\.(mp4|m4v|mov|webm|ogv|mkv)$/i.test(f.name)) { say(t('notVideo')); return; }
    say(t('loading'));
    video.pause();
    const prev = objectUrl;
    objectUrl = URL.createObjectURL(f);
    video.src = objectUrl;
    video.load();
    if (prev) URL.revokeObjectURL(prev);
    const onMeta = () => {
      if (destroyed) return;
      overlay.hidden = true;
      playBtn.disabled = false;
      seek.disabled = false;
      compareBtn.disabled = false;
      chooseBtn.querySelector('.va-vbtn__label')?.replaceChildren(t('chooseOther'));
      root.dataset.state = 'loaded';
      vc.reset();
      say(t('loaded', { name: f.name }));
      updateTransport();
    };
    video.addEventListener('loadeddata', onMeta, { once: true });
    d.add(() => video.removeEventListener('loadeddata', onMeta));
  }

  updateTransport();
  updateFsButton();
  if (file) load(file);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    signal?.removeEventListener('abort', destroy);
    if (fsElement() === root) { const dd = /** @type {any} */ (doc); (dd.exitFullscreen || dd.webkitExitFullscreen)?.call(dd)?.catch?.(() => {}); }
    d.run();
    video.pause();
    video.removeAttribute('src');
    video.load(); // releases the decoder and the blob
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    root.remove();
  }
  signal?.addEventListener('abort', destroy, { once: true });
  return { destroy };
}
