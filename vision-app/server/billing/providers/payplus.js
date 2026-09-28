// @ts-check
/**
 * PayPlus adapter (Israel, ILS). docs/research/business-legal-payments.md sections 1.6.1 and 1.7.
 *
 * - Checkout: PaymentPages/generateLink (hosted page, card data never touches us), create_token=true so
 *   the monthly plan can be renewed by OUR scheduler (server/billing/renewals.js) with chargeToken().
 * - Callback (refURL_callback -> POST /api/webhooks/payplus): user-agent must be exactly "PayPlus" and
 *   header `hash` = base64(HMAC-SHA256(secret_key, RAW body)); fallback variant: the hash of
 *   JSON.stringify(JSON.parse(raw)) (docs sample). The callback is only a signal: access is granted only
 *   after re-querying PaymentPages/ipn and checking amount + currency against the stored checkout.
 * - Outgoing auth: header `Authorization: {"api_key":"…","secret_key":"…"}` (a JSON string).
 * Fields marked [CHECK] must be confirmed against the PayPlus portal / staging before go-live.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookVerificationError, ProviderError } from './errors.js';

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** @param {number} minor */
const toMajor = (minor) => Math.round(minor) / 100;
/** @param {unknown} major */
const toMinor = (major) => {
  const n = Number(major);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
/** @param {unknown} v */
const header1 = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * Verifies a PayPlus callback signature.
 * @param {Buffer} rawBody
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {string} secretKey
 * @returns {'raw'|'reserialized'|null} which signed-payload variant matched, or null
 */
export function verifyPayPlusSignature(rawBody, headers, secretKey) {
  if (header1(headers['user-agent']) !== 'PayPlus') return null;
  const hash = header1(headers.hash);
  if (typeof hash !== 'string' || !B64.test(hash.trim())) return null;
  const given = Buffer.from(hash.trim(), 'base64');
  if (given.length !== 32) return null;
  const mac = (/** @type {Buffer|string} */ data) => createHmac('sha256', secretKey).update(data).digest();
  if (timingSafeEqual(mac(rawBody), given)) return 'raw';
  let reserialized;
  try { reserialized = JSON.stringify(JSON.parse(rawBody.toString('utf8'))); } catch { return null; }
  if (timingSafeEqual(mac(reserialized), given)) return 'reserialized';
  return null;
}

/**
 * @param {{env: 'sandbox'|'production', apiBase: string, apiKey: string|null, secretKey: string|null, pageUid: string|null,
 *   terminalUid: string|null, fetchImpl?: typeof fetch, logger: {info: Function, warn: Function, error: Function}, now: () => number,
 *   lookupCheckout: (providerRef: string) => import('./index.js').CheckoutLookupRow|null, timeoutMs?: number}} opts
 * @returns {import('./index.js').PaymentProvider}
 */
export function createPayPlusProvider(opts) {
  const { env, apiBase, apiKey, secretKey, pageUid, terminalUid, logger, now, lookupCheckout } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const authHeader = JSON.stringify({ api_key: apiKey, secret_key: secretKey });
  /** @type {Set<string>} */
  const variantsSeen = new Set();

  /** @param {string} path @param {object} body @returns {Promise<any>} */
  async function api(path, body) {
    let res;
    try {
      res = await fetchImpl(apiBase + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ProviderError(`PayPlus ${path}: ${err instanceof Error ? err.message : 'network error'}`);
    }
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    if (res.status >= 500 || !json) throw new ProviderError(`PayPlus ${path}: HTTP ${res.status}`, { status: res.status });
    return json;
  }
  const succeeded = (/** @type {any} */ json) => json?.results?.status === 'success';

  /**
   * Authoritative re-query of a payment page (never trust the callback body itself).
   * @param {string} ref page_request_uid
   * @returns {Promise<import('../service.js').NormalizedEvent[]>}
   */
  async function confirmCheckout(ref) {
    const checkout = lookupCheckout(ref);
    if (!checkout) return [];
    const json = await api('PaymentPages/ipn', { payment_request_uid: ref });
    const d = json?.data ?? {};
    const tx = d.transaction ?? d;
    const statusCode = String(tx.status_code ?? d.status_code ?? '');
    if (!succeeded(json) || statusCode !== '000') {
      logger.info(`[payplus] page ${ref} not approved (status ${statusCode || 'unknown'})`);
      return [];
    }
    const amount = toMinor(tx.amount ?? d.amount);
    const currency = String(tx.currency ?? tx.currency_code ?? d.currency ?? d.currency_code ?? '').toUpperCase();
    if (amount !== checkout.amount || currency !== checkout.currency) {
      logger.error(`[payplus] AMOUNT MISMATCH for page ${ref}: got ${amount} ${currency}, expected ${checkout.amount} ${checkout.currency}`);
      throw new WebhookVerificationError('amount or currency differs from the checkout session', 'AMOUNT_MISMATCH');
    }
    const txUid = String(tx.uid ?? tx.transaction_uid ?? d.transaction_uid ?? '');
    if (!txUid) throw new WebhookVerificationError('re-query returned no transaction uid', 'INVALID_PAYLOAD');
    const tokenRef = d.token_uid ?? tx.token_uid ?? d.card_information?.token ?? tx.card_information?.token ?? null; // [CHECK]
    const customerRef = d.customer_uid ?? tx.customer_uid ?? null; // [CHECK]
    const invoiceUrl = d.invoice_original_url ?? tx.invoice_original_url ?? null; // [CHECK]
    const psid = checkout.kind === 'renew' && checkout.subscription_psid ? checkout.subscription_psid : ref;
    const t = now();
    /** @type {import('../service.js').NormalizedEvent[]} */
    const events = [{
      eventId: `${txUid}:${statusCode}`,
      type: checkout.kind === 'renew' ? 'subscription.renewed' : 'subscription.activated',
      userId: checkout.user_id, providerSubscriptionId: psid, providerCustomerId: customerRef ?? undefined,
      providerTokenRef: tokenRef ?? undefined, plan: checkout.plan, occurredAt: t, checkoutRef: ref,
    }, {
      eventId: `${txUid}:${statusCode}:invoice`, type: 'invoice.issued', userId: checkout.user_id, providerSubscriptionId: psid,
      plan: checkout.plan, occurredAt: t,
      invoice: { providerInvoiceId: txUid, amount, currency, status: 'paid', url: invoiceUrl, issuedAt: t, plan: checkout.plan },
    }];
    return events;
  }

  return {
    id: 'payplus',
    region: 'IL',
    cspFormActionOrigins: [env === 'production' ? 'https://payments.payplus.co.il' : 'https://paymentsdev.payplus.co.il'],
    capabilities: { managesRenewals: false, tokenCharges: true, refunds: true, signedWebhooks: true },

    async createCheckout({ user, plan, amount, currency, checkoutId, successUrl, cancelUrl, callbackUrl }) {
      const json = await api('PaymentPages/generateLink', {
        payment_page_uid: pageUid,
        charge_method: 1, // immediate charge [CHECK]
        amount: toMajor(amount),
        currency_code: currency,
        create_token: true,
        refURL_success: successUrl,
        refURL_failure: cancelUrl,
        refURL_callback: callbackUrl,
        sendEmailApproval: true,
        sendEmailFailure: false,
        language_code: user.lang === 'en' ? 'en' : 'he',
        customer: { customer_name: user.email, email: user.email },
        items: [{ name: `${plan.id} plan`, quantity: 1, price: toMajor(amount), vat_type: 0 }], // VAT included [CHECK vat_type]
        more_info: checkoutId,
        more_info_1: user.id,
        more_info_2: plan.id,
      });
      const url = json?.data?.payment_page_link;
      const ref = json?.data?.page_request_uid;
      if (!succeeded(json) || typeof url !== 'string' || typeof ref !== 'string' || !/^https:\/\//.test(url)) {
        throw new ProviderError(`PayPlus generateLink failed: ${json?.results?.description ?? 'unexpected response'}`);
      }
      return { url, providerRef: ref };
    },

    // We schedule renewals ourselves (no PayPlus standing order), so there is nothing to stop remotely:
    // clearing our subscription state stops future token charges.
    async cancelSubscription() {},
    async resumeSubscription() {},

    async verifyAndParseWebhook(rawBody, headers) {
      const variant = verifyPayPlusSignature(rawBody, headers, /** @type {string} */ (secretKey));
      if (!variant) throw new WebhookVerificationError('PayPlus signature mismatch or wrong user-agent');
      if (!variantsSeen.has(variant)) {
        variantsSeen.add(variant);
        logger.info(`[payplus] callback signature matched the "${variant}" variant`);
      }
      let body;
      try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw new WebhookVerificationError('body is not JSON', 'INVALID_PAYLOAD'); }
      const ref = body?.transaction?.payment_page_request_uid ?? body?.payment_page_request_uid
        ?? body?.page_request_uid ?? body?.data?.page_request_uid; // [CHECK]
      if (typeof ref !== 'string' || !ref) return []; // not a payment-page callback (e.g. our own token charge)
      return confirmCheckout(ref);
    },

    confirmCheckout,

    async chargeToken({ tokenRef, customerRef, amount, currency, idempotencyKey }) {
      const json = await api('Transactions/Charge', { // [CHECK endpoint + fields]
        terminal_uid: terminalUid,
        use_token: true,
        token: tokenRef,
        customer_uid: customerRef ?? undefined,
        amount: toMajor(amount),
        currency_code: currency,
        charge_method: 1,
        credit_terms: 1,
        initial_invoice: true,
        more_info: idempotencyKey,
      });
      const tx = json?.data?.transaction ?? json?.data ?? {};
      const statusCode = String(tx.status_code ?? '');
      if (succeeded(json) && statusCode === '000') {
        const charged = toMinor(tx.amount ?? toMajor(amount));
        if (charged !== amount) throw new ProviderError(`PayPlus charged ${charged} instead of ${amount}`);
        return { status: 'succeeded', providerTxId: String(tx.uid ?? tx.transaction_uid ?? ''), invoiceUrl: tx.invoice_original_url ?? null };
      }
      if (json?.results?.status === 'error' || statusCode) {
        return { status: 'declined', error: String(json?.results?.description ?? statusCode) };
      }
      throw new ProviderError('PayPlus charge: indeterminate response');
    },

    async refund({ providerTxId, amount }) {
      const json = await api('Transactions/RefundByTransactionUID', {
        transaction_uid: providerTxId,
        amount: toMajor(amount),
        more_info: 'cancellation within the statutory 14-day window',
      });
      if (!succeeded(json)) throw new ProviderError(`PayPlus refund failed: ${json?.results?.description ?? 'unknown'}`);
      return { refundId: json?.data?.transaction?.uid ?? json?.data?.uid ?? null, status: 'refunded' };
    },
  };
}
