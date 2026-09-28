// @ts-check
/**
 * Billing state machine. Provider adapters translate provider payloads into normalized events
 * (see providers/README.md); this module is the only place that changes subscription state.
 */
import { computeEntitlement, hasPaidAccess, toMs } from './entitlement.js';
import { findPlan, isPlanId } from './plans.js';
import { HttpError } from '../http/errors.js';
import { isUniqueViolation } from '../db.js';
import { newId } from '../auth/tokens.js';

export const EVENT_TYPES = Object.freeze([
  'subscription.activated', 'subscription.renewed', 'subscription.canceled', 'subscription.resumed',
  'payment.failed', 'subscription.expired', 'invoice.issued',
]);

/**
 * @typedef {object} NormalizedInvoice
 * @property {string} providerInvoiceId
 * @property {number} amount        minor units
 * @property {string} currency
 * @property {string} [status]      default "paid"
 * @property {string|null} [url]    link to the legal invoice/receipt document at the provider
 * @property {number|string} [issuedAt]
 * @property {string} [plan]
 */
/**
 * @typedef {object} NormalizedEvent
 * @property {string} eventId
 * @property {typeof EVENT_TYPES[number]} type
 * @property {string} [userId]
 * @property {string} [providerSubscriptionId]
 * @property {string} [providerCustomerId]
 * @property {string} [plan]
 * @property {number|string} [currentPeriodEnd]
 * @property {number|string} [occurredAt]
 * @property {string} [checkoutRef]   provider_ref of the checkout that produced this subscription
 * @property {NormalizedInvoice} [invoice]
 */

/**
 * @typedef {object} SubscriptionRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} provider
 * @property {string|null} provider_customer_id
 * @property {string} provider_subscription_id
 * @property {string} plan
 * @property {'active'|'canceled'|'past_due'|'expired'} status
 * @property {number|null} current_period_end
 * @property {number} cancel_at_period_end
 * @property {number|null} last_event_at
 * @property {number} created_at
 * @property {number} updated_at
 */

/**
 * @param {{db: import('../db.js').Db, config: import('../config.js').Config,
 *   providers: Map<string, import('./providers/index.js').PaymentProvider>,
 *   provider: import('./providers/index.js').PaymentProvider,
 *   now: () => number, logger: {info: Function, warn: Function, error: Function},
 *   audit: import('../audit.js').Audit}} deps
 */
export function createBillingService({ db, config, providers, provider, now, logger, audit }) {
  /** @param {string} userId @returns {SubscriptionRow|null} */
  function currentSubscription(userId) {
    return db.one('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', userId) ?? null;
  }

  /** @param {{id: string, trial_ends_at: number}} user */
  function entitlementFor(user) {
    return computeEntitlement({ trialEndsAt: user.trial_ends_at }, currentSubscription(user.id), now());
  }

  /** @param {string} providerId */
  function adapterFor(providerId) {
    const a = providers.get(providerId);
    if (!a) throw new HttpError(502, 'PROVIDER_UNAVAILABLE', `Payment provider "${providerId}" is not configured`);
    return a;
  }

  /**
   * @param {unknown} err
   * @param {string} what
   * @returns {never}
   */
  function providerFailure(err, what) {
    if (err instanceof HttpError) throw err;
    logger.error(`[billing] provider ${what} failed:`, err instanceof Error ? err.message : err);
    throw new HttpError(502, 'PROVIDER_ERROR', 'The payment provider could not complete the request. Please try again.');
  }

  /**
   * @param {{id: string, email: string, lang: string, trial_ends_at: number}} user
   * @param {unknown} planId
   * @param {{successUrl: string, cancelUrl: string, baseUrl: string}} urls
   */
  async function createCheckout(user, planId, urls) {
    if (!isPlanId(planId)) throw new HttpError(400, 'INVALID_PLAN', 'Unknown plan');
    const plan = /** @type {import('./plans.js').Plan} */ (findPlan(config.plans, planId));
    const ent = entitlementFor(user);
    if (hasPaidAccess(ent)) throw new HttpError(409, 'ALREADY_SUBSCRIBED', 'You already have an active subscription');

    const checkoutId = newId();
    const t = now();
    db.run('INSERT INTO checkout_sessions (id, user_id, provider, plan, provider_ref, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
      checkoutId, user.id, provider.id, plan.id, 'pending', t, t);
    let result;
    try {
      result = await provider.createCheckout({
        user: { id: user.id, email: user.email, lang: user.lang },
        plan, checkoutId, successUrl: urls.successUrl, cancelUrl: urls.cancelUrl, baseUrl: urls.baseUrl,
        trialEndsAt: user.trial_ends_at > t ? user.trial_ends_at : null,
      });
    } catch (err) {
      db.run("UPDATE checkout_sessions SET status = 'canceled', updated_at = ? WHERE id = ?", now(), checkoutId);
      providerFailure(err, 'createCheckout');
    }
    db.run('UPDATE checkout_sessions SET provider_ref = ?, updated_at = ? WHERE id = ?', result.providerRef, now(), checkoutId);
    audit(user.id, 'checkout.created', { plan: plan.id, provider: provider.id, checkoutId });
    return { url: result.url, checkoutId, providerRef: result.providerRef };
  }

  /** One-request cancellation (at period end). Idempotent. */
  async function cancel(/** @type {{id: string, trial_ends_at: number}} */ user) {
    const sub = currentSubscription(user.id);
    const ent = entitlementFor(user);
    if (sub && ent.status === 'canceled') return ent;
    if (!sub || !(ent.status === 'active' || ent.status === 'past_due')) {
      throw new HttpError(409, 'NO_ACTIVE_SUBSCRIPTION', 'There is no active subscription to cancel');
    }
    try {
      await adapterFor(sub.provider).cancelSubscription(sub, { immediate: false });
    } catch (err) { providerFailure(err, 'cancelSubscription'); }
    db.run("UPDATE subscriptions SET status = 'canceled', cancel_at_period_end = 1, updated_at = ? WHERE id = ?", now(), sub.id);
    audit(user.id, 'subscription.cancel_requested', { subscriptionId: sub.id, periodEnd: sub.current_period_end });
    return entitlementFor(user);
  }

  /** Undo a pending cancellation while the paid period is still running. Idempotent. */
  async function resume(/** @type {{id: string, trial_ends_at: number}} */ user) {
    const sub = currentSubscription(user.id);
    const ent = entitlementFor(user);
    if (sub && ent.status === 'active') return ent;
    if (!sub || ent.status !== 'canceled') {
      throw new HttpError(409, 'NOT_RESUMABLE', 'There is no canceled subscription that can be resumed');
    }
    try {
      await adapterFor(sub.provider).resumeSubscription(sub);
    } catch (err) {
      if (err && /** @type {any} */ (err).code === 'NOT_SUPPORTED') {
        throw new HttpError(409, 'NOT_RESUMABLE', 'This subscription cannot be resumed; please subscribe again when it ends');
      }
      providerFailure(err, 'resumeSubscription');
    }
    db.run("UPDATE subscriptions SET status = 'active', cancel_at_period_end = 0, updated_at = ? WHERE id = ?", now(), sub.id);
    audit(user.id, 'subscription.resumed_by_user', { subscriptionId: sub.id });
    return entitlementFor(user);
  }

  /**
   * Stops future charges before an account is deleted. Throws 502 if the provider refuses
   * (the account is then NOT deleted, so the user is never billed without an account).
   * @param {{id: string}} user
   */
  async function cancelAllForDeletion(user) {
    /** @type {SubscriptionRow[]} */
    const subs = db.all("SELECT * FROM subscriptions WHERE user_id = ? AND status IN ('active', 'past_due')", user.id);
    for (const sub of subs) {
      try {
        await adapterFor(sub.provider).cancelSubscription(sub, { immediate: true });
      } catch (err) { providerFailure(err, 'cancelSubscription(immediate)'); }
      db.run("UPDATE subscriptions SET status = 'expired', cancel_at_period_end = 1, updated_at = ? WHERE id = ?", now(), sub.id);
    }
    return subs.length;
  }

  /** @param {string} userId */
  function listInvoices(userId) {
    return db.all('SELECT id, plan, amount, currency, status, url, issued_at FROM invoices WHERE user_id = ? ORDER BY issued_at DESC', userId)
      .map((r) => ({ id: r.id, plan: r.plan, amount: r.amount, currency: r.currency, status: r.status, url: r.url, issuedAt: new Date(r.issued_at).toISOString() }));
  }

  /**
   * Applies events in order. Each event runs in its own transaction together with the insert of
   * its id into webhook_events, so a duplicate delivery is a no-op and a crash never half-applies.
   * @param {string} providerId
   * @param {NormalizedEvent[]} events
   */
  function applyEvents(providerId, events) {
    let processed = 0;
    let duplicates = 0;
    let ignored = 0;
    for (const ev of events) {
      const outcome = db.tx(() => applyOne(providerId, ev));
      if (outcome === 'duplicate') duplicates++;
      else if (outcome === 'ignored') ignored++;
      else processed++;
    }
    return { processed, duplicates, ignored };
  }

  /**
   * @param {string} providerId
   * @param {NormalizedEvent} ev
   * @returns {'applied'|'duplicate'|'ignored'}
   */
  function applyOne(providerId, ev) {
    const t = now();
    /** @type {SubscriptionRow|null} */
    let sub = ev.providerSubscriptionId
      ? db.one('SELECT * FROM subscriptions WHERE provider = ? AND provider_subscription_id = ?', providerId, ev.providerSubscriptionId) ?? null
      : null;
    const userId = sub?.user_id ?? ev.userId ?? null;
    const userExists = userId ? Boolean(db.one('SELECT 1 AS x FROM users WHERE id = ?', userId)) : false;

    try {
      db.run('INSERT INTO webhook_events (provider, event_id, received_at, type, user_id, payload) VALUES (?, ?, ?, ?, ?, ?)',
        providerId, ev.eventId, t, ev.type, userExists ? userId : null, JSON.stringify(ev));
    } catch (err) {
      if (isUniqueViolation(err)) return 'duplicate';
      throw err;
    }
    if (!userExists) {
      logger.warn(`[billing] ${providerId} event ${ev.eventId} (${ev.type}) references no known user; ignored`);
      return 'ignored';
    }

    const occurredAt = toMs(ev.occurredAt) ?? t;
    const periodEnd = toMs(ev.currentPeriodEnd);
    if (ev.invoice) insertInvoice(providerId, userId, ev.invoice, ev.plan ?? sub?.plan ?? null, t);
    if (ev.type === 'invoice.issued') {
      if (!ev.invoice) return 'ignored';
      audit(userId, 'invoice.issued', { provider: providerId, amount: ev.invoice.amount });
      return 'applied';
    }

    // Out-of-order delivery: never let an older event overwrite newer state.
    if (sub && sub.last_event_at !== null && occurredAt < sub.last_event_at) {
      logger.info(`[billing] stale ${ev.type} event ${ev.eventId} ignored`);
      return 'ignored';
    }

    const createFrom = ev.type === 'subscription.activated' || ev.type === 'subscription.renewed';
    if (!sub) {
      if (!createFrom || !ev.providerSubscriptionId || !isPlanId(ev.plan)) {
        logger.warn(`[billing] ${ev.type} for unknown subscription ${ev.providerSubscriptionId ?? '(none)'}; ignored`);
        return 'ignored';
      }
      const id = newId();
      db.run(`INSERT INTO subscriptions (id, user_id, provider, provider_customer_id, provider_subscription_id, plan, status,
                current_period_end, cancel_at_period_end, last_event_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?)`,
      id, userId, providerId, ev.providerCustomerId ?? null, ev.providerSubscriptionId, ev.plan, periodEnd, occurredAt, t, t);
      sub = db.one('SELECT * FROM subscriptions WHERE id = ?', id);
    } else {
      /** @type {Partial<SubscriptionRow>} */
      const patch = { last_event_at: occurredAt, updated_at: t };
      if (periodEnd !== null) patch.current_period_end = periodEnd;
      if (ev.providerCustomerId) patch.provider_customer_id = ev.providerCustomerId;
      if (isPlanId(ev.plan)) patch.plan = ev.plan;
      switch (ev.type) {
        case 'subscription.activated':
        case 'subscription.renewed':
        case 'subscription.resumed':
          patch.status = 'active'; patch.cancel_at_period_end = 0; break;
        case 'subscription.canceled':
          patch.status = 'canceled'; patch.cancel_at_period_end = 1; break;
        case 'payment.failed':
          if (sub.status !== 'expired' && sub.status !== 'canceled') patch.status = 'past_due';
          break;
        case 'subscription.expired':
          patch.status = 'expired'; break;
        default:
          return 'ignored';
      }
      const cols = Object.keys(patch);
      db.raw.prepare(`UPDATE subscriptions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...cols.map((c) => /** @type {any} */ (patch)[c]), sub.id);
    }
    if (ev.checkoutRef) {
      db.run("UPDATE checkout_sessions SET status = 'completed', updated_at = ? WHERE provider = ? AND provider_ref = ? AND user_id = ?",
        t, providerId, ev.checkoutRef, userId);
    }
    audit(userId, ev.type, { provider: providerId, plan: ev.plan ?? sub?.plan, periodEnd });
    return 'applied';
  }

  /**
   * @param {string} providerId @param {string} userId @param {NormalizedInvoice} inv @param {string|null} plan @param {number} t
   */
  function insertInvoice(providerId, userId, inv, plan, t) {
    if (!inv.providerInvoiceId || !Number.isInteger(inv.amount)) return;
    try {
      db.run(`INSERT INTO invoices (id, user_id, provider, provider_invoice_id, plan, amount, currency, status, url, issued_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(), userId, providerId, inv.providerInvoiceId, inv.plan ?? plan, inv.amount, (inv.currency || config.currency).toUpperCase(),
      inv.status || 'paid', inv.url ?? null, toMs(inv.issuedAt) ?? t);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }

  /**
   * Removes a user and everything personal, keeping legally required invoice records anonymised.
   * @param {string} userId
   */
  function purgeUser(userId) {
    db.tx(() => {
      db.run('UPDATE invoices SET user_id = NULL WHERE user_id = ?', userId);
      db.run('UPDATE audit_log SET user_id = NULL WHERE user_id = ?', userId);
      db.run('UPDATE webhook_events SET user_id = NULL, payload = NULL WHERE user_id = ?', userId);
      db.run('DELETE FROM users WHERE id = ?', userId); // cascades: sessions, resets, subscriptions, checkouts
      audit(null, 'account.deleted');
    });
  }

  /** Periodic cleanup. */
  function maintenance() {
    const t = now();
    db.run("UPDATE checkout_sessions SET status = 'expired', updated_at = ? WHERE status = 'pending' AND created_at < ?", t, t - 24 * 3600_000);
    db.run('UPDATE webhook_events SET payload = NULL WHERE payload IS NOT NULL AND received_at < ?', t - 90 * 86_400_000);
  }

  return {
    currentSubscription, entitlementFor, createCheckout, cancel, resume, cancelAllForDeletion,
    listInvoices, applyEvents, purgeUser, maintenance,
  };
}

/** @typedef {ReturnType<typeof createBillingService>} BillingService */
