// @ts-check
/**
 * Pure view geometry shared by the renderer (shader uniforms, 2D fallback) and the viewers (gestures).
 *
 * View model: {zoom, panX, panY}
 *   - The source is first fitted into the output ('contain' by default, or 'cover'), then magnified by `zoom`.
 *   - panX/panY move the view centre in SOURCE UV units (fraction of source width/height) away from the
 *     image centre: the source point shown at the output centre is (0.5 + panX, 0.5 + panY).
 * Units of dw/dh only need to be consistent (CSS px in viewers, device px in the renderer): the mapping
 * is scale-invariant.
 */

/** @typedef {{zoom: number, panX: number, panY: number}} View */
/** @typedef {'contain'|'cover'} Fit */

/** @returns {View} */
export function identityView() {
  return { zoom: 1, panX: 0, panY: 0 };
}

/**
 * Output units per source pixel at zoom 1.
 * @param {number} sw @param {number} sh @param {number} dw @param {number} dh @param {Fit} [fit]
 */
export function fitScale(sw, sh, dw, dh, fit = 'contain') {
  if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return 0;
  return fit === 'cover' ? Math.max(dw / sw, dh / sh) : Math.min(dw / sw, dh / sh);
}

/**
 * Output units per source pixel at the given view.
 * @param {View} view @param {number} sw @param {number} sh @param {number} dw @param {number} dh @param {Fit} [fit]
 */
export function viewScale(view, sw, sh, dw, dh, fit = 'contain') {
  return fitScale(sw, sh, dw, dh, fit) * view.zoom;
}

/**
 * Source UV (0..1 inside the image, top-left origin) shown at output point (x, y).
 * @param {number} x @param {number} y
 * @param {View} view @param {number} sw @param {number} sh @param {number} dw @param {number} dh @param {Fit} [fit]
 * @returns {[number, number]}
 */
export function sourceUvAt(x, y, view, sw, sh, dw, dh, fit = 'contain') {
  const sc = viewScale(view, sw, sh, dw, dh, fit);
  if (!sc) return [0.5, 0.5];
  return [0.5 + view.panX + (x - dw / 2) / (sc * sw), 0.5 + view.panY + (y - dh / 2) / (sc * sh)];
}

/**
 * Output point where source UV (u, v) is displayed.
 * @param {number} u @param {number} v
 * @param {View} view @param {number} sw @param {number} sh @param {number} dw @param {number} dh @param {Fit} [fit]
 * @returns {[number, number]}
 */
export function outputPointOfUv(u, v, view, sw, sh, dw, dh, fit = 'contain') {
  const sc = viewScale(view, sw, sh, dw, dh, fit);
  return [dw / 2 + (u - 0.5 - view.panX) * sc * sw, dh / 2 + (v - 0.5 - view.panY) * sc * sh];
}

/**
 * Clamp zoom to [minZoom, maxZoom] and pan so the image never leaves the viewport more than necessary:
 * when the (zoomed) image is larger than the viewport along an axis, its edges cannot move inside the
 * viewport; when it is smaller, it is centred along that axis.
 * @param {View} view @param {number} sw @param {number} sh @param {number} dw @param {number} dh
 * @param {{minZoom?: number, maxZoom?: number, fit?: Fit}} [opts]
 * @returns {View}
 */
export function clampView(view, sw, sh, dw, dh, { minZoom = 1, maxZoom = 10, fit = 'contain' } = {}) {
  const zoom = Math.min(maxZoom, Math.max(minZoom, Number.isFinite(view.zoom) ? view.zoom : 1));
  const sc = fitScale(sw, sh, dw, dh, fit) * zoom;
  if (!sc) return { zoom, panX: 0, panY: 0 };
  const halfU = dw / 2 / (sc * sw); // half of the visible extent, in source UV
  const halfV = dh / 2 / (sc * sh);
  const limU = Math.max(0, 0.5 - halfU);
  const limV = Math.max(0, 0.5 - halfV);
  const px = Number.isFinite(view.panX) ? view.panX : 0;
  const py = Number.isFinite(view.panY) ? view.panY : 0;
  return { zoom, panX: Math.min(limU, Math.max(-limU, px)), panY: Math.min(limV, Math.max(-limV, py)) };
}

/**
 * Change zoom keeping the source point under output point (ax, ay) fixed (pinch / wheel / double-tap).
 * The result is NOT clamped; pass it through clampView.
 * @param {View} view @param {number} newZoom @param {number} ax @param {number} ay
 * @param {number} sw @param {number} sh @param {number} dw @param {number} dh @param {Fit} [fit]
 * @returns {View}
 */
export function zoomAtPoint(view, newZoom, ax, ay, sw, sh, dw, dh, fit = 'contain') {
  const [u, v] = sourceUvAt(ax, ay, view, sw, sh, dw, dh, fit);
  const sc = fitScale(sw, sh, dw, dh, fit) * newZoom;
  if (!sc) return { ...view, zoom: newZoom };
  return {
    zoom: newZoom,
    panX: u - 0.5 - (ax - dw / 2) / (sc * sw),
    panY: v - 0.5 - (ay - dh / 2) / (sc * sh),
  };
}

/**
 * Drag the image by (dx, dy) output units (content follows the finger). Not clamped.
 * @param {View} view @param {number} dx @param {number} dy
 * @param {number} sw @param {number} sh @param {number} dw @param {number} dh @param {Fit} [fit]
 * @returns {View}
 */
export function panByPixels(view, dx, dy, sw, sh, dw, dh, fit = 'contain') {
  const sc = viewScale(view, sw, sh, dw, dh, fit);
  if (!sc) return { ...view };
  return { zoom: view.zoom, panX: view.panX - dx / (sc * sw), panY: view.panY - dy / (sc * sh) };
}

/**
 * Destination rectangle of the whole source image in output units (for drawImage in the 2D path).
 * @param {View} view @param {number} sw @param {number} sh @param {number} dw @param {number} dh @param {Fit} [fit]
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function imageRect(view, sw, sh, dw, dh, fit = 'contain') {
  const sc = viewScale(view, sw, sh, dw, dh, fit);
  const [x, y] = outputPointOfUv(0, 0, view, sw, sh, dw, dh, fit);
  return { x, y, w: sw * sc, h: sh * sc };
}

/**
 * Only same-origin, blob: and data: URLs may be used as renderer sources (no CORS-dependent pixels).
 * @param {string} url
 * @param {string} pageOrigin  e.g. location.origin
 */
export function isSafeMediaUrl(url, pageOrigin) {
  if (!url) return false;
  let u;
  try { u = new URL(url, pageOrigin); } catch { return false; }
  if (u.protocol === 'blob:') {
    // blob:https://origin/uuid — must belong to this origin
    try { return new URL(u.pathname).origin === pageOrigin; } catch { return false; }
  }
  if (u.protocol === 'data:') return true;
  return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === pageOrigin;
}
