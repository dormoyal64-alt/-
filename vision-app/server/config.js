// @ts-check
/**
 * Environment parsing and validation. Every setting the server reads lives here.
 * `loadConfig(env)` throws a ConfigError listing ALL problems at once, so a misconfigured
 * production deploy fails fast with one clear message (see server/.env.example).
 */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { buildPlans } from './billing/plans.js';

export class ConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** Payment providers that have an adapter in server/billing/providers/. */
export const KNOWN_PROVIDERS = ['mock'];
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
 * @property {string} paymentProvider
 * @property {string} currency
 * @property {import('./billing/plans.js').Plan[]} plans
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

  const paymentProvider = (str('PAYMENT_PROVIDER') ?? 'mock').toLowerCase();
  if (!KNOWN_PROVIDERS.includes(paymentProvider)) {
    problems.push(`PAYMENT_PROVIDER "${paymentProvider}" is not supported (available: ${KNOWN_PROVIDERS.join(', ')})`);
  }
  if (isProduction && paymentProvider === 'mock') {
    problems.push('PAYMENT_PROVIDER=mock is refused in production: configure a real payment provider');
  }

  const currency = (str('CURRENCY') ?? 'ILS').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) problems.push(`CURRENCY must be an ISO-4217 code like ILS (got "${currency}")`);

  const prices = {
    monthly: int('PRICE_MONTHLY', 2990, 1, 100_000_000),
    quarterly: int('PRICE_QUARTERLY', 7990, 1, 100_000_000),
    yearly: int('PRICE_YEARLY', 24900, 1, 100_000_000),
  };
  const plans = buildPlans({ prices, currency });

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

  const termsVersion = str('TERMS_VERSION') ?? '2026-09-27';
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
    sessionTtlDays, trialDays, paymentProvider, currency, plans, mailProvider, mailHttpUrl, mailHttpToken,
    mailFrom, trustProxy, termsVersion, appName, mockWebhookSecret, rateLimitIpScale,
  });
}
