// @ts-check
/**
 * Device-resolution stimulus canvas (vision-science.md §1.3 rule 1). DOM module shared by the acuity,
 * contrast and line-sharpness views.
 * - Backing store in device pixels; exact integer size from ResizeObserver 'device-pixel-content-box'
 *   where supported (Chromium/Firefox), else round(css·dpr) plus a sub-pixel translate so the canvas
 *   sits on whole device pixels (Safari).
 * - Drawing callbacks receive an identity-transform 2D context and the backing size in device px.
 */
import { hiDpiCanvas } from '../../core/ui.js';

/**
 * @typedef {Object} StimulusCanvas
 * @property {HTMLCanvasElement} canvas
 * @property {() => number} devicePxPerCssPx   actual backing-store pixels per CSS px
 * @property {(fn: (g: CanvasRenderingContext2D, devW: number, devH: number) => void) => void} draw
 *           Clear to white and draw; the callback is kept and replayed if the backing store changes.
 * @property {() => void} destroy
 */

/**
 * @param {number} cssW @param {number} cssH
 * @returns {StimulusCanvas}
 */
export function createStimulusCanvas(cssW, cssH) {
  const hd = hiDpiCanvas(cssW, cssH);
  const { canvas, ctx: g } = hd;
  canvas.setAttribute('aria-hidden', 'true');
  /** @type {null|((g: CanvasRenderingContext2D, devW: number, devH: number) => void)} */
  let last = null;
  let exact = false;

  const paint = () => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (last) last(g, canvas.width, canvas.height);
  };

  /** Safari fallback: nudge the canvas so its top-left corner lands on a whole device pixel. */
  const snapPosition = () => {
    if (exact) return;
    canvas.style.transform = '';
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const fx = (Math.round(rect.left * dpr) - rect.left * dpr) / dpr;
    const fy = (Math.round(rect.top * dpr) - rect.top * dpr) / dpr;
    if (Math.abs(fx) > 1e-3 || Math.abs(fy) > 1e-3) canvas.style.transform = `translate(${fx}px, ${fy}px)`;
  };

  /** @type {ResizeObserver|null} */
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const dprNow = window.devicePixelRatio || 1;
      const box = entry.devicePixelContentBoxSize?.[0];
      // Trust the exact device-pixel box only when it agrees with css·dpr (emulated DPRs can report CSS px).
      if (box && Math.abs(box.inlineSize - entry.contentRect.width * dprNow) <= 1.5 && Math.abs(box.blockSize - entry.contentRect.height * dprNow) <= 1.5) {
        exact = true;
        if (canvas.width !== box.inlineSize || canvas.height !== box.blockSize) {
          canvas.width = box.inlineSize;
          canvas.height = box.blockSize;
        }
      } else {
        exact = false;
        const w = Math.round(entry.contentRect.width * dprNow);
        const hgt = Math.round(entry.contentRect.height * dprNow);
        if (w > 0 && hgt > 0 && (canvas.width !== w || canvas.height !== hgt)) { canvas.width = w; canvas.height = hgt; }
        snapPosition();
      }
      paint();
    });
    try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(canvas); }
  }

  return {
    canvas,
    devicePxPerCssPx: () => {
      const cssWidth = parseFloat(canvas.style.width) || cssW;
      return canvas.width / cssWidth;
    },
    draw(fn) { last = fn; paint(); },
    destroy() { ro?.disconnect(); last = null; },
  };
}
