// @ts-check
/**
 * In-memory sliding-window-log rate limiter. Single process only (fine for one Node instance;
 * use a shared store if the app is ever scaled horizontally).
 */
import { HttpError } from './errors.js';

export class SlidingWindowLimiter {
  /**
   * @param {{windowMs: number, max: number, now?: () => number, maxKeys?: number}} opts
   */
  constructor({ windowMs, max, now = Date.now, maxKeys = 50_000 }) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now;
    this.maxKeys = maxKeys;
    /** @type {Map<string, number[]>} */
    this.hits = new Map();
  }

  /** @param {string} key @param {number} t */
  #prune(key, t) {
    const arr = this.hits.get(key);
    if (!arr) return [];
    const cutoff = t - this.windowMs;
    let i = 0;
    while (i < arr.length && arr[i] <= cutoff) i++;
    if (i) arr.splice(0, i);
    if (!arr.length) this.hits.delete(key);
    return arr;
  }

  /**
   * Checks without recording.
   * @param {string} key
   * @returns {{allowed: boolean, remaining: number, retryAfterMs: number}}
   */
  peek(key) {
    const t = this.now();
    const arr = this.#prune(key, t);
    if (arr.length >= this.max) {
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, arr[arr.length - this.max] + this.windowMs - t) };
    }
    return { allowed: true, remaining: this.max - arr.length, retryAfterMs: 0 };
  }

  /**
   * Records one hit if allowed.
   * @param {string} key
   * @returns {{allowed: boolean, remaining: number, retryAfterMs: number}}
   */
  hit(key) {
    const res = this.peek(key);
    if (!res.allowed) return res;
    const t = this.now();
    let arr = this.hits.get(key);
    if (!arr) {
      if (this.hits.size >= this.maxKeys) {
        const oldest = this.hits.keys().next().value; // Map keeps insertion order
        if (oldest !== undefined) this.hits.delete(oldest);
      }
      arr = [];
      this.hits.set(key, arr);
    }
    arr.push(t);
    return { allowed: true, remaining: this.max - arr.length, retryAfterMs: 0 };
  }

  /** @param {string} key */
  reset(key) {
    this.hits.delete(key);
  }

  /** Drops keys whose hits are all outside the window. */
  sweep() {
    const t = this.now();
    for (const key of [...this.hits.keys()]) this.#prune(key, t);
  }
}

/**
 * Records a hit on every (limiter, key) pair; throws 429 with Retry-After if any is exhausted.
 * Checks all pairs first so a rejected request does not consume budget elsewhere.
 * @param {Array<[SlidingWindowLimiter, string]>} checks
 */
export function enforceLimits(checks) {
  let retryAfterMs = 0;
  for (const [limiter, key] of checks) {
    const r = limiter.peek(key);
    if (!r.allowed) retryAfterMs = Math.max(retryAfterMs, r.retryAfterMs);
  }
  if (retryAfterMs > 0) {
    const secs = String(Math.ceil(retryAfterMs / 1000));
    throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.', { 'Retry-After': secs });
  }
  for (const [limiter, key] of checks) limiter.hit(key);
}
