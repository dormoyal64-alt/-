// @ts-check
/**
 * Tiny observable store for app-wide state (language, session, connectivity).
 */

/** @typedef {import('../core/types.js').Lang} Lang */
/** @typedef {import('../account/entitlement.js').User} User */
/** @typedef {import('../account/entitlement.js').Entitlement} Entitlement */

/**
 * @typedef {Object} AppState
 * @property {Lang} lang
 * @property {User|null} user
 * @property {Entitlement|null} entitlement
 * @property {'network'|'cache'|null} source   Where the entitlement came from.
 * @property {number|null} checkedAt          ms epoch of the last successful GET /api/me.
 * @property {boolean} online
 * @property {boolean} sessionUnknown         True when we could not reach the server and have no usable cache.
 * @property {boolean} updateReady            A new service-worker version is waiting.
 */

/**
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
  let state = initial;
  /** @type {Set<(next: T, prev: T) => void>} */
  const subs = new Set();
  return {
    /** @returns {T} */
    get: () => state,
    /** @param {Partial<T>} patch */
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      for (const fn of [...subs]) fn(state, prev);
    },
    /** @param {(next: T, prev: T) => void} fn @returns {() => void} */
    subscribe(fn) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
  };
}

/** @typedef {ReturnType<typeof createStore<AppState>>} AppStore */
