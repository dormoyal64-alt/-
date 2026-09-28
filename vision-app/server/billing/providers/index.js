// @ts-check
/**
 * Payment provider registry. See README.md in this folder for the adapter contract.
 */
import { createMockProvider } from './mock.js';
import { createPayPlusProvider } from './payplus.js';
import { createPaddleProvider } from './paddle.js';

export { WebhookVerificationError, ProviderError } from './errors.js';

/**
 * @typedef {object} CheckoutRequest
 * @property {{id: string, email: string, lang: string}} user
 * @property {import('../plans.js').Plan} plan      plan with the region's price/currency
 * @property {number} amount                         minor units, VAT included (= plan.price)
 * @property {string} currency
 * @property {'IL'|'INTL'} region
 * @property {'auto'|'manual'} renewal
 * @property {'new'|'renew'} kind
 * @property {string} checkoutId        our checkout_sessions.id (put it in provider metadata)
 * @property {string} successUrl        absolute URL to return to after payment
 * @property {string} cancelUrl         absolute URL to return to when the user abandons / payment fails
 * @property {string} callbackUrl       absolute URL of our webhook for this provider
 * @property {string} baseUrl           this server's origin
 * @property {number|null} trialEndsAt  epoch ms if the free trial is still running
 */

/**
 * @typedef {object} ChargeResult
 * @property {'succeeded'|'declined'} status
 * @property {string} [providerTxId]
 * @property {string|null} [invoiceUrl]
 * @property {string} [error]
 */

/**
 * @typedef {object} PaymentProvider
 * @property {string} id                                   matches /api/webhooks/:provider and subscriptions.provider
 * @property {'IL'|'INTL'|null} region                     region this provider serves (null = any, e.g. mock)
 * @property {string[]} cspFormActionOrigins               origins added to CSP form-action
 * @property {{managesRenewals: boolean, tokenCharges: boolean, refunds: boolean, signedWebhooks: boolean}} capabilities
 * @property {(req: CheckoutRequest) => Promise<{url: string, providerRef: string}>} createCheckout
 * @property {(sub: import('../service.js').SubscriptionRow, opts?: {immediate?: boolean}) => Promise<void>} cancelSubscription
 * @property {(sub: import('../service.js').SubscriptionRow) => Promise<void>} resumeSubscription  throw an Error with code 'NOT_SUPPORTED' if impossible
 * @property {(rawBody: Buffer, headers: import('node:http').IncomingHttpHeaders) => Promise<import('../service.js').NormalizedEvent[]>|import('../service.js').NormalizedEvent[]} verifyAndParseWebhook
 *   must throw WebhookVerificationError on a bad signature / payload
 * @property {(providerRef: string) => Promise<import('../service.js').NormalizedEvent[]>} [confirmCheckout]
 *   authoritative server-to-server re-query of a hosted checkout (PayPlus); [] if not paid
 * @property {(req: {tokenRef: string, customerRef: string|null, amount: number, currency: string, idempotencyKey: string}) => Promise<ChargeResult>} [chargeToken]
 *   throws when the outcome is unknown (network error / timeout): the caller must NOT retry blindly
 * @property {(req: {providerTxId: string, amount: number, currency: string}) => Promise<{refundId: string|null, status: 'refunded'|'pending'}>} [refund]
 */

/**
 * @typedef {object} CheckoutLookupRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} plan
 * @property {number|null} amount
 * @property {string|null} currency
 * @property {string} status
 * @property {'new'|'renew'} kind
 * @property {string|null} subscription_psid   provider_subscription_id of the subscription being renewed
 */

/**
 * @param {import('../../config.js').Config} config
 * @param {{now: () => number, logger: {info: Function, warn: Function, error: Function},
 *   lookupCheckout: (providerId: string, providerRef: string) => CheckoutLookupRow|null, fetchImpl?: typeof fetch}} deps
 * @returns {Map<string, PaymentProvider>}
 */
export function createProviders(config, deps) {
  /** @type {Map<string, PaymentProvider>} */
  const map = new Map();
  const add = (/** @type {PaymentProvider} */ p) => map.set(p.id, p);
  const mode = config.paymentProvider;
  if (mode === 'mock') {
    if (config.isProduction) throw new Error('The mock payment provider cannot be used in production');
    add(createMockProvider({ webhookSecret: config.mockWebhookSecret, now: deps.now }));
  }
  if (mode === 'payplus' || mode === 'auto') {
    add(createPayPlusProvider({
      ...config.payplus, fetchImpl: deps.fetchImpl, logger: deps.logger, now: deps.now,
      lookupCheckout: (ref) => deps.lookupCheckout('payplus', ref),
    }));
  }
  if (mode === 'paddle' || mode === 'auto') {
    add(createPaddleProvider({ ...config.paddle, fetchImpl: deps.fetchImpl, logger: deps.logger, now: deps.now }));
  }
  if (!map.size) throw new Error(`Unsupported PAYMENT_PROVIDER "${mode}"`);
  return map;
}
