// @ts-check
/**
 * Pure entitlement logic (no DOM): access end dates, trial countdown, offline cache validity.
 * Storage is injected so everything here is unit-testable under node.
 */

/** @typedef {'trial'|'active'|'canceled'|'past_due'|'expired'} EntitlementStatus */
/** @typedef {'monthly'|'quarterly'|'yearly'} PlanId */

/**
 * API shape (docs/ARCHITECTURE.md).
 * @typedef {Object} Entitlement
 * @property {EntitlementStatus} status
 * @property {PlanId|null} plan
 * @property {string|null} trialEndsAt
 * @property {string|null} currentPeriodEnd
 * @property {boolean} cancelAtPeriodEnd
 * @property {number|null} daysLeft
 * @property {boolean} hasAccess
 */

/** @typedef {{id: string, email: string, lang?: 'he'|'en', createdAt?: string}} User */

/**
 * What we keep on the device so the app keeps working offline.
 * @typedef {Object} EntitlementCache
 * @property {1} v
 * @property {string} savedAt
 * @property {User} user
 * @property {Entitlement} entitlement
 */

export const CACHE_KEY = 'va.account.v1';
export const DAY_MS = 86_400_000;
/** A cache written more than this far in the "future" means the device clock was moved; don't trust it. */
const CLOCK_SKEW_MS = 10 * 60_000;

/** @param {string|null|undefined} iso @returns {number|null} */
function parseTime(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The moment current access ends (trial end for trials, paid period end otherwise).
 * @param {Entitlement|null|undefined} e
 * @returns {number|null} ms epoch
 */
export function accessEndsAt(e) {
  if (!e) return null;
  return e.status === 'trial'
    ? parseTime(e.trialEndsAt) ?? parseTime(e.currentPeriodEnd)
    : parseTime(e.currentPeriodEnd) ?? parseTime(e.trialEndsAt);
}

/**
 * Whole days remaining until `endMs` (rounded up; 0 when past).
 * @param {number} endMs @param {number} now
 */
export function daysUntil(endMs, now) {
  return Math.max(0, Math.ceil((endMs - now) / DAY_MS));
}

/**
 * Days left in the free trial, or null when not in a trial.
 * @param {Entitlement|null|undefined} e @param {number} now
 * @returns {number|null}
 */
export function trialDaysLeft(e, now) {
  if (!e || e.status !== 'trial') return null;
  const end = parseTime(e.trialEndsAt);
  if (end === null) return typeof e.daysLeft === 'number' ? Math.max(0, e.daysLeft) : null;
  return daysUntil(end, now);
}

/**
 * Home-screen trial banner: visible during the last `windowDays` days of the free month.
 * @param {Entitlement|null|undefined} e @param {number} now @param {number} [windowDays]
 */
export function shouldShowTrialBanner(e, now, windowDays = 7) {
  const d = trialDaysLeft(e, now);
  return d !== null && !!e?.hasAccess && d <= windowDays;
}

/**
 * Is a cached entitlement good enough to let the user in while offline?
 * Requires hasAccess and that the trial / paid period has not ended yet.
 * @param {EntitlementCache|null|undefined} cache @param {number} now
 */
export function isCacheUsable(cache, now) {
  if (!cache || cache.v !== 1 || !cache.user || !cache.entitlement) return false;
  if (cache.entitlement.hasAccess !== true) return false;
  const saved = parseTime(cache.savedAt);
  if (saved === null || saved > now + CLOCK_SKEW_MS) return false;
  const end = accessEndsAt(cache.entitlement);
  return end !== null && now < end;
}

/**
 * Effective access for the current session.
 * @param {Entitlement|null|undefined} e
 * @param {'network'|'cache'|null} source
 * @param {number} now
 */
export function hasEffectiveAccess(e, source, now) {
  if (!e || e.hasAccess !== true) return false;
  if (source === 'cache') {
    const end = accessEndsAt(e);
    return end !== null && now < end;
  }
  return true;
}

/**
 * @param {Pick<Storage, 'getItem'>|null|undefined} storage
 * @returns {EntitlementCache|null}
 */
export function readCache(storage) {
  try {
    const raw = storage?.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.v === 1 ? data : null;
  } catch {
    return null;
  }
}

/**
 * @param {Pick<Storage, 'setItem'>|null|undefined} storage
 * @param {{user: User, entitlement: Entitlement}} session
 * @param {number} now
 */
export function writeCache(storage, { user, entitlement }, now) {
  /** @type {EntitlementCache} */
  const data = {
    v: 1,
    savedAt: new Date(now).toISOString(),
    user: { id: user.id, email: user.email, lang: user.lang, createdAt: user.createdAt },
    entitlement,
  };
  try { storage?.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* quota / private mode */ }
  return data;
}

/** @param {Pick<Storage, 'removeItem'>|null|undefined} storage */
export function clearCache(storage) {
  try { storage?.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

/**
 * Which subscription actions make sense for this entitlement.
 * @param {Entitlement|null|undefined} e @param {number} now
 */
export function subscriptionActions(e, now) {
  const end = accessEndsAt(e);
  const periodOpen = end !== null && now < end;
  const paid = !!e && (e.status === 'active' || e.status === 'past_due' || e.status === 'canceled');
  return {
    canCancel: !!e && paid && e.status !== 'canceled' && !e.cancelAtPeriodEnd,
    canResume: !!e && paid && e.cancelAtPeriodEnd === true && periodOpen,
    canSubscribe: !e || e.status === 'trial' || e.status === 'expired' || (e.status === 'canceled' && !periodOpen),
    needsPaymentFix: !!e && e.status === 'past_due',
  };
}

export const REFUND_WINDOW_DAYS = 14;

/**
 * Is the user still within 14 days of their FIRST payment (cancel now => full refund)?
 * Derived from the invoice list until the entitlement carries this itself.
 * @param {Array<{status?: string, issuedAt?: string}>|null|undefined} invoices @param {number} now
 */
export function refundWindowOpen(invoices, now) {
  const paid = (invoices || [])
    .filter((i) => i && (i.status === undefined || i.status === 'paid'))
    .map((i) => parseTime(i.issuedAt))
    .filter((ms) => ms !== null);
  if (!paid.length) return false;
  const first = Math.min(...paid);
  return now >= first && now - first <= REFUND_WINDOW_DAYS * DAY_MS;
}
