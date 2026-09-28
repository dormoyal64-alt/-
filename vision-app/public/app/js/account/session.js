// @ts-check
/**
 * Session / entitlement state: the start-up auth gate (GET /api/me) with an on-device entitlement cache so the
 * app keeps working offline while a trial or paid period is still running.
 */
import { api } from './api.js';
import { readCache, writeCache, clearCache, isCacheUsable, hasEffectiveAccess } from './entitlement.js';
import { listProfiles } from '../core/storage.js';

/** @typedef {import('./entitlement.js').Entitlement} Entitlement */
/** @typedef {import('./entitlement.js').User} User */
/** @typedef {import('../shell/store.js').AppStore} AppStore */

/** @returns {Storage|null} */
function ls() {
  try { return window.localStorage; } catch { return null; }
}

/**
 * @param {AppStore} store
 * @param {{now?: () => number}} [opts]
 */
export function createSession(store, { now = Date.now } = {}) {
  /** @param {{user: User, entitlement: Entitlement}} res */
  function setAuth(res) {
    if (!res?.user || !res?.entitlement) return;
    writeCache(ls(), res, now());
    store.set({ user: res.user, entitlement: res.entitlement, source: 'network', checkedAt: now(), sessionUnknown: false });
  }

  /** @param {Entitlement} entitlement */
  function setEntitlement(entitlement) {
    const { user } = store.get();
    if (!user || !entitlement) return;
    setAuth({ user, entitlement });
  }

  function clear() {
    clearCache(ls());
    store.set({ user: null, entitlement: null, source: null, checkedAt: null, sessionUnknown: false });
  }

  /** Fall back to the on-device cache after a failed /api/me. */
  function useCache() {
    const cache = readCache(ls());
    if (cache && isCacheUsable(cache, now())) {
      store.set({ user: cache.user, entitlement: cache.entitlement, source: 'cache', sessionUnknown: false });
      return true;
    }
    if (cache) {
      // Known user, but the cached access has run out: they land on the paywall, which asks to reconnect.
      store.set({ user: cache.user, entitlement: cache.entitlement, source: 'cache', sessionUnknown: true });
      return false;
    }
    store.set({ user: null, entitlement: null, source: null, sessionUnknown: true });
    return false;
  }

  /**
   * Start-up gate and later refreshes.
   * @returns {Promise<'ok'|'anonymous'|'offline'>}
   */
  async function refresh() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      useCache();
      return 'offline';
    }
    try {
      const res = await api.me();
      setAuth(res);
      return 'ok';
    } catch (err) {
      if (/** @type {any} */ (err)?.status === 401) { clear(); return 'anonymous'; }
      useCache();
      return 'offline';
    }
  }

  /** @returns {import('../shell/guards.js').GuardState} */
  function guardState() {
    const s = store.get();
    return {
      loggedIn: !!s.user,
      hasAccess: hasEffectiveAccess(s.entitlement, s.source, now()),
      hasProfile: listProfiles().length > 0,
    };
  }

  return { setAuth, setEntitlement, clear, refresh, init: refresh, guardState };
}

/** @typedef {ReturnType<typeof createSession>} Session */
