// @ts-check
/**
 * Shared UI building blocks for test / calibration views, so every step looks and behaves the same.
 * Class names are a contract with css/base.css (owned by the manager; the UX agent may restyle them).
 */
import { h, s, clear, abortError } from './dom.js';
import { makeT } from './i18n.js';

/** @typedef {import('./types.js').Lang} Lang */
/** @typedef {import('./types.js').Eye} Eye */
/** @typedef {'up'|'down'|'left'|'right'} Direction */

const STRINGS = {
  he: {
    continue: 'המשך',
    start: 'התחל',
    cancel: 'ביטול',
    unsure: 'לא בטוח/ה',
    coverTitle: 'כסו את העין {other}',
    coverBody: 'כסו בעדינות את העין {other} בכף היד (בלי ללחוץ), והשאירו את שתי העיניים פתוחות. כעת נבדוק את העין {eye}.',
    bothEyesTitle: 'בדיקה בשתי העיניים',
    bothEyesBody: 'השאירו את שתי העיניים פתוחות והחזיקו את המכשיר במרחק הקריאה הרגיל שלכם.',
    glassesHint: 'אם אתם משתמשים במשקפיים או עדשות מול הטלפון — הרכיבו אותם כעת.',
    right: 'הימנית',
    left: 'השמאלית',
    dirUp: 'למעלה',
    dirDown: 'למטה',
    dirLeft: 'שמאלה',
    dirRight: 'ימינה',
    padLabel: 'לאיזה כיוון פונה הפתח?',
  },
  en: {
    continue: 'Continue',
    start: 'Start',
    cancel: 'Cancel',
    unsure: 'Not sure',
    coverTitle: 'Cover your {other} eye',
    coverBody: 'Gently cover your {other} eye with your palm (don’t press) and keep both eyes open. We will now test your {eye} eye.',
    bothEyesTitle: 'Both eyes',
    bothEyesBody: 'Keep both eyes open and hold the device at your usual reading distance.',
    glassesHint: 'If you wear glasses or contact lenses when using your phone, put them on now.',
    right: 'right',
    left: 'left',
    dirUp: 'Up',
    dirDown: 'Down',
    dirLeft: 'Left',
    dirRight: 'Right',
    padLabel: 'Which way is the opening facing?',
  },
};

/**
 * Standard screen layout.
 * @param {{title?: string, body?: (Node|string)[], actions?: Node[], className?: string, testId?: string}} opts
 * @returns {HTMLElement}
 */
export function screen({ title, body = [], actions = [], className = '', testId }) {
  return h('section', { class: `va-screen ${className}`.trim(), 'data-testid': testId },
    title ? h('h1', { class: 'va-title', tabindex: '-1' }, title) : null,
    h('div', { class: 'va-screen__body' }, ...body.map((b) => (typeof b === 'string' ? h('p', { class: 'va-text' }, b) : b))),
    actions.length ? h('div', { class: 'va-actions' }, ...actions) : null,
  );
}

/**
 * @param {string} label
 * @param {{variant?: 'primary'|'secondary'|'ghost'|'danger', onClick?: (e: MouseEvent) => void, testId?: string, disabled?: boolean, type?: 'button'|'submit'}} [opts]
 */
export function button(label, { variant = 'primary', onClick, testId, disabled, type = 'button' } = {}) {
  return h('button', {
    type, class: `va-btn va-btn--${variant}`, 'data-testid': testId, disabled: !!disabled,
    on: onClick ? { click: onClick } : undefined,
  }, label);
}

/**
 * Render an instruction screen and wait for the user to choose.
 * @param {HTMLElement} container
 * @param {{title: string, paragraphs?: string[], illustration?: Node|null, primaryLabel: string, secondaryLabel?: string, signal?: AbortSignal, testId?: string}} opts
 * @returns {Promise<'primary'|'secondary'>}
 */
export function instructionScreen(container, { title, paragraphs = [], illustration = null, primaryLabel, secondaryLabel, signal, testId }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => { clear(container); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = (/** @type {'primary'|'secondary'} */ choice) => {
      signal?.removeEventListener('abort', onAbort);
      clear(container);
      resolve(choice);
    };
    const actions = [button(primaryLabel, { onClick: () => done('primary'), testId: 'instruction-primary' })];
    if (secondaryLabel) actions.push(button(secondaryLabel, { variant: 'secondary', onClick: () => done('secondary'), testId: 'instruction-secondary' }));
    clear(container);
    const body = [];
    if (illustration) body.push(h('div', { class: 'va-illustration' }, illustration));
    body.push(...paragraphs);
    container.appendChild(screen({ title, body, actions, testId }));
    focusTitle(container);
  });
}

/**
 * "Cover your other eye" (or "use both eyes") screen before a monocular test.
 * @param {HTMLElement} container
 * @param {{eye: Eye, lang: Lang, signal?: AbortSignal, showGlassesHint?: boolean}} opts
 * @returns {Promise<void>}
 */
export async function coverEyeScreen(container, { eye, lang, signal, showGlassesHint = true }) {
  const t = makeT(STRINGS, lang);
  const paragraphs = [];
  let title;
  if (eye === 'both') {
    title = t('bothEyesTitle');
    paragraphs.push(t('bothEyesBody'));
  } else {
    const other = eye === 'right' ? 'left' : 'right';
    title = t('coverTitle', { other: t(other) });
    paragraphs.push(t('coverBody', { other: t(other), eye: t(eye) }));
  }
  if (showGlassesHint) paragraphs.push(t('glassesHint'));
  await instructionScreen(container, {
    title, paragraphs, illustration: coverEyeIllustration(eye), primaryLabel: t('start'), signal, testId: `cover-eye-${eye}`,
  });
}

/**
 * Simple face illustration with a hand covering the non-tested eye. Mirrors correctly:
 * the user's RIGHT eye appears on the viewer's LEFT (as when looking at a face).
 * @param {Eye} eye  eye under test
 * @returns {SVGElement}
 */
export function coverEyeIllustration(eye) {
  // Face viewed from the front: user's right eye is at x=70 (viewer's left), user's left eye at x=130.
  const coverX = eye === 'right' ? 130 : eye === 'left' ? 70 : null;
  return s('svg', { viewBox: '0 0 200 160', width: '180', height: '144', role: 'img', 'aria-hidden': 'true', class: 'va-cover-illustration' },
    s('ellipse', { cx: '100', cy: '82', rx: '70', ry: '76', class: 'va-ill-face' }),
    s('ellipse', { cx: '70', cy: '70', rx: '14', ry: '9', class: 'va-ill-eye' }),
    s('circle', { cx: '70', cy: '70', r: '5', class: 'va-ill-pupil' }),
    s('ellipse', { cx: '130', cy: '70', rx: '14', ry: '9', class: 'va-ill-eye' }),
    s('circle', { cx: '130', cy: '70', r: '5', class: 'va-ill-pupil' }),
    s('path', { d: 'M80 118 Q100 130 120 118', class: 'va-ill-mouth' }),
    coverX !== null ? s('rect', { x: String(coverX - 26), y: '48', width: '52', height: '46', rx: '20', class: 'va-ill-hand' }) : null,
  );
}

/**
 * Four-direction response pad (+ optional "not sure"). Directions are ABSOLUTE screen directions
 * and are never mirrored in RTL. Supports arrow keys and swipe gestures on `swipeTarget`.
 * @param {{lang: Lang, onAnswer: (d: Direction|'unsure') => void, includeUnsure?: boolean, swipeTarget?: HTMLElement}} opts
 * @returns {{el: HTMLElement, destroy: () => void, setEnabled: (on: boolean) => void}}
 */
export function directionPad({ lang, onAnswer, includeUnsure = true, swipeTarget }) {
  const t = makeT(STRINGS, lang);
  let enabled = true;
  const fire = (/** @type {Direction|'unsure'} */ d) => { if (enabled) onAnswer(d); };
  const arrow = (/** @type {Direction} */ d, /** @type {string} */ label, /** @type {number} */ rot) =>
    h('button', {
      type: 'button', class: `va-pad__btn va-pad__btn--${d}`, 'aria-label': label, 'data-testid': `pad-${d}`,
      on: { click: () => fire(d) },
    }, s('svg', { viewBox: '0 0 24 24', width: '28', height: '28', 'aria-hidden': 'true', style: { transform: `rotate(${rot}deg)` } },
      s('path', { d: 'M12 4 L20 14 H15 V20 H9 V14 H4 Z', fill: 'currentColor' })));
  const el = h('div', { class: 'va-pad', role: 'group', 'aria-label': t('padLabel'), dir: 'ltr' },
    arrow('up', t('dirUp'), 0),
    arrow('left', t('dirLeft'), -90),
    arrow('right', t('dirRight'), 90),
    arrow('down', t('dirDown'), 180),
    includeUnsure ? h('button', { type: 'button', class: 'va-pad__unsure va-btn va-btn--ghost', 'data-testid': 'pad-unsure', on: { click: () => fire('unsure') } }, t('unsure')) : null,
  );
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    /** @type {Record<string, Direction>} */
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (map[e.key]) { e.preventDefault(); fire(map[e.key]); }
  };
  document.addEventListener('keydown', onKey);
  let sx = 0; let sy = 0; let tracking = false;
  /** @param {PointerEvent} e */
  const onDown = (e) => { tracking = true; sx = e.clientX; sy = e.clientY; };
  /** @param {PointerEvent} e */
  const onUp = (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - sx; const dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return;
    fire(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };
  swipeTarget?.addEventListener('pointerdown', onDown);
  swipeTarget?.addEventListener('pointerup', onUp);
  return {
    el,
    setEnabled(on) { enabled = on; el.classList.toggle('is-disabled', !on); },
    destroy() {
      document.removeEventListener('keydown', onKey);
      swipeTarget?.removeEventListener('pointerdown', onDown);
      swipeTarget?.removeEventListener('pointerup', onUp);
    },
  };
}

/**
 * Determinate progress bar.
 * @returns {{el: HTMLElement, set: (fraction: number) => void}}
 */
export function progressBar() {
  const fill = h('div', { class: 'va-progress__fill' });
  const el = h('div', { class: 'va-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
  return {
    el,
    set(fraction) {
      const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
      fill.style.width = `${pct}%`;
      el.setAttribute('aria-valuenow', String(pct));
    },
  };
}

/**
 * Move keyboard/screen-reader focus to the first title in a container.
 * @param {HTMLElement} container
 */
export function focusTitle(container) {
  const title = /** @type {HTMLElement|null} */ (container.querySelector('.va-title'));
  title?.focus({ preventScroll: true });
}

/**
 * Create a canvas that renders at device resolution: returns the canvas and a 2D context already
 * scaled so that drawing units are CSS px. Re-call `resize` when the element size changes.
 * @param {number} cssWidth @param {number} cssHeight
 * @returns {{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, dpr: number, resize: (w: number, h: number) => void}}
 */
export function hiDpiCanvas(cssWidth, cssHeight) {
  const canvas = h('canvas', { class: 'va-canvas' });
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const api = {
    canvas, ctx, dpr: window.devicePixelRatio || 1,
    /** @param {number} w @param {number} hgt */
    resize(w, hgt) {
      api.dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * api.dpr);
      canvas.height = Math.round(hgt * api.dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${hgt}px`;
      ctx.setTransform(api.dpr, 0, 0, api.dpr, 0, 0);
    },
  };
  api.resize(cssWidth, cssHeight);
  return api;
}
