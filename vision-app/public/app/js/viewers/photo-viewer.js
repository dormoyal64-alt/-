// @ts-check
/**
 * Photo viewer: shows a local image through the personal enhancement pipeline (profile.media).
 * Pinch / drag / double-tap / wheel / keyboard zoom & pan, hold-to-compare with the original,
 * strength 0–150 %, save or share the adapted image at full resolution. The photo never leaves the device.
 */
import { h, clear } from '../core/dom.js';
import { makeT, dirFor, formatNumber } from '../core/i18n.js';
import { neutralFilterParams } from '../core/types.js';
import { scaleParams } from '../render/filter-math.js';
import { createFilterRenderer } from '../render/filter-renderer.js';
import { suspendUiFilter } from '../render/apply-ui.js';
import { fileStem } from './viewer-math.js';
import {
  ensureViewerStyles, createDisposer, mediaParamsOf, iconButton, attachGestures, createViewController,
  attachStageKeys, holdButton, rangeField, shareOrDownload, uniqueId,
} from './viewer-kit.js';

const STRINGS = {
  he: {
    title: 'צפייה בתמונות',
    choose: 'בחירת תמונה',
    chooseOther: 'תמונה אחרת',
    empty: 'בחרו תמונה כדי לראות אותה מותאמת לראייה שלכם.',
    privacy: 'התמונה נשארת במכשיר שלכם ואינה נשלחת לשום מקום.',
    stageLabel: 'תמונה מותאמת',
    stageHint: 'גררו להזזה, צבטו או הקישו פעמיים להגדלה. במקלדת: חיצים להזזה, + ו־− להגדלה והקטנה, 0 להתאמה למסך.',
    strength: 'עוצמת ההתאמה',
    compare: 'החזיקו להשוואה למקור',
    showingOriginal: 'מוצג המקור ללא התאמה',
    showingAdapted: 'מוצגת התמונה המותאמת',
    zoomIn: 'הגדלה',
    zoomOut: 'הקטנה',
    zoomFit: 'התאמה למסך',
    zoomLevel: 'הגדלה פי {z}',
    save: 'שמירה או שיתוף',
    saving: 'מכינים את התמונה…',
    saved: 'התמונה המותאמת נשמרה בהורדות.',
    shared: 'התמונה שותפה.',
    cancelled: 'השיתוף בוטל.',
    saveFailed: 'לא הצלחנו לשמור את התמונה.',
    notImage: 'הקובץ שנבחר אינו תמונה.',
    loadFailed: 'לא הצלחנו לפתוח את התמונה. נסו תמונה אחרת.',
    loading: 'פותחים את התמונה…',
    loaded: 'נפתחה התמונה {name}.',
    noRenderer: 'המכשיר אינו תומך בתצוגה המשופרת.',
  },
  en: {
    title: 'Photo viewer',
    choose: 'Choose a photo',
    chooseOther: 'Another photo',
    empty: 'Choose a photo to see it adapted to your vision.',
    privacy: 'Your photo stays on your device and is never uploaded.',
    stageLabel: 'Adapted photo',
    stageHint: 'Drag to move, pinch or double-tap to zoom. Keyboard: arrows to move, + and − to zoom, 0 to fit.',
    strength: 'Adaptation strength',
    compare: 'Hold to compare with original',
    showingOriginal: 'Showing the original, without adaptation',
    showingAdapted: 'Showing the adapted photo',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomFit: 'Fit to screen',
    zoomLevel: 'Zoom ×{z}',
    save: 'Save or share',
    saving: 'Preparing the image…',
    saved: 'The adapted image was saved to your downloads.',
    shared: 'Image shared.',
    cancelled: 'Sharing cancelled.',
    saveFailed: 'Couldn’t save the image.',
    notImage: 'The selected file is not an image.',
    loadFailed: 'Couldn’t open this image. Try another one.',
    loading: 'Opening the image…',
    loaded: 'Opened {name}.',
    noRenderer: 'This device can’t display the enhanced view.',
  },
};

/**
 * @param {HTMLElement} container
 * @param {{lang?: import('../core/types.js').Lang, profile?: import('../core/types.js').VisionProfile|null, file?: File|null, signal?: AbortSignal}} [options]
 * @returns {{destroy: () => void}}
 */
export function mountPhotoViewer(container, options = {}) {
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
  let loadToken = 0;
  /** @type {string|null} */ let objectUrl = null;
  /** @type {Set<string>} */ const downloadUrls = new Set();
  let fileName = 'image';

  const hintId = uniqueId('va-photo-hint');
  const status = h('p', { class: 'va-viewer__status', role: 'status', 'aria-live': 'polite', 'data-testid': 'photo-status' });
  const say = (/** @type {string} */ msg) => { status.textContent = msg; };

  const input = h('input', { type: 'file', accept: 'image/*', hidden: true, 'data-testid': 'photo-file-input' });
  const pick = () => input.click();
  const chooseBtn = iconButton({ icon: 'image', label: t('choose'), showLabel: true, variant: 'primary', onClick: pick, testId: 'photo-choose' });
  const saveBtn = iconButton({ icon: 'share', label: t('save'), showLabel: true, onClick: () => { void save(); }, testId: 'photo-save', disabled: true });

  const canvas = h('canvas', { class: 'va-viewer__canvas', 'aria-hidden': 'true', 'data-testid': 'photo-canvas' });
  const badge = h('div', { class: 'va-viewer__badge', hidden: true, 'aria-hidden': 'true' });
  const overlay = h('div', { class: 'va-viewer__overlay', 'data-testid': 'photo-empty' },
    h('p', null, t('empty')),
    iconButton({ icon: 'image', label: t('choose'), showLabel: true, variant: 'primary', onClick: pick, testId: 'photo-choose-empty' }),
    h('p', { class: 'va-viewer__note' }, t('privacy')));
  const stage = h('div', {
    class: 'va-viewer__stage', tabindex: '0', role: 'img', 'aria-label': t('stageLabel'), 'aria-describedby': hintId,
    'data-testid': 'photo-stage',
  }, canvas, badge, overlay);

  const strengthField = rangeField({
    label: t('strength'), min: 0, max: 150, step: 5, value: strength, testId: 'photo-strength',
    format: (v) => formatNumber(v / 100, lang, { style: 'percent' }),
    onInput: (v) => { strength = v; applyParams(); },
  });
  const compareBtn = iconButton({ icon: 'eye', label: t('compare'), showLabel: true, className: 'va-vbtn--hold', testId: 'photo-compare', disabled: true });
  const zoomOutBtn = iconButton({ icon: 'minus', label: t('zoomOut'), testId: 'photo-zoom-out', disabled: true, onClick: () => { vc?.zoomBy(0.8); announceZoom(); } });
  const zoomInBtn = iconButton({ icon: 'plus', label: t('zoomIn'), testId: 'photo-zoom-in', disabled: true, onClick: () => { vc?.zoomBy(1.25); announceZoom(); } });
  const fitBtn = iconButton({ icon: 'fit', label: t('zoomFit'), testId: 'photo-zoom-fit', disabled: true, onClick: () => { vc?.reset(); announceZoom(); } });

  const root = h('section', { class: 'va-viewer va-photo-viewer', dir: dirFor(lang), lang, 'data-testid': 'photo-viewer', 'aria-label': t('title') },
    h('div', { class: 'va-viewer__bar' }, h('h2', { class: 'va-viewer__title' }, t('title')), chooseBtn, saveBtn, input),
    stage,
    h('p', { id: hintId, class: 'va-visually-hidden' }, t('stageHint')),
    h('div', { class: 'va-viewer__panel' },
      h('div', { class: 'va-viewer__row' }, strengthField.el),
      h('div', { class: 'va-viewer__row' }, compareBtn, h('div', { class: 'va-viewer__group' }, zoomOutBtn, zoomInBtn, fitBtn))),
    status);
  clear(container);
  container.appendChild(root);

  const renderer = createFilterRenderer(canvas, { background: [0, 0, 0], onError: (err) => console.warn('[photo-viewer]', err) });
  d.add(() => renderer.destroy());
  root.dataset.backend = renderer.backend;
  if (!renderer.supported) say(t('noRenderer'));

  const vc = createViewController(renderer, canvas, {
    maxZoom: 8,
    onChange: (v) => {
      badge.hidden = v.zoom <= 1.01;
      badge.textContent = `×${formatNumber(v.zoom, lang, { maximumFractionDigits: 1 })}`;
    },
  });
  const announceZoom = () => say(t('zoomLevel', { z: formatNumber(vc.get().zoom, lang, { maximumFractionDigits: 1 }) }));

  function applyParams() {
    renderer.setParams(comparing ? neutralFilterParams() : scaleParams(base, strength / 100));
  }
  applyParams();

  d.add(attachGestures(stage, {
    onPan: (dx, dy) => vc.pan(dx, dy),
    onZoom: (f, x, y) => vc.zoomBy(f, x, y),
    onDoubleTap: (x, y) => vc.toggle(x, y),
  }));
  d.add(attachStageKeys(stage, { pan: (dx, dy) => vc.pan(dx, dy), zoomBy: (f) => { vc.zoomBy(f); announceZoom(); }, reset: () => vc.reset() }));
  d.add(holdButton(compareBtn, {
    onStart: () => { comparing = true; applyParams(); say(t('showingOriginal')); },
    onEnd: () => { comparing = false; applyParams(); say(t('showingAdapted')); },
  }));
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => vc.reclamp());
    ro.observe(stage);
    d.add(() => ro.disconnect());
  }
  d.on(input, 'change', () => { const f = input.files?.[0]; if (f) void load(f); input.value = ''; });

  /** @param {File} f */
  async function load(f) {
    const token = ++loadToken;
    if (!f.type.startsWith('image/')) { say(t('notImage')); return; }
    say(t('loading'));
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.decoding = 'async';
    img.alt = '';
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      if (!destroyed && token === loadToken) say(t('loadFailed'));
      return;
    }
    if (destroyed || token !== loadToken) { URL.revokeObjectURL(url); return; }
    const prev = objectUrl;
    objectUrl = url;
    fileName = fileStem(f.name);
    renderer.setSource(img);
    if (prev) URL.revokeObjectURL(prev);
    vc.reset();
    overlay.hidden = true;
    chooseBtn.querySelector('.va-vbtn__label')?.replaceChildren(t('chooseOther'));
    for (const b of [saveBtn, compareBtn, zoomOutBtn, zoomInBtn, fitBtn]) b.disabled = false;
    root.dataset.state = 'loaded';
    say(t('loaded', { name: f.name }));
  }

  async function save() {
    saveBtn.disabled = true;
    say(t('saving'));
    try {
      renderer.setParams(scaleParams(base, strength / 100));
      const blob = await renderer.exportBlob({ type: 'image/jpeg', quality: 0.92, maxSize: 4096 });
      applyParams();
      if (destroyed) return;
      if (!blob) { say(t('saveFailed')); return; }
      const result = await shareOrDownload(blob, `${fileName}-adapted.jpg`, { title: t('title'), doc, trackUrl: (u) => downloadUrls.add(u) });
      if (!destroyed) say(t(result === 'shared' ? 'shared' : result === 'cancelled' ? 'cancelled' : 'saved'));
    } catch (err) {
      console.warn('[photo-viewer] save failed', err);
      if (!destroyed) say(t('saveFailed'));
    } finally {
      if (!destroyed) saveBtn.disabled = false;
    }
  }

  if (file) void load(file);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    signal?.removeEventListener('abort', destroy);
    d.run();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    downloadUrls.forEach((u) => URL.revokeObjectURL(u));
    downloadUrls.clear();
    root.remove();
  }
  signal?.addEventListener('abort', destroy, { once: true });
  return { destroy };
}
