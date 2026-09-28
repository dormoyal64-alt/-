// @ts-check
/**
 * Renewal scheduler (docs/research/business-legal-payments.md 1.7 and 3.5).
 *
 * - Auto-renewing subscriptions whose provider does NOT manage renewals (PayPlus, mock) are charged by
 *   us with the saved token when the period ends. Declined => past_due, retried every 24 h during the
 *   grace period (PAST_DUE_GRACE_DAYS, default 7), then expired. An attempt whose outcome is unknown
 *   (timeout) stays 'pending' and blocks further automatic charges for that period (no double charge);
 *   it must be reconciled manually.
 * - Canceled subscriptions and fixed-term (manual) plans are never charged; they are marked expired
 *   when their period ends.
 * - Notices (each at most once per subscription period, recorded in `notices`):
 *     pre_charge      IL monthly, MONTHLY_REMINDER_DAYS before our token charge
 *     renewal_notice  provider-managed (Paddle) quarterly/yearly, RENEWAL_REMINDER_DAYS before renewal
 *     end_notice      fixed-term plan, statutory notice 60 days before the end (section 13A)
 *     final_reminder  fixed-term plan, RENEWAL_REMINDER_DAYS before the end
 *     payment_failed  when a token charge is declined
 * `runOnce()` is deterministic given the injected clock; `start(ms)` runs it on a timer.
 */
import { DAY_MS } from './entitlement.js';
import { addMonthsUtc } from './plans.js';

const RETRY_MS = DAY_MS;
const END_NOTICE_DAYS = 60;

/**
 * @param {{db: import('../db.js').Db, config: import('../config.js').Config, billing: import('./service.js').BillingService,
 *   providers: Map<string, import('./providers/index.js').PaymentProvider>, mailer: import('../mail/index.js').Mailer,
 *   now: () => number, logger: {info: Function, warn: Function, error: Function}}} deps
 */
export function createRenewalScheduler({ db, config, billing, providers, now, logger }) {
  let running = false;
  /** @type {ReturnType<typeof setInterval>|null} */
  let timer = null;

  /**
   * Records the notice; returns true if it had not been sent yet for this period.
   * @param {string} subId @param {string} kind @param {number} periodEnd
   */
  const claimNotice = (subId, kind, periodEnd) =>
    Number(db.run('INSERT OR IGNORE INTO notices (subscription_id, kind, period_end, sent_at) VALUES (?, ?, ?, ?)', subId, kind, periodEnd, now()).changes) === 1;

  /** @param {any} row subscription joined with users.email/lang @param {import('../mail/templates.js').BillingMailKind} kind @param {number} dateMs */
  async function sendNotice(row, kind, dateMs) {
    if (!claimNotice(row.id, kind, row.current_period_end)) return false;
    await billing.notify({ email: row.email, lang: row.lang }, kind, {
      planId: row.plan, dateMs, amount: row.amount ?? undefined, currency: row.currency ?? undefined, region: row.region,
    });
    return true;
  }

  /** @param {any} sub @param {string} reason */
  function expire(sub, reason) {
    billing.applyEvents(sub.provider, [{
      eventId: `sched:expire:${sub.id}:${sub.current_period_end}`, type: 'subscription.expired',
      providerSubscriptionId: sub.provider_subscription_id, occurredAt: now(),
    }]);
    logger.info(`[renewals] subscription ${sub.id} expired (${reason})`);
  }

  async function chargeDue(summary) {
    const t = now();
    const due = db.all(`SELECT s.*, u.email, u.lang FROM subscriptions s JOIN users u ON u.id = s.user_id
                        WHERE s.renewal = 'auto' AND s.status IN ('active', 'past_due') AND s.cancel_at_period_end = 0
                          AND s.current_period_end <= ? AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= ?)`, t, t);
    for (const sub of due) {
      const adapter = providers.get(sub.provider);
      if (!adapter || adapter.capabilities.managesRenewals || !adapter.chargeToken) continue;
      if (t >= sub.current_period_end + config.pastDueGraceDays * DAY_MS) {
        expire(sub, 'grace period over');
        summary.expired++;
        continue;
      }
      const pending = db.one("SELECT id FROM renewal_attempts WHERE subscription_id = ? AND period_end = ? AND status = 'pending'", sub.id, sub.current_period_end);
      if (pending) {
        logger.error(`[renewals] subscription ${sub.id}: unresolved charge attempt ${pending.id}; manual reconciliation required`);
        summary.blocked++;
        continue;
      }
      const plan = billing.regionPlan(sub.region, sub.plan);
      const amount = sub.amount ?? plan.price;
      const currency = sub.currency ?? plan.currency;
      const attemptNo = db.one('SELECT COUNT(*) AS n FROM renewal_attempts WHERE subscription_id = ? AND period_end = ?', sub.id, sub.current_period_end).n + 1;
      const attemptId = db.run("INSERT INTO renewal_attempts (subscription_id, period_end, attempted_at, status) VALUES (?, ?, ?, 'pending')",
        sub.id, sub.current_period_end, t).lastInsertRowid;

      /** @type {import('./providers/index.js').ChargeResult} */
      let result;
      if (!sub.provider_token_ref) {
        result = { status: 'declined', error: 'no saved payment token' };
      } else {
        try {
          result = await adapter.chargeToken({
            tokenRef: sub.provider_token_ref, customerRef: sub.provider_customer_id, amount, currency,
            idempotencyKey: `renew:${sub.id}:${sub.current_period_end}:${attemptNo}`,
          });
        } catch (err) {
          db.run('UPDATE renewal_attempts SET error = ? WHERE id = ?', String(err instanceof Error ? err.message : err).slice(0, 500), attemptId);
          logger.error(`[renewals] charge outcome unknown for subscription ${sub.id}; left pending for reconciliation`);
          summary.blocked++;
          continue;
        }
      }

      if (result.status === 'succeeded') {
        db.run("UPDATE renewal_attempts SET status = 'succeeded', provider_tx_id = ? WHERE id = ?", result.providerTxId ?? null, attemptId);
        const newEnd = addMonthsUtc(sub.current_period_end, plan.months);
        const key = `sched:renew:${sub.id}:${sub.current_period_end}`;
        billing.applyEvents(sub.provider, [
          { eventId: key, type: 'subscription.renewed', providerSubscriptionId: sub.provider_subscription_id, currentPeriodEnd: newEnd, occurredAt: t },
          { eventId: `${key}:invoice`, type: 'invoice.issued', providerSubscriptionId: sub.provider_subscription_id, plan: sub.plan, occurredAt: t,
            invoice: { providerInvoiceId: result.providerTxId || key, amount, currency, status: 'paid', url: result.invoiceUrl ?? null, issuedAt: t, plan: sub.plan } },
        ]);
        summary.charged++;
      } else {
        db.run("UPDATE renewal_attempts SET status = 'failed', error = ? WHERE id = ?", (result.error ?? 'declined').slice(0, 500), attemptId);
        if (sub.status !== 'past_due') {
          billing.applyEvents(sub.provider, [{
            eventId: `sched:failed:${sub.id}:${sub.current_period_end}`, type: 'payment.failed',
            providerSubscriptionId: sub.provider_subscription_id, occurredAt: t,
          }]);
        }
        db.run('UPDATE subscriptions SET next_attempt_at = ? WHERE id = ?', t + RETRY_MS, sub.id);
        await sendNotice(sub, 'payment_failed', sub.current_period_end + config.pastDueGraceDays * DAY_MS);
        summary.failed++;
      }
    }
  }

  function endFinishedTerms(summary) {
    const t = now();
    const done = db.all(`SELECT * FROM subscriptions WHERE status IN ('active', 'canceled') AND current_period_end <= ?
                           AND (renewal = 'manual' OR status = 'canceled' OR cancel_at_period_end = 1)`, t);
    for (const sub of done) {
      expire(sub, sub.renewal === 'manual' ? 'fixed term ended' : 'canceled period ended');
      summary.expired++;
    }
    // Auto-renewing subscriptions managed by a provider that never reported back: expire after grace.
    const stale = db.all("SELECT * FROM subscriptions WHERE status IN ('active', 'past_due') AND renewal = 'auto' AND current_period_end <= ?",
      t - config.pastDueGraceDays * DAY_MS);
    for (const sub of stale) {
      if (!providers.get(sub.provider)?.capabilities.managesRenewals) continue; // ours are handled in chargeDue
      expire(sub, 'no renewal reported by provider');
      summary.expired++;
    }
  }

  async function reminders(summary) {
    const t = now();
    const rows = db.all(`SELECT s.*, u.email, u.lang FROM subscriptions s JOIN users u ON u.id = s.user_id
                         WHERE s.status = 'active' AND s.cancel_at_period_end = 0 AND s.current_period_end > ?`, t);
    for (const s of rows) {
      const left = s.current_period_end - t;
      const adapter = providers.get(s.provider);
      if (s.renewal === 'manual') {
        if (config.renewalReminderDays > 0 && left <= config.renewalReminderDays * DAY_MS) {
          claimNotice(s.id, 'end_notice', s.current_period_end); // superseded if we are already this late
          if (await sendNotice(s, 'final_reminder', s.current_period_end)) summary.reminders++;
        } else if (left <= END_NOTICE_DAYS * DAY_MS) {
          if (await sendNotice(s, 'end_notice', s.current_period_end)) summary.reminders++;
        }
      } else if (adapter?.capabilities.managesRenewals) {
        if (s.plan !== 'monthly' && config.renewalReminderDays > 0 && left <= config.renewalReminderDays * DAY_MS) {
          if (await sendNotice(s, 'renewal_notice', s.current_period_end)) summary.reminders++;
        }
      } else if (config.monthlyReminderDays > 0 && left <= config.monthlyReminderDays * DAY_MS) {
        if (await sendNotice(s, 'pre_charge', s.current_period_end)) summary.reminders++;
      }
    }
  }

  /** One full pass. Never runs concurrently with itself. */
  async function runOnce() {
    if (running) return null;
    running = true;
    const summary = { charged: 0, failed: 0, blocked: 0, expired: 0, reminders: 0 };
    try {
      await chargeDue(summary);
      endFinishedTerms(summary);
      await reminders(summary);
    } catch (err) {
      logger.error('[renewals] run failed:', err);
    } finally {
      running = false;
    }
    return summary;
  }

  return {
    runOnce,
    /** @param {number} intervalMs */
    start(intervalMs) {
      if (timer || intervalMs <= 0) return;
      const tick = () => { runOnce().catch(() => {}); };
      setTimeout(tick, 5_000).unref();
      timer = setInterval(tick, intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/** @typedef {ReturnType<typeof createRenewalScheduler>} RenewalScheduler */
