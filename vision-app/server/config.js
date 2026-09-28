// @ts-check
/**
 * Environment parsing and validation. Every setting the server reads lives here.
 * `loadConfig(env)` throws a ConfigError listing ALL problems at once, so a misconfigured
 * production deploy fails fast with one clear message (see server/.env.example).
 */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { buildPlans } from './billing/plans.js';
import { renewalFor } from './billing/pricing.js';

export class ConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * PAYMENT_PROVIDER values. 'auto' routes Israeli customers (IL / ILS) to PayPlus and everyone else to
 * Paddle; a single provider name forces that provider for everyone; 'mock' is for development/tests.
 */
export const KNOWN_PROVIDERS = ['mock', 'payplus', 'paddle', 'auto'];
const MAIL_PROVIDERS = ['console', 'http'];
const NODE_ENVS = ['development', 'test', 'production'];

/**
 * @typedef {object} Config
 * @property {'development'|'test'|'production'} nodeEnv
 * @property {boolean} isProduction
 * @property {number} port
 * @property {string} host
 * @property {string|null} publicBaseUrl   origin only, e.g. "https://app.example.co.il" (no trailing slash)
 * @property {string} dataDir              absolute path, or ':memory:'
 * @property {string} sessionSecret
 * @property {boolean} sessionSecretGenerated
 * @property {number} sessionTtlDays
 * @property {number} trialDays
 * @property {'mock'|'payplus'|'paddle'|'auto'} paymentProvider
 * @property {string} currency              Israeli (IL region) price-list currency, default ILS
 * @property {import('./billing/plans.js').Plan[]} plans   IL region plans (kept for backwards compatibility)
 * @property {{IL: import('./billing/pricing.js').RegionPricing, INTL: import('./billing/pricing.js').RegionPricing}} pricing
 * @property {number} pastDueGraceDays
 * @property {number} refundWindowDays
 * @property {number} renewWindowDays
 * @property {number} monthlyReminderDays
 * @property {number} renewalReminderDays
 * @property {number} renewalIntervalMinutes
 * @property {string|null} geoCountryHeader
 * @property {{env: 'sandbox'|'production', apiBase: string, apiKey: string|null, secretKey: string|null, pageUid: string|null, terminalUid: string|null}} payplus
 * @property {{env: 'sandbox'|'production', apiBase: string, apiKey: string|null, webhookSecret: string|null, toleranceSec: number, priceIds: Record<'monthly'|'quarterly'|'yearly', string|null>}} paddle
 * @property {'console'|'http'} mailProvider
 * @property {string|null} mailHttpUrl
 * @property {string|null} mailHttpToken
 * @property {string} mailFrom
 * @property {boolean|number|string} trustProxy
 * @property {string} termsVersion
 * @property {string} appName
 * @property {string} mockWebhookSecret
 * @property {number} rateLimitIpScale
 */

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  /** @type {string[]} */
  const problems = [];
  const str = (/** @type {string} */ k) => {
    const v = env[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const int = (/** @type {string} */ k, /** @type {number} */ def, /** @type {number} */ min, /** @type {number} */ max) => {
    const raw = str(k);
    if (raw === undefined) return def;
    if (!/^\d+$/.test(raw)) { problems.push(`${k} must be an integer (got "${raw}")`); return def; }
    const n = Number(raw);
    if (n < min || n > max) { problems.push(`${k} must be between ${min} and ${max} (got ${n})`); return def; }
    return n;
  };

  const nodeEnvRaw = str('NODE_ENV') ?? 'development';
  if (!NODE_ENVS.includes(nodeEnvRaw)) problems.push(`NODE_ENV must be one of ${NODE_ENVS.join(', ')} (got "${nodeEnvRaw}")`);
  const nodeEnv = /** @type {Config['nodeEnv']} */ (NODE_ENVS.includes(nodeEnvRaw) ? nodeEnvRaw : 'development');
  const isProduction = nodeEnv === 'production';

  const port = int('PORT', 3000, 0, 65535);
  const host = str('HOST') ?? (isProduction ? '0.0.0.0' : '127.0.0.1');

  /** @type {string|null} */
  let publicBaseUrl = null;
  const baseRaw = str('PUBLIC_BASE_URL');
  if (baseRaw) {
    try {
      const u = new URL(baseRaw);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
      if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) {
        problems.push('PUBLIC_BASE_URL must be an origin only, e.g. https://app.example.co.il (no path, query or credentials)');
      }
      if (isProduction && u.protocol !== 'https:') problems.push('PUBLIC_BASE_URL must use https:// in production');
      publicBaseUrl = u.origin;
    } catch {
      problems.push(`PUBLIC_BASE_URL is not a valid http(s) URL (got "${baseRaw}")`);
    }
  } else if (isProduction) {
    problems.push('PUBLIC_BASE_URL is required in production (used for payment redirects, e-mail links and the Origin check)');
  }

  const dataRaw = str('DATA_DIR') ?? './data';
  const dataDir = dataRaw === ':memory:' ? ':memory:' : resolve(dataRaw);

  let sessionSecret = str('SESSION_SECRET');
  let sessionSecretGenerated = false;
  if (!sessionSecret) {
    if (isProduction) problems.push('SESSION_SECRET is required in production (at least 32 characters; e.g. `openssl rand -base64 48`)');
    sessionSecret = randomBytes(32).toString('base64url');
    sessionSecretGenerated = true;
  } else if (sessionSecret.length < 32) {
    if (isProduction) problems.push(`SESSION_SECRET must be at least 32 characters (got ${sessionSecret.length})`);
  }

  const trialDays = int('TRIAL_DAYS', 30, 0, 365);
  const sessionTtlDays = int('SESSION_TTL_DAYS', 30, 1, 365);

  const paymentProvider = /** @type {Config['paymentProvider']} */ ((str('PAYMENT_PROVIDER') ?? 'mock').toLowerCase());
  if (!KNOWN_PROVIDERS.includes(paymentProvider)) {
    problems.push(`PAYMENT_PROVIDER "${paymentProvider}" is not supported (available: ${KNOWN_PROVIDERS.join(', ')})`);
  }
  if (isProduction && paymentProvider === 'mock') {
    problems.push('PAYMENT_PROVIDER=mock is refused in production: configure a real payment provider');
  }

  const currency = (str('CURRENCY') ?? 'ILS').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) problems.push(`CURRENCY must be an ISO-4217 code like ILS (got "${currency}")`);

  // Placeholder prices from docs/research/business-legal-payments.md section 6.3 (VAT included).
  const prices = {
    monthly: int('PRICE_MONTHLY', 2490, 1, 100_000_000),
    quarterly: int('PRICE_QUARTERLY', 5990, 1, 100_000_000),
    yearly: int('PRICE_YEARLY', 17990, 1, 100_000_000),
  };
  const intlCurrency = (str('INTL_CURRENCY') ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(intlCurrency)) problems.push(`INTL_CURRENCY must be an ISO-4217 code like USD (got "${intlCurrency}")`);
  const intlPrices = {
    monthly: int('PRICE_INTL_MONTHLY', 599, 1, 100_000_000),
    quarterly: int('PRICE_INTL_QUARTERLY', 1499, 1, 100_000_000),
    yearly: int('PRICE_INTL_YEARLY', 4499, 1, 100_000_000),
  };
  const plans = buildPlans({ prices, currency });
  const pricing = {
    IL: { region: /** @type {'IL'} */ ('IL'), currency, plans },
    INTL: { region: /** @type {'INTL'} */ ('INTL'), currency: intlCurrency, plans: buildPlans({ prices: intlPrices, currency: intlCurrency }) },
  };
  void renewalFor; // (imported for the JSDoc types of RegionPricing consumers)

  const pastDueGraceDays = int('PAST_DUE_GRACE_DAYS', 7, 0, 60);
  const refundWindowDays = int('REFUND_WINDOW_DAYS', 14, 0, 365);
  const renewWindowDays = int('RENEW_WINDOW_DAYS', 30, 1, 365);
  const monthlyReminderDays = int('MONTHLY_REMINDER_DAYS', 3, 0, 27);
  const renewalReminderDays = int('RENEWAL_REMINDER_DAYS', 7, 0, 60);
  const renewalIntervalMinutes = int('RENEWAL_INTERVAL_MINUTES', 60, 0, 24 * 60);
  const geoCountryHeader = str('GEO_COUNTRY_HEADER')?.toLowerCase() ?? null;

  const envOf = (/** @type {string} */ k) => {
    const v = (str(k) ?? 'sandbox').toLowerCase();
    if (v === 'staging' || v === 'sandbox') return /** @type {'sandbox'} */ ('sandbox');
    if (v === 'production') return /** @type {'production'} */ ('production');
    problems.push(`${k} must be "sandbox" or "production" (got "${v}")`);
    return /** @type {'sandbox'} */ ('sandbox');
  };
  const usesPayplus = paymentProvider === 'payplus' || paymentProvider === 'auto';
  const usesPaddle = paymentProvider === 'paddle' || paymentProvider === 'auto';

  const payplusEnv = envOf('PAYPLUS_ENV');
  const payplus = {
    env: payplusEnv,
    apiBase: (str('PAYPLUS_API_BASE') ?? (payplusEnv === 'production'
      ? 'https://restapi.payplus.co.il/api/v1.0/' : 'https://restapidev.payplus.co.il/api/v1.0/')).replace(/\/?$/, '/'),
    apiKey: str('PAYPLUS_API_KEY') ?? null,
    secretKey: str('PAYPLUS_SECRET_KEY') ?? null,
    pageUid: str('PAYPLUS_PAGE_UID') ?? null,
    terminalUid: str('PAYPLUS_TERMINAL_UID') ?? null,
  };
  if (usesPayplus) {
    for (const [k, v] of [['PAYPLUS_API_KEY', payplus.apiKey], ['PAYPLUS_SECRET_KEY', payplus.secretKey],
      ['PAYPLUS_PAGE_UID', payplus.pageUid], ['PAYPLUS_TERMINAL_UID', payplus.terminalUid]]) {
      if (!v) problems.push(`${k} is required when PAYMENT_PROVIDER=${paymentProvider}`);
    }
    if (isProduction && payplusEnv !== 'production') problems.push('PAYPLUS_ENV must be "production" when NODE_ENV=production');
  }

  const paddleEnv = envOf('PADDLE_ENV');
  const paddle = {
    env: paddleEnv,
    apiBase: (str('PADDLE_API_BASE') ?? (paddleEnv === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com')).replace(/\/$/, ''),
    apiKey: str('PADDLE_API_KEY') ?? null,
    webhookSecret: str('PADDLE_WEBHOOK_SECRET') ?? null,
    toleranceSec: int('PADDLE_WEBHOOK_TOLERANCE_SEC', 5, 1, 3600),
    priceIds: {
      monthly: str('PADDLE_PRICE_MONTHLY') ?? null,
      quarterly: str('PADDLE_PRICE_QUARTERLY') ?? null,
      yearly: str('PADDLE_PRICE_YEARLY') ?? null,
    },
  };
  if (usesPaddle) {
    for (const [k, v] of [['PADDLE_API_KEY', paddle.apiKey], ['PADDLE_WEBHOOK_SECRET', paddle.webhookSecret],
      ['PADDLE_PRICE_MONTHLY', paddle.priceIds.monthly], ['PADDLE_PRICE_QUARTERLY', paddle.priceIds.quarterly],
      ['PADDLE_PRICE_YEARLY', paddle.priceIds.yearly]]) {
      if (!v) problems.push(`${k} is required when PAYMENT_PROVIDER=${paymentProvider}`);
    }
    if (isProduction && paddleEnv !== 'production') problems.push('PADDLE_ENV must be "production" when NODE_ENV=production');
  }

  const mailProvider = /** @type {Config['mailProvider']} */ ((str('MAIL_PROVIDER') ?? 'console').toLowerCase());
  if (!MAIL_PROVIDERS.includes(mailProvider)) problems.push(`MAIL_PROVIDER must be one of ${MAIL_PROVIDERS.join(', ')} (got "${mailProvider}")`);
  const mailHttpUrl = str('MAIL_HTTP_URL') ?? null;
  const mailHttpToken = str('MAIL_HTTP_TOKEN') ?? null;
  if (mailProvider === 'http') {
    if (!mailHttpUrl) problems.push('MAIL_HTTP_URL is required when MAIL_PROVIDER=http');
    else {
      try {
        const u = new URL(mailHttpUrl);
        if (isProduction && u.protocol !== 'https:') problems.push('MAIL_HTTP_URL must use https:// in production');
      } catch { problems.push('MAIL_HTTP_URL is not a valid URL'); }
    }
  }
  const mailFrom = str('MAIL_FROM') ?? 'no-reply@localhost';

  /** @type {boolean|number|string} */
  let trustProxy = false;
  const tp = str('TRUST_PROXY');
  if (tp !== undefined) {
    if (tp === 'true') trustProxy = true;
    else if (tp === 'false') trustProxy = false;
    else if (/^\d+$/.test(tp)) trustProxy = Number(tp);
    else trustProxy = tp; // e.g. "loopback" or "10.0.0.0/8, 127.0.0.1"
  }

  const termsVersion = str('TERMS_VERSION') ?? '2026-09-28';
  const appName = str('APP_NAME') ?? 'VisionApp';

  const mockWebhookSecret = str('MOCK_WEBHOOK_SECRET') ?? 'mock-webhook-secret-for-development-only';

  let rateLimitIpScale = nodeEnv === 'test' ? 20 : 1;
  const scaleRaw = str('RATE_LIMIT_IP_SCALE');
  if (scaleRaw !== undefined) {
    const n = Number(scaleRaw);
    if (!Number.isFinite(n) || n < 1 || n > 1000) problems.push('RATE_LIMIT_IP_SCALE must be a number between 1 and 1000');
    else if (isProduction && n !== 1) problems.push('RATE_LIMIT_IP_SCALE cannot be changed in production');
    else rateLimitIpScale = n;
  }

  if (problems.length) throw new ConfigError(problems);

  return Object.freeze({
    nodeEnv, isProduction, port, host, publicBaseUrl, dataDir, sessionSecret, sessionSecretGenerated,
    sessionTtlDays, trialDays, paymentProvider, currency, plans, pricing, pastDueGraceDays, refundWindowDays,
    renewWindowDays, monthlyReminderDays, renewalReminderDays, renewalIntervalMinutes, geoCountryHeader, payplus, paddle,
    mailProvider, mailHttpUrl, mailHttpToken, mailFrom, trustProxy, termsVersion, appName, mockWebhookSecret, rateLimitIpScale,
  });
}
