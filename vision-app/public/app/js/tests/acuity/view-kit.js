// @ts-check
/**
 * Small DOM/runtime helpers shared by the acuity, contrast, reading and line-sharpness views.
 */
import { abortError, delay } from '../../core/dom.js';

/** Fallback viewing distance when no calibration exists (vision-science.md item 9 / §3.1 examples). */
export const DEFAULT_DISTANCE_MM = 400;

/** Distance must stay within ±10 % of the target during tests (item 9). */
export const DISTANCE_TOLERANCE = 0.1;

/**
 * A one-slot answer channel: `next()` returns a promise for the next pushed answer; rejects on abort.
 * Answers pushed while nobody is waiting are ignored (prevents double taps from leaking into the next trial).
 * @template T
 * @param {AbortSignal|undefined} signal
 */
export function createAnswerChannel(signal) {
  /** @type {null|{resolve: (v: T) => void, reject: (e: unknown) => void}} */
  let waiter = null;
  const onAbort = () => { const w = waiter; waiter = null; w?.reject(abortError()); };
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    /** @returns {Promise<T>} */
    next() {
      if (signal?.aborted) return Promise.reject(abortError());
      return new Promise((resolve, reject) => { waiter = { resolve, reject }; });
    },
    /** @param {T} value */
    push(value) { const w = waiter; waiter = null; w?.resolve(value); },
    get waiting() { return waiter !== null; },
    dispose() { signal?.removeEventListener('abort', onAbort); waiter = null; },
  };
}

/**
 * Viewing-distance source: live camera distance when available (ctx.distanceTracker.current() non-null),
 * otherwise the calibrated distance.
 * @param {import('../../core/types.js').TestContext} ctx
 */
export function createDistanceSource(ctx) {
  const target = ctx.distance?.distanceMm || DEFAULT_DISTANCE_MM;
  const tracker = ctx.distanceTracker || null;
  const api = {
    target,
    live: !!tracker,
    /** Current eye-to-screen distance in mm. */
    current() {
      const v = tracker ? tracker.current() : null;
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : target;
    },
    /**
     * 'closer' / 'farther' when a live distance is outside ±10 % of the target, else null.
     * @param {number} d
     * @returns {'closer'|'farther'|null}
     */
    status(d) {
      if (!tracker || tracker.current() === null) return null;
      if (d > target * (1 + DISTANCE_TOLERANCE)) return 'closer';
      if (d < target * (1 - DISTANCE_TOLERANCE)) return 'farther';
      return null;
    },
    /**
     * If the live distance is out of tolerance, report it through `onHint` and wait (up to `maxWaitMs`)
     * for the user to adjust. Returns the distance to use and whether the trial was blanked.
     * @param {{signal?: AbortSignal, onHint: (s: 'closer'|'farther'|null) => void, maxWaitMs?: number}} o
     * @returns {Promise<{distanceMm: number, blanked: boolean}>}
     */
    async settle({ signal, onHint, maxWaitMs = 4000 }) {
      let d = api.current();
      let s = api.status(d);
      if (!s) { onHint(null); return { distanceMm: d, blanked: false }; }
      const until = performance.now() + maxWaitMs;
      while (s && performance.now() < until) {
        onHint(s);
        await delay(200, signal);
        d = api.current();
        s = api.status(d);
      }
      onHint(null);
      return { distanceMm: d, blanked: true };
    },
  };
  return api;
}

/**
 * Size of a square stimulus area that fits the container width and leaves room for the response controls.
 * @param {HTMLElement} container @param {{reserveHeight: number, min?: number, max?: number}} o
 */
export function squareStimulusSize(container, { reserveHeight, min = 180, max = 440 }) {
  const width = (container.clientWidth || window.innerWidth) - 32;
  const height = (window.innerHeight || 700) - reserveHeight;
  return Math.round(Math.max(min, Math.min(max, width, height)));
}

/** @returns {boolean} */
export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
