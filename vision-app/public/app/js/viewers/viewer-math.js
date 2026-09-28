// @ts-check
/**
 * Pure helpers for the viewers (no DOM): time formatting, camera zoom split, camera error classification,
 * magnifier colour presets, file names.
 */
import { sanitizeParams, clamp } from '../render/filter-math.js';

/** @typedef {import('../render/filter-math.js').SanitizedParams} SanitizedParams */
/** @typedef {'profile'|'contrast'|'inverted'|'yellow'} MagnifierMode */

export const MAGNIFIER_MODES = /** @type {const} */ (['profile', 'contrast', 'inverted', 'yellow']);
export const MAGNIFIER_MIN_ZOOM = 1;
export const MAGNIFIER_MAX_ZOOM = 10;

/**
 * 0 -> "0:00", 75 -> "1:15", 3725 -> "1:02:05".
 * @param {number} sec
 */
export function formatTime(sec) {
  const t = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const s = t % 60;
  const m = Math.floor(t / 60) % 60;
  const hrs = Math.floor(t / 3600);
  const ss = String(s).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Split a requested total magnification between the camera's own zoom (MediaTrack `zoom` capability,
 * better resolution) and digital zoom in the renderer. Capability values are treated as ratios to cap.min
 * (Android reports 1..8; UVC webcams e.g. 100..500).
 * @param {number} total  requested magnification (>= 1)
 * @param {{min: number, max: number, step?: number}|null|undefined} cap
 * @returns {{track: number|null, trackRatio: number, digital: number}}
 */
export function splitZoom(total, cap) {
  const z = Math.max(1, Number.isFinite(total) ? total : 1);
  if (!cap || !(cap.min > 0) || !(cap.max > cap.min)) return { track: null, trackRatio: 1, digital: z };
  let track = clamp(cap.min * z, cap.min, cap.max);
  if (cap.step && cap.step > 0) track = clamp(cap.min + Math.round((track - cap.min) / cap.step) * cap.step, cap.min, cap.max);
  const trackRatio = track / cap.min;
  return { track, trackRatio, digital: Math.max(1, z / trackRatio) };
}

/**
 * @param {unknown} err  from getUserMedia
 * @param {boolean} [secure]  window.isSecureContext
 * @returns {'denied'|'nocamera'|'busy'|'insecure'|'other'}
 */
export function classifyCameraError(err, secure = true) {
  if (!secure) return 'insecure';
  const name = /** @type {any} */ (err)?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'nocamera';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  if (name === 'NoApiError') return 'insecure';
  return 'other';
}

/**
 * Classic low-vision magnifier colour modes. Zoom is handled by the magnifier itself (params.zoom = 1).
 *   profile   — the user's media parameters
 *   contrast  — grey-scale, strong contrast, mild sharpening (dark print on light paper stays dark on light)
 *   inverted  — same, reversed polarity (light on dark)
 *   yellow    — reversed polarity tinted yellow: yellow print on black
 * @param {MagnifierMode} mode
 * @param {import('../core/types.js').FilterParams|null|undefined} profileMedia
 * @returns {SanitizedParams}
 */
export function magnifierPreset(mode, profileMedia) {
  const hiContrast = { saturation: 0, contrast: 2.2, brightness: 1, sharpenAmount: 0.6, sharpenSigmaPx: 1.5, zoom: 1 };
  switch (mode) {
    case 'contrast': return sanitizeParams({ ...hiContrast, invert: false });
    case 'inverted': return sanitizeParams({ ...hiContrast, invert: true });
    case 'yellow': return sanitizeParams({ ...hiContrast, invert: true, tint: [1, 1, 0] });
    default: return sanitizeParams({ ...(profileMedia || {}), zoom: 1 });
  }
}

/**
 * Safe download name stem from a user file name: "IMG 0001.HEIC" -> "IMG-0001".
 * @param {string|undefined|null} name
 * @param {string} [fallback]
 */
export function fileStem(name, fallback = 'image') {
  const stem = String(name || '').replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return stem || fallback;
}
