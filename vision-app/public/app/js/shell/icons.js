// @ts-check
/**
 * Minimal inline SVG icon set (24x24, stroke = currentColor). Decorative by default (aria-hidden).
 * Icons with class "va-icon--dir" point in the reading direction and are mirrored in RTL by app.css.
 */
import { s } from '../core/dom.js';

/** @typedef {[string, Record<string, string>]} Shape */

/** @type {Record<string, Shape[]>} */
const ICONS = {
  home: [['path', { d: 'M3 10.5 12 3l9 7.5' }], ['path', { d: 'M5.5 9v11.5h5v-6h3v6h5V9' }]],
  results: [['path', { d: 'M3 20.5h18' }], ['path', { d: 'M6 17V11' }], ['path', { d: 'M11 17V5' }], ['path', { d: 'M16 17v-4' }], ['path', { d: 'M20 17V8' }]],
  phone: [['rect', { x: '6', y: '2.5', width: '12', height: '19', rx: '2.5' }], ['path', { d: 'M10.5 18.5h3' }], ['path', { d: 'M9 7h6M9 10.5h4' }]],
  user: [['circle', { cx: '12', cy: '8', r: '4' }], ['path', { d: 'M4 21c0-4.4 3.6-7.5 8-7.5s8 3.1 8 7.5' }]],
  users: [['circle', { cx: '9', cy: '8', r: '3.5' }], ['path', { d: 'M2.5 20.5c0-3.8 2.9-6.5 6.5-6.5s6.5 2.7 6.5 6.5' }], ['circle', { cx: '17', cy: '9', r: '2.5' }], ['path', { d: 'M17.5 14c2.4.3 4 2.4 4 5' }]],
  settings: [['path', { d: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1' }], ['circle', { cx: '15', cy: '6', r: '2' }], ['circle', { cx: '9', cy: '12', r: '2' }], ['circle', { cx: '17', cy: '18', r: '2' }]],
  help: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6' }], ['path', { d: 'M12 17h.01' }]],
  back: [['path', { d: 'M14.5 5.5 8 12l6.5 6.5' }]],
  forward: [['path', { d: 'M9.5 5.5 16 12l-6.5 6.5' }]],
  close: [['path', { d: 'M6 6l12 12M18 6 6 18' }]],
  photo: [['rect', { x: '3', y: '4.5', width: '18', height: '15', rx: '2.5' }], ['circle', { cx: '8.5', cy: '9.5', r: '1.6' }], ['path', { d: 'M20.5 15.5 15.5 10.5 6 19.5' }]],
  video: [['rect', { x: '2.5', y: '6', width: '13.5', height: '12', rx: '2.5' }], ['path', { d: 'M16 10.5 21.5 7.5v9L16 13.5' }]],
  magnifier: [['circle', { cx: '10.5', cy: '10.5', r: '6.5' }], ['path', { d: 'M20.5 20.5 15.5 15.5' }], ['path', { d: 'M10.5 7.8v5.4M7.8 10.5h5.4' }]],
  reader: [['path', { d: 'M12 6.5C10.3 5 7.7 4.5 3.5 4.5v14c4.2 0 6.8.5 8.5 2 1.7-1.5 4.3-2 8.5-2v-14c-4.2 0-6.8.5-8.5 2z' }], ['path', { d: 'M12 6.5v14' }]],
  retest: [['path', { d: 'M20 12a8 8 0 1 1-2.4-5.7' }], ['path', { d: 'M20 4v5h-5' }]],
  lock: [['rect', { x: '5', y: '10.5', width: '14', height: '10', rx: '2.5' }], ['path', { d: 'M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3' }]],
  shield: [['path', { d: 'M12 3 19.5 6v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z' }], ['path', { d: 'm9 12 2.2 2.2L15.5 10' }]],
  check: [['path', { d: 'm5 12.5 4.5 4.5L19 7.5' }]],
  eye: [['path', { d: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z' }], ['circle', { cx: '12', cy: '12', r: '3' }]],
  glasses: [['circle', { cx: '6.5', cy: '14', r: '3.8' }], ['circle', { cx: '17.5', cy: '14', r: '3.8' }], ['path', { d: 'M10.3 13.2c1.1-.8 2.3-.8 3.4 0' }], ['path', { d: 'M2.7 13 4 7.5M21.3 13 20 7.5' }]],
  eyeOff: [['path', { d: 'M3 3l18 18' }], ['path', { d: 'M10.6 5.6A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3 3.8' }], ['path', { d: 'M6.6 6.8C3.7 8.5 2 12 2 12s3.6 6.5 10 6.5c1.8 0 3.4-.5 4.8-1.3' }], ['path', { d: 'M9.9 9.9a3 3 0 0 0 4.2 4.2' }]],
  print: [['path', { d: 'M6.5 9V3.5h11V9' }], ['rect', { x: '3', y: '9', width: '18', height: '8', rx: '2' }], ['rect', { x: '7', y: '14', width: '10', height: '6.5', rx: '1' }]],
  trash: [['path', { d: 'M4 7h16' }], ['path', { d: 'M9.5 7V4.5h5V7' }], ['path', { d: 'M6 7l1 13h10l1-13' }], ['path', { d: 'M10 11v5.5M14 11v5.5' }]],
  edit: [['path', { d: 'M4 20h4L19 9l-4-4L4 16z' }], ['path', { d: 'm13.5 6.5 4 4' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  warning: [['path', { d: 'M12 3.5 2.5 20h19z' }], ['path', { d: 'M12 10v4.5M12 17.2h.01' }]],
  info: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'M12 11v5.5M12 7.8h.01' }]],
  star: [['path', { d: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z' }]],
  logout: [['path', { d: 'M14 4h4.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H14' }], ['path', { d: 'M9.5 8 5.5 12l4 4M5.5 12H15' }]],
  globe: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'M3 12h18' }], ['path', { d: 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z' }]],
  sparkle: [['path', { d: 'M12 3v4M12 17v4M3 12h4M17 12h4' }], ['path', { d: 'm6.3 6.3 2.2 2.2M15.5 15.5l2.2 2.2M6.3 17.7l2.2-2.2M15.5 8.5l2.2-2.2' }]],
  receipt: [['path', { d: 'M6 3h12v18l-3-2-3 2-3-2-3 2z' }], ['path', { d: 'M9 8h6M9 12h6M9 16h3' }]],
  clock: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'M12 7v5l3.5 2' }]],
  logo: [['path', { d: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z' }], ['circle', { cx: '12', cy: '12', r: '3.2' }], ['path', { d: 'M12 2.5v1.5M12 20v1.5' }]],
};

const DIRECTIONAL = new Set(['back', 'forward', 'logout']);

/**
 * @param {string} name
 * @param {{size?: number, label?: string, className?: string}} [opts]  label => role=img with a text alternative
 * @returns {SVGElement}
 */
export function icon(name, { size = 24, label, className = '' } = {}) {
  const shapes = ICONS[name] || ICONS.info;
  const cls = ['va-icon', `va-icon--${name}`, DIRECTIONAL.has(name) ? 'va-icon--dir' : '', className].filter(Boolean).join(' ');
  const attrs = {
    viewBox: '0 0 24 24', width: String(size), height: String(size), fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', focusable: 'false', class: cls,
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
  };
  return s('svg', attrs, ...shapes.map(([tag, a]) => s(tag, a)));
}
