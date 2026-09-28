# Payment provider adapters

Card data never touches our servers: every checkout is a full redirect to a provider-hosted page.
Adapters translate between a provider and our billing state machine (`../service.js`), which is
the only code that changes subscription state. Selection is done by `PAYMENT_PROVIDER`
(`mock` | `payplus` | `paddle` | `auto`) and `../pricing.js` (region IL/ILS -> PayPlus,
otherwise Paddle). The provider is stored on each subscription, so a user never switches providers
mid-subscription.

## Interface (`PaymentProvider`, JSDoc in `index.js`)

| Member | Contract |
|---|---|
| `id` | `'mock' \| 'payplus' \| 'paddle'`; also the webhook path `/api/webhooks/:id` |
| `region` | `'IL' \| 'INTL' \| null` (null = any) |
| `cspFormActionOrigins` | origins added to CSP `form-action` |
| `capabilities` | `{managesRenewals, tokenCharges, refunds, signedWebhooks}` |
| `createCheckout(req)` | `-> {url, providerRef}`. `req` has user, plan, amount/currency (minor units, VAT incl.), region, renewal, kind (`new`/`renew`), checkoutId, successUrl/cancelUrl (`/api/billing/return/*`), callbackUrl, trialEndsAt |
| `verifyAndParseWebhook(rawBody: Buffer, headers)` | verify the signature over the RAW bytes FIRST; return `NormalizedEvent[]`; throw `WebhookVerificationError` (`INVALID_SIGNATURE` / `INVALID_PAYLOAD` / `AMOUNT_MISMATCH`) |
| `cancelSubscription(sub, {immediate})` | stop future charges at the provider (no-op where we schedule renewals) |
| `resumeSubscription(sub)` | undo a scheduled cancellation; throw `{code:'NOT_SUPPORTED'}` if impossible |
| `confirmCheckout(ref)?` | authoritative server-to-server re-query of a hosted checkout -> events (`[]` if unpaid) |
| `chargeToken({tokenRef, customerRef, amount, currency, idempotencyKey})?` | `{status:'succeeded'\|'declined', providerTxId}`; THROW when the outcome is unknown |
| `refund({providerTxId, amount, currency})?` | `{refundId, status:'refunded'\|'pending'}` |

`NormalizedEvent = {eventId, type, userId?, providerSubscriptionId?, providerCustomerId?, providerTokenRef?,
plan?, currentPeriodEnd?, occurredAt?, checkoutRef?, renewal?, amount?, currency?, invoice?}` with
`type` in `subscription.activated | subscription.renewed | subscription.canceled | subscription.resumed |
payment.failed | subscription.expired | invoice.issued`. `eventId` must be stable across redeliveries
(idempotency: `(provider, eventId)` is unique in `webhook_events`; duplicates are 200 no-ops). Events older
than the subscription's `last_event_at` are ignored. A missing `currentPeriodEnd` is computed by the
service (first period starts when the free trial ends; a `renew` checkout extends the current end).

## Adapters

* **mock** (`mock.js`, dev/test only, refused in production): hosted test page at
  `/api/billing/mock/checkout/:ref`; webhooks signed with `x-mock-signature = hex(HMAC-SHA256(MOCK_WEBHOOK_SECRET, raw))`.
  Test hooks: `nextCharge = 'declined' | 'error'`, `charges`, `refunds`.
* **payplus** (`payplus.js`, Israel): `PaymentPages/generateLink` with `create_token`; callback verified
  exactly per research 1.6.1 (`user-agent: PayPlus`, `hash` = base64 HMAC-SHA256 of the raw body, fallback
  `JSON.stringify(JSON.parse(raw))`, constant-time). The callback is only a signal: access is granted only
  after `PaymentPages/ipn` says `status_code 000` AND amount/currency equal the stored checkout. The
  `/api/billing/return/success` landing page runs the same re-query when the callback is late. Renewals are
  charged by OUR scheduler (`../renewals.js`) with `Transactions/Charge` (no PayPlus standing order, so
  cancellation cannot leave a "zombie" charge). Refunds: `Transactions/RefundByTransactionUID`.
* **paddle** (`paddle.js`, international MoR): `POST /transactions` with `PADDLE_PRICE_*`, user sent to
  `data.checkout.url`; webhook `Paddle-Signature: ts=..;h1=..` verified per 1.6.2 (HMAC hex over
  `ts:rawBody`, 5 s tolerance, any `h1`); Paddle runs renewals; cancel via `POST /subscriptions/:id/cancel`,
  resume via `PATCH scheduled_change: null`, refund via `POST /adjustments`.

## Before go-live (items marked `[CHECK]` in code)

* PayPlus: confirm in staging the `/api/v1.0/` base path, the callback body field holding the
  `page_request_uid`, the IPN response fields (`status_code`, `amount`, `currency`, `token_uid`,
  `customer_uid`, invoice URL), `Transactions/Charge` fields for token charges, `vat_type` for VAT-inclusive
  items; log which signature variant matches, then lock to it.
* Paddle: set the default payment link to a Paddle-hosted checkout (our CSP blocks Paddle.js on our pages),
  configure success redirect to `/api/billing/return/success`, confirm the adjustments payload, and make the
  `PADDLE_PRICE_*` prices equal `PRICE_INTL_*`.
* Nightly reconciliation of open checkouts and `renewal_attempts` rows left `pending` (unknown outcome).
* Cardcom fallback adapter: unsigned callback => always `GetLpResult` re-query (research 1.6.3).
