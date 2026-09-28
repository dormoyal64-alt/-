# Business, Legal & Payments Specification

Owner: Agent A2 (Business, Legal & Payments Lead). Research date: 2026-09-27. Status: decision-ready draft for the founder, engineering, and outside counsel.

> **Not legal, tax or regulatory advice.** This is structured research so the team can build the product and brief professionals efficiently. Before launch, an Israeli lawyer must review the consumer-protection, privacy and medical-device positioning. An Israeli CPA must review VAT, invoicing and the Merchant-of-Record setup. A trademark attorney must run a formal clearance search on the name.

## How to read the evidence tags

Our research sandbox blocked direct page fetches for most sites, including stripe.com, paddle.com, gov.il, nevo.co.il, fda.gov and most Israeli payment service provider (PSP) documentation portals. Every claim is therefore tagged by how it was checked:

| Tag | Meaning |
|---|---|
| **[V]** | Verified first-hand from an official source. This means a page fetched directly (developer.apple.com, developer.android.com) or the provider's own source code on GitHub (Paddle SDK, PayPlus plugin). |
| **[S]** | The official page (law text, regulator page, or provider docs) was read through a search-engine extract, not opened directly. The URL is still the official source to cite. |
| **[2nd]** | A reputable secondary source, such as a law-firm update, trade press or an app-store listing summary. |
| **[CHECK]** | Background knowledge that could not be re-verified in this session. Confirm it before relying on it. |

---

## 0. Executive summary: decisions at a glance

| Topic | Decision |
|---|---|
| Israel payment provider | **PayPlus** (hosted payment page and tokenized recurring billing, with a signed callback plus Bit, Apple Pay and Google Pay). It issues Israeli tax invoices and receipts automatically. **Fallback adapter: Cardcom.** |
| International payment provider | **Paddle Billing** as Merchant of Record (MoR). It collects and remits global VAT and sales tax, supports Israeli sellers and the ILS currency, and offers an HMAC-signed webhook and a sandbox. Stripe cannot be used directly by an Israeli company in 2026. |
| Card data | Card data never touches our servers. Checkout is by full redirect to the provider-hosted page, which keeps us in PCI DSS scope **SAQ A**. |
| Trial | **30-day free trial with no card** (opt-in). At day 30 the user reaches a paywall and nothing is charged automatically. This is the most compliant design under Israeli law and avoids section 13A "benefit period" notice traps. |
| Israeli plans | **Monthly** auto-renews until cancelled; it is a continuing transaction of indefinite term. **3-month and yearly** plans are prepaid fixed-term plans that **do not auto-renew in Israel** without the consumer's explicit consent. They come with renewal reminders and one-tap renewal. |
| International plans | All three plans auto-renew through Paddle, with our own pre-renewal reminder emails. |
| Cancellation | One click in the app, plus a dedicated cancellation link on the website homepage. No cancellation fee. Written confirmation is sent. There is a full refund if the first paid charge is cancelled within 14 days. |
| App stores | Ship as a PWA sold from our own website, so any PSP can be used. If we later wrap the app for the stores, in-app purchase (IAP) or Play Billing is mandatory for Israeli storefronts, and web-bought subscriptions can be honoured under Apple guideline 3.1.3(b). |
| Privacy | Treat all vision-test data as "information of special sensitivity" (Amendment 13). **Keep eye data on-device only.** The server holds only the account, the subscription and invoice references. |
| Medical positioning | The product is a "display personalization and viewing-comfort tool". It is **not a medical device, not a diagnosis, not a prescription**. It shows no clinical metrics (20/40, diopters, disease names). |
| Default prices | ILS incl. 18% VAT: **₪24.90 per month, ₪59.90 per 3 months, ₪179.90 per year.** USD: **$5.99, $14.99, $44.99.** These are placeholders the founder can change. |
| Name | **SeeTuned** (Hebrew סִיטְיוּנְד). EN: "Your screen, tuned to your eyes." HE: "המסך שלך, מכוון לעיניים שלך." Alternatives: EyeTuned, Visora, VueFit. A formal trademark search is still required. |

---

## 1. Payments for an Israeli business selling a recurring web subscription

### 1.1 Requirements we evaluated against

1. A hosted payment page (redirect, or an iframe the PSP hosts), so that card data never touches our servers. This makes us eligible for PCI DSS **SAQ A**. [CHECK] SAQ A applies when all cardholder-data functions are outsourced to a PCI-DSS-validated provider and every element of the payment page comes from that provider. A full-page redirect is the simplest way to stay eligible. If we embed an iframe, our parent page needs a strict CSP and script-integrity controls.
2. Tokenization or recurring billing (הוראת קבע באשראי) for the monthly plan.
3. Webhooks or instant payment notifications (IPN) we can authenticate. HMAC is preferred; otherwise a server-to-server re-query.
4. A sandbox or staging environment.
5. Bit, Apple Pay and Google Pay (Bit matters in Israel).
6. Automatic Israeli tax invoices and receipts (חשבונית מס/קבלה) for every charge.
7. Hebrew UI, ILS currency, and later USD, EUR and global tax handling.

### 1.2 Is Stripe available to Israel-based businesses in 2026?

**No, not for an Israeli-incorporated business with an Israeli bank account.**

- Israel does not appear on Stripe's supported-countries list at https://stripe.com/global. We could not open that page from the sandbox, but multiple sources agree:
  - Globes: "Stripe struggling to receive Israeli clearing license". Stripe "does not operate in Israel and so cannot assist local businesspeople in receiving payments into their Israeli bank accounts". https://www.globes.co.il/news/article.aspx?did=1001381078 [2nd]
  - Israeli startup guides (2025–2026) describe the same workarounds. https://www.doola.com/stripe-guide/how-to-open-a-stripe-account-in-israel/ [2nd]
- The workaround is a US entity (Delaware C-corp or LLC) with a US bank account, for example through Stripe Atlas at about $500 (https://support.stripe.com/questions/stripe-atlas). We **do not recommend** this for launch. It adds US tax filings, and a company managed from Israel is usually an Israeli tax resident anyway. It also does not solve Israeli invoicing or Bit. [CHECK with CPA]
- Stripe Managed Payments is Stripe's new MoR product, built from the Lemon Squeezy acquisition. As of April 2026 it was in public preview for merchants in "35+ countries", and Israel is not confirmed. Its previewed pricing is about 6.4% + 30¢. https://docs.stripe.com/payments/managed-payments , https://www.lemonsqueezy.com/blog/2026-update [S/2nd]
- **Re-check Stripe availability every 6 months.** Our adapter layer lets us add Stripe or Stripe Managed Payments later without touching product code.

### 1.3 Merchant-of-Record options (for international sales)

**Paddle Billing: recommended for international sales.**
- Israel is a supported country, and Paddle pays out to sellers anywhere except sanctioned countries. https://developer.paddle.com/concepts/sell/supported-countries-locales/ , https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle [S]
- Paddle is the MoR. It is the legal seller to the end customer and calculates, collects and remits VAT, GST and US sales tax. It handles refunds and chargebacks and issues the customer invoices.
- **ILS** is a supported currency. It appears in the official SDK's `CurrencyCode` enum: https://github.com/PaddleHQ/paddle-node-sdk/blob/main/src/enums/shared/currency-code.ts [V]
- Payment methods: cards, PayPal, Apple Pay, Google Pay, and regional methods such as BLIK, MB Way and Pix. **There is no Bit.** https://developer.paddle.com/concepts/payment-methods/overview [S]
- Recurring billing: native subscriptions (monthly, quarterly, yearly), trials, proration and dunning.
- Card-free trials exist in developer preview or early access. Set `requires_payment_method: false` on a trial price; if no card is added before the trial ends, Paddle cancels the subscription. https://developer.paddle.com/changelog/2025/cardless-trials-developer-preview/ , sample: https://github.com/PaddleHQ/paddle-sample-cardless-trials [S/V]
- Fees: **5% + $0.50 per transaction**, all-in. https://www.paddle.com/pricing ; analysis at https://dodopayments.com/blogs/paddle-fees-explained [2nd]
- Sandbox: a separate sandbox account and API. The API base is `https://sandbox-api.paddle.com` and production is `https://api.paddle.com`. [CHECK]
- Checkout UI: Paddle.js overlay or inline checkout, hosted by Paddle, so we stay SAQ A. Checkout is localized; confirm whether **Hebrew** is available. https://www.paddle.com/help/start/intro-to-paddle/do-you-offer-localised-checkouts [CHECK]
- Docs: https://developer.paddle.com/ ; Node SDK: https://github.com/PaddleHQ/paddle-node-sdk

**Lemon Squeezy: not recommended for a new integration in 2026.**
- Stripe acquired it in 2024. In January 2026 it announced that its future is Stripe Managed Payments; both products coexisted as of April 2026. https://www.lemonsqueezy.com/blog/2026-update [2nd]
- Platform direction is uncertain and prices are rising. Revisit once Stripe Managed Payments is generally available and confirms Israeli merchants.

**Other MoRs** (FastSpring, Polar, Creem, Dodo Payments) exist but were not researched in depth. The adapter keeps them possible. [CHECK]

### 1.4 Israeli PSPs compared

In the table:
- "Signed webhook" means the provider signs its callback so we can verify it cryptographically. "Re-query" means the callback is unsigned and we must confirm the transaction with an authenticated server-to-server API call.
- All Israeli PSPs below support ILS and Hebrew hosted pages and are PCI-DSS certified. **Fees are not publicly listed by most Israeli PSPs.** The figures come from a 2026 comparison ([2nd] https://www.autoflowr.co.il/compare/payment-gateways-israel-2026) and must be confirmed by quotes.

| PSP | Hosted page | Recurring and tokens | Webhook authentication | Sandbox | Bit / Apple Pay / Google Pay | Auto tax invoice | Indicative fees | API docs |
|---|---|---|---|---|---|---|---|---|
| **PayPlus** | Yes: `PaymentPages/generateLink` for redirect or iframe [V] | Yes: tokens (`create_token`), recurring-payments module, token charges [S] | **Signed.** Header `hash` = base64 HMAC-SHA256 with the secret key, plus `user-agent: PayPlus` [S][V] | Yes: `restapidev.payplus.co.il` [S] | Yes / Yes / Yes [S] | Yes: PayPlus Invoice+ module; the WooCommerce plugin issues invoices [V] | Clearing 0.9–1.3%, monthly fee ₪0–150 [2nd] | https://docs.payplus.co.il/reference/introduction |
| **Cardcom** | Yes: LowProfile (`/api/v11/LowProfile/Create`, redirect or iframe) [S] | Yes: `ChargeAndCreateToken` and `CreateTokenOnly`, plus a standing-order (הוראת קבע) module with its own webhooks [S] | **Unsigned; re-query** with `POST /api/v11/LowProfile/GetLpResult` [S][2nd] | Test terminal on request [CHECK] | Yes / Yes / Yes [S] | Yes: automatic digitally signed invoice and receipt [S] | Clearing 1.2–1.6%, ₪90–180 per month [2nd]. Cardcom holds a Bank of Israel acquiring licence [S] | https://secure.cardcom.solutions/Api/v11/Docs (OpenAPI v3) |
| **Grow (formerly Meshulam)** | Yes: `createPaymentProcess` returns a URL for redirect or iframe, valid 10 minutes [S] | Yes: save a token on the first charge, then charge the token; recurring webhooks start from the second charge [S] | **Unsigned.** Callback to `notifyUrl`; you must call `approveTransaction`; match the stored `processToken` and re-query [S][2nd] | Yes (sandbox keys) [CHECK] | Yes / Yes / Yes (plus PayBox) [S] | Yes, automatic [S] | Often no setup fee or monthly fee; per-transaction pricing [2nd] | https://grow-il.readme.io/ , https://developers.grow.business/ |
| **Tranzila** | Yes: iframe `direct.tranzila.com/<terminal>/iframenew.php`, plus Hosted Fields [S] | Yes: tokens (Token Module is an add-on), "My Billing" STO API v2 for monthly, quarterly or yearly billing [S] | Notify URL (`notify_url`), unsigned, so re-query. Its REST API v2 authenticates our requests with HMAC headers (`X-tranzila-api-app-key`, `-request-time`, `-nonce`, `-access-token`) [S] | Test terminal [CHECK] | Yes / Yes / Yes [S] | Via Tranzila invoice module [CHECK] | Clearing 1.2–1.7%, ₪90–200 per month [2nd] | https://docs.tranzila.com/ |
| **Hyp (formerly Yaad Sarig; CreditGuard is part of the Hyp group)** [CHECK] | Yes: Hyp Pay payment page [S] | Yes: HK standing order, saved cards, `RecurringDebit` (Israeli market) [S] | Redirect parameters are signed and checked with `APISign` `What=VERIFY` [S][2nd] | Demo terminal (for example masof 0010064925 on public demo URLs) [2nd] | Yes / Yes / Yes [S] | Via EZcount integration [CHECK] | Quote [2nd] | https://developers.hyp.co.il/ , https://yaadpay.docs.apiary.io/ |
| **iCredit (Rivhit)** | Yes: `PaymentPageRequest.svc/GetUrl` (redirect, iframe or popup) [S] | Yes: `RecurringSaleDetails`; daily, weekly or monthly [S] | IPN to `IPNURL`, then verify via API [S] | [CHECK] | Bit [CHECK] | Yes, through Rivhit bookkeeping [S] | Quote | https://rivhit-api.readme.io/ |
| **Pelecard** | Yes: iframe on `gateway21.pelecard.biz` [S] | Yes: tokenization, J2/J4/J5 action types [S] | Validate `ConfirmationKey` server-side via `PaymentGW/GetTransaction` [2nd] | [CHECK] | Bit / Apple Pay (ClientSecure.js) [2nd] | Via third-party invoicing [CHECK] | Quote | https://gateway21.pelecard.biz/ |

Notes:
- **Bit cannot be used for card-style recurring billing** [CHECK with PSP]. Offer Bit only for one-time charges, such as the prepaid 3-month and yearly plans in Israel. The monthly auto-renewing plan uses a tokenized card, or an Apple Pay or Google Pay token if the PSP supports recurring wallet tokens [CHECK].
- Apple Pay on a PSP-hosted page needs no domain verification on our side. If we ever put an Apple Pay button on our own domain, we must host `/.well-known/apple-developer-merchantid-domain-association`. PayPlus ships that file in its plugin. [V] https://github.com/PayPlus-Gateway/payplus-payment-gateway
- Israeli card acquiring commissions are negotiable and depend on volume, so ask 3 PSPs for written quotes. [2nd] https://www.cardcom.solutions/blog/clearing-fees-comparison-guide

### 1.5 Recommendation

**Israel launch: PayPlus (primary). Build a second adapter for Cardcom (fallback).**
- PayPlus is the only Israeli PSP we found with a **documented cryptographic webhook signature**. It also has a modern JSON REST API, a public staging environment, tokens and recurring billing, and Bit, Apple Pay and Google Pay. Its automatic invoices and receipts come from the same vendor. [S][V]
- Cardcom is the strongest fallback. It holds its own Bank of Israel acquiring licence and has a JSON API v11 with an OpenAPI spec, a mature standing-order module and automatic invoices. Its callback is unsigned, so the adapter must always re-query `GetLpResult`. [S]
- Grow is a good option for very small volumes (no monthly fee), but its callback is also unsigned.

**International expansion: Paddle Billing (MoR).**
- It takes over global tax registration, collection and remittance and consumer-law obligations as seller of record. It supports Israeli sellers and ILS, has a signed webhook and a sandbox, and offers card-free trials.
- The trade-off is fees: 5% + $0.50 is heavy on a $5.99 monthly plan (about 13%), so push annual plans internationally.
- Later option: once Israeli merchants are supported, Stripe Managed Payments could replace Paddle behind the same adapter.

**Routing rule.** The billing country comes from IP geolocation plus the user's declared country, confirmed at checkout.
- Israeli users (billing country IL, prices in ILS) go to **PayPlus**.
- Everyone else (USD or EUR) goes to **Paddle**.
- Store `provider` on each subscription so users never switch providers mid-subscription.

### 1.6 Webhook verification specs (implement exactly)

#### 1.6.1 PayPlus callback (`refURL_callback`)

Sources:
- Official docs: https://docs.payplus.co.il/reference/validate-requests-received-from-payplus [S]
- The official PayPlus WooCommerce plugin, which reads the raw body and builds the hash: https://github.com/PayPlus-Gateway/payplus-payment-gateway/blob/main/includes/wc_payplus_gateway.php [V]

The official docs sample:
```js
// official PayPlus docs sample (Node)
if (req.headers['user-agent'] !== 'PayPlus') reject();
const message = JSON.stringify(req.body);          // docs sample re-serialises the parsed JSON
const genHash = crypto.createHmac('sha256', secret_key).update(message).digest('base64');
return genHash === req.headers['hash'];
```
The official plugin, in PHP:
```php
$json = file_get_contents('php://input');                          // RAW body
$payplusGenHash = base64_encode(hash_hmac('sha256', $json, $this->secret_key, true));
$payplusHash = $_SERVER['HTTP_HASH'];                              // header "hash"
```

Implementation spec for our backend:

| Item | Value |
|---|---|
| Delivery | HTTPS `POST`, JSON body, to the `refURL_callback` we pass in `PaymentPages/generateLink`. Recurring charges are delivered to the callback URL configured for the recurring order. [CHECK exact field for recurring] |
| Headers | `hash: <base64>` and `user-agent: PayPlus` (exact string) |
| Key | Our PayPlus **secret key**. This is the same `secret_key` used in API auth, as UTF-8 bytes. |
| Algorithm | HMAC-SHA256 |
| Signed payload | **Raw request body bytes, exactly as received.** Capture them with `express.raw({type:'application/json'})` on this route. |
| Encoding | Standard Base64 with padding. Compare with a constant-time function (`crypto.timingSafeEqual` on equal-length buffers). |
| Compatibility fallback | If the raw-body hash does not match, also try the hash of `JSON.stringify(JSON.parse(raw))`, which is the docs-sample behaviour. Accept if either matches. Log which variant matched during sandbox testing, then lock to one. Both variants require the secret, so security is not weakened. |
| Replay | PayPlus signs **no timestamp**. Mitigate in three ways: (1) idempotency on `transaction.uid` + `status_code`; (2) **re-query before granting paid access** using `POST {base}/PaymentPages/ipn` with the `payment_request_uid`, which is the endpoint the official plugin uses [V]; (3) reject any callback whose amount or currency differs from the stored checkout session. |
| Response | Return `200` quickly after persisting the event; process asynchronously. |
| Outgoing API authentication (for re-query, refunds and token charges) | Header `Authorization: {"api_key":"<API_KEY>","secret_key":"<SECRET_KEY>"}` (a JSON string) and `Content-Type: application/json` [V, from the plugin] |
| Base URLs | Staging `https://restapidev.payplus.co.il/api/v1.0/`; production `https://restapi.payplus.co.il/api/v1.0/` [S]. Confirm the `/api/v1.0/` path in the portal [CHECK]. Endpoints seen in the plugin [V]: `PaymentPages/generateLink`, `PaymentPages/ipn`, `Transactions/RefundByTransactionUID`. |

#### 1.6.2 Paddle Billing webhook

Sources:
- Official docs: https://developer.paddle.com/webhooks/about/signature-verification/ [S]
- The official Node SDK source [V]: https://github.com/PaddleHQ/paddle-node-sdk/blob/main/src/notifications/helpers/webhooks-validator.ts and https://github.com/PaddleHQ/paddle-node-sdk/blob/main/src/internal/providers/crypto/node-crypto.ts

The official SDK logic, quoted from source:
```ts
const payloadWithTime = `${headers.ts}:${requestBody}`;               // ts + ":" + raw body
if (Date.now() > (headers.ts + 5) * 1000) return false;                // MAX_VALID_TIME_DIFFERENCE = 5 s
const computedHash = createHmac('sha256', secretKey).update(payloadWithTime).digest('hex');
return computedHash === headers.h1;
```

| Item | Value |
|---|---|
| Header | `Paddle-Signature: ts=<unix-seconds>;h1=<64 lowercase hex chars>`. Split on `;` and then on `=`. |
| Key | The **endpoint secret key** of the notification destination (format `pdl_ntfset_...`), from Paddle > Developer tools > Notifications. Sandbox and production have different secrets. |
| Algorithm | HMAC-SHA256, lowercase hex digest |
| Signed payload | `ts + ":" + rawBody`, where rawBody is the exact bytes received. Never parse and re-serialize before verifying. |
| Freshness | Reject if `now > ts + 5 s`, the SDK default. Keep server clocks on NTP. The tolerance may be a config value, defaulting to 5 s. |
| Multiple signatures | During secret rotation the header may carry more than one `h1`. Accept if **any** `h1` matches. [CHECK in docs; the SDK parses the last one] |
| Comparison | Constant-time (`timingSafeEqual`) |
| Idempotency | Use `event_id` (`evt_...`) as a unique key. Order by `occurred_at`. Paddle retries on non-2xx responses. |
| Events to handle | `subscription.created`, `subscription.activated`, `subscription.trialing`, `subscription.updated`, `subscription.past_due`, `subscription.paused`, `subscription.canceled`, `transaction.completed`, `transaction.payment_failed`, `adjustment.created` / `adjustment.updated` (refunds and credits) [CHECK list against docs] |
| API authentication | `Authorization: Bearer <API key>` [CHECK] |

#### 1.6.3 Fallback PSPs (unsigned callbacks), generic rule

- **Treat the callback only as a "please check" signal.**
- Take the transaction reference from the callback, then call the provider's authenticated status API and act only on that answer:
  - Cardcom: `POST https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult` with `{TerminalNumber, ApiName, LowProfileId}`. Require `ResponseCode == 0`, a matching `LowProfileId` and `ReturnValue`, the expected amount and currency, and a transaction id. [S][2nd]
  - Grow: call `approveTransaction` after checking that the callback's `processId` or `processToken` matches the one we stored; then re-query. [S]
  - Hyp: `APISign` with `What=VERIFY` on the returned parameters. [S]
- Also run a **nightly reconciliation job** that re-queries every open checkout and every recurring charge.

### 1.7 Provider-adapter requirements (backend contract)

Implement one interface per provider (`payplus`, `paddle`, later `cardcom` and `stripe`):

```
createCheckout({userId, planId, country, currency, locale, email, successUrl, cancelUrl}) -> {url, providerSessionId}
verifyAndParseWebhook(rawBody: Buffer, headers) -> NormalizedEvent[]   // throws on bad signature
confirmTransaction(providerRef) -> {status, amountMinor, currency, providerTxId}   // server-to-server re-query
getSubscription(providerSubId) -> NormalizedSubscription
cancelSubscription(providerSubId, {when:'now'|'period_end'}) -> NormalizedSubscription
refund(providerTxId, {amountMinor?}) -> {refundId, status}
chargeToken(tokenRef, amountMinor, currency, idempotencyKey)   // PayPlus/Cardcom only (if we schedule renewals ourselves)
getInvoiceUrl(providerTxId) -> url   // PSP-generated tax invoice/receipt or Paddle invoice
capabilities -> {signedWebhooks, cardlessTrial, bit, applePay, googlePay, invoices, currencies[]}
```

- Store **amounts in minor units** (agorot, cents) as integers. Israeli prices are **VAT-inclusive**.
- Persist `provider`, `providerCustomerId`, `providerSubscriptionId` and `providerTokenRef` (an opaque reference, never a card number), plus `lastEventAt`.
- Keep an append-only `billing_events` table with a unique index on `(provider, providerEventId)`.
- The entitlement is computed by **our** state machine, never trusted from the client:
  - Paths: `trial -> active -> past_due -> canceled/expired`, and `trial -> expired` (no card).
  - Grace period when `past_due`: 7 days of retries, then `expired`. [recommendation]
- Webhook routes need raw-body capture, a 1 MB body limit and no CSRF or Origin check. Authentication is by signature or re-query only.
- Secrets live in environment variables: `PAYPLUS_API_KEY`, `PAYPLUS_SECRET_KEY`, `PAYPLUS_PAGE_UID`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, and `*_ENV=sandbox|production`.
- **Renewal scheduling in Israel.** For the monthly plan, prefer **our own scheduler charging the PayPlus token**, rather than the PSP's standing-order module. This gives us full control of Israeli notices, grace periods and one-click cancellation, and prevents a "zombie" standing order after cancellation. If the PayPlus recurring module is used instead, the adapter must cancel it on every cancellation and verify that the cancellation took.

### 1.8 Tax and invoicing notes (for the CPA)

- **Israeli VAT is 18%**, in force since 1 January 2025. It was **not** raised to 19% in 2026: the 2026 budget kept 18%.
  - https://www.vatupdate.com/2025/12/10/israel-approves-2026-budget-vat-stays-at-18-expands-exemptions-eases-bank-entry-rules/ [2nd]
  - https://taxsummaries.pwc.com/israel/corporate/other-taxes [2nd]
  - https://www.vatcalc.com/vat/israel-vat-rise-to-19-jan-2026-proposal/ [2nd]
- Consumer prices must be shown as the **total price including VAT** (Consumer Protection Law sections 17A–17G, "המחיר הכולל"). https://www.gov.il/he/pages/cpfta_display_of_prices [S]
- Every Israeli charge needs a **tax invoice-receipt** (חשבונית מס/קבלה), generated by the PSP invoicing module. If the founder operates as an עוסק פטור (VAT-exempt dealer), the documents are receipts (קבלה) and no VAT is charged; the CPA must confirm the structure.
- "Israel Invoices" (חשבוניות ישראל) **allocation numbers** apply to B2B tax invoices where the buyer deducts input VAT: above ₪10,000 from 1 January 2026 and above **₪5,000 from 1 June 2026** (pre-VAT). This is irrelevant for our consumer prices. Only a future B2B or bulk licence would need it.
  - https://www.cpa.co.il/2026-allocation-number/ [2nd]
  - https://www.greeninvoice.co.il/magazine/israel-invoice/ [2nd]
- With Paddle as MoR, the Israeli company sells to Paddle, which resells to consumers. The CPA must confirm:
  - VAT treatment of our supply to Paddle (a zero-rated export of services, or not, especially for Israeli end-customers);
  - whether Israeli users should be routed away from Paddle, which is our plan anyway.
- Israel has **no enacted** mandatory VAT regime for foreign B2C digital suppliers as of early 2026; the 2023 proposal stalled. [2nd] https://www.creem.io/blog/israel-vat-rate-guide-for-digital-sellers-in-2026

---

## 2. App-store rules (if we later wrap the PWA as native apps)

### 2.1 Can a PWA sold from our own website use a regular payment provider?

**Yes.** A PWA installed from our website is not distributed by the App Store or Google Play:
- on iOS, through Safari "Add to Home Screen";
- on Android, through Chrome "Install app".

Store payment rules therefore do not apply, and we can use PayPlus, Paddle or any other PSP. Store rules apply only to binaries we submit to a store, whether a native wrapper, a WKWebView shell, a Capacitor build or a Trusted Web Activity (TWA).

**Recommendation:** launch as a PWA only. Treat store apps as a later, separate project with store billing.

### 2.2 Apple App Store

All quotes below are from the official App Review Guidelines, fetched 2026-09-27 [V]: https://developer.apple.com/app-store/review/guidelines/

- **3.1.1 In-App Purchase.** "Apps must use in-app purchase to unlock features or functionality within your app", and this includes subscriptions. A vision-personalization subscription is digital functionality, so **IAP is mandatory** in a store build.
- **3.1.1(a) Link to other purchase methods.**
  - StoreKit External Purchase Link entitlements exist only in specific storefronts.
  - "These entitlements are not required for developers to include buttons, external links, or other calls to action in their **United States** storefront apps."
  - "In all other storefronts, except for the United States storefront … apps and their metadata may not include buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than in-app purchase."
  - **This means the Israeli storefront allows no link-out to our web checkout.**
- **3.1.3(a) Reader apps** covers magazines, newspapers, books, audio, music and video only. **Our app is not a reader app**, so the External Link Account Entitlement does not apply.
- **3.1.3(b) Multiplatform services.** "Apps that operate across multiple platforms may allow users to access content, subscriptions, or features they have acquired … on other platforms or your web site … provided those items are also available as in-app purchases within the app." So web subscribers can sign in and use the store app, **provided we also sell the same plans through IAP.**
- **3.1.3(f) Free stand-alone apps.** A free companion app with no purchasing and no calls to action is allowed. This option is fragile for us, because the app itself is the paid product.
- **3.1.2(a) Auto-renewable subscriptions.**
  - The period must be at least 7 days.
  - The subscription "may offer a free trial period … by providing the relevant information set forth in App Store Connect" (introductory offers).
  - Before a trial starts, the app must clearly state its duration, what stops working when it ends, and the downstream charges.
- **4.2 Minimum functionality.** The app must be "beyond a repackaged website". A thin WebView wrapper risks rejection, so a store build needs native value such as camera, HealthKit-free accessibility integration or offline use.
- **1.4.1 Medical apps.**
  - Apps "that could be used for diagnosing or treating patients may be reviewed with greater scrutiny".
  - Apps "must clearly disclose data and methodology to support accuracy claims relating to health measurements".
  - Apps "should remind users to check with a doctor".
  - This reinforces the non-medical positioning in section 5.
- **5.1.3 Health data.** No use for advertising, and no storing personal health information in iCloud.

Commissions [CHECK]: 30% standard. 15% in the Small Business Program (under $1M per year) and for subscriptions after the first year of paid service.

**Recent changes (2025–2026)** [V from https://developer.apple.com/news/ unless noted]:

| Region | Change |
|---|---|
| **US (Epic v. Apple)** | See the timeline below. |
| **EU (Digital Markets Act)** | Announced 18 August 2026, effective **1 October 2026**. The Core Technology Fee is replaced by a 5% Core Technology Commission. Alternative payment options may appear alongside IAP, and commission rates are adjusted. |
| **Japan (MSCA)** | 17 December 2025: alternative app marketplaces and payments outside IAP are allowed. |
| **Brazil** | 18 June 2026: alternative distribution and payments. |
| **China storefront** | March 2026: commission reduced to 25%, and 12% for small business. |
| **New subscription option** | April 2026: "monthly subscriptions with a 12-month commitment". This conflicts with the Israeli fixed-term rules in section 3; do not use it for Israel. |

US timeline for Epic v. Apple:
- The injunction required allowing link-outs.
- The district court held Apple in contempt and barred any commission on linked-out purchases.
- 11 December 2025: the Ninth Circuit affirmed contempt but allowed a non-prohibitive commission to be argued. https://cdn.ca9.uscourts.gov/datastore/opinions/2025/12/11/25-2935.pdf [S]
- 29 April 2026: the Ninth Circuit ordered zero commission on link-outs while the stay fight continued. [2nd] https://appleinsider.com/articles/26/04/29/app-store-policy-must-change-as-epic-convinces-us-circuit-court-to-reverse-stay
- 6 May 2026: Justice Kagan denied Apple's stay application (25A1213). https://www.scotusblog.com/2026/05/court-tuns-down-apples-request-to-pause-order-holding-it-in-contempt/ [S]
- Apple's certiorari petition (No. 25-1311, filed 26 May 2026) was set for the 25 June 2026 conference. **We have not verified the outcome** [CHECK]. https://www.supremecourt.gov/DocketPDF/25/25-1311/409561/20260526163506450_2026-05-26%20Apple-Epic%20--%20Cert%20Petition%20and%20Appendix.pdf

**Net for us:** in the US storefront we may link to web checkout, currently at 0% commission (verify before relying). In Israel and most other countries, IAP is required and no steering is allowed.

### 2.3 Google Play

- **Play Payments policy.** Apps distributed on Google Play that sell digital goods or subscriptions must use Google Play Billing, except where a local alternative-billing or external-links programme applies.
- **TWA (packaged PWA).** A TWA distributed on Play must sell through Play Billing using the **Digital Goods API** together with the **Payment Request API**. This requires Chrome 101 or later.
  - https://developer.chrome.com/docs/android/trusted-web-activity/receive-payments-play-billing [S]
  - https://developer.chrome.com/docs/android/trusted-web-activity/billing [S]
  - Sample code: https://github.com/chromeos/pwa-play-billing
- **Fees and choice.** The "Expanded billing choice and lower fees on Google Play" blog post (24 June 2026) says [V]:
  - 10% service fee on the first $1M per year, and 10% on auto-renewing subscriptions at any revenue level;
  - an extra 5% billing fee when Play Billing is used in the US, UK and EEA;
  - alternative billing or web links carry no billing fee.
  - Source: https://developer.android.com/blog/posts/expanded-billing-choice-and-lower-fees-on-google-play
- **Rollout dates.** US, UK and EEA on 30 June 2026; Australia 30 September 2026; Japan and Korea 31 December 2026; **the rest of the world, including Israel, by 30 September 2027.** These dates come from the Play Console help page https://support.google.com/googleplay/android-developer/answer/16954621 [S]. The blog says "later 2026" for the rest of the world, so **check the Israeli date before building.**
- **Until the rollout reaches Israel:** Play Billing is required, and the subscription service fee is 15% [CHECK].
- **US-only programmes.** The external content links programme and alternative billing, which followed Epic v. Google, require reporting transactions and paying fees from 1 October 2026 (plus per-install fees for link-outs). https://support.google.com/googleplay/android-developer/answer/16470497 [S] ; https://support.google.com/googleplay/android-developer/answer/15582165 [S]

### 2.4 Free trials in the stores

- **Apple:** use an introductory offer of type "free trial" on the subscription, configured in App Store Connect. Apple handles eligibility (one per subscription group) and auto-converts to paid. [CHECK details]
- **Google Play:** use a free-trial offer on a subscription base plan. Play handles eligibility and auto-renewal. [CHECK details]
- **The store trial is card-on-file with auto-convert.** For Israeli storefront users this collides with our Israeli design in section 3. If we ship store apps, get counsel to confirm that:
  - the store's own disclosures, reminders and management UI satisfy section 13A; or
  - we should use a no-trial IAP and give trials only on the web.

### 2.5 Store strategy recommendation

1. Launch as a PWA plus web checkout (PayPlus for IL, Paddle for international).
2. If store builds come later, use IAP or Play Billing in-app and honour web subscriptions under 3.1.3(b). Price store plans about 15–20% higher to absorb fees where allowed. In the US storefront only, add a link-out to web checkout.
3. Share entitlements across channels through our backend: `entitlement.source = 'web_payplus'|'web_paddle'|'apple'|'google'`.

---

## 3. Israeli consumer-protection law: subscriptions and free trials

### 3.1 Primary sources

- The statute, Consumer Protection Law 5741-1981 (חוק הגנת הצרכן, התשמ"א-1981):
  - https://www.nevo.co.il/law_html/law00/70305.htm
  - https://he.wikisource.org/wiki/חוק_הגנת_הצרכן
- The Consumer Protection (Cancellation of Transaction) Regulations 5771-2010 (תקנות הגנת הצרכן (ביטול עסקה), התשע"א-2010): https://www.nevo.co.il/law_html/law00/84257.htm
- The regulator, the Consumer Protection and Fair Trade Authority: https://www.gov.il/he/pages/returns
- Explainers:
  - Kol-Zchut on cancelling a continuing transaction: https://www.kolzchut.org.il/he/ביטול_עסקה_מתמשכת
  - Kol-Zchut on distance-sale transactions: https://www.kolzchut.org.il/he/עסקת_מכר_מרחוק

### 3.2 Which rules apply to our plans

| Our product | Legal category | Consequence |
|---|---|---|
| Monthly plan, auto-renewing until cancelled | **Continuing transaction** (עסקה מתמשכת) of indefinite term, which is also a **distance sale** (עסקת מכר מרחוק) | Section 13D (13ד) cancellation rules, section 14C (14ג) disclosure and cooling-off, and the rules on periodic statements of charges |
| 3-month and yearly plans | **Fixed-term transaction** (עסקה לתקופה קצובה), type (1) under 13A(a) (13א(א)): "a transaction for a specific period" | Section 13A: **no automatic extension without the consumer's explicit consent**, a written notice of the end date in the notice window, an SMS 21 days before the end, and the end date shown prominently on every invoice |
| Free trial that converts to paid **automatically** | 13A(a) type (2): "a transaction in which, for a specific period, goods or services are purchased at a reduced price or with another benefit" — **a benefit period** | The Supreme Court requires a **separate, standalone notice** of the benefit's end. Without it, the price rise has no effect and charging after the benefit period is unlawful (details below). |
| Free trial with **no card and no auto-conversion** | No paid transaction exists until the user actively buys | Section 13A obligations are not triggered. This is the cleanest design. |

The 13A(a) definition and the notice window ("60 days before the end, to 30 days before the end") are quoted from the statute via search extracts [S]; see also https://protocol.co.il/fixed-term-transaction/ [2nd]. Type (2) excludes a reduction given "for a limited period and without any condition" during an existing transaction.

Two further sources on 13A:
- The Knesset's 2008 amendment "prevents an automatic extension of contractual relations between consumers and providers and requires … the expressed consent on the part of the consumer for its extension." https://www.loc.gov/item/global-legal-monitor/2008-05-02/israel-consumer-protection/ [S]
- An amendment requires the end-of-transaction notice **also by SMS** to the consumer's mobile number, if one was given, **21 days before the end date**. The administrative fine for breach is ₪22,000. https://www.chamber.org.il/serviceslobby/legal/1857/59721/ [2nd]

**Supreme Court, CA 3849/20 (ע"א 3849/20), 30 May 2023.**
- Section 13A(b) requires a **separate and independent notice** that the benefit or discount period is ending. This is in addition to mentions in the contract, invoices or SMS.
- Until that notice is given, the price increase has no legal effect.
- Ruling: https://img.haarets.co.il/bs/00000188-7147-d9d1-ab89-f5ffcf520000/69/54/6e8d1dc5450db2964b15fe3e36b2/%D7%A4%D7%A1%D7%A7-%D7%93%D7%99%D7%9F-30-5-23.pdf [S]
- Law-firm summary (Shibolet): https://www.shibolet.com/%D7%A2%D7%95%D7%A1%D7%A7-%D7%A9%D7%94%D7%AA%D7%A7%D7%A9%D7%A8-%D7%91%D7%A2%D7%A1%D7%A7%D7%94-%D7%9C%D7%AA%D7%A7%D7%95%D7%A4%D7%94-%D7%A7%D7%A6%D7%95%D7%91%D7%94-%D7%9E%D7%97%D7%95%D7%99%D7%91-%D7%9C/ [2nd]
- **Practical meaning for a card-on-file 30-day trial:** the statutory window of 60 to 30 days before the end cannot be met for a 30-day trial. Auto-conversion after a free month is therefore legally risky in Israel and a class-action magnet. **Avoid it.**

### 3.3 Cancellation of a continuing transaction (section 13D)

- **Effective date:** the contract ends **within 3 business days** of the cancellation notice, or on a later date the consumer specifies. From the cancellation date the business must stop providing the service and **must not charge for anything after that date**. 13D(c), quoted in https://www.fridmanwork.com/ADVX-lawyers114954.html [2nd]
- **Channels:** the consumer may give notice by phone or orally, by post, by email, by fax, or **through the website**.
  - A business that sells through a website must provide a **dedicated, prominent link on the website's main page** for sending a cancellation notice. [S/2nd] https://www.3slaw.co.il/%D7%A2%D7%9C-%D7%96%D7%9B%D7%95%D7%AA-%D7%94%D7%91%D7%99%D7%98%D7%95%D7%9C-%D7%A9%D7%9C-%D7%A2%D7%A1%D7%A7%D7%AA-%D7%9E%D7%9B%D7%A8-%D7%9E%D7%A8%D7%97%D7%95%D7%A7-%D7%91%D7%90%D7%9E%D7%A6%D7%A2%D7%95%D7%AA-%D7%A7%D7%99%D7%A9%D7%95%D7%A8%D7%99%D7%AA-%D7%99%D7%99%D7%A2%D7%95%D7%93%D7%99%D7%AA-%D7%91%D7%93%D7%A3-%D7%90%D7%99%D7%A0%D7%98%D7%A8%D7%A0%D7%98.html
  - The business must publish the ways to cancel and what details are needed. **A user who signed up digitally cannot be forced to phone** a representative to cancel. [2nd]
- **Cancellation fees:** for an indefinite-term continuing transaction, the law strictly limits them [2nd]. **We charge no cancellation fee at all.**
- **Periodic statements:** where the business charges under a debit authority, it must send a detailed statement of payments or copies of invoices periodically, and an annual statement of charges (the extracts mention every 6 months and an annual statement in March) [S]. **Sending a tax invoice-receipt email for every charge, plus a yearly March summary, covers this.** [CHECK exact current wording of 13B]

### 3.4 Distance-sale disclosure and cooling-off (section 14C)

- **Disclosure before the transaction.** State:
  - the business identity: name, company or ID number, address and contact details;
  - the main characteristics of the service;
  - the total price including VAT;
  - payment terms, the period and any renewal terms;
  - the cancellation terms and method.
  
  After the purchase, send a **written confirmation** in a durable medium (email). [S] https://www.kolzchut.org.il/he/ביטול_עסקה_שנעשתה_באינטרנט_או_בטלפון
- **14-day cancellation.** The consumer may cancel within 14 days of the transaction or of receiving the disclosure document, whichever is later.
  - The refund is due **within 7 business days**.
  - The cancellation fee may be at most **5% of the price or ₪100, whichever is lower**, plus proven card-clearing costs.
  - For a continuing transaction that has already started, the refund is proportional. [S] https://www.kolzchut.org.il/he/דמי_ביטול , regulations: https://www.nevo.co.il/law_html/law00/84257.htm
- **Exception.** 14C(d) excludes "information as defined in the Computers Law, 1995". It is unclear whether this covers a SaaS subscription, so **do not rely on it.** https://fs.knesset.gov.il/14/law/14_lsr_211534.PDF [S]
- **Senior citizens, people with disabilities and new immigrants** have an extended **4-month** cancellation right for distance sales, when the transaction involved a conversation (for example by phone) between the business and the consumer. [CHECK: 14C(c1)] This is relevant because our audience skews older. **Recommendation: honour 4-month requests from these groups whenever any phone or WhatsApp sales contact occurred.**

### 3.5 Compliance requirements for each possible trial flow

**Flow A (recommended): trial without card, then paywall**
1. Day 0: create an account with email and password, accept the terms, and start a 30-day trial (`entitlement.status='trial'`). No payment details are collected.
2. Pre-trial screen text, in Hebrew and English: "30 days free. No card required. Nothing will be charged automatically."
3. Days 23, 27 and 30: in-app, push and email reminders that the trial is ending. These are courtesy messages, not a legal requirement in Flow A.
4. Day 30: `expired`. The paywall shows the plans with **total prices including VAT**, the per-month equivalent, renewal terms, the cancellation method and a link to the terms.
5. Purchase happens on the PSP-hosted page. Afterwards: tax invoice-receipt, a confirmation email with the disclosure details and the plan's **end date or next charge date**, and a link to cancel.
6. The profile and settings the user created during the trial remain on the device after expiry. Premium features are locked. Keep a free basic tier for accessibility goodwill (optional).

**Flow B (not recommended in Israel): card-on-file trial that auto-converts**
- The auto-conversion is a 13A type (2) benefit period. It requires:
  - a separate written notice of the trial end, and ideally the statutory 60–30-day window, which a 30-day trial cannot meet;
  - an SMS 21 days before the end;
  - the end date on every document.
- The legal risk is high. If the founder insists, use a **7-day trial**, get explicit opt-in consent at signup, and send a separate notice at signup plus reminders 3 days and 1 day before conversion. Counsel must sign off.

**Paid plans (Israel)**
- **Monthly** (auto-renew):
  - At purchase, the user ticks an unchecked box: "I agree to a monthly renewing charge of ₪X until I cancel".
  - Each charge: tax invoice-receipt by email, showing the next charge date.
  - A March annual summary of charges.
  - A price increase requires advance written notice, and the user may cancel. [CHECK the notice period with counsel; recommendation: 30 days]
- **3-month and yearly** (fixed-term, **not auto-renewed**):
  - At purchase, show the end date. Also show the end date prominently on the invoice-receipt.
  - Send a written notice of the end date **60 to 30 days before the end**. For the 3-month plan, that means during its first month.
  - Send an **SMS 21 days before the end** if we have a mobile number. Collect mobile numbers optionally at purchase, for this purpose only.
  - Offer a one-tap "Renew for another year / 3 months" button. **Renewal happens only with explicit consent given close to the end.** Without consent, the plan ends: `expired`, then the paywall.
  - Bit is allowed for these one-time charges.
- **Cancellation, one-click in the app** (`POST /api/billing/cancel`):
  - The dialog offers two choices: (1) "Stop renewal, keep access until {date}", which is the **default**, since the consumer specifies a later effective date as the law allows; or (2) "Cancel now and refund unused days", a pro-rata refund.
  - Send an email confirmation with the cancellation date and a reference number immediately.
  - No fee.
  - If the first paid charge is cancelled within 14 days: **full refund** (we waive the permitted 5% or ₪100 fee, which is simpler and generous).
- **Website:** a persistent footer and home-page link "ביטול מנוי / Cancel subscription" that deep-links to the account cancel screen, with a login-free contact form as an alternative.

**International (Paddle) paid plans:** auto-renewing monthly, 3-month and yearly. Send our own renewal reminder 7 days before any 3-month or yearly renewal, and before the first charge after any promotional price. Paddle, as MoR, handles EU withdrawal rights and refunds. [CHECK against Paddle buyer terms]

### 3.6 Most compliant design (summary)

**Israel:**
- no-card trial, then paywall;
- monthly auto-renew with one-click cancellation;
- 3-month and yearly as prepaid, non-auto-renewing plans with statutory notices and one-tap explicit renewal;
- no cancellation fees;
- full refund within 14 days of the first paid charge;
- VAT-inclusive prices;
- an invoice for every charge and a March annual summary;
- a dedicated cancellation link on the home page.

---

## 4. Privacy and accessibility

### 4.1 Israeli Privacy Protection Law, Amendment 13 (in force 14 August 2025)

Sources:
- The Privacy Protection Authority (PPA): https://www.gov.il/he/pages/13_amendment [S]
- Pearl Cohen: https://www.pearlcohen.com/israel-significant-amendment-to-the-privacy-law-takes-effect/ [2nd]
- Barnea (on DPOs): https://barlaw.co.il/practice_areas/high-tech/cyber/client_updates/a-practical-guide-to-board-responsibility-and-dpo-appointment-under-amendment-13/ [2nd]
- Israel Democracy Institute (IDI) analysis: https://www.idi.org.il/media/30906/reforming-privacy-law-in-israel-assessing-amendment-13-and-what-it-still-fails-to-cover.pdf [2nd]
- Unofficial English translation: https://or-hof.com/israel-protection-of-privacy-law-5741-1981-translation/ [2nd]

What the amendment changes:
- **"Information of special sensitivity" (מידע בעל רגישות מיוחדת)** replaces "sensitive information". It includes **medical and health information**, biometric and genetic data, location and others. **Treat vision-test results, eye-specific profiles and inferred conditions as special-sensitivity health data.** [S/2nd]
- **Database registration** is now required mainly for data brokers (more than 10,000 people, where the main purpose is transfer to third parties) and public bodies. **We would not need to register.** [2nd]
- **Notification duty.** A controller not required to register, whose database holds special-sensitivity information on **more than 100,000 people**, must notify the PPA within 30 days. The notice covers the controller's identity, address and contact details, and the Data Protection Officer (DPO) if one is required. [S] https://zes.co.il/%D7%AA%D7%99%D7%A7%D7%95%D7%9F-%D7%9E%D7%A1-13-%D7%9C%D7%97%D7%95%D7%A7-%D7%94%D7%92%D7%A0%D7%AA-%D7%94%D7%A4%D7%A8%D7%98%D7%99%D7%95%D7%AA/ (search extract)
- **DPO** (ממונה הגנת פרטיות) is required for:
  - public bodies and data brokers;
  - controllers or processors whose **main activities include processing special-sensitivity information on a significant scale**, or systematic monitoring on a significant scale.
  
  **If eye data stays on-device, we avoid "processing special-sensitivity information at significant scale" on our servers.** [S/2nd]
- **Enforcement:** the PPA can impose administrative fines, with the highest multipliers for special-sensitivity data. There are stronger notice (section 11) and security duties. The Data Security Regulations 5777-2017 still apply, with security levels depending on the data. [2nd][CHECK level]
- **Consent:** get explicit, separate consent for any processing of special-sensitivity data. Do not bundle it into the terms and conditions. [2nd]

### 4.2 GDPR (for EU and EEA users, and the UK GDPR similarly)

- Vision-test results are **special-category health data** (Article 9). Any server-side processing needs **explicit consent** (Art. 9(2)(a)).
- A Data Protection Impact Assessment (DPIA) is likely required if health data is processed at scale (Art. 35).
- An EU representative is required under Art. 27 if we have no EU establishment. The exemption for occasional processing does not cover large-scale special-category processing. [CHECK]
- **Israel has an EU adequacy decision**, reaffirmed on 15 January 2024, so EU-to-Israel transfers need no Standard Contractual Clauses. https://www.gov.il/en/pages/adequacy [S] ; https://iapp.org/news/a/european-commission-upholds-11-adequacy-decisions [2nd]
- With on-device storage, most GDPR health-data duties shrink to the on-device UX: we still need a transparent notice, and the app must let users delete local data.

### 4.3 Recommended privacy architecture

This matches ARCHITECTURE.md ("eye data never leaves the device").

1. **On-device only:** raw test answers, results, the VisionProfile and camera frames are stored in IndexedDB or localStorage in the PWA. Camera and MediaPipe processing runs locally, and frames are never uploaded.
2. **Server stores:** email, password hash, language, country, consent records (timestamp, version, text hash), subscription and entitlement state, provider IDs, invoice references, and cancellation records. **No eye data, and no "has condition X" flags.**
3. **Optional cloud sync** (post-MVP): only after separate explicit consent, and only for display settings (font scale, contrast, colour filter), ideally end-to-end encrypted with a key derived from a user secret. **The default is off.**
4. **Analytics:** cookieless and first-party, using event counts only (for example "test_completed"). No test results, no third-party ad SDKs, no session replay on test screens.
5. **Data subject rights:**
   - "Export my data": a local JSON download.
   - "Delete my data": clears local storage and deletes the server account (`DELETE /api/me`), which cancels the subscription.
   - Invoices are kept for the statutory bookkeeping period, which is typically 7 years in Israel. [CHECK with CPA]
6. **Security:** HttpOnly session cookies, CSP, bcrypt/scrypt/argon2, rate limiting, and an audit log for billing actions. Document a data-security procedure and a database definition document (מסמך הגדרות מאגר) per the 2017 Data Security Regulations. [CHECK]

### 4.4 Privacy-policy must-haves

Write the privacy policy in Hebrew and English. It must cover:
- the controller's identity and contact details, and the DPO if one is appointed;
- what we collect: account and billing data on the server; eye data on-device only;
- the purposes and the legal basis or consent;
- whether providing data is a legal obligation or voluntary (section 11 notice), and the consequences of refusal;
- recipients: PayPlus, Paddle, email and SMS providers, hosting;
- cross-border transfers;
- retention periods;
- rights of access, correction and deletion under Israeli law and GDPR, and how to exercise them;
- security measures;
- the camera explanation: processed locally and never uploaded;
- cookies;
- children: the service is not directed at under-16s or under-18s, as the founder chooses;
- how the policy changes, and the version date.

### 4.5 Website and app accessibility (Israel)

- **Legal basis:** Equal Rights for Persons with Disabilities (Service Accessibility Adjustments) Regulations 5773-2013, regulation 35 (תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), תקנה 35). Websites **and applications** that provide a service must meet **Israeli Standard IS 5568** (ת"י 5568) at **level AA**, which is based on WCAG 2.0. [S]
  - https://aisrael.org/?ArticleID=44360&CategoryID=2765
  - https://www.isoc.org.il/freedom-of-internet/accessibility/all-about-accessibility
  - https://www.isoc.org.il/freedom-of-internet/accessibility/rules-and-regulations-accessibility-internet
- **Target WCAG 2.1 AA** as a minimum, per ARCHITECTURE.md, and aim for **WCAG 2.2 AA**. IS 5568 has been updated toward WCAG 2.1 [2nd] https://www.boia.org/blog/israels-digital-accessibility-laws-an-overview
- **Accessibility statement** (הצהרת נגישות): it must be displayed prominently on the website and in the app. [S] Must-have content [CHECK against the current regulation text]:
  - the standard and level we comply with (IS 5568 / WCAG 2.1 AA);
  - the date of the last accessibility review;
  - which parts of the site or app are accessible and any known limitations;
  - workarounds where limitations exist;
  - the adjustments available;
  - the **accessibility coordinator's** (רכז/ת נגישות) name, phone, email and postal address, for requests and complaints;
  - the date the statement was last updated.
- **Exemptions:** a small-business exemption applies only to sites that existed before the regulations (average turnover up to ₪1M) [S]. **We are a new service with no exemption; we must comply from day 1.** Statutory damages without proof of harm of up to about ₪50,000 per claim are cited [2nd], so compliance matters.
- **EU:** the European Accessibility Act has applied since 28 June 2025 to e-commerce services offered to EU consumers, with a micro-enterprise exemption for services (fewer than 10 staff and €2M or less turnover or balance sheet). [CHECK]


---

## 5. Medical-device regulatory positioning

### 5.1 When does a vision-test app become a medical device?

Across all jurisdictions, the **intended purpose** decides whether an app is a medical device. That intended purpose is read from our claims: website, store listing, UI text, marketing and ads. How the software works does not decide it.

**United States (FDA)**
- Classic vision-test tools are **classified medical devices**, even on paper:
  - visual acuity chart (Snellen chart, "intended to test visual acuity"): 21 CFR 886.1150, Class I, 510(k)-exempt. https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-886/subpart-B/section-886.1150 [S]
  - Amsler grid ("intended to rapidly detect central and paracentral irregularities in the visual field"): 21 CFR 886.1330, Class I, 510(k)-exempt. https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-886/subpart-B/section-886.1330 [S]
  - colour vision tester ("intended to evaluate color vision"): 21 CFR 886.1170, Class I, 510(k)-exempt. https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-886/subpart-B/section-886.1170 [S]
- **An app that markets itself as "a test of your visual acuity, colour vision or macular health" is therefore likely a device function.** Class I exempt devices still carry general controls: establishment registration and listing, labelling, a quality system, and adverse-event reporting.
- FDA-cleared examples show where the line sits:
  - **Visibly Digital Acuity Product**, a self-administered online distance-acuity test. It received 510(k) clearance on **12 August 2022** after a multi-centre study against the ETDRS lane test, for ages 22–40. https://www.medtechdive.com/news/visibly-fda-clearance-online-vision-test/629859/ , https://www.prnewswire.com/news-releases/visibly-becomes-first-fda-cleared-online-vision-test-in-the-united-states-301606088.html [2nd]
  - **Alleye** (Oculocare), an FDA 510(k)-cleared and CE-marked app to detect and monitor metamorphopsia in age-related macular degeneration (AMD), using an Amsler-like hyperacuity task. https://alleye.io/news/alleye-receives-fda-510k-clearance [2nd]
  - **myVisionTrack**, an FDA-registered Class I hyperacuity self-monitoring app. https://www.nature.com/articles/s41433-023-02479-y [2nd]
- **General Wellness guidance** (revised **6 January 2026**, replacing the 2019 version). FDA does not regulate low-risk products that are intended only to maintain or encourage a general state of health and are unrelated to disease.
  - The revision allows prompting users to see a health-care professional when outputs fall outside normal ranges, **provided** the product makes no disease-specific, diagnostic or treatment claims.
  - Sources: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices [S] ; https://www.cov.com/en/news-and-insights/insights/2026/01/fda-issues-revised-guidance-on-general-wellness-products [2nd] ; https://www.faegredrinker.com/en/insights/publications/2026/1/key-updates-in-fdas-2026-general-wellness-and-clinical-decision-support-software-guidance [2nd]
- **Device Software Functions and Mobile Medical Applications guidance.** Software that only helps users adjust device settings, or that provides accessibility functions, is not a device function. Software that screens for, diagnoses or monitors disease is a device function. [CHECK current version] https://www.fda.gov/regulatory-information/search-fda-guidance-documents/policy-device-software-functions-and-mobile-medical-applications

**European Union (MDR 2017/745)**
- Software is a medical device (MDSW) if its intended purpose is medical, such as diagnosis, monitoring or prediction of disease.
- Under **Annex VIII, Rule 11**, software "intended to provide information which is used to take decisions with diagnosis or therapeutic purposes" is **Class IIa** (or higher), which needs a notified body. Other medical software is Class I.
- MDCG 2019-11 is the qualification guidance, and it applies to apps. https://health.ec.europa.eu/system/files/2020-09/md_mdcg_2019_11_guidance_en_0.pdf [S]
- **Display or accessibility personalisation with no medical intended purpose is not MDSW.**

**Israel**
- The Medical Equipment Law 5772-2012 (חוק ציוד רפואי, התשע"ב-2012) defines medical equipment to include software. Registration with the Ministry of Health's **AMAR** division (אגף אמ"ר) is required before marketing a medical device. https://www.gov.il/he/pages/amr-licensing [S]
- Since 1 January 2024, Class I devices register through a **declaration route** that relies on approvals from reference countries (the US, EU states and others), and a fast track exists for some medium-risk devices. https://www.emergobyul.com/news/israel-update-declaration-route-low-risk-medical-devices-now-effect [2nd] ; https://medenvoyglobal.com/blog/medical-device-and-ivd-registration-in-israel/ [2nd]
- The Optometry Law 5751-1991 (חוק העיסוק באופטומטריה, התשנ"א-1991) reserves eye examinations for glasses or contact-lens fitting and prescriptions to licensed optometrists. **We must never issue or imply a prescription.** https://www.nevo.co.il/law_html/law00/4463.htm [S]

**Apple App Store 1.4.1** (if a store build ever ships) also demands methodology for any health-measurement accuracy claims (section 2.2).

### 5.2 Recommended positioning

- **Intended purpose statement** (put it in the Terms, the medical disclaimer, the store listings and the landing-page footer):
  > "[Name] is a display-personalisation and viewing-comfort tool. It uses short on-screen visual checks to choose text size, contrast, colour and sharpness settings that are comfortable for you, and guides you to your device's accessibility settings. It is not a medical device, does not diagnose, screen for, monitor or treat any condition, and does not provide a prescription. It does not replace an eye examination by an optometrist or ophthalmologist."
- **Hebrew:**
  > "[שם] הוא כלי להתאמה אישית של התצוגה ולנוחות צפייה. הוא משתמש בבדיקות חזותיות קצרות על המסך כדי לבחור גודל טקסט, ניגודיות, צבע וחדות שנוחים לך, ומדריך אותך להגדרות הנגישות של המכשיר. זה אינו מכשיר רפואי, אינו מאבחן, אינו מבצע סינון או מעקב ואינו מטפל בשום מצב רפואי, ואינו מספק מרשם. הוא אינו מחליף בדיקת עיניים אצל אופטומטריסט או רופא עיניים."
- **Outputs:**
  - Present results as **display settings**, for example "Recommended text size: 150%", "Contrast boost: high" or "Colour filter: red-green enhancement".
  - **Do not** present clinical metrics: no Snellen fractions (6/12, 20/40), no logMAR, no diopters, no cylinder or axis, no "colour-blindness type and severity", no "astigmatism detected", no "macular abnormality".
  - Internally the engine may compute acuity-like numbers. Keep them in the on-device profile as technical parameters and do not surface them as a health result. Coordinate with A1 (vision science) and the product-claims section of `docs/research/vision-science.md`.
- **Amsler-type grid (highest risk):** its FDA classification is literally "detect … irregularities in the visual field", and cleared competitors use it for AMD monitoring. Two acceptable options:
  - (a) Remove it from the MVP. This is the safest option.
  - (b) Keep it as a "grid comfort check", with the wellness-compatible safety message below, **no disease names, no scoring, no tracking over time and no "monitoring" language.**
- **Safety message, shown whenever a check suggests a large difference between the eyes, very low scores, distortion, or a sudden change reported by the user:**
  - EN: "Your results suggest the screen alone may not be enough. We recommend having your eyes checked by an optometrist or ophthalmologist. If you notice sudden changes in vision, seek care promptly."
  - HE: "התוצאות מרמזות שהתאמת המסך לבדה אולי לא תספיק. מומלץ לבדוק את העיניים אצל אופטומטריסט או רופא עיניים. אם הבחנת בשינוי פתאומי בראייה, פנה/י לטיפול בהקדם."
- **No accuracy or validation claims** unless we have a study, and even then only for comfort outcomes.

### 5.3 Wording: use vs avoid

| Use (EN) | Use (HE) | Avoid (EN) | Avoid (HE) |
|---|---|---|---|
| display personalisation, viewing comfort | התאמה אישית של התצוגה, נוחות צפייה | eye test, eye exam, vision exam | בדיקת עיניים, בדיקת ראייה (as a product claim) |
| visual checks, comfort checks, screen tune-up | בדיקות חזותיות, בדיקות נוחות, כיוונון מסך | diagnose, detect, screen for, monitor, track your eye health | לאבחן, לגלות, לאתר, לעקוב אחרי בריאות העין |
| find settings that are easier for you to read | למצוא הגדרות שקל לך יותר לקרוא | prescription, diopters, 20/20, 6/6, visual acuity score | מרשם, דיופטר, חדות ראייה 6/6 |
| larger text, stronger contrast, colour filters | טקסט גדול יותר, ניגודיות חזקה יותר, מסנני צבע | correct / improve / treat / cure your vision | לתקן / לשפר / לרפא את הראייה |
| magnifier, enhanced photo and video viewer | זכוכית מגדלת, צפייה משופרת בתמונות ובסרטונים | glaucoma, cataract, AMD, macular degeneration, colour blindness diagnosis, astigmatism detected | גלאוקומה, קטרקט, ניוון מקולרי, אבחון עיוורון צבעים, זוהה אסטיגמטיזם |
| we recommend seeing an eye-care professional | מומלץ לפנות לאופטומטריסט או רופא עיניים | clinically proven, FDA/CE approved, doctor-grade, medical-grade | מוכח קלינית, מאושר FDA, ברמה רפואית |
| not a medical device | אינו מכשיר רפואי | replaces your optometrist, no need for glasses | מחליף את האופטומטריסט, אין צורך במשקפיים |

