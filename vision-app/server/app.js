// @ts-check
/**
 * Express application factory. `createApp(config, deps?)` is used by server/index.js and by tests
 * (which inject a capturing mailer, a silent logger, a fake clock, ...).
 */
import express from 'express';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createAudit } from './audit.js';
import { securityHeaders, apiCsrfGuard, serverOrigin } from './http/security.js';
import { staticRoutes } from './http/static.js';
import { errorHandler, notFound } from './http/errors.js';
import { createLimiters } from './http/limits.js';
import { createSessionStore } from './auth/sessions.js';
import { sessionCookie, loadSession } from './auth/middleware.js';
import { authRoutes } from './auth/routes.js';
import { createMailer } from './mail/index.js';
import { createProviders } from './billing/providers/index.js';
import { mockCheckoutRouter } from './billing/providers/mock.js';
import { createBillingService } from './billing/service.js';
import { createRenewalScheduler } from './billing/renewals.js';
import { billingRoutes, webhookRoutes, returnUrls } from './billing/routes.js';
import { DAY_MS } from './billing/entitlement.js';

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

/**
 * @typedef {object} AppDeps
 * @property {import('./mail/index.js').Mailer} [mailer]
 * @property {{info: Function, warn: Function, error: Function}} [logger]
 * @property {() => number} [now]                         clock (epoch ms)
 * @property {import('./billing/providers/index.js').PaymentProvider} [provider]   single provider (tests)
 * @property {import('./billing/providers/index.js').PaymentProvider[]} [providers] several providers (tests)
 * @property {typeof fetch} [fetchImpl]                   used by real provider adapters (tests mock it)
 * @property {string} [publicDir]
 * @property {boolean} [maintenanceTimer]                 default true
 */

/**
 * @param {import('./config.js').Config} config
 * @param {AppDeps} [deps]
 */
export function createApp(config, deps = {}) {
  const logger = deps.logger ?? { info: console.log, warn: console.warn, error: console.error };
  const now = deps.now ?? Date.now;
  const db = openDatabase(config.dataDir);
  const audit = createAudit(db, now);
  const mailer = deps.mailer ?? createMailer(config, logger);
  const lookupCheckout = (/** @type {string} */ providerId, /** @type {string} */ ref) => db.one(
    `SELECT c.id, c.user_id, c.plan, c.amount, c.currency, c.status, c.kind, s.provider_subscription_id AS subscription_psid
       FROM checkout_sessions c LEFT JOIN subscriptions s ON s.id = c.subscription_id
      WHERE c.provider = ? AND c.provider_ref = ?`, providerId, ref) ?? null;
  const injected = deps.providers ?? (deps.provider ? [deps.provider] : null);
  const providers = injected
    ? new Map(injected.map((p) => [p.id, p]))
    : createProviders(config, { now, logger, lookupCheckout, fetchImpl: deps.fetchImpl });
  const hasMock = providers.has('mock') && !config.isProduction;
  const sessions = createSessionStore(db, { ttlMs: config.sessionTtlDays * DAY_MS, now });
  const cookie = sessionCookie(config);
  const appBaseUrl = () => config.publicBaseUrl ?? `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
  const billing = createBillingService({ db, config, providers, now, logger, audit, mailer, appBaseUrl });
  const renewals = createRenewalScheduler({ db, config, billing, providers, mailer, now, logger });
  const limiters = createLimiters(config, now);
  const baseUrlOf = (/** @type {import('express').Request} */ req) => serverOrigin(req, config);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false); // API responses are no-store; static files get ETags from express.static

  const formActionOrigins = [...new Set([...providers.values()].flatMap((p) => p.cspFormActionOrigins))];
  app.use(securityHeaders({ isProduction: config.isProduction, formActionOrigins }));

  // ---- JSON API ------------------------------------------------------------------------------
  const api = express.Router();
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(apiCsrfGuard(config, {
    skip: (req) => req.path.startsWith('/webhooks/'),
    allowForm: (req) => hasMock && req.path.startsWith('/billing/mock/'),
  }));
  api.use(webhookRoutes({ providers, billing, logger })); // raw body: before express.json()
  api.use(express.json({ limit: '32kb', type: 'application/json', strict: true }));
  api.use(loadSession({ sessions, db, cookie }));
  api.get('/health', (_req, res) => { res.json({ ok: true }); });
  api.use(authRoutes({ db, config, sessions, cookie, billing, mailer, limiters, audit, now, logger, baseUrlOf }));
  api.use(billingRoutes({ config, billing, limiters, baseUrlOf }));
  if (hasMock) {
    api.use('/billing/mock', mockCheckoutRouter({ config, billing, db, now, baseUrlOf, returnUrls }));
  }
  api.use(notFound);
  app.use('/api', api);

  // ---- Static site + PWA ---------------------------------------------------------------------
  app.use(staticRoutes({ publicDir: deps.publicDir ?? DEFAULT_PUBLIC_DIR, isProduction: config.isProduction }));
  app.use(notFound);
  app.use(errorHandler(logger));

  // ---- Housekeeping --------------------------------------------------------------------------
  const maintenance = () => {
    try {
      const expiredSessions = sessions.purgeExpired();
      db.run('DELETE FROM password_resets WHERE expires_at < ?', now() - DAY_MS);
      billing.maintenance();
      for (const l of Object.values(limiters)) l.sweep();
      return expiredSessions;
    } catch (err) {
      logger.error('[maintenance] failed:', err);
      return 0;
    }
  };
  maintenance();
  const timer = deps.maintenanceTimer === false ? null : setInterval(maintenance, 60 * 60 * 1000);
  timer?.unref();

  app.locals.services = { db, sessions, billing, mailer, providers, renewals, limiters, config, audit, maintenance };
  app.locals.close = () => {
    if (timer) clearInterval(timer);
    renewals.stop();
    db.close();
  };
  return app;
}
