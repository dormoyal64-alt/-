// @ts-check
/**
 * Small deterministic PRNG so procedures can be reproduced in unit tests (inject `rng`).
 * Pure module, no DOM.
 */

/**
 * mulberry32 — fast 32-bit seeded generator returning floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @typedef {'up'|'down'|'left'|'right'} Direction */

/** @type {readonly Direction[]} */
export const DIRECTIONS = Object.freeze(['up', 'right', 'down', 'left']);

/**
 * Random orientation for a 4AFC trial. Never returns the same orientation three times in a row, so a
 * perfectly-seeing observer can never trigger the "5 identical responses in a row" reliability flag.
 * @param {() => number} rng
 * @param {Direction[]} history  previously presented orientations (most recent last)
 * @returns {Direction}
 */
export function nextOrientation(rng, history) {
  const n = history.length;
  const banned = n >= 2 && history[n - 1] === history[n - 2] ? history[n - 1] : null;
  const pool = banned ? DIRECTIONS.filter((d) => d !== banned) : DIRECTIONS;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/**
 * Pick a uniformly random direction (used to turn a "not sure" answer into a forced-choice guess).
 * @param {() => number} rng
 * @returns {Direction}
 */
export function randomDirection(rng) {
  return DIRECTIONS[Math.min(3, Math.floor(rng() * 4))];
}
