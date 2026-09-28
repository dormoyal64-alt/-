// PayPlus + Paddle adapters: signature test vectors, re-query gating, amount checks, API request shapes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyPayPlusSignature, createPayPlusProvider } from '../../../server/billing/providers/payplus.js';
import { verifyPaddleSignature, mapPaddleEvent, createPaddleProvider } from '../../../server/billing/providers/paddle.js';
import { WebhookVerificationError } from '../../../server/billing/providers/errors.js';
import { SILENT, mockFetch } from './helpers.js';

const PP_SECRET = 'pp-secret-key';
const ppHash = (data, secret = PP_SECRET) => createHmac('sha256', secret).update(data).digest('base64');

describe('PayPlus signature (1.6.1)', () => {
  const raw = Buffer.from('{"transaction":{"payment_page_request_uid":"prq-1","uid":"tx-1","status_code":"000","amount":24.9}}');
  test('valid raw-body hash with user-agent PayPlus', () => {
    assert.equal(verifyPayPlusSignature(raw, { 'user-agent': 'PayPlus', hash: ppHash(raw) }, PP_SECRET), 'raw');
  });
  test('fallback: hash of JSON.stringify(JSON.parse(raw)) (docs sample)', () => {
    const spaced = Buffer.from('{ "transaction": { "payment_page_request_uid": "prq-1", "uid": "tx-1" } }');
    const h = ppHash(JSON.stringify(JSON.parse(spaced.toString())));
    assert.equal(verifyPayPlusSignature(spaced, { 'user-agent': 'PayPlus', hash: h }, PP_SECRET), 'reserialized');
  });
  test('tampered body, wrong secret, wrong user-agent, malformed hash => null', () => {
    const h = ppHash(raw);
    const tampered = Buffer.from(raw.toString().replace('24.9', '0.1'));
    assert.equal(verifyPayPlusSignature(tampered, { 'user-agent': 'PayPlus', hash: h }, PP_SECRET), null);
    assert.equal(verifyPayPlusSignature(raw, { 'user-agent': 'PayPlus', hash: ppHash(raw, 'other') }, PP_SECRET), null);
    assert.equal(verifyPayPlusSignature(raw, { 'user-agent': 'curl/8', hash: h }, PP_SECRET), null);
    assert.equal(verifyPayPlusSignature(raw, { 'user-agent': 'PayPlus' }, PP_SECRET), null);
    assert.equal(verifyPayPlusSignature(raw, { 'user-agent': 'PayPlus', hash: 'not base64!' }, PP_SECRET), null);
    assert.equal(verifyPayPlusSignature(raw, { 'user-agent': 'PayPlus', hash: Buffer.from('short').toString('base64') }, PP_SECRET), null);
  });
});

describe('PayPlus adapter', () => {
  const checkout = { id: 'co-1', user_id: 'user-1', plan: 'monthly', amount: 2490, currency: 'ILS', status: 'pending', kind: 'new', subscription_psid: null };
  const make = (routes, lookup = (ref) => (ref === 'prq-1' ? checkout : null)) => {
    const fetchImpl = mockFetch(routes);
    const provider = createPayPlusProvider({
      env: 'sandbox', apiBase: 'https://restapidev.payplus.co.il/api/v1.0/', apiKey: 'api-key', secretKey: PP_SECRET,
      pageUid: 'page-uid', terminalUid: 'term-uid', fetchImpl, logger: SILENT, now: () => 1_800_000_000_000, lookupCheckout: lookup,
    });
    return { provider, fetchImpl };
  };
  const ipnOk = (over = {}) => () => [200, { results: { status: 'success', code: 0 }, data: { transaction: { uid: 'tx-1', status_code: '000', amount: 24.9, currency: 'ILS', ...over }, token_uid: 'tok-1', customer_uid: 'cus-1' } }];
  const callback = (body) => {
    const raw = Buffer.from(JSON.stringify(body));
    return [raw, { 'user-agent': 'PayPlus', hash: ppHash(raw) }];
  };

  test('createCheckout: generateLink with hosted page, token creation, callback URLs and JSON-string auth', async () => {
    const { provider, fetchImpl } = make({
      'POST PaymentPages/generateLink': () => [200, { results: { status: 'success' }, data: { page_request_uid: 'prq-1', payment_page_link: 'https://paymentsdev.payplus.co.il/abc' } }],
    });
    const r = await provider.createCheckout({
      user: { id: 'user-1', email: 'a@example.com', lang: 'he' }, plan: { id: 'monthly', months: 1, price: 2490, currency: 'ILS', pricePerMonth: 2490, savingsPercent: 0 },
      amount: 2490, currency: 'ILS', region: 'IL', renewal: 'auto', kind: 'new', checkoutId: 'co-1',
      successUrl: 'https://app.example/api/billing/return/success', cancelUrl: 'https://app.example/api/billing/return/cancel',
      callbackUrl: 'https://app.example/api/webhooks/payplus', baseUrl: 'https://app.example', trialEndsAt: null,
    });
    assert.deepEqual(r, { url: 'https://paymentsdev.payplus.co.il/abc', providerRef: 'prq-1' });
    const call = fetchImpl.calls[0];
    assert.equal(call.url, 'https://restapidev.payplus.co.il/api/v1.0/PaymentPages/generateLink');
    assert.deepEqual(JSON.parse(call.headers.authorization), { api_key: 'api-key', secret_key: PP_SECRET });
    assert.equal(call.body.amount, 24.9);
    assert.equal(call.body.currency_code, 'ILS');
    assert.equal(call.body.create_token, true);
    assert.equal(call.body.payment_page_uid, 'page-uid');
    assert.equal(call.body.refURL_callback, 'https://app.example/api/webhooks/payplus');
    assert.equal(call.body.refURL_success, 'https://app.example/api/billing/return/success');
    assert.equal(call.body.refURL_failure, 'https://app.example/api/billing/return/cancel');
  });

  test('valid callback is only a signal: access is granted from the PaymentPages/ipn re-query', async () => {
    const { provider, fetchImpl } = make({ 'POST PaymentPages/ipn': ipnOk() });
    const [raw, headers] = callback({ transaction: { payment_page_request_uid: 'prq-1', uid: 'tx-1', status_code: '000', amount: 24.9 } });
    const events = await provider.verifyAndParseWebhook(raw, headers);
    assert.equal(fetchImpl.calls.length, 1);
    assert.deepEqual(fetchImpl.calls[0].body, { payment_request_uid: 'prq-1' });
    assert.deepEqual(events.map((e) => [e.type, e.eventId]), [['subscription.activated', 'tx-1:000'], ['invoice.issued', 'tx-1:000:invoice']]);
    assert.equal(events[0].userId, 'user-1');
    assert.equal(events[0].providerTokenRef, 'tok-1');
    assert.equal(events[1].invoice.amount, 2490);
  });

  test('callback claims success but the re-query says declined => no events', async () => {
    const { provider } = make({ 'POST PaymentPages/ipn': ipnOk({ status_code: '006' }) });
    const [raw, headers] = callback({ transaction: { payment_page_request_uid: 'prq-1', uid: 'tx-1', status_code: '000' } });
    assert.deepEqual(await provider.verifyAndParseWebhook(raw, headers), []);
  });

  test('amount or currency mismatch vs the stored checkout is rejected', async () => {
    for (const over of [{ amount: 1 }, { currency: 'USD' }]) {
      const { provider } = make({ 'POST PaymentPages/ipn': ipnOk(over) });
      const [raw, headers] = callback({ transaction: { payment_page_request_uid: 'prq-1', uid: 'tx-1' } });
      await assert.rejects(provider.verifyAndParseWebhook(raw, headers), (err) => err instanceof WebhookVerificationError && err.code === 'AMOUNT_MISMATCH');
    }
  });

  test('bad signature is rejected before any API call; unknown checkout => [] without re-query', async () => {
    const { provider, fetchImpl } = make({ 'POST PaymentPages/ipn': ipnOk() });
    const raw = Buffer.from('{"transaction":{"payment_page_request_uid":"prq-1"}}');
    await assert.rejects(provider.verifyAndParseWebhook(raw, { 'user-agent': 'PayPlus', hash: ppHash('other') }), WebhookVerificationError);
    const [raw2, h2] = callback({ transaction: { payment_page_request_uid: 'prq-unknown' } });
    assert.deepEqual(await provider.verifyAndParseWebhook(raw2, h2), []);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('chargeToken: succeeded / declined / indeterminate (throws); refund', async () => {
    let mode = 'ok';
    const { provider, fetchImpl } = make({
      'POST Transactions/Charge': () => {
        if (mode === 'ok') return [200, { results: { status: 'success' }, data: { transaction: { uid: 'tx-9', status_code: '000', amount: 24.9 } } }];
        if (mode === 'declined') return [200, { results: { status: 'error', description: 'card declined' }, data: {} }];
        return new TypeError('fetch failed');
      },
      'POST Transactions/RefundByTransactionUID': () => [200, { results: { status: 'success' }, data: { transaction: { uid: 'rf-1' } } }],
    });
    const req = { tokenRef: 'tok-1', customerRef: 'cus-1', amount: 2490, currency: 'ILS', idempotencyKey: 'k1' };
    assert.deepEqual(await provider.chargeToken(req), { status: 'succeeded', providerTxId: 'tx-9', invoiceUrl: null });
    assert.equal(fetchImpl.calls[0].body.token, 'tok-1');
    assert.equal(fetchImpl.calls[0].body.terminal_uid, 'term-uid');
    mode = 'declined';
    assert.equal((await provider.chargeToken(req)).status, 'declined');
    mode = 'error';
    await assert.rejects(provider.chargeToken(req));
    assert.deepEqual(await provider.refund({ providerTxId: 'tx-9', amount: 2490, currency: 'ILS' }), { refundId: 'rf-1', status: 'refunded' });
    assert.equal(fetchImpl.calls.at(-1).body.transaction_uid, 'tx-9');
    assert.equal(fetchImpl.calls.at(-1).body.amount, 24.9);
  });
});

const PD_SECRET = 'pdl_ntfset_test_secret';
const pdSig = (ts, raw, secret = PD_SECRET) => createHmac('sha256', secret).update(`${ts}:${raw}`).digest('hex');

describe('Paddle signature (1.6.2)', () => {
  const raw = Buffer.from('{"event_id":"evt_1","event_type":"subscription.activated","data":{}}');
  const ts = 1_800_000_000;
  const nowMs = ts * 1000 + 2000;
  test('valid ts;h1 within the 5 s tolerance', () => {
    assert.equal(verifyPaddleSignature(raw, `ts=${ts};h1=${pdSig(ts, raw)}`, PD_SECRET, nowMs, 5).ok, true);
  });
  test('tampered body and wrong secret fail', () => {
    assert.equal(verifyPaddleSignature(Buffer.from(raw.toString() + ' '), `ts=${ts};h1=${pdSig(ts, raw)}`, PD_SECRET, nowMs, 5).ok, false);
    assert.equal(verifyPaddleSignature(raw, `ts=${ts};h1=${pdSig(ts, raw, 'wrong')}`, PD_SECRET, nowMs, 5).ok, false);
    assert.equal(verifyPaddleSignature(raw, `ts=${ts + 1};h1=${pdSig(ts, raw)}`, PD_SECRET, nowMs, 5).ok, false);
  });
  test('stale timestamp rejected (now > ts + tolerance); tolerance configurable', () => {
    const header = `ts=${ts};h1=${pdSig(ts, raw)}`;
    const r = verifyPaddleSignature(raw, header, PD_SECRET, ts * 1000 + 5001, 5);
    assert.deepEqual(r, { ok: false, reason: 'stale signature timestamp' });
    assert.equal(verifyPaddleSignature(raw, header, PD_SECRET, ts * 1000 + 5001, 60).ok, true);
  });
  test('multiple h1 (secret rotation): any match is accepted', () => {
    const header = `ts=${ts};h1=${pdSig(ts, raw, 'old-secret')};h1=${pdSig(ts, raw)}`;
    assert.equal(verifyPaddleSignature(raw, header, PD_SECRET, nowMs, 5).ok, true);
    assert.equal(verifyPaddleSignature(raw, `ts=${ts};h1=${'0'.repeat(64)};h1=zz`, PD_SECRET, nowMs, 5).ok, false);
  });
  test('missing or malformed header', () => {
    for (const h of [undefined, '', `h1=${pdSig(ts, raw)}`, `ts=abc;h1=${pdSig(ts, raw)}`, `ts=${ts}`]) {
      assert.equal(verifyPaddleSignature(raw, h, PD_SECRET, nowMs, 5).ok, false);
    }
  });
});

describe('Paddle adapter', () => {
  const priceIds = { monthly: 'pri_m', quarterly: 'pri_q', yearly: 'pri_y' };
  const make = (routes, nowMs = 1_800_000_000_000) => {
    const fetchImpl = mockFetch(routes);
    const provider = createPaddleProvider({
      env: 'sandbox', apiBase: 'https://sandbox-api.paddle.com', apiKey: 'pdl_key', webhookSecret: PD_SECRET, toleranceSec: 5,
      priceIds, fetchImpl, logger: SILENT, now: () => nowMs,
    });
    return { provider, fetchImpl };
  };

  test('event mapping', () => {
    const sub = (type, data) => mapPaddleEvent({ event_id: 'evt_1', event_type: type, occurred_at: '2026-09-28T10:00:00Z', data }, priceIds);
    const base = { id: 'sub_1', customer_id: 'ctm_1', items: [{ price: { id: 'pri_y' } }], custom_data: { userId: 'u1' }, current_billing_period: { ends_at: '2027-09-28T10:00:00Z' } };
    const act = sub('subscription.created', { ...base, status: 'active', transaction_id: 'txn_1' })[0];
    assert.deepEqual([act.type, act.plan, act.userId, act.providerSubscriptionId, act.checkoutRef], ['subscription.activated', 'yearly', 'u1', 'sub_1', 'txn_1']);
    assert.equal(sub('subscription.updated', { ...base, status: 'active', scheduled_change: { action: 'cancel' } })[0].type, 'subscription.canceled');
    assert.equal(sub('subscription.updated', { ...base, status: 'active', scheduled_change: null })[0].type, 'subscription.renewed');
    assert.equal(sub('subscription.past_due', { ...base, status: 'past_due' })[0].type, 'payment.failed');
    assert.equal(sub('subscription.canceled', { ...base, status: 'canceled' })[0].type, 'subscription.expired');
    assert.deepEqual(sub('adjustment.created', {}), []);
    const tx = sub('transaction.completed', { id: 'txn_2', subscription_id: 'sub_1', customer_id: 'ctm_1', currency_code: 'USD', items: [{ price: { id: 'pri_y' } }], custom_data: { userId: 'u1' }, details: { totals: { grand_total: '4499' } }, billing_period: { ends_at: '2027-09-28T10:00:00Z' }, billed_at: '2026-09-28T10:00:00Z' });
    assert.deepEqual(tx.map((e) => e.type), ['subscription.renewed', 'invoice.issued']);
    assert.deepEqual([tx[1].invoice.amount, tx[1].invoice.currency, tx[1].invoice.providerInvoiceId], [4499, 'USD', 'txn_2']);
    assert.throws(() => mapPaddleEvent({ data: {} }, priceIds), WebhookVerificationError);
  });

  test('verifyAndParseWebhook uses Paddle-Signature and the clock', () => {
    const body = JSON.stringify({ event_id: 'evt_9', event_type: 'subscription.past_due', occurred_at: '2026-09-28T10:00:00Z', data: { id: 'sub_1', status: 'past_due' } });
    const ts = 1_800_000_000;
    const { provider } = make({}, ts * 1000 + 1000);
    const events = provider.verifyAndParseWebhook(Buffer.from(body), { 'paddle-signature': `ts=${ts};h1=${pdSig(ts, body)}` });
    assert.equal(events[0].type, 'payment.failed');
    const late = make({}, ts * 1000 + 6000).provider;
    assert.throws(() => late.verifyAndParseWebhook(Buffer.from(body), { 'paddle-signature': `ts=${ts};h1=${pdSig(ts, body)}` }), /stale/);
  });

  test('createCheckout creates a transaction with the plan price id; cancel/resume use the API with Bearer auth', async () => {
    const { provider, fetchImpl } = make({
      'POST /transactions': () => [201, { data: { id: 'txn_1', checkout: { url: 'https://sandbox-pay.paddle.io/hsc_1?_ptxn=txn_1' } } }],
      'POST /subscriptions/sub_1/cancel': () => [200, { data: { id: 'sub_1' } }],
      'PATCH /subscriptions/sub_1': () => [200, { data: { id: 'sub_1' } }],
    });
    const r = await provider.createCheckout({ user: { id: 'u1', email: 'a@example.com', lang: 'en' }, plan: { id: 'yearly' }, checkoutId: 'co-1' });
    assert.deepEqual(r, { url: 'https://sandbox-pay.paddle.io/hsc_1?_ptxn=txn_1', providerRef: 'txn_1' });
    assert.equal(fetchImpl.calls[0].headers.authorization, 'Bearer pdl_key');
    assert.deepEqual(fetchImpl.calls[0].body.items, [{ price_id: 'pri_y', quantity: 1 }]);
    assert.deepEqual(fetchImpl.calls[0].body.custom_data, { userId: 'u1', checkoutId: 'co-1', plan: 'yearly' });
    await provider.cancelSubscription({ provider_subscription_id: 'sub_1' }, { immediate: false });
    assert.deepEqual(fetchImpl.calls[1].body, { effective_from: 'next_billing_period' });
    await provider.cancelSubscription({ provider_subscription_id: 'sub_1' }, { immediate: true });
    assert.deepEqual(fetchImpl.calls[2].body, { effective_from: 'immediately' });
    await provider.resumeSubscription({ provider_subscription_id: 'sub_1' });
    assert.deepEqual([fetchImpl.calls[3].method, fetchImpl.calls[3].body], ['PATCH', { scheduled_change: null }]);
  });

  test('API errors surface as ProviderError', async () => {
    const { provider } = make({ 'POST /transactions': () => [400, { error: { code: 'bad_request' } }] });
    await assert.rejects(provider.createCheckout({ user: { id: 'u1' }, plan: { id: 'monthly' }, checkoutId: 'c' }), /HTTP 400 bad_request/);
  });
});
