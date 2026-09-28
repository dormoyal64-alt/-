// @ts-check
/**
 * Pure entitlement logic: who may use the app right now, and why.
 * All instants are absolute (epoch ms / Date / ISO string with offset); day counts are computed on
 * elapsed time, never on local calendar dates, so results do not depend on the server time zone.
 */

export const DAY_MS = 86_400_000;
/** Access kept after a failed renewal payment while the provider retries. */
export const PAST_DUE_GRACE_DAYS = 3;

/**
 * @typedef {'trial'|'active'|'canceled'|'past_due'|'expired'} EntitlementStatus
 * @typedef {object} Entitlement
 * @property {EntitlementStatus} status
 * @property {null|'monthly'|'quarterly'|'yearly'} plan
 * @property {string|null} trialEndsAt        ISO 8601 (UTC)
 * @property {string|null} currentPeriodEnd   ISO 8601 (UTC)
 * @property {boolean} cancelAtPeriodEnd
 * @property {number} daysLeft                whole days of access left, rounded up (0 when no access)
 * @property {boolean} hasAccess
 */

/**
 * @typedef {object} EntitlementUser
 * @property {number|string|Date|null} [trialEndsAt]
 * @property {number|string|Date|null} [trial_ends_at]
 */
/**
 * @typedef {object} EntitlementSubscription
 * @property {string} [plan]
 * @property {'active'|'canceled'|'past_due'|'expired'|string} status
 * @property {number|string|Date|null} [currentPeriodEnd]
 * @property {number|string|Date|null} [current_period_end]
 * @property {boolean|number} [cancelAtPeriodEnd]
 * @property {boolean|number} [cancel_at_period_end]
 */

/** @param {unknown} v @returns {number|null} */
export function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** @param {number|null} ms */
const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());
/** @param {number} untilMs @param {number} nowMs */
const daysUntil = (untilMs, nowMs) => (untilMs > nowMs ? Math.ceil((untilMs - nowMs) / DAY_MS) : 0);
/** @param {unknown} p @returns {null|'monthly'|'quarterly'|'yearly'} */
const planOf = (p) => (p === 'monthly' || p === 'quarterly' || p === 'yearly' ? p : null);

/**
 * @param {EntitlementUser|null} user
 * @param {EntitlementSubscription|null} subscription  the user's most recent subscription, if any
 * @param {number|string|Date} [now]
 * @returns {Entitlement}
 */
export function computeEntitlement(user, subscription, now = Date.now()) {
  const nowMs = toMs(now) ?? Date.now();
  const trialEnd = toMs(user?.trialEndsAt ?? user?.trial_ends_at ?? null);

  if (subscription && subscription.status && subscription.status !== 'expired') {
    const periodEnd = toMs(subscription.currentPeriodEnd ?? subscription.current_period_end ?? null);
    const cancelFlag = Boolean(subscription.cancelAtPeriodEnd ?? subscription.cancel_at_period_end ?? false);
    const plan = planOf(subscription.plan);
    const base = { plan, trialEndsAt: iso(trialEnd), currentPeriodEnd: iso(periodEnd) };

    if (periodEnd !== null) {
      const graceEnd = periodEnd + PAST_DUE_GRACE_DAYS * DAY_MS;
      const canceled = subscription.status === 'canceled' || (subscription.status === 'active' && cancelFlag);
      if (canceled) {
        // Paid until the end of the period, will not renew.
        if (nowMs < periodEnd) {
          return { status: 'canceled', ...base, cancelAtPeriodEnd: true, daysLeft: daysUntil(periodEnd, nowMs), hasAccess: true };
        }
      } else if (subscription.status === 'active') {
        if (nowMs < periodEnd) {
          return { status: 'active', ...base, cancelAtPeriodEnd: false, daysLeft: daysUntil(periodEnd, nowMs), hasAccess: true };
        }
        // Period over but no renewal/failure reported yet (late webhook): same grace as past_due.
        if (nowMs < graceEnd) {
          return { status: 'past_due', ...base, cancelAtPeriodEnd: false, daysLeft: daysUntil(graceEnd, nowMs), hasAccess: true };
        }
      } else if (subscription.status === 'past_due') {
        if (nowMs < graceEnd) {
          return { status: 'past_due', ...base, cancelAtPeriodEnd: false, daysLeft: daysUntil(graceEnd, nowMs), hasAccess: true };
        }
      }
    }
    // Subscription no longer grants access: fall through (an unused trial may still apply).
  }

  if (trialEnd !== null && nowMs < trialEnd) {
    return {
      status: 'trial', plan: null, trialEndsAt: iso(trialEnd), currentPeriodEnd: null,
      cancelAtPeriodEnd: false, daysLeft: daysUntil(trialEnd, nowMs), hasAccess: true,
    };
  }

  const lastPeriodEnd = subscription ? toMs(subscription.currentPeriodEnd ?? subscription.current_period_end ?? null) : null;
  return {
    status: 'expired', plan: null, trialEndsAt: iso(trialEnd), currentPeriodEnd: iso(lastPeriodEnd),
    cancelAtPeriodEnd: false, daysLeft: 0, hasAccess: false,
  };
}

/**
 * True when the user currently holds a paid subscription that still grants access
 * (used to refuse a second checkout with 409 ALREADY_SUBSCRIBED).
 * @param {Entitlement} e
 */
export function hasPaidAccess(e) {
  return e.hasAccess && (e.status === 'active' || e.status === 'canceled' || e.status === 'past_due');
}
