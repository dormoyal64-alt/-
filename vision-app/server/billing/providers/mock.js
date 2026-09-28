// @ts-check
/**
 * Mock payment provider for development and tests. NEVER available in production
 * (config refuses PAYMENT_PROVIDER=mock there, and the router below 404s as a second guard).
 *
 * - createCheckout -> URL of a server-rendered test page at /api/billing/mock/checkout/:ref
 * - Paying on that page applies the same normalized events a real webhook would
 *   (subscription.activated + invoice.issued) and redirects to /app/#/account?checkout=success.
 * - Webhooks: POST /api/webhooks/mock with header `x-mock-signature: hex(HMAC-SHA256(MOCK_WEBHOOK_SECRET, rawBody))`
 *   and body `{"events":[{id, type, userId, subscriptionId, customerId, plan, currentPeriodEnd, occurredAt, invoice}]}`
 *   (a single event object is accepted too).
 */
import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { newToken, hmacHex, safeEqual, sha256Hex } from '../../auth/tokens.js';
import { WebhookVerificationError } from './errors.js';
import { EVENT_TYPES } from '../service.js';
import { findPlan, formatPrice } from '../plans.js';
import { hasPaidAccess } from '../entitlement.js';
import { escapeHtml } from '../../mail/templates.js';

/**
 * Test hooks: set `nextCharge` to 'declined' or 'error' to make the next chargeToken() decline or throw;
 * `charges` and `refunds` record calls.
 * @param {{webhookSecret: string, now: () => number}} opts
 */
export function createMockProvider({ webhookSecret }) {
  const sign = (/** @type {string|Buffer} */ body) => createHmac('sha256', webhookSecret).update(body).digest('hex');
  /** @type {Array<{tokenRef: string, amount: number, currency: string, idempotencyKey: string}>} */
  const charges = [];
  /** @type {Array<{providerTxId: string, amount: number}>} */
  const refunds = [];
  /** @type {import('./index.js').PaymentProvider & {signWebhook: (body: string|Buffer) => string, nextCharge: null|'declined'|'error', charges: typeof charges, refunds: typeof refunds}} */
  const provider = {
    id: 'mock',
    region: null,
    cspFormActionOrigins: [],
    capabilities: { managesRenewals: false, tokenCharges: true, refunds: true, signedWebhooks: true },
    nextCharge: null,
    charges,
    refunds,
    async createCheckout({ baseUrl }) {
      const providerRef = `mock_cs_${newToken()}`;
      return { url: `${baseUrl}/api/billing/mock/checkout/${providerRef}`, providerRef };
    },
    async cancelSubscription() { /* nothing to call */ },
    async resumeSubscription() { /* nothing to call */ },
    async chargeToken(req) {
      const outcome = provider.nextCharge;
      provider.nextCharge = null;
      if (outcome === 'error') throw new Error('mock: charge outcome unknown (simulated timeout)');
      charges.push({ tokenRef: req.tokenRef, amount: req.amount, currency: req.currency, idempotencyKey: req.idempotencyKey });
      if (outcome === 'declined' || req.tokenRef.includes('decline')) return { status: 'declined', error: 'mock decline' };
      return { status: 'succeeded', providerTxId: `mock_tx_${newToken().slice(0, 24)}`, invoiceUrl: null };
    },
    async refund(req) {
      refunds.push({ providerTxId: req.providerTxId, amount: req.amount });
      return { refundId: `mock_rf_${newToken().slice(0, 16)}`, status: 'refunded' };
    },
    signWebhook: sign,
    verifyAndParseWebhook(rawBody, headers) {
      const sigHeader = headers['x-mock-signature'];
      const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
      if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/i.test(sig)) throw new WebhookVerificationError('missing or malformed signature');
      const expected = Buffer.from(sign(rawBody), 'hex');
      if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) throw new WebhookVerificationError('signature mismatch');
      let body;
      try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw new WebhookVerificationError('body is not JSON', 'INVALID_PAYLOAD'); }
      const list = Array.isArray(body?.events) ? body.events : [body];
      return list.map((e) => {
        if (!e || typeof e.id !== 'string' || !e.id || typeof e.type !== 'string') {
          throw new WebhookVerificationError('event needs string id and type', 'INVALID_PAYLOAD');
        }
        if (!/** @type {readonly string[]} */ (EVENT_TYPES).includes(e.type)) {
          throw new WebhookVerificationError(`unknown event type ${e.type}`, 'INVALID_PAYLOAD');
        }
        return {
          eventId: e.id,
          type: e.type,
          userId: e.userId,
          providerSubscriptionId: e.subscriptionId,
          providerCustomerId: e.customerId,
          plan: e.plan,
          currentPeriodEnd: e.currentPeriodEnd,
          occurredAt: e.occurredAt,
          checkoutRef: e.checkoutRef,
          providerTokenRef: e.tokenRef,
          invoice: e.invoice && typeof e.invoice === 'object' ? {
            providerInvoiceId: String(e.invoice.id ?? e.invoice.providerInvoiceId ?? ''),
            amount: Number(e.invoice.amount),
            currency: String(e.invoice.currency ?? ''),
            status: e.invoice.status,
            url: e.invoice.url ?? null,
            issuedAt: e.invoice.issuedAt,
            plan: e.invoice.plan,
          } : undefined,
        };
      });
    },
  };
  return provider;
}

const PAGE_STRINGS = {
  he: {
    title: 'תשלום (מצב בדיקה)', testMode: 'מצב בדיקה: לא יבוצע חיוב אמיתי.', plan: 'מסלול', price: 'מחיר',
    monthly: 'חודשי', quarterly: 'שלושה חודשים', yearly: 'שנתי', pay: 'תשלום (מצב בדיקה)', cancel: 'ביטול',
    months: (/** @type {number} */ n) => (n === 1 ? 'חודש' : `${n} חודשים`), done: 'הקנייה הזו כבר הסתיימה.', back: 'חזרה לאפליקציה',
    notFound: 'דף התשלום לא נמצא או שפג תוקפו.', login: 'יש להתחבר כדי להמשיך.',
  },
  en: {
    title: 'Payment (test mode)', testMode: 'Test mode: no real charge will be made.', plan: 'Plan', price: 'Price',
    monthly: 'Monthly', quarterly: '3 months', yearly: 'Yearly', pay: 'Pay (test mode)', cancel: 'Cancel',
    months: (/** @type {number} */ n) => (n === 1 ? '1 month' : `${n} months`), done: 'This checkout is already finished.', back: 'Back to the app',
    notFound: 'This payment page was not found or has expired.', login: 'Please sign in to continue.',
  },
};

const PAGE_CSS = `
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:20px;line-height:1.5;background:#f4f5f7;color:#111}
  main{max-width:32rem;margin:2rem auto;padding:1.5rem;background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.15)}
  h1{font-size:1.5rem;margin:0 0 1rem}
  .badge{background:#fff3cd;border:2px solid #8a6d00;color:#4d3d00;padding:.5rem .75rem;border-radius:8px;margin-block-end:1rem}
  dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem 1rem;margin:0 0 1.5rem}
  dt{font-weight:600}
  dd{margin:0}
  .actions{display:flex;gap:1rem;flex-wrap:wrap}
  button,a.btn{min-height:48px;min-width:48px;padding:.75rem 1.5rem;font-size:1.1rem;border-radius:8px;border:2px solid #0b57d0;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
  button.pay{background:#0b57d0;color:#fff}
  button.cancel,a.btn{background:#fff;color:#0b57d0}
  button:focus-visible,a:focus-visible{outline:3px solid #111;outline-offset:3px}
  form{margin:0}
`;

/** @param {'he'|'en'} lang @param {string} title @param {string} bodyHtml */
function page(lang, title, bodyHtml) {
  return `<!doctype html><html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">`
    + '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">'
    + `<title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body><main>${bodyHtml}</main></body></html>`;
}

/**
 * Router for the hosted test checkout page, mounted at /api/billing/mock.
 * @param {{config: import('../../config.js').Config, billing: import('../service.js').BillingService,
 *   db: import('../../db.js').Db, now: () => number, baseUrlOf: (req: import('express').Request) => string,
 *   returnUrls: (base: string) => {successUrl: string, cancelUrl: string}}} deps
 */
export function mockCheckoutRouter({ config, billing, db, now, baseUrlOf, returnUrls }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (config.isProduction) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(express.urlencoded({ extended: false, limit: '2kb', parameterLimit: 10 }));

  /** @param {import('express').Request} req @param {any} user */
  const langOf = (req, user) => {
    const q = req.query.lang;
    if (q === 'he' || q === 'en') return q;
    return user?.lang === 'en' ? 'en' : 'he';
  };
  /** @param {any} checkout @returns {import('../plans.js').Plan} */
  const planOf = (checkout) => {
    const region = checkout.region === 'INTL' ? 'INTL' : 'IL';
    const base = /** @type {import('../plans.js').Plan} */ (findPlan(config.pricing[region].plans, checkout.plan));
    return { ...base, price: checkout.amount ?? base.price, currency: checkout.currency ?? base.currency };
  };
  /** @param {string} ref @param {string} userId */
  const csrfFor = (ref, userId) => hmacHex(config.sessionSecret, `mock-checkout:${ref}:${userId}`);

  /**
   * @param {import('express').Request} req @param {import('express').Response} res
   * @returns {{user: any, checkout: any, lang: 'he'|'en'}|null}
   */
  function load(req, res) {
    const user = res.locals.user;
    const lang = langOf(req, user);
    const s = PAGE_STRINGS[lang];
    const back = `<p><a class="btn" href="/app/#/account">${escapeHtml(s.back)}</a></p>`;
    if (!user) {
      res.status(401).type('html').send(page(lang, s.title, `<h1>${escapeHtml(s.title)}</h1><p>${escapeHtml(s.login)}</p>${back}`));
      return null;
    }
    const ref = String(req.params.ref);
    const checkout = /^mock_cs_[A-Za-z0-9_-]{43}$/.test(ref)
      ? db.one("SELECT * FROM checkout_sessions WHERE provider = 'mock' AND provider_ref = ? AND user_id = ?", ref, user.id)
      : undefined;
    if (!checkout) {
      res.status(404).type('html').send(page(lang, s.title, `<h1>${escapeHtml(s.title)}</h1><p>${escapeHtml(s.notFound)}</p>${back}`));
      return null;
    }
    if (checkout.status !== 'pending') {
      res.status(409).type('html').send(page(lang, s.title, `<h1>${escapeHtml(s.title)}</h1><p>${escapeHtml(s.done)}</p>${back}`));
      return null;
    }
    return { user, checkout, lang };
  }

  router.get('/checkout/:ref', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    const { user, checkout, lang } = ctx;
    const s = PAGE_STRINGS[lang];
    const plan = planOf(checkout);
    const ref = encodeURIComponent(checkout.provider_ref);
    const csrf = csrfFor(checkout.provider_ref, user.id);
    const langQ = req.query.lang === 'he' || req.query.lang === 'en' ? `?lang=${req.query.lang}` : '';
    const body = `<h1>${escapeHtml(s.title)}</h1>`
      + `<p class="badge" role="note">${escapeHtml(s.testMode)}</p>`
      + `<dl><dt>${escapeHtml(s.plan)}</dt><dd>${escapeHtml(s[plan.id])} (${escapeHtml(s.months(plan.months))})</dd>`
      + `<dt>${escapeHtml(s.price)}</dt><dd><bdi>${escapeHtml(formatPrice(plan.price, plan.currency, lang))}</bdi></dd></dl>`
      + '<div class="actions">'
      + `<form method="post" action="/api/billing/mock/checkout/${ref}/pay${langQ}"><input type="hidden" name="csrf" value="${csrf}">`
      + `<button type="submit" class="pay">${escapeHtml(s.pay)}</button></form>`
      + `<form method="post" action="/api/billing/mock/checkout/${ref}/cancel${langQ}"><input type="hidden" name="csrf" value="${csrf}">`
      + `<button type="submit" class="cancel">${escapeHtml(s.cancel)}</button></form>`
      + '</div>';
    res.type('html').send(page(lang, s.title, body));
  });

  /** @param {import('express').Request} req @param {{user: any, checkout: any}} ctx */
  const csrfOk = (req, ctx) => typeof req.body?.csrf === 'string' && safeEqual(req.body.csrf, csrfFor(ctx.checkout.provider_ref, ctx.user.id));

  router.post('/checkout/:ref/pay', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    if (!csrfOk(req, ctx)) {
      res.status(403).json({ error: { code: 'BAD_CSRF', message: 'Invalid form token' } });
      return;
    }
    const { user, checkout } = ctx;
    const urls = returnUrls(baseUrlOf(req));
    if (checkout.kind !== 'renew' && hasPaidAccess(billing.entitlementFor(user))) {
      db.run("UPDATE checkout_sessions SET status = 'canceled', updated_at = ? WHERE id = ?", now(), checkout.id);
      res.redirect(303, urls.cancelUrl);
      return;
    }
    const plan = planOf(checkout);
    const t = now();
    const renewing = checkout.kind === 'renew' && checkout.subscription_id;
    const existing = renewing ? db.one('SELECT provider_subscription_id FROM subscriptions WHERE id = ?', checkout.subscription_id) : null;
    const subscriptionId = existing?.provider_subscription_id ?? `mock_sub_${newToken().slice(0, 24)}`;
    // The paid period (computed by the billing service) starts when the free trial ends, so subscribing
    // early never loses trial days; a renewal extends the current period.
    billing.applyEvents('mock', [
      {
        eventId: `mock_evt_${newToken()}`, type: renewing ? 'subscription.renewed' : 'subscription.activated', userId: user.id,
        providerSubscriptionId: subscriptionId, providerCustomerId: `mock_cus_${sha256Hex(user.id).slice(0, 16)}`,
        providerTokenRef: `mock_tok_${newToken().slice(0, 24)}`, plan: plan.id, occurredAt: t, checkoutRef: checkout.provider_ref,
      },
      {
        eventId: `mock_evt_${newToken()}`, type: 'invoice.issued', userId: user.id, providerSubscriptionId: subscriptionId,
        plan: plan.id, occurredAt: t,
        invoice: { providerInvoiceId: `mock_inv_${newToken().slice(0, 24)}`, amount: plan.price, currency: plan.currency, status: 'paid', url: null, issuedAt: t, plan: plan.id },
      },
    ]);
    res.redirect(303, urls.successUrl);
  });

  router.post('/checkout/:ref/cancel', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    if (!csrfOk(req, ctx)) {
      res.status(403).json({ error: { code: 'BAD_CSRF', message: 'Invalid form token' } });
      return;
    }
    db.run("UPDATE checkout_sessions SET status = 'canceled', updated_at = ? WHERE id = ?", now(), ctx.checkout.id);
    res.redirect(303, returnUrls(baseUrlOf(req)).cancelUrl);
  });

  return router;
}
