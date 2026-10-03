// @ts-check
/**
 * Billing state machine. Provider adapters translate provider payloads into normalized events
 * (see providers/README.md); this module is the only place that changes subscription state.
 */
import { computeEntitlement, hasPaidAccess, toMs, DAY_MS } from './entitlement.js';
import { findPlan, isPlanId, addMonthsUtc, formatPrice } from './plans.js';
import { resolveRegion, routeProvider, renewalFor } from './pricing.js';
import { HttpError } from '../http/errors.js';
import { isUniqueViolation } from '../db.js';
import { newId } from '../auth/tokens.js';
import { billingEmail } from '../mail/templates.js';

export const EVENT_TYPES = Object.freeze([
  'subscription.activated', 'subscription.renewed', 'subscription.canceled', 'subscription.resumed',
  'payment.failed', 'subscription.expired', 'invoice.issued',
]);

/**
 * @typedef {object} NormalizedInvoice
 * @property {string} providerInvoiceId   provider transaction / invoice id (used for refunds)
 * @property {number} amount        minor units
 * @property {string} currency
 * @property {string} [status]      default "paid"
 * @property {string|null} [url]    link to the legal invoice/receipt document at the provider
 * @property {number|string} [issuedAt]
 * @property {string} [plan]
 */
/**
 * @typedef {object} NormalizedEvent
 * @property {string} eventId       unique per provider (idempotency key)
 * @property {typeof EVENT_TYPES[number]} type
 * @property {string} [userId]
 * @property {string} [providerSubscriptionId]
 * @property {string} [providerCustomerId]
 * @property {string} [providerTokenRef]  opaque saved-card token reference (never card data)
 * @property {string} [plan]
 * @property {number|string} [currentPeriodEnd]   omitted => computed from the checkout / plan length
 * @property {number|string} [occurredAt]
 * @property {string} [checkoutRef]   provider_ref of the checkout that produced this event
 * @property {'auto'|'manual'} [renewal]
 * @property {number} [amount]
 * @property {string} [currency]
 * @property {NormalizedInvoice} [invoice]
 */

/**
 * @typedef {object} SubscriptionRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} provider
 * @property {string|null} provider_customer_id
 * @property {string} provider_subscription_id
 * @property {string|null} provider_token_ref
 * @property {string} plan
 * @property {'active'|'canceled'|'past_due'|'expired'} status
 * @property {number|null} current_period_end
 * @property {number} cancel_at_period_end
 * @property {number|null} last_event_at
 * @property {'IL'|'INTL'} region
 * @property {'auto'|'manual'} renewal
 * @property {number|null} amount
 * @property {string|null} currency
 * @property {number|null} next_attempt_at
 * @property {string|null} ended_reason
 * @property {number} created_at
 * @property {number} updated_at
 */

/**
 * @param {{db: import('../db.js').Db, config: import('../config.js').Config,
 *   providers: Map<string, import('./providers/index.js').PaymentProvider>,
 *   now: () => number, logger: {info: Function, warn: Function, error: Function},
 *   audit: import('../audit.js').Audit, mailer: import('../mail/index.js').Mailer, appBaseUrl: () => string}} deps
 */
export function createBillingService({ db, config, providers, now, logger, audit, mailer, appBaseUrl }) {
  /** @param {string} userId @returns {SubscriptionRow|null} */
  function currentSubscription(userId) {
    return db.one('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', userId) ?? null;
  }

  /** @param {{id: string, trial_ends_at: number}} user */
  function entitlementFor(user) {
    const sub = currentSubscription(user.id);
    const ent = computeEntitlement({ trialEndsAt: user.trial_ends_at }, sub, now(),
      { graceDays: config.pastDueGraceDays, renewWindowDays: config.renewWindowDays });
    let refundEligibleUntil = null;
    if (sub && ent.hasAccess) {
      const charge = refundableCharge(sub);
      if (charge) refundEligibleUntil = new Date(charge.issued_at + config.refundWindowDays * DAY_MS).toISOString();
    }
    return { ...ent, refundEligibleUntil };
  }

  /** @param {string} providerId */
  function adapterFor(providerId) {
    const a = providers.get(providerId);
    if (!a) throw new HttpError(502, 'PROVIDER_UNAVAILABLE', `Payment provider "${providerId}" is not configured`);
    return a;
  }

  /** @param {{country?: unknown, currency?: unknown, geoCountry?: unknown}} hints */
  function route(hints) {
    return routeProvider(resolveRegion(hints, config), providers);
  }

  /** @param {'IL'|'INTL'} region @param {string} planId */
  function regionPlan(region, planId) {
    return /** @type {import('./plans.js').Plan} */ (findPlan(config.pricing[region].plans, planId));
  }

  /** @param {unknown} err @param {string} what @returns {never} */
  function providerFailure(err, what) {
    if (err instanceof HttpError) throw err;
    logger.error(`[billing] provider ${what} failed:`, err instanceof Error ? err.message : err);
    throw new HttpError(502, 'PROVIDER_ERROR', 'The payment provider could not complete the request. Please try again.');
  }

  /**
   * Fire-and-forget billing e-mail (never blocks or fails the request).
   * @param {{email: string, lang: string}} user
   * @param {import('../mail/templates.js').BillingMailKind} kind
   * @param {{planId: string, dateMs: number, amount?: number, currency?: string, reference?: string, region?: string}} p
   */
  function notify(user, kind, p) {
    const lang = user.lang === 'en' ? 'en' : 'he';
    const msg = billingEmail(kind, {
      to: user.email, lang, appName: config.appName, planId: p.planId, dateMs: p.dateMs, reference: p.reference,
      amountText: p.amount !== undefined && p.currency ? formatPrice(p.amount, p.currency, lang) : undefined,
      accountUrl: `${appBaseUrl()}/app/#/account`, timeZone: p.region === 'INTL' ? 'UTC' : 'Asia/Jerusalem',
    });
    return mailer.send(msg).catch((err) => logger.error(`[mail] ${kind} e-mail failed:`, err instanceof Error ? err.message : err));
  }

  /**
   * @param {{id: string, email: string, lang: string, trial_ends_at: number}} user
   * @param {unknown} planId
   * @param {{successUrl: string, cancelUrl: string, baseUrl: string}} urls
   * @param {{country?: unknown, currency?: unknown, geoCountry?: unknown}} [hints]
   * @param {{kind?: 'new'|'renew', subscription?: SubscriptionRow}} [opts]
   */
  async function createCheckout(user, planId, urls, hints = {}, opts = {}) {
    if (!isPlanId(planId)) throw new HttpError(400, 'INVALID_PLAN', 'Unknown plan');
    const kind = opts.kind ?? 'new';
    if (kind === 'new' && hasPaidAccess(entitlementFor(user))) {
      throw new HttpError(409, 'ALREADY_SUBSCRIBED', 'You already have an active subscription');
    }
    const { region, provider } = opts.subscription
      ? { region: opts.subscription.region, provider: adapterFor(opts.subscription.provider) }
      : route(hints);
    const plan = regionPlan(region, planId);
    const renewal = renewalFor(region, plan.id, provider);
    const checkoutId = newId();
    const t = now();
    db.run(`INSERT INTO checkout_sessions (id, user_id, provider, plan, provider_ref, status, created_at, updated_at,
              region, renewal, amount, currency, kind, subscription_id)
            VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    checkoutId, user.id, provider.id, plan.id, t, t, region, renewal, plan.price, plan.currency, kind, opts.subscription?.id ?? null);
    let result;
    try {
      result = await provider.createCheckout({
        user: { id: user.id, email: user.email, lang: user.lang }, plan, amount: plan.price, currency: plan.currency,
        region, renewal, kind, checkoutId, successUrl: urls.successUrl, cancelUrl: urls.cancelUrl,
        callbackUrl: `${urls.baseUrl}/api/webhooks/${provider.id}`, baseUrl: urls.baseUrl,
        trialEndsAt: user.trial_ends_at > t ? user.trial_ends_at : null,
      });
    } catch (err) {
      db.run("UPDATE checkout_sessions SET status = 'canceled', updated_at = ? WHERE id = ?", now(), checkoutId);
      providerFailure(err, 'createCheckout');
    }
    db.run('UPDATE checkout_sessions SET provider_ref = ?, updated_at = ? WHERE id = ?', result.providerRef, now(), checkoutId);
    audit(user.id, 'checkout.created', { plan: plan.id, provider: provider.id, region, kind, checkoutId });
    return { url: result.url, checkoutId, providerRef: result.providerRef };
  }

  /**
   * The charge that is still inside the statutory 14-day cancellation window (Consumer Protection Law 14C), or null:
   * - the subscription's first paid charge (exactly one invoice so far), or
   * - for fixed-term plans renewed manually with explicit consent ('manual' renewal), the latest paid charge,
   *   because each such renewal is a new distance purchase.
   * Automatic monthly renewals are not new purchases, so they only stop future charges.
   * @param {SubscriptionRow} sub
   */
  function refundableCharge(sub) {
    const paid = db.all("SELECT * FROM invoices WHERE provider = ? AND provider_subscription_id = ? AND status = 'paid' ORDER BY issued_at",
      sub.provider, sub.provider_subscription_id);
    if (!paid.length) return null;
    const latest = paid[paid.length - 1];
    if (now() - latest.issued_at > config.refundWindowDays * DAY_MS) return null;
    const all = db.one('SELECT COUNT(*) AS n FROM invoices WHERE provider = ? AND provider_subscription_id = ?', sub.provider, sub.provider_subscription_id).n;
    if (paid.length === 1 && all === 1) return latest;
    let renewal = 'auto';
    try { renewal = renewalFor(sub.region, sub.plan, adapterFor(sub.provider)); } catch { /* provider gone: be conservative */ }
    return renewal === 'manual' ? latest : null;
  }

  /**
   * One-request cancellation, no fee.
   * mode 'period_end' (default): stop renewal, keep access until the paid period ends. Idempotent.
   * mode 'now': only within REFUND_WINDOW_DAYS of a refundable charge (first charge, or the latest manual
   *   fixed-term renewal) => immediate end + full refund of that charge;
   *   otherwise 400 REFUND_WINDOW_PASSED (the user keeps paid access; they can use 'period_end').
   * @param {{id: string, email: string, lang: string, trial_ends_at: number}} user
   * @param {unknown} [mode]
   */
  async function cancel(user, mode = 'period_end') {
    if (mode !== 'period_end' && mode !== 'now') throw new HttpError(400, 'INVALID_MODE', 'mode must be "period_end" or "now"');
    const sub = currentSubscription(user.id);
    const ent = entitlementFor(user);
    const reference = `C-${newId().slice(0, 8).toUpperCase()}`;

    if (mode === 'period_end') {
      if (sub && ent.status === 'canceled') return { entitlement: ent, refund: null };
      if (!sub || !(ent.status === 'active' || ent.status === 'past_due')) {
        throw new HttpError(409, 'NO_ACTIVE_SUBSCRIPTION', 'There is no active subscription to cancel');
      }
      try {
        await adapterFor(sub.provider).cancelSubscription(sub, { immediate: false });
      } catch (err) { providerFailure(err, 'cancelSubscription'); }
      db.run("UPDATE subscriptions SET status = 'canceled', cancel_at_period_end = 1, next_attempt_at = NULL, updated_at = ? WHERE id = ?", now(), sub.id);
      audit(user.id, 'subscription.cancel_requested', { subscriptionId: sub.id, mode, reference, periodEnd: sub.current_period_end });
      notify(user, 'cancel_confirmation', { planId: sub.plan, dateMs: sub.current_period_end ?? now(), reference, region: sub.region });
      return { entitlement: entitlementFor(user), refund: null };
    }

    if (!sub || !ent.hasAccess || !(ent.status === 'active' || ent.status === 'canceled' || ent.status === 'past_due')) {
      throw new HttpError(409, 'NO_ACTIVE_SUBSCRIPTION', 'There is no active subscription to cancel');
    }
    // A double-click (two concurrent requests) must not refund the same charge twice: while a refund for this
    // subscription is in flight, later requests share its outcome.
    const inflight = refundsInFlight.get(sub.id);
    if (inflight) return inflight;
    const run = cancelNowWithRefund(user, sub, reference);
    refundsInFlight.set(sub.id, run);
    try { return await run; } finally { refundsInFlight.delete(sub.id); }
  }

  /** @type {Map<string, Promise<{entitlement: any, refund: any}>>} */
  const refundsInFlight = new Map();

  /**
   * @param {{id: string, email: string, lang: string, trial_ends_at: number}} user
   * @param {SubscriptionRow} sub @param {string} reference
   */
  async function cancelNowWithRefund(user, sub, reference) {
    const charge = refundableCharge(sub);
    if (!charge) {
      throw new HttpError(400, 'REFUND_WINDOW_PASSED',
        `Immediate cancellation with a refund is only available within ${config.refundWindowDays} days of the first payment. You can stop the renewal instead.`);
    }
    const adapter = adapterFor(sub.provider);
    try {
      await adapter.cancelSubscription(sub, { immediate: true });
    } catch (err) { providerFailure(err, 'cancelSubscription(immediate)'); }
    /** @type {{status: 'refunded'|'pending', amount: number, currency: string}} */
    let refund = { status: 'pending', amount: charge.amount, currency: charge.currency };
    try {
      if (!adapter.refund) throw new Error('adapter has no refund()');
      const r = await adapter.refund({ providerTxId: charge.provider_invoice_id, amount: charge.amount, currency: charge.currency });
      refund = { ...refund, status: r.status };
    } catch (err) {
      // The subscription is already stopped; the refund must still happen (7 business days): flag it.
      logger.error(`[billing] REFUND FAILED for invoice ${charge.id}, manual refund required:`, err instanceof Error ? err.message : err);
      audit(user.id, 'refund.failed', { invoiceId: charge.id, amount: charge.amount });
    }
    const t = now();
    db.tx(() => {
      db.run(`UPDATE subscriptions SET status = 'expired', cancel_at_period_end = 1, current_period_end = ?, ended_reason = 'refunded',
                provider_token_ref = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ?`, t, t, sub.id);
      db.run('UPDATE invoices SET status = ? WHERE id = ?', refund.status === 'refunded' ? 'refunded' : 'refund_pending', charge.id);
      audit(user.id, 'subscription.canceled_with_refund', { subscriptionId: sub.id, reference, amount: charge.amount, refund: refund.status });
    });
    notify(user, 'refund_confirmation', { planId: sub.plan, dateMs: t, amount: charge.amount, currency: charge.currency, reference, region: sub.region });
    return { entitlement: entitlementFor(user), refund };
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
   * Explicit-consent renewal of an Israeli fixed-term plan (never automatic). Charges the saved token
   * when possible ({entitlement}); otherwise returns a hosted payment page ({url}).
   * @param {{id: string, email: string, lang: string, trial_ends_at: number}} user
   * @param {{planId?: unknown, consent?: unknown}} body
   * @param {{successUrl: string, cancelUrl: string, baseUrl: string}} urls
   */
  async function renew(user, body, urls) {
    if (body.consent !== true) throw new HttpError(400, 'CONSENT_REQUIRED', 'Renewal requires your explicit consent (consent: true)');
    const sub = currentSubscription(user.id);
    const ent = entitlementFor(user);
    if (!sub || !ent.canRenew) throw new HttpError(409, 'NOT_RENEWABLE', 'There is no fixed-term plan that can be renewed now');
    const planId = body.planId ?? sub.plan;
    if (!isPlanId(planId)) throw new HttpError(400, 'INVALID_PLAN', 'Unknown plan');
    const adapter = adapterFor(sub.provider);
    const plan = regionPlan(sub.region, planId);
    const renewal = renewalFor(sub.region, plan.id, adapter);
    const t = now();
    audit(user.id, 'subscription.renewal_consented', { subscriptionId: sub.id, plan: plan.id, amount: plan.price, currency: plan.currency });

    if (sub.provider_token_ref && adapter.chargeToken) {
      const key = `renew:${sub.id}:${sub.current_period_end}:${plan.id}`;
      let result;
      try {
        result = await adapter.chargeToken({ tokenRef: sub.provider_token_ref, customerRef: sub.provider_customer_id, amount: plan.price, currency: plan.currency, idempotencyKey: key });
      } catch (err) { providerFailure(err, 'chargeToken(renew)'); }
      if (result.status === 'succeeded') {
        const newEnd = addMonthsUtc(Math.max(t, sub.current_period_end ?? t), plan.months);
        applyEvents(sub.provider, [
          { eventId: `renew:${key}`, type: 'subscription.renewed', providerSubscriptionId: sub.provider_subscription_id, plan: plan.id,
            currentPeriodEnd: newEnd, occurredAt: t, renewal, amount: plan.price, currency: plan.currency },
          { eventId: `renew:${key}:invoice`, type: 'invoice.issued', providerSubscriptionId: sub.provider_subscription_id, plan: plan.id, occurredAt: t,
            invoice: { providerInvoiceId: result.providerTxId ?? key, amount: plan.price, currency: plan.currency, status: 'paid', url: result.invoiceUrl ?? null, issuedAt: t, plan: plan.id } },
        ]);
        return { entitlement: entitlementFor(user) };
      }
      logger.warn(`[billing] renewal token charge declined for subscription ${sub.id}; offering the hosted page`);
    }
    const { url } = await createCheckout(user, plan.id, urls, {}, { kind: 'renew', subscription: sub });
    return { url };
  }

  /**
   * Stops future charges before an account is deleted. Throws 502 if the provider refuses
   * (the account is then NOT deleted, so the user is never billed without an account).
   * @param {{id: string}} user
   */
  async function cancelAllForDeletion(user) {
    /** @type {SubscriptionRow[]} */
    const subs = db.all("SELECT * FROM subscriptions WHERE user_id = ? AND status IN ('active', 'past_due', 'canceled')", user.id);
    for (const sub of subs) {
      if (sub.status !== 'canceled' || adapterFor(sub.provider).capabilities.managesRenewals) {
        try {
          await adapterFor(sub.provider).cancelSubscription(sub, { immediate: true });
        } catch (err) { providerFailure(err, 'cancelSubscription(immediate)'); }
      }
      db.run("UPDATE subscriptions SET status = 'expired', cancel_at_period_end = 1, provider_token_ref = NULL, updated_at = ? WHERE id = ?", now(), sub.id);
    }
    return subs.length;
  }

  /** @param {string} userId */
  function listInvoices(userId) {
    return db.all('SELECT id, plan, amount, currency, status, url, issued_at FROM invoices WHERE user_id = ? ORDER BY issued_at DESC', userId)
      .map((r) => ({ id: r.id, plan: r.plan, amount: r.amount, currency: r.currency, status: r.status, url: r.url, issuedAt: new Date(r.issued_at).toISOString() }));
  }

  /**
   * After the hosted page redirects back: re-query pending checkouts of providers that support it
   * (authoritative server-to-server check), so access does not wait for a delayed callback.
   * @param {{id: string}} user
   */
  async function confirmPendingCheckouts(user) {
    const rows = db.all("SELECT provider, provider_ref FROM checkout_sessions WHERE user_id = ? AND status = 'pending' AND provider_ref IS NOT NULL AND created_at > ? ORDER BY created_at DESC LIMIT 3",
      user.id, now() - DAY_MS);
    for (const row of rows) {
      const adapter = providers.get(row.provider);
      if (!adapter?.confirmCheckout) continue;
      try {
        applyEvents(adapter.id, await adapter.confirmCheckout(row.provider_ref));
      } catch (err) {
        logger.warn(`[billing] confirm of ${row.provider} checkout failed:`, err instanceof Error ? err.message : err);
      }
    }
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
    const checkout = ev.checkoutRef
      ? db.one('SELECT * FROM checkout_sessions WHERE provider = ? AND provider_ref = ?', providerId, ev.checkoutRef) ?? null
      : null;
    /** @type {SubscriptionRow|null} */
    let sub = ev.providerSubscriptionId
      ? db.one('SELECT * FROM subscriptions WHERE provider = ? AND provider_subscription_id = ?', providerId, ev.providerSubscriptionId) ?? null
      : null;
    if (!sub && checkout?.kind === 'renew' && checkout.subscription_id) sub = db.one('SELECT * FROM subscriptions WHERE id = ?', checkout.subscription_id) ?? null;
    const userId = sub?.user_id ?? ev.userId ?? checkout?.user_id ?? null;
    const user = userId ? db.one('SELECT id, trial_ends_at FROM users WHERE id = ?', userId) : null;

    try {
      db.run('INSERT INTO webhook_events (provider, event_id, received_at, type, user_id, payload) VALUES (?, ?, ?, ?, ?, ?)',
        providerId, ev.eventId, t, ev.type, user ? userId : null, JSON.stringify(ev));
    } catch (err) {
      if (isUniqueViolation(err)) return 'duplicate';
      throw err;
    }
    if (!user) {
      logger.warn(`[billing] ${providerId} event ${ev.eventId} (${ev.type}) references no known user; ignored`);
      return 'ignored';
    }

    const occurredAt = toMs(ev.occurredAt) ?? t;
    let periodEnd = toMs(ev.currentPeriodEnd);
    const psid = ev.providerSubscriptionId ?? sub?.provider_subscription_id ?? null;
    if (ev.invoice) insertInvoice(providerId, userId, psid, ev.invoice, ev.plan ?? sub?.plan ?? null, t);
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

    const adapter = providers.get(providerId);
    const createFrom = ev.type === 'subscription.activated' || ev.type === 'subscription.renewed';
    if (!sub) {
      const planId = ev.plan ?? checkout?.plan;
      if (!createFrom || !psid || !isPlanId(planId)) {
        logger.warn(`[billing] ${ev.type} for unknown subscription ${psid ?? '(none)'}; ignored`);
        return 'ignored';
      }
      const region = checkout?.region ?? adapter?.region ?? 'IL';
      const plan = regionPlan(region, planId);
      const renewal = checkout?.renewal ?? (adapter ? renewalFor(region, planId, adapter) : 'auto');
      // The first paid period starts when the free trial ends, so paying early never loses trial days.
      periodEnd ??= addMonthsUtc(Math.max(occurredAt, user.trial_ends_at), plan.months);
      const id = newId();
      db.run(`INSERT INTO subscriptions (id, user_id, provider, provider_customer_id, provider_subscription_id, plan, status,
                current_period_end, cancel_at_period_end, last_event_at, created_at, updated_at, region, renewal, amount, currency, provider_token_ref)
              VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, userId, providerId, ev.providerCustomerId ?? null, psid, planId, periodEnd, occurredAt, t, t, region, renewal,
      checkout?.amount ?? ev.amount ?? plan.price, checkout?.currency ?? ev.currency ?? plan.currency, ev.providerTokenRef ?? null);
      sub = db.one('SELECT * FROM subscriptions WHERE id = ?', id);
    } else {
      /** @type {Record<string, unknown>} */
      const patch = { last_event_at: occurredAt, updated_at: t };
      const renewalCheckout = checkout?.kind === 'renew' ? checkout : null;
      if (periodEnd === null && renewalCheckout && ev.type === 'subscription.renewed') {
        const plan = regionPlan(sub.region, renewalCheckout.plan);
        periodEnd = addMonthsUtc(Math.max(t, sub.current_period_end ?? t), plan.months);
        Object.assign(patch, { plan: plan.id, renewal: renewalCheckout.renewal ?? sub.renewal, amount: renewalCheckout.amount, currency: renewalCheckout.currency });
      }
      if (periodEnd !== null) patch.current_period_end = periodEnd;
      if (ev.providerCustomerId) patch.provider_customer_id = ev.providerCustomerId;
      if (ev.providerTokenRef) patch.provider_token_ref = ev.providerTokenRef;
      if (isPlanId(ev.plan)) patch.plan = ev.plan;
      if (ev.renewal) patch.renewal = ev.renewal;
      if (Number.isInteger(ev.amount)) patch.amount = ev.amount;
      if (ev.currency) patch.currency = ev.currency;
      switch (ev.type) {
        case 'subscription.activated':
        case 'subscription.renewed':
        case 'subscription.resumed':
          Object.assign(patch, { status: 'active', cancel_at_period_end: 0, next_attempt_at: null, ended_reason: null }); break;
        case 'subscription.canceled':
          Object.assign(patch, { status: 'canceled', cancel_at_period_end: 1 }); break;
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
        .run(.../** @type {any[]} */ (cols.map((c) => patch[c])), sub.id);
    }
    if (checkout) {
      db.run("UPDATE checkout_sessions SET status = 'completed', updated_at = ? WHERE id = ?", t, checkout.id);
    }
    audit(userId, ev.type, { provider: providerId, plan: ev.plan ?? sub?.plan, periodEnd });
    return 'applied';
  }

  /**
   * @param {string} providerId @param {string} userId @param {string|null} psid @param {NormalizedInvoice} inv
   * @param {string|null} plan @param {number} t
   */
  function insertInvoice(providerId, userId, psid, inv, plan, t) {
    if (!inv.providerInvoiceId || !Number.isInteger(inv.amount)) return;
    try {
      db.run(`INSERT INTO invoices (id, user_id, provider, provider_invoice_id, plan, amount, currency, status, url, issued_at, provider_subscription_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(), userId, providerId, inv.providerInvoiceId, inv.plan ?? plan, inv.amount, (inv.currency || config.currency).toUpperCase(),
      inv.status || 'paid', inv.url ?? null, toMs(inv.issuedAt) ?? t, psid);
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
      db.run('DELETE FROM users WHERE id = ?', userId); // cascades: sessions, resets, subscriptions, checkouts, attempts, notices
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
    currentSubscription, entitlementFor, route, createCheckout, cancel, resume, renew, cancelAllForDeletion,
    listInvoices, confirmPendingCheckouts, applyEvents, purgeUser, maintenance, notify, adapterFor, regionPlan,
  };
}

/** @typedef {ReturnType<typeof createBillingService>} BillingService */
