// @ts-check
import { SlidingWindowLimiter } from './rate-limit.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * The app's rate limits. Per-IP limits are multiplied by config.rateLimitIpScale (20 in NODE_ENV=test
 * so e2e suites sharing 127.0.0.1 are not throttled; always 1 in production). Per-account limits are
 * never scaled.
 * @param {{rateLimitIpScale: number}} config
 * @param {() => number} now
 */
export function createLimiters(config, now) {
  const s = config.rateLimitIpScale;
  const mk = (/** @type {number} */ windowMs, /** @type {number} */ max) => new SlidingWindowLimiter({ windowMs, max, now });
  return {
    loginIpEmail: mk(15 * MIN, 10),
    loginIp: mk(15 * MIN, 50 * s),
    registerIp: mk(HOUR, 10 * s),
    resetIpEmail: mk(HOUR, 5),
    resetIp: mk(HOUR, 20 * s),
    resetConfirmIp: mk(15 * MIN, 20 * s),
    deleteUser: mk(15 * MIN, 10),
    checkoutUser: mk(HOUR, 30),
  };
}

/** @typedef {ReturnType<typeof createLimiters>} Limiters */
