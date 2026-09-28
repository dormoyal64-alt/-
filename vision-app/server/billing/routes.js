// @ts-check
/**
 * /api/plans, /api/billing/*, and the raw-body webhook endpoint /api/webhooks/:provider.
 */
import express from 'express';
import { HttpError } from '../http/errors.js';
import { enforceLimits } from '../http/rate-limit.js';
import { requireAuth } from '../auth/middleware.js';
import { WebhookVerificationError } from './providers/errors.js';
import { plansFor } from './pricing.js';

/** Where the hosted payment page sends the user back to (hash routes of the PWA). */
export function returnUrls(/** @type {string} */ base) {
  return {
    successUrl: `${base}/app/#/account?checkout=success`,
    cancelUrl: `${base}/app/#/account?checkout=cancel`,
  };
}

/** Server-side landing URLs handed to real providers (they may append their own query parameters). */
export function providerReturnUrls(/** @type {string} */ base) {
  return { successUrl: `${base}/api/billing/return/success`, cancelUrl: `${base}/api/billing/return/cancel` };
}

/**
 * JSON routes (mounted after express.json()).
 * @param {{config: import('../config.js').Config, billing: import('./service.js').BillingService,
 *   limiters: import('../http/limits.js').Limiters, baseUrlOf: (req: import('express').Request) => string}} deps
 */
export function billingRoutes({ config, billing, limiters, baseUrlOf }) {
  const router = express.Router();
  /** @param {import('express').Request} req @param {Record<string, unknown>} [body] */
  const hintsOf = (req, body = {}) => ({
    country: body.country ?? req.query.country,
    currency: body.currency ?? req.query.currency,
    geoCountry: config.geoCountryHeader ? req.get(config.geoCountryHeader) : undefined,
  });
  /** @param {unknown} b @returns {Record<string, any>} */
  const obj = (b) => (b && typeof b === 'object' && !Array.isArray(b) ? /** @type {any} */ (b) : {});
  const urlsFor = (/** @type {import('express').Request} */ req) => {
    const base = baseUrlOf(req);
    return { ...providerReturnUrls(base), baseUrl: base };
  };

  router.get('/plans', (req, res) => {
    const { region, provider } = billing.route(hintsOf(req));
    res.json({ trialDays: config.trialDays, ...plansFor(config, region, provider) });
  });

  router.post('/billing/checkout', requireAuth, async (req, res) => {
    const user = res.locals.user;
    const body = obj(req.body);
    enforceLimits([[limiters.checkoutUser, `checkout:${user.id}`]]);
    const { url } = await billing.createCheckout(user, body.planId, urlsFor(req), hintsOf(req, body));
    res.json({ url });
  });

  router.post('/billing/cancel', requireAuth, async (req, res) => {
    const { entitlement, refund } = await billing.cancel(res.locals.user, obj(req.body).mode ?? 'period_end');
    res.json(refund ? { entitlement, refund } : { entitlement });
  });

  router.post('/billing/renew', requireAuth, async (req, res) => {
    const user = res.locals.user;
    enforceLimits([[limiters.checkoutUser, `checkout:${user.id}`]]);
    res.json(await billing.renew(user, obj(req.body), urlsFor(req)));
  });

  router.post('/billing/resume', requireAuth, async (_req, res) => {
    res.json({ entitlement: await billing.resume(res.locals.user) });
  });

  router.get('/billing/invoices', requireAuth, (_req, res) => {
    res.json({ invoices: billing.listInvoices(res.locals.user.id) });
  });

  // Landing page after the hosted payment page. Never grants access by itself: it only triggers the
  // authoritative server-to-server re-query, then sends the user to the app.
  router.get('/billing/return/:result', async (req, res) => {
    const result = req.params.result;
    if (result !== 'success' && result !== 'cancel') throw new HttpError(404, 'NOT_FOUND', 'Not found');
    if (result === 'success' && res.locals.user) await billing.confirmPendingCheckouts(res.locals.user);
    const urls = returnUrls(baseUrlOf(req));
    res.redirect(303, result === 'success' ? urls.successUrl : urls.cancelUrl);
  });

  return router;
}

/**
 * Webhook route: must be mounted BEFORE any JSON body parser (signatures cover the raw bytes).
 * @param {{providers: Map<string, import('./providers/index.js').PaymentProvider>, billing: import('./service.js').BillingService,
 *   logger: {warn: Function}}} deps
 */
export function webhookRoutes({ providers, billing, logger }) {
  const router = express.Router();
  router.post('/webhooks/:provider', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
    const adapter = providers.get(String(req.params.provider));
    if (!adapter) throw new HttpError(404, 'NOT_FOUND', 'Unknown payment provider');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    let events;
    try {
      events = await adapter.verifyAndParseWebhook(raw, req.headers);
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        logger.warn(`[webhook:${adapter.id}] rejected: ${err.message}`);
        const messages = { INVALID_SIGNATURE: 'Invalid webhook signature', INVALID_PAYLOAD: 'Invalid webhook payload', AMOUNT_MISMATCH: 'Payment amount does not match the checkout' };
        throw new HttpError(400, err.code, messages[err.code]);
      }
      throw err;
    }
    const result = billing.applyEvents(adapter.id, events);
    res.status(200).json({ received: true, ...result });
  });
  return router;
}
