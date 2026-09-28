// @ts-check
/**
 * Paddle Billing adapter (international; Paddle is Merchant of Record and runs the renewals).
 * docs/research/business-legal-payments.md sections 1.6.2 and 1.7.
 *
 * - Checkout: POST /transactions with the plan's price id (PADDLE_PRICE_*) and custom_data {userId,
 *   checkoutId, plan}; the user is sent to the transaction's `checkout.url`. Configure the "default payment
 *   link" in Paddle to a Paddle-hosted checkout: our CSP does not allow Paddle.js on our own pages.
 * - Webhook: header `Paddle-Signature: ts=<unix>;h1=<hex>[;h1=<hex>]`; HMAC-SHA256 (hex) over
 *   `${ts}:${rawBody}` with the notification destination secret; reject when now > ts + tolerance
 *   (default 5 s); accept if ANY h1 matches (secret rotation); constant-time comparison.
 * - API auth: `Authorization: Bearer <PADDLE_API_KEY>`.
 * Fields marked [CHECK] must be confirmed in the Paddle sandbox before go-live.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookVerificationError, ProviderError } from './errors.js';

/**
 * @param {Buffer} rawBody
 * @param {string|undefined} header   value of Paddle-Signature
 * @param {string} secret
 * @param {number} nowMs
 * @param {number} toleranceSec
 * @returns {{ok: boolean, reason?: string}}
 */
export function verifyPaddleSignature(rawBody, header, secret, nowMs, toleranceSec = 5) {
  if (typeof header !== 'string' || !header) return { ok: false, reason: 'missing Paddle-Signature header' };
  let ts = null;
  /** @type {string[]} */
  const h1s = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 'ts') ts = v;
    else if (k === 'h1') h1s.push(v);
  }
  if (!ts || !/^\d{1,12}$/.test(ts)) return { ok: false, reason: 'missing or malformed ts' };
  if (!h1s.length) return { ok: false, reason: 'missing h1' };
  if (nowMs > (Number(ts) + toleranceSec) * 1000) return { ok: false, reason: 'stale signature timestamp' };
  const mac = createHmac('sha256', secret).update(`${ts}:`).update(rawBody).digest();
  let match = false;
  for (const h1 of h1s) {
    if (/^[0-9a-f]{64}$/i.test(h1) && timingSafeEqual(mac, Buffer.from(h1, 'hex'))) match = true;
  }
  return match ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

/**
 * Maps a verified Paddle notification to normalized events. Unknown types map to [] (acknowledged, ignored).
 * @param {any} body
 * @param {Record<string, string|null>} priceIds planId -> Paddle price id
 * @returns {import('../service.js').NormalizedEvent[]}
 */
export function mapPaddleEvent(body, priceIds) {
  const type = body?.event_type;
  const eventId = body?.event_id;
  const d = body?.data ?? {};
  if (typeof type !== 'string' || typeof eventId !== 'string' || !eventId) {
    throw new WebhookVerificationError('notification needs event_id and event_type', 'INVALID_PAYLOAD');
  }
  const byPrice = Object.fromEntries(Object.entries(priceIds).filter(([, v]) => v).map(([k, v]) => [v, k]));
  const priceId = d.items?.[0]?.price?.id ?? d.items?.[0]?.price_id;
  const plan = byPrice[priceId] ?? d.custom_data?.plan;
  const common = {
    userId: typeof d.custom_data?.userId === 'string' ? d.custom_data.userId : undefined,
    occurredAt: body.occurred_at,
    plan,
  };
  /** @param {import('../service.js').NormalizedEvent['type']} t @param {object} [extra] */
  const sub = (t, extra = {}) => ({
    eventId, type: t, ...common, providerSubscriptionId: d.id, providerCustomerId: d.customer_id,
    currentPeriodEnd: d.current_billing_period?.ends_at ?? undefined, ...extra,
  });

  switch (type) {
    case 'subscription.created':
    case 'subscription.activated':
      return [sub('subscription.activated', { checkoutRef: d.transaction_id ?? undefined })];
    case 'subscription.updated':
      if (d.status === 'active') return [sub(d.scheduled_change?.action === 'cancel' ? 'subscription.canceled' : 'subscription.renewed')];
      if (d.status === 'past_due') return [sub('payment.failed')];
      if (d.status === 'canceled' || d.status === 'paused') return [sub('subscription.expired')];
      return [];
    case 'subscription.resumed':
      return [sub('subscription.resumed')];
    case 'subscription.past_due':
      return [sub('payment.failed')];
    case 'subscription.canceled': // Paddle "canceled" = the subscription has ended
    case 'subscription.paused':
      return [sub('subscription.expired')];
    case 'transaction.completed': {
      if (!d.subscription_id) return [];
      const amount = Number.parseInt(d.details?.totals?.grand_total ?? '', 10);
      /** @type {import('../service.js').NormalizedEvent[]} */
      const out = [];
      if (d.billing_period?.ends_at) {
        out.push({
          eventId: `${eventId}:renewed`, type: 'subscription.renewed', ...common, providerSubscriptionId: d.subscription_id,
          providerCustomerId: d.customer_id, currentPeriodEnd: d.billing_period.ends_at, checkoutRef: d.id,
        });
      }
      if (Number.isInteger(amount)) {
        out.push({
          eventId: `${eventId}:invoice`, type: 'invoice.issued', ...common, providerSubscriptionId: d.subscription_id,
          invoice: {
            providerInvoiceId: d.id, amount, currency: String(d.currency_code ?? ''), status: 'paid',
            url: null, issuedAt: d.billed_at ?? body.occurred_at, plan,
          },
        });
      }
      return out;
    }
    case 'transaction.payment_failed':
      return d.subscription_id ? [{ eventId, type: 'payment.failed', ...common, providerSubscriptionId: d.subscription_id }] : [];
    default:
      return []; // adjustments, customers, etc.: acknowledged, nothing to change
  }
}

/**
 * @param {{env: 'sandbox'|'production', apiBase: string, apiKey: string|null, webhookSecret: string|null, toleranceSec: number,
 *   priceIds: Record<'monthly'|'quarterly'|'yearly', string|null>, fetchImpl?: typeof fetch,
 *   logger: {info: Function, warn: Function, error: Function}, now: () => number, timeoutMs?: number}} opts
 * @returns {import('./index.js').PaymentProvider}
 */
export function createPaddleProvider(opts) {
  const { env, apiBase, apiKey, webhookSecret, toleranceSec, priceIds, logger, now } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  /** @param {string} method @param {string} path @param {object} [body] @returns {Promise<any>} */
  async function api(method, path, body) {
    let res;
    try {
      res = await fetchImpl(apiBase + path, {
        method,
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ProviderError(`Paddle ${method} ${path}: ${err instanceof Error ? err.message : 'network error'}`);
    }
    /** @type {any} */
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      throw new ProviderError(`Paddle ${method} ${path}: HTTP ${res.status} ${json?.error?.code ?? ''}`.trim(), { status: res.status, code: json?.error?.code });
    }
    return json;
  }

  return {
    id: 'paddle',
    region: 'INTL',
    cspFormActionOrigins: [env === 'production' ? 'https://pay.paddle.io' : 'https://sandbox-pay.paddle.io'], // [CHECK]
    capabilities: { managesRenewals: true, tokenCharges: false, refunds: true, signedWebhooks: true },

    async createCheckout({ user, plan, checkoutId }) {
      const priceId = priceIds[plan.id];
      if (!priceId) throw new ProviderError(`no Paddle price id configured for plan ${plan.id}`);
      const json = await api('POST', '/transactions', {
        items: [{ price_id: priceId, quantity: 1 }],
        collection_mode: 'automatic',
        custom_data: { userId: user.id, checkoutId, plan: plan.id },
      });
      const url = json?.data?.checkout?.url;
      const id = json?.data?.id;
      if (typeof url !== 'string' || !/^https:\/\//.test(url) || typeof id !== 'string') {
        throw new ProviderError('Paddle transaction has no checkout URL (set a default payment link in Paddle)');
      }
      return { url, providerRef: id };
    },

    async cancelSubscription(sub, { immediate = false } = {}) {
      await api('POST', `/subscriptions/${encodeURIComponent(sub.provider_subscription_id)}/cancel`, {
        effective_from: immediate ? 'immediately' : 'next_billing_period',
      });
    },

    async resumeSubscription(sub) {
      // Removes the scheduled cancellation.
      await api('PATCH', `/subscriptions/${encodeURIComponent(sub.provider_subscription_id)}`, { scheduled_change: null });
    },

    verifyAndParseWebhook(rawBody, headers) {
      const sig = headers['paddle-signature'];
      const r = verifyPaddleSignature(rawBody, Array.isArray(sig) ? sig[0] : sig, /** @type {string} */ (webhookSecret), now(), toleranceSec);
      if (!r.ok) throw new WebhookVerificationError(`Paddle: ${r.reason}`);
      let body;
      try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw new WebhookVerificationError('body is not JSON', 'INVALID_PAYLOAD'); }
      const events = mapPaddleEvent(body, priceIds);
      if (!events.length) logger.info(`[paddle] ${body.event_type} acknowledged (no state change)`);
      return events;
    },

    async refund({ providerTxId }) {
      const json = await api('POST', '/adjustments', { // [CHECK]
        action: 'refund',
        transaction_id: providerTxId,
        type: 'full',
        reason: 'Cancelled within 14 days of the first charge',
      });
      return { refundId: json?.data?.id ?? null, status: json?.data?.status === 'approved' ? 'refunded' : 'pending' };
    },
  };
}
