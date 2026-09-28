// @ts-check
/**
 * Shared building blocks for the media viewers: stylesheet injection, icons, gestures (pinch / drag / double-tap /
 * wheel / keyboard), a clamped view controller, hold-to-compare, strength slider, save/share, disposers.
 */
import { h, s } from '../core/dom.js';
import { sanitizeParams, clamp } from '../render/filter-math.js';
import { identityView, clampView, zoomAtPoint, panByPixels } from '../render/view-math.js';

/** @typedef {import('../render/view-math.js').View} View */
/** @typedef {import('../render/view-math.js').Fit} Fit */
/** @typedef {import('../render/filter-renderer.js').FilterRenderer} FilterRenderer */

export const STYLESHEET_ID = 'va-viewers-css';

/** Inject viewers.css once per document. @param {Document} doc */
export function ensureViewerStyles(doc) {
  if (doc.getElementById(STYLESHEET_ID)) return;
  const link = doc.createElement('link');
  link.id = STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./viewers.css', import.meta.url).href;
  doc.head.appendChild(link);
}

/** Collects cleanup functions; run() executes them in reverse order exactly once each. */
export function createDisposer() {
  /** @type {Array<() => void>} */
  const fns = [];
  return {
    /** @param {() => void} fn */
    add(fn) { fns.push(fn); return fn; },
    /** @param {EventTarget} target @param {string} type @param {(e: any) => void} fn @param {AddEventListenerOptions|boolean} [opts] */
    on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      fns.push(() => target.removeEventListener(type, fn, opts));
    },
    run() {
      while (fns.length) {
        const fn = /** @type {() => void} */ (fns.pop());
        try { fn(); } catch (err) { console.error('viewer cleanup failed', err); }
      }
    },
  };
}

/**
 * The profile's media parameters (validated), with zoom 1: viewers manage magnification through the view.
 * @param {import('../core/types.js').VisionProfile|null|undefined} profile
 */
export function mediaParamsOf(profile) {
  return { ...sanitizeParams(profile?.media), zoom: 1 };
}

// ---------- icons (24×24, stroke = currentColor) ----------
/** @type {Record<string, Array<[string, Record<string, string>]>>} */
const ICONS = {
  image: [['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }], ['circle', { cx: '8.5', cy: '8.5', r: '1.5' }], ['path', { d: 'M21 15l-5-5L5 21' }]],
  video: [['rect', { x: '2', y: '6', width: '14', height: '12', rx: '2' }], ['path', { d: 'M16 10l6-4v12l-6-4z' }]],
  play: [['path', { d: 'M7 4l13 8-13 8z', fill: 'currentColor' }]],
  pause: [['path', { d: 'M6 4h4v16H6zM14 4h4v16h-4z', fill: 'currentColor' }]],
  stop: [['path', { d: 'M6 6h12v12H6z', fill: 'currentColor' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  minus: [['path', { d: 'M5 12h14' }]],
  fit: [['path', { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' }]],
  eye: [['path', { d: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z' }], ['circle', { cx: '12', cy: '12', r: '3' }]],
  share: [['path', { d: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13' }]],
  volume: [['path', { d: 'M11 5L6 9H2v6h4l5 4z', fill: 'currentColor' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14' }]],
  mute: [['path', { d: 'M11 5L6 9H2v6h4l5 4z', fill: 'currentColor' }], ['path', { d: 'M23 9l-6 6M17 9l6 6' }]],
  fullscreen: [['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3' }]],
  fullscreenExit: [['path', { d: 'M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M16 21v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3' }]],
  torch: [['path', { d: 'M8 2h8v4l-2 4v12h-4V10L8 6z' }], ['path', { d: 'M12 13v3' }]],
  freeze: [['path', { d: 'M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 3 3-3M9 20l3-3 3 3' }]],
  camera: [['path', { d: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' }], ['circle', { cx: '12', cy: '13', r: '4' }]],
  edit: [['path', { d: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' }]],
  speak: [['path', { d: 'M11 5L6 9H2v6h4l5 4z', fill: 'currentColor' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }]],
  paste: [['rect', { x: '8', y: '2', width: '8', height: '4', rx: '1' }], ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }]],
  retry: [['path', { d: 'M1 4v6h6M3.5 15a9 9 0 1 0 2.1-9.4L1 10' }]],
};

/** @param {string} name */
export function icon(name) {
  return s('svg', {
    viewBox: '0 0 24 24', width: '24', height: '24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'va-vicon',
  }, ...(ICONS[name] || []).map(([tag, attrs]) => s(tag, attrs)));
}

/**
 * Button with an icon and (optionally visible) label. Icon-only buttons get aria-label + title.
 * @param {{icon: string, label: string, onClick?: (e: MouseEvent) => void, testId?: string, showLabel?: boolean,
 *   variant?: 'primary'|'secondary'|'ghost', disabled?: boolean, className?: string}} o
 */
export function iconButton({ icon: name, label, onClick, testId, showLabel = false, variant = 'secondary', disabled = false, className = '' }) {
  const labelEl = h('span', { class: showLabel ? 'va-vbtn__label' : 'va-visually-hidden' }, label);
  const btn = h('button', {
    type: 'button', class: `va-btn va-btn--${variant} va-vbtn ${showLabel ? '' : 'va-vbtn--icon'} ${className}`.trim(),
    title: showLabel ? undefined : label, 'data-testid': testId, disabled,
    on: onClick ? { click: onClick } : undefined,
  }, icon(name), labelEl);
  return btn;
}

/**
 * Update an icon button's icon and label in place.
 * @param {HTMLButtonElement} btn @param {string} name @param {string} label
 */
export function setButtonIcon(btn, name, label) {
  const old = btn.querySelector('svg');
  if (old) btn.replaceChild(icon(name), old);
  const l = btn.querySelector('.va-vbtn__label, .va-visually-hidden');
  if (l) l.textContent = label;
  if (btn.title) btn.title = label;
}

/**
 * Pointer gestures on a stage element: one-finger/mouse drag = pan, two-finger pinch = zoom (+ pan by the
 * centroid), double-tap/double-click = onDoubleTap, wheel = zoom at the cursor. Coordinates are CSS px relative
 * to the element's top-left corner (physical; not mirrored in RTL).
 * @param {HTMLElement} el
 * @param {{onPan?: (dx: number, dy: number) => void, onZoom?: (factor: number, x: number, y: number) => void,
 *   onDoubleTap?: (x: number, y: number) => void, onEnd?: () => void}} handlers
 * @returns {() => void} detach
 */
export function attachGestures(el, handlers) {
  /** @type {Map<number, {x: number, y: number}>} */
  const pts = new Map();
  let lastC = { x: 0, y: 0 };
  let lastDist = 0;
  let tap = /** @type {{t: number, x: number, y: number}|null} */ (null);
  let moved = 0;
  let lastTap = { t: -1e9, x: 0, y: 0 };

  const local = (/** @type {PointerEvent|WheelEvent} */ e) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const centroid = () => {
    let x = 0; let y = 0;
    for (const p of pts.values()) { x += p.x; y += p.y; }
    return { x: x / pts.size, y: y / pts.size };
  };
  const spread = () => {
    const [a, b] = [...pts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const resetAnchors = () => { if (pts.size) { lastC = centroid(); lastDist = spread(); } };

  /** @param {PointerEvent} e */
  const down = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1) { tap = { t: e.timeStamp, x: p.x, y: p.y }; moved = 0; } else tap = null;
    resetAnchors();
  };
  /** @param {PointerEvent} e */
  const move = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    const c = centroid();
    const dx = c.x - lastC.x; const dy = c.y - lastC.y;
    moved += Math.abs(dx) + Math.abs(dy);
    if (pts.size >= 2) {
      const d = spread();
      if (lastDist > 0 && d > 0 && handlers.onZoom) handlers.onZoom(d / lastDist, c.x, c.y);
      lastDist = d;
    }
    if ((dx || dy) && handlers.onPan) handlers.onPan(dx, dy);
    lastC = c;
  };
  /** @param {PointerEvent} e */
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e);
    pts.delete(e.pointerId);
    if (e.type === 'pointerup' && tap && moved < 10 && e.timeStamp - tap.t < 350) {
      if (e.timeStamp - lastTap.t < 350 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) {
        handlers.onDoubleTap?.(p.x, p.y);
        lastTap = { t: -1e9, x: 0, y: 0 };
      } else lastTap = { t: e.timeStamp, x: p.x, y: p.y };
    }
    tap = null;
    resetAnchors();
    if (!pts.size) handlers.onEnd?.();
  };
  /** @param {WheelEvent} e */
  const wheel = (e) => {
    if (!handlers.onZoom) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const f = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
    const p = local(e);
    handlers.onZoom(clamp(f, 0.5, 2), p.x, p.y);
    handlers.onEnd?.();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
    pts.clear();
  };
}

/**
 * Clamped zoom/pan state for a renderer showing a source in a canvas.
 * @param {FilterRenderer} renderer
 * @param {HTMLCanvasElement} canvas
 * @param {{minZoom?: number, maxZoom?: number, fit?: Fit, onChange?: (v: View) => void}} [o]
 */
export function createViewController(renderer, canvas, { minZoom = 1, maxZoom = 8, fit = 'contain', onChange } = {}) {
  let view = identityView();
  /** @returns {[number, number, number, number]|null} */
  const metrics = () => {
    const sz = renderer.getSourceSize();
    const w = canvas.clientWidth; const hh = canvas.clientHeight;
    return sz && w && hh ? [sz.width, sz.height, w, hh] : null;
  };
  /** @param {View} v */
  const apply = (v) => {
    const m = metrics();
    view = m ? clampView(v, ...m, { minZoom, maxZoom, fit }) : { zoom: clamp(v.zoom, minZoom, maxZoom), panX: 0, panY: 0 };
    renderer.setView(view);
    onChange?.(view);
  };
  const center = () => { const m = metrics(); return m ? [m[2] / 2, m[3] / 2] : [0, 0]; };
  return {
    get: () => ({ ...view }),
    /** @param {number} dx @param {number} dy */
    pan(dx, dy) { const m = metrics(); if (m) apply(panByPixels(view, dx, dy, ...m, fit)); },
    /** @param {number} factor @param {number} [x] @param {number} [y] */
    zoomBy(factor, x, y) {
      const m = metrics();
      if (!m) return;
      const [cx, cy] = center();
      apply(zoomAtPoint(view, clamp(view.zoom * factor, minZoom, maxZoom), x ?? cx, y ?? cy, ...m, fit));
    },
    /** @param {number} z @param {number} [x] @param {number} [y] */
    zoomTo(z, x, y) {
      const m = metrics();
      if (!m) return;
      const [cx, cy] = center();
      apply(zoomAtPoint(view, clamp(z, minZoom, maxZoom), x ?? cx, y ?? cy, ...m, fit));
    },
    /** Double-tap behaviour: zoomed -> fit; fit -> 2.5× at the point. @param {number} x @param {number} y */
    toggle(x, y) { if (view.zoom > minZoom * 1.05) apply(identityView()); else this.zoomTo(2.5, x, y); },
    reset() { apply(identityView()); },
    reclamp() { apply(view); },
  };
}

/**
 * Keyboard control on a focusable stage: arrows pan, + / − zoom, 0 resets. Extra keys via `extra`.
 * @param {HTMLElement} el
 * @param {{pan?: (dx: number, dy: number) => void, zoomBy?: (f: number) => void, reset?: () => void,
 *   extra?: (e: KeyboardEvent) => boolean}} o
 * @returns {() => void}
 */
export function attachStageKeys(el, { pan, zoomBy, reset, extra }) {
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (extra && extra(e)) { e.preventDefault(); return; }
    const step = Math.max(24, el.clientWidth * 0.1);
    /** @type {Record<string, () => void>} */
    const map = {
      ArrowLeft: () => pan?.(step, 0), ArrowRight: () => pan?.(-step, 0),
      ArrowUp: () => pan?.(0, step), ArrowDown: () => pan?.(0, -step),
      '+': () => zoomBy?.(1.25), '=': () => zoomBy?.(1.25), '-': () => zoomBy?.(0.8), '0': () => reset?.(),
    };
    const fn = map[e.key];
    if (fn && (e.key.startsWith('Arrow') ? pan : true)) { e.preventDefault(); fn(); }
  };
  el.addEventListener('keydown', onKey);
  return () => el.removeEventListener('keydown', onKey);
}

/**
 * Press-and-hold behaviour (pointer, Space/Enter). Assistive-technology clicks (no pointer, no key) toggle.
 * @param {HTMLButtonElement} btn
 * @param {{onStart: () => void, onEnd: () => void}} o
 * @returns {() => void}
 */
export function holdButton(btn, { onStart, onEnd }) {
  let active = false;
  let lastPointer = -1e9;
  let keyHeld = false;
  const start = () => { if (active) return; active = true; btn.setAttribute('aria-pressed', 'true'); onStart(); };
  const end = () => { if (!active) return; active = false; btn.setAttribute('aria-pressed', 'false'); onEnd(); };
  btn.setAttribute('aria-pressed', 'false');
  /** @param {PointerEvent} e */
  const down = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    lastPointer = performance.now();
    try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    start();
  };
  const upP = () => { lastPointer = performance.now(); end(); };
  /** @param {KeyboardEvent} e */
  const kd = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); keyHeld = true; if (!e.repeat) start(); } };
  /** @param {KeyboardEvent} e */
  const ku = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); end(); } };
  /** @param {MouseEvent} e */
  const click = (e) => {
    e.preventDefault();
    if (keyHeld) { keyHeld = false; return; }
    if (performance.now() - lastPointer < 1000) return;
    if (active) end(); else start(); // screen-reader activation: toggle
  };
  const blur = () => { keyHeld = false; end(); };
  /** @param {Event} e */
  const ctx = (e) => e.preventDefault();
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', upP);
  btn.addEventListener('pointercancel', upP);
  btn.addEventListener('lostpointercapture', upP);
  btn.addEventListener('keydown', kd);
  btn.addEventListener('keyup', ku);
  btn.addEventListener('click', click);
  btn.addEventListener('blur', blur);
  btn.addEventListener('contextmenu', ctx);
  return () => {
    end();
    btn.removeEventListener('pointerdown', down);
    btn.removeEventListener('pointerup', upP);
    btn.removeEventListener('pointercancel', upP);
    btn.removeEventListener('lostpointercapture', upP);
    btn.removeEventListener('keydown', kd);
    btn.removeEventListener('keyup', ku);
    btn.removeEventListener('click', click);
    btn.removeEventListener('blur', blur);
    btn.removeEventListener('contextmenu', ctx);
  };
}

let uid = 0;
/** @param {string} prefix */
export function uniqueId(prefix) {
  uid += 1;
  return `${prefix}-${uid}`;
}

/**
 * Labelled range with a live value read-out.
 * @param {{label: string, min: number, max: number, step: number, value: number, format: (v: number) => string,
 *   onInput: (v: number) => void, testId?: string}} o
 */
export function rangeField({ label, min, max, step, value, format, onInput, testId }) {
  const id = uniqueId('va-range');
  const out = h('output', { class: 'va-viewer__value', for: id }, format(value));
  const input = h('input', {
    id, type: 'range', class: 'va-range', min: String(min), max: String(max), step: String(step), value: String(value),
    'aria-valuetext': format(value), 'data-testid': testId,
  });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    input.setAttribute('aria-valuetext', format(v));
    onInput(v);
  });
  const el = h('div', { class: 'va-viewer__field' },
    h('div', { class: 'va-viewer__field-head' }, h('label', { for: id, class: 'va-label' }, label), out),
    input);
  return {
    el, input,
    /** @param {number} v */
    set(v) { input.value = String(v); out.textContent = format(v); input.setAttribute('aria-valuetext', format(v)); },
  };
}

/**
 * Share a file with the OS share sheet when possible, otherwise trigger a download.
 * @param {Blob} blob @param {string} filename @param {{title?: string, doc: Document, trackUrl?: (url: string) => void}} o
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareOrDownload(blob, filename, { title, doc, trackUrl }) {
  const nav = /** @type {any} */ (doc.defaultView?.navigator || navigator);
  const file = new File([blob], filename, { type: blob.type });
  if (typeof nav.canShare === 'function' && typeof nav.share === 'function') {
    let can = false;
    try { can = nav.canShare({ files: [file] }); } catch { can = false; }
    if (can) {
      try { await nav.share({ files: [file], title }); return 'shared'; } catch (err) {
        if (/** @type {any} */ (err)?.name === 'AbortError') return 'cancelled';
        // NotAllowedError (activation expired) etc.: fall back to a download.
      }
    }
  }
  const url = URL.createObjectURL(blob);
  trackUrl?.(url);
  const a = h('a', { href: url, download: filename, rel: 'noopener', hidden: true });
  (doc.body || doc.documentElement).appendChild(a);
  a.click();
  a.remove();
  return 'downloaded';
}
