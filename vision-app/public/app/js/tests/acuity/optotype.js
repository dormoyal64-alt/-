// @ts-check
/**
 * Tumbling-E geometry (vision-science.md §1.3 rule 2, §3.3). Pure: returns rectangles in device px,
 * drawing is done by the caller. Sizes are never snapped; only the letter's top-left corner is snapped
 * to whole device pixels (§1.3 rule 4). Orientation names the side the E opens towards (the direction
 * the three bars point): 'right' is the normal letter E. Absolute screen directions, never mirrored.
 */
import { SURROUND } from './acuity-math.js';

/** @typedef {import('./random.js').Direction} Direction */
/** @typedef {{x: number, y: number, w: number, h: number}} Rect */

/**
 * Rectangles forming a Tumbling E whose top-left corner is (x0, y0), stroke `s` (letter = 5s).
 * @param {number} x0 @param {number} y0 @param {number} s @param {Direction} orientation
 * @returns {Rect[]}
 */
export function tumblingERects(x0, y0, s, orientation) {
  const L = 5 * s;
  switch (orientation) {
    case 'right': // spine left, bars point right
      return [{ x: x0, y: y0, w: s, h: L }, { x: x0, y: y0, w: L, h: s }, { x: x0, y: y0 + 2 * s, w: L, h: s }, { x: x0, y: y0 + 4 * s, w: L, h: s }];
    case 'left':
      return [{ x: x0 + 4 * s, y: y0, w: s, h: L }, { x: x0, y: y0, w: L, h: s }, { x: x0, y: y0 + 2 * s, w: L, h: s }, { x: x0, y: y0 + 4 * s, w: L, h: s }];
    case 'down': // spine on top, bars point down
      return [{ x: x0, y: y0, w: L, h: s }, { x: x0, y: y0, w: s, h: L }, { x: x0 + 2 * s, y: y0, w: s, h: L }, { x: x0 + 4 * s, y: y0, w: s, h: L }];
    case 'up':
      return [{ x: x0, y: y0 + 4 * s, w: L, h: s }, { x: x0, y: y0, w: s, h: L }, { x: x0 + 2 * s, y: y0, w: s, h: L }, { x: x0 + 4 * s, y: y0, w: s, h: L }];
    default:
      throw new Error(`bad orientation ${orientation}`);
  }
}

/**
 * Four surround bars (crowding box) around a letter at (x0, y0) with stroke s: thickness 1 stroke,
 * length 5 strokes, edge-to-edge gap 2.5 strokes.
 * @param {number} x0 @param {number} y0 @param {number} s
 * @returns {Rect[]}
 */
export function surroundRects(x0, y0, s) {
  const L = 5 * s;
  const g = SURROUND.gap * s;
  const t = SURROUND.thickness * s;
  const len = SURROUND.length * s;
  return [
    { x: x0, y: y0 - g - t, w: len, h: t },   // top
    { x: x0, y: y0 + L + g, w: len, h: t },   // bottom
    { x: x0 - g - t, y: y0, w: t, h: len },   // left
    { x: x0 + L + g, y: y0, w: t, h: len },   // right
  ];
}

/**
 * Layout of a centred Tumbling E (optionally with surround bars) in a canvas of devW × devH device px.
 * The letter's top-left corner is snapped to whole device pixels; the stroke is kept exact.
 * @param {{devW: number, devH: number, strokeDevPx: number, orientation: Direction, surround?: boolean, snapStroke?: boolean}} o
 * @returns {{x0: number, y0: number, stroke: number, rects: Rect[]}}
 */
export function layoutTumblingE({ devW, devH, strokeDevPx, orientation, surround = true, snapStroke = false }) {
  const stroke = snapStroke ? Math.max(1, Math.round(strokeDevPx)) : strokeDevPx;
  const x0 = Math.round(devW / 2 - 2.5 * stroke);
  const y0 = Math.round(devH / 2 - 2.5 * stroke);
  const rects = tumblingERects(x0, y0, stroke, orientation);
  if (surround) rects.push(...surroundRects(x0, y0, stroke));
  return { x0, y0, stroke, rects };
}

/**
 * Fill rectangles as one path (overlapping rectangles do not double-darken anti-aliased edges).
 * @param {CanvasRenderingContext2D} g @param {Rect[]} rects @param {string} color
 */
export function fillRects(g, rects, color) {
  g.beginPath();
  for (const r of rects) g.rect(r.x, r.y, r.w, r.h);
  g.fillStyle = color;
  g.fill('nonzero');
}
