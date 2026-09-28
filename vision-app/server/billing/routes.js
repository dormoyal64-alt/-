// @ts-check
/**
 * /api/plans, /api/billing/*, and the raw-body webhook endpoint /api/webhooks/:provider.
 */
import express from 'express';
import { HttpError } from '../http/errors.js';
import { enforceLimits } from '../http/rate-limit.js';
import { requireAuth } from '../auth/middleware.js';
import { WebhookVerificationError } from './providers/errors.js';

/** Where the hosted payment page sends the user back to (hash routes of the PWA). */
export function returnUrls(/** @type {string} */ base) {
  return {
    successUrl: `${base}/app/#/account?checkout=success`,
    cancelUrl: `${base}/app/#/account?checkout=cancel`,
  };
}

/**
 * JSON routes (mounted after express.json()).
 * @param {{config: import('../config.js').Config, billing: import('./service.js').BillingService,
 *   limiters: import('../http/limits.js').Limiters, baseUrlOf: (req: import('express').Request) => string}} deps
 */
export function billingRoutes({ config, billing, limiters, baseUrlOf }) {
  const router = express.Router();

  router.get('/plans', (_req, res) => {
    res.json({ trialDays: config.trialDays, currency: config.currency, plans: config.plans });
  });

  router.post('/billing/checkout', requireAuth, async (req, res) => {
    const user = res.locals.user;
    const planId = req.body && typeof req.body === 'object' ? req.body.planId : undefined;
    enforceLimits([[limiters.checkoutUser, `checkout:${user.id}`]]);
    const base = baseUrlOf(req);
    const { url } = await billing.createCheckout(user, planId, { ...returnUrls(base), baseUrl: base });
    res.json({ url });
  });

  router.post('/billing/cancel', requireAuth, async (_req, res) => {
    res.json({ entitlement: await billing.cancel(res.locals.user) });
  });

  router.post('/billing/resume', requireAuth, async (_req, res) => {
    res.json({ entitlement: await billing.resume(res.locals.user) });
  });

  router.get('/billing/invoices', requireAuth, (_req, res) => {
    res.json({ invoices: billing.listInvoices(res.locals.user.id) });
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
  router.post('/webhooks/:provider', express.raw({ type: () => true, limit: '256kb' }), async (req, res) => {
    const adapter = providers.get(String(req.params.provider));
    if (!adapter) throw new HttpError(404, 'NOT_FOUND', 'Unknown payment provider');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    let events;
    try {
      events = await adapter.verifyAndParseWebhook(raw, req.headers);
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        logger.warn(`[webhook:${adapter.id}] rejected: ${err.message}`);
        throw new HttpError(400, err.code, err.code === 'INVALID_SIGNATURE' ? 'Invalid webhook signature' : 'Invalid webhook payload');
      }
      throw err;
    }
    const result = billing.applyEvents(adapter.id, events);
    res.status(200).json({ received: true, ...result });
  });
  return router;
}
