// @ts-check
/**
 * Shared DOM helpers for the calibration views (screens, choices, size matcher, illustrations).
 * Styles are applied through CSSOM style objects only (CSP-safe); layout uses logical properties (RTL-safe).
 */
import { h, s, clear } from '../core/dom.js';
import { screen as uiScreen, button, focusTitle } from '../core/ui.js';
import { CARD_WIDTH_MM, CARD_HEIGHT_MM, CARD_CORNER_RADIUS_MM, RULER_LENGTH_MM, clamp } from './calibration-math.js';

/**
 * @typedef {Object} ChoiceOption
 * @property {string} label
 * @property {string} value
 * @property {'primary'|'secondary'|'ghost'|'danger'} [variant]
 * @property {string} [testId]
 */

/**
 * Render a standard screen and wait for one of its buttons.
 * @param {HTMLElement} container
 * @param {{title: string, paragraphs?: Array<string|Node>, illustration?: Node|null, options: ChoiceOption[], testId?: string, notice?: {text: string, tone?: 'warning'|'danger'|'success'}|null}} opts
 * @returns {Promise<string>}
 */
export function choose(container, { title, paragraphs = [], illustration = null, options, testId, notice = null }) {
  return new Promise((resolve) => {
    const body = [];
    if (illustration) body.push(h('div', { class: 'va-illustration' }, illustration));
    if (notice) body.push(h('p', { class: `va-notice va-notice--${notice.tone || 'warning'}`, role: 'status' }, notice.text));
    body.push(...paragraphs);
    const actions = options.map((o) => button(o.label, {
      variant: o.variant || 'primary', testId: o.testId, onClick: () => resolve(o.value),
    }));
    show(container, uiScreen({ title, body, actions, testId }));
  });
}

/** Replace the container content and move focus to the title. @param {HTMLElement} container @param {Node} node */
export function show(container, node) {
  clear(container);
  container.appendChild(node);
  focusTitle(container);
}

/**
 * Sticky action bar at the bottom of a screen (keeps controls reachable while a card covers the outline).
 * @param {...(Node|null)} children
 */
export function stickyBar(...children) {
  return h('div', {
    class: 'va-stack',
    style: {
      position: 'sticky', bottom: '0', zIndex: '2', background: 'var(--va-bg)', paddingBlock: '10px',
      paddingBottom: 'calc(10px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--va-border)', gap: '10px',
    },
  }, ...children);
}

/**
 * Numeric distance field in cm.
 * @param {{label: string, value?: number|null, min: number, max: number, testId?: string}} opts
 */
export function cmField({ label, value = null, min, max, testId }) {
  const id = `va-cal-${Math.random().toString(36).slice(2, 9)}`;
  const input = h('input', {
    id, class: 'va-input', type: 'number', inputmode: 'decimal', min: String(min), max: String(max), step: '0.5',
    value: value === null ? '' : String(value), 'data-testid': testId, style: { maxWidth: '12rem' },
  });
  const el = h('div', { class: 'va-field' }, h('label', { class: 'va-label', for: id }, label), input);
  return { el, input, read: () => (input.value.trim() === '' ? NaN : Number(input.value.replace(',', '.'))) };
}

// ---------------------------------------------------------------------------------------------------------------
// Size matcher (card / ruler)
// ---------------------------------------------------------------------------------------------------------------

/**
 * A resizable card outline (ID-1, aspect ratio locked, long side along the viewport's long axis) or a vertical
 * ruler scale, driven by a slider plus ±1 px fine buttons. The value is the CSS px length of the object's
 * reference length (card long side 85.60 mm, or 80 mm of ruler).
 * @param {{kind: 'card'|'ruler', minPx: number, maxPx: number, startPx: number, sliderLabel: string, smallerLabel: string, largerLabel: string}} opts
 */
export function sizeMatcher({ kind, minPx, maxPx, startPx, sliderLabel, smallerLabel, largerLabel }) {
  let value = clamp(Math.round(startPx), minPx, maxPx);
  const figure = kind === 'card' ? cardFigure() : rulerFigure();
  const holder = h('div', {
    'data-testid': 'size-figure', dir: 'ltr',
    style: { display: 'flex', overflow: 'hidden', paddingBlock: '4px' },
  }, figure.el);
  const slider = h('input', {
    type: 'range', class: 'va-range', min: String(minPx), max: String(maxPx), step: '1', value: String(value),
    'aria-label': sliderLabel, 'data-testid': 'size-slider', style: { flex: '1 1 auto', minWidth: '0' },
    on: { input: () => set(Number(slider.value)) },
  });
  const fine = (/** @type {string} */ label, /** @type {string} */ glyph, /** @type {number} */ delta, /** @type {string} */ testId) => h('button', {
    type: 'button', class: 'va-btn va-btn--secondary', 'aria-label': label, 'data-testid': testId,
    style: { minWidth: '48px', minHeight: '48px', padding: '0', fontSize: '1.5rem', flex: '0 0 auto' },
    on: { click: () => set(value + delta) },
  }, glyph);
  const controls = h('div', { class: 'va-row', style: { flexWrap: 'nowrap', gap: '10px' } },
    fine(smallerLabel, '−', -1, 'size-minus'), slider, fine(largerLabel, '+', 1, 'size-plus'));

  /** @param {number} v */
  function set(v) {
    value = clamp(Math.round(v), minPx, maxPx);
    slider.value = String(value);
    slider.setAttribute('aria-valuetext', `${value}`);
    figure.render(value, isLandscapeViewport());
  }
  const onResize = () => figure.render(value, isLandscapeViewport());
  window.addEventListener('resize', onResize);
  set(value);
  return {
    figureEl: holder,
    controlsEl: controls,
    value: () => value,
    set,
    destroy: () => window.removeEventListener('resize', onResize),
  };
}

function isLandscapeViewport() {
  return window.innerWidth > window.innerHeight;
}

/** ID-1 card outline drawn in mm units, scaled so that its long side = value px. */
function cardFigure() {
  const svg = s('svg', { role: 'img', 'aria-hidden': 'true', 'data-testid': 'card-outline', style: { display: 'block', flex: '0 0 auto', marginInline: 'auto', overflow: 'hidden' } });
  return {
    el: svg,
    /** @param {number} longPx @param {boolean} landscape */
    render(longPx, landscape) {
      const shortPx = (longPx * CARD_HEIGHT_MM) / CARD_WIDTH_MM;
      const W = landscape ? CARD_WIDTH_MM : CARD_HEIGHT_MM;
      const H = landscape ? CARD_HEIGHT_MM : CARD_WIDTH_MM;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', String(landscape ? longPx : shortPx));
      svg.setAttribute('height', String(landscape ? shortPx : longPx));
      svg.dataset.longPx = String(longPx);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const r = String(CARD_CORNER_RADIUS_MM);
      const common = { 'vector-effect': 'non-scaling-stroke' };
      // chip + stripe are decorative, placed relative to the card's own long axis
      const chip = landscape ? { x: 8, y: 17, w: 11, h: 8.5 } : { x: 17, y: 8, w: 8.5, h: 11 };
      svg.append(
        s('rect', { x: '0', y: '0', width: String(W), height: String(H), rx: r, ry: r, fill: 'var(--va-surface-2)', stroke: 'none' }),
        s('rect', { x: String(chip.x), y: String(chip.y), width: String(chip.w), height: String(chip.h), rx: '1.5', fill: 'var(--va-accent)', opacity: '0.55' }),
        s('path', { d: landscape ? `M8 ${H - 12} H${W - 8}` : `M${W - 12} 8 V${H - 8}`, stroke: 'var(--va-text-muted)', 'stroke-width': '2', 'stroke-linecap': 'round', opacity: '0.4', ...common }),
        // outline: stroke centred on the exact card edge; the SVG clips the outer half, so the visible edge is exact
        s('rect', { x: '0', y: '0', width: String(W), height: String(H), rx: r, ry: r, fill: 'none', stroke: 'var(--va-primary)', 'stroke-width': '4', ...common }),
        // corner marker: where to put the card's corner
        s('path', { d: `M0 14 V${CARD_CORNER_RADIUS_MM} Q0 0 ${CARD_CORNER_RADIUS_MM} 0 H14`, fill: 'none', stroke: 'var(--va-danger)', 'stroke-width': '8', ...common }),
      );
    },
  };
}

/** Vertical ruler scale (0–8 cm with mm ticks); value = px length of 80 mm. */
function rulerFigure() {
  const PAD_TOP = 4; const PAD_BOTTOM = 4; const WIDTH_MM = 22;
  const svg = s('svg', { role: 'img', 'aria-hidden': 'true', 'data-testid': 'ruler-scale', style: { display: 'block', flex: '0 0 auto', marginInline: 'auto', overflow: 'visible' } });
  const totalMm = RULER_LENGTH_MM + PAD_TOP + PAD_BOTTOM;
  return {
    el: svg,
    /** @param {number} lenPx */
    render(lenPx) {
      const scale = lenPx / RULER_LENGTH_MM;
      svg.setAttribute('viewBox', `0 ${-PAD_TOP} ${WIDTH_MM} ${totalMm}`);
      svg.setAttribute('width', String(WIDTH_MM * scale));
      svg.setAttribute('height', String(totalMm * scale));
      svg.dataset.longPx = String(lenPx);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const ticks = [];
      for (let mm = 0; mm <= RULER_LENGTH_MM; mm++) {
        const len = mm % 10 === 0 ? 10 : mm % 5 === 0 ? 7 : 4;
        ticks.push(`M0 ${mm} H${len}`);
      }
      svg.append(
        s('rect', { x: '0', y: '0', width: String(WIDTH_MM), height: String(RULER_LENGTH_MM), fill: 'var(--va-surface-2)' }),
        s('path', { d: ticks.join(' '), stroke: 'var(--va-text)', 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke', fill: 'none' }),
        s('path', { d: `M0 0 V${RULER_LENGTH_MM}`, stroke: 'var(--va-text)', 'stroke-width': '1.5', 'vector-effect': 'non-scaling-stroke' }),
        ...Array.from({ length: RULER_LENGTH_MM / 10 + 1 }, (_, i) => s('text', {
          x: '12', y: String(i * 10 + 1.2), 'font-size': '3.6', fill: 'var(--va-text)', 'font-family': 'system-ui, sans-serif',
        }, String(i))),
        s('path', { d: `M0 0 H${WIDTH_MM}`, stroke: 'var(--va-danger)', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }),
        s('path', { d: `M0 ${RULER_LENGTH_MM} H${WIDTH_MM}`, stroke: 'var(--va-danger)', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }),
      );
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Illustrations (decorative, aria-hidden). Geometry is absolute (dir=ltr) and never mirrored.
// ---------------------------------------------------------------------------------------------------------------

const ILL = { stroke: 'currentColor', fill: 'none', 'stroke-width': '3', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };

/** Phone (portrait) with a card laid on it, aligned with the outline's corner. */
export function cardIllustration() {
  return s('svg', { viewBox: '0 0 200 170', width: '200', height: '170', 'aria-hidden': 'true', dir: 'ltr' },
    s('rect', { x: '55', y: '6', width: '90', height: '158', rx: '14', ...ILL }),
    s('rect', { x: '68', y: '26', width: '52', height: '82', rx: '4', fill: 'none', stroke: 'var(--va-primary)', 'stroke-width': '2.5', 'stroke-dasharray': '5 4' }),
    s('g', { transform: 'rotate(-8 100 70)' },
      s('rect', { x: '72', y: '34', width: '52', height: '82', rx: '4', fill: 'var(--va-accent)', opacity: '0.85', stroke: 'currentColor', 'stroke-width': '2' }),
      s('rect', { x: '82', y: '44', width: '12', height: '9', rx: '2', fill: '#fff', opacity: '0.8' })),
    s('path', { d: 'M150 60 l14 0 M150 80 l20 0', ...ILL, 'stroke-width': '2.5' }),
    s('path', { d: 'M40 60 l-14 0 M40 80 l-20 0', ...ILL, 'stroke-width': '2.5' }),
  );
}

/** Landscape phone with the fixation square, the red dot and its path; an eye with the other one closed. */
export function blindSpotIllustration(/** @type {'left'|'right'} */ eye) {
  const left = eye === 'left';
  const fixX = left ? 172 : 28;
  const dotX = left ? 92 : 108;
  const arrow = left ? 'M150 62 L112 62 M120 55 L112 62 L120 69' : 'M50 62 L88 62 M80 55 L88 62 L80 69';
  // face seen from the front: user's right eye on the viewer's left
  const closedX = left ? 78 : 122; const openX = left ? 122 : 78;
  return s('svg', { viewBox: '0 0 200 190', width: '220', height: '209', 'aria-hidden': 'true', dir: 'ltr' },
    s('rect', { x: '8', y: '20', width: '184', height: '86', rx: '14', ...ILL }),
    s('rect', { x: '18', y: '28', width: '164', height: '70', rx: '4', fill: '#fff', stroke: 'none' }),
    s('rect', { x: String(fixX - 5), y: '57', width: '10', height: '10', fill: '#000' }),
    s('circle', { cx: String(dotX), cy: '62', r: '6', fill: '#e00000' }),
    s('path', { d: arrow, fill: 'none', stroke: '#e00000', 'stroke-width': '2.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    s('ellipse', { cx: '100', cy: '150', rx: '44', ry: '34', class: 'va-ill-face' }),
    s('path', { d: `M${closedX - 10} 146 Q${closedX} 152 ${closedX + 10} 146`, fill: 'none', stroke: 'currentColor', 'stroke-width': '3', 'stroke-linecap': 'round' }),
    s('ellipse', { cx: String(openX), cy: '146', rx: '9', ry: '6', class: 'va-ill-eye' }),
    s('circle', { cx: String(openX), cy: '146', r: '3.2', class: 'va-ill-pupil' }),
    s('path', { d: 'M90 168 Q100 174 110 168', class: 'va-ill-mouth' }),
  );
}

/** Portrait phone → landscape phone. */
export function rotateIllustration() {
  return s('svg', { viewBox: '0 0 220 130', width: '220', height: '130', 'aria-hidden': 'true', dir: 'ltr' },
    s('rect', { x: '14', y: '14', width: '56', height: '100', rx: '10', ...ILL }),
    s('path', { d: 'M88 64 Q110 34 132 64 M124 58 L132 64 L136 55', ...ILL, stroke: 'var(--va-primary)' }),
    s('rect', { x: '110', y: '66', width: '100', height: '56', rx: '10', ...ILL }),
  );
}

/** Phone moving towards (near) or away from (far) an eye. @param {'near'|'far'} dir */
export function focusIllustration(dir) {
  const arrow = dir === 'near' ? 'M150 70 L96 70 M106 62 L96 70 L106 78' : 'M96 70 L150 70 M140 62 L150 70 L140 78';
  return s('svg', { viewBox: '0 0 220 140', width: '220', height: '140', 'aria-hidden': 'true', dir: 'ltr' },
    s('path', { d: 'M20 70 Q45 40 70 70 Q45 100 20 70 Z', class: 'va-ill-eye' }),
    s('circle', { cx: '45', cy: '70', r: '9', class: 'va-ill-pupil' }),
    s('path', { d: arrow, ...ILL, stroke: 'var(--va-primary)' }),
    s('rect', { x: '160', y: '22', width: '44', height: '96', rx: '8', ...ILL }),
    s('path', { d: 'M168 60 H196 M168 72 H190', stroke: 'currentColor', 'stroke-width': '3', 'stroke-linecap': 'round' }),
  );
}

/** @param {number} mm @returns {number} centimetres rounded to 0.5 */
export function mmToCm(mm) {
  return Math.round(mm / 5) / 2;
}
