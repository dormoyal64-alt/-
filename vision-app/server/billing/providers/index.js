// @ts-check
/**
 * Payment provider registry. See README.md in this folder for the adapter contract.
 */
import { createMockProvider } from './mock.js';

export { WebhookVerificationError } from './errors.js';

/**
 * @typedef {object} CheckoutRequest
 * @property {{id: string, email: string, lang: string}} user
 * @property {import('../plans.js').Plan} plan
 * @property {string} checkoutId        our checkout_sessions.id (put it in provider metadata)
 * @property {string} successUrl        absolute URL to return to after payment
 * @property {string} cancelUrl         absolute URL to return to when the user abandons payment
 * @property {string} baseUrl           this server's origin
 * @property {number|null} trialEndsAt  epoch ms if the free trial is still running (defer first charge)
 */

/**
 * @typedef {object} PaymentProvider
 * @property {string} id                                   matches PAYMENT_PROVIDER and /api/webhooks/:provider
 * @property {string[]} cspFormActionOrigins               origins added to CSP form-action
 * @property {(req: CheckoutRequest) => Promise<{url: string, providerRef: string}>} createCheckout
 * @property {(sub: import('../service.js').SubscriptionRow, opts?: {immediate?: boolean}) => Promise<void>} cancelSubscription
 * @property {(sub: import('../service.js').SubscriptionRow) => Promise<void>} resumeSubscription  throw an Error with code 'NOT_SUPPORTED' if impossible
 * @property {(rawBody: Buffer, headers: import('node:http').IncomingHttpHeaders) => Promise<import('../service.js').NormalizedEvent[]>|import('../service.js').NormalizedEvent[]} verifyAndParseWebhook
 *   must throw WebhookVerificationError on a bad signature / payload
 */

/**
 * @param {import('../../config.js').Config} config
 * @param {{now: () => number, logger: {info: Function, warn: Function, error: Function}}} deps
 * @returns {PaymentProvider}
 */
export function createProvider(config, deps) {
  switch (config.paymentProvider) {
    case 'mock':
      if (config.isProduction) throw new Error('The mock payment provider cannot be used in production');
      return createMockProvider({ webhookSecret: config.mockWebhookSecret, now: deps.now });
    default:
      throw new Error(`Unsupported PAYMENT_PROVIDER "${config.paymentProvider}"`);
  }
}
