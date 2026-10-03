// Israeli plan semantics: renewal scheduler, reminders, explicit-consent renewal, 14-day refund,
// and a PayPlus end-to-end flow with a mocked provider API.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startTestServer, registerUser, payWithMock, mockFetch, PASSWORD } from './helpers.js';

const DAY = 86_400_000;

describe('renewal scheduler and Israeli plan rules (mock provider)', () => {
  let t;
  let mock;
  before(async () => { t = await startTestServer(); mock = t.services.providers.get('mock'); });
  after(async () => { await t.close(); });

  const userRow = (id) => t.services.db.one('SELECT * FROM users WHERE id = ?', id);
  const sub = (userId) => t.services.billing.currentSubscription(userId);
  const ent = (userId) => t.services.billing.entitlementFor(userRow(userId));
  const mails = (tag, to) => t.mail.filter((m) => m.tag === tag && m.to === to);
  const run = () => t.services.renewals.runOnce();
  /** Registers, pays for `plan` with the mock page, returns {user, email, client, cpe}. */
  async function subscribed(plan) {
    const r = await registerUser(t);
    await payWithMock(r.client, plan);
    return { ...r, cpe: sub(r.user.id).current_period_end };
  }

  test('monthly (auto): one pre-charge reminder, token charge at period end, period extended, invoice issued', async () => {
    const { user, email, cpe } = await subscribed('monthly');
    assert.equal(sub(user.id).renewal, 'auto');
    t.clock.t = cpe - 2 * DAY;
    await run();
    await run();
    assert.equal(mails('pre_charge', email).length, 1, 'reminder sent once');
    assert.match(mails('pre_charge', email)[0].text, /24\.90/);
    const before = mock.charges.length;
    t.clock.t = cpe;
    const summary = await run();
    assert.equal(summary.charged >= 1, true);
    assert.equal(mock.charges.length, before + 1);
    assert.deepEqual([mock.charges.at(-1).amount, mock.charges.at(-1).currency], [2490, 'ILS']);
    const s = sub(user.id);
    assert.equal(s.status, 'active');
    assert.ok(s.current_period_end > cpe + 27 * DAY);
    assert.equal(t.services.billing.listInvoices(user.id).length, 2);
    await run();
    assert.equal(mock.charges.length, before + 1, 'not charged twice');
  });

  test('declined charge => past_due, retried daily, expired after the 7-day grace; canceled never charged', async () => {
    const { user, email, cpe } = await subscribed('monthly');
    t.clock.t = cpe;
    mock.nextCharge = 'declined';
    await run();
    assert.equal(sub(user.id).status, 'past_due');
    assert.deepEqual([ent(user.id).status, ent(user.id).hasAccess], ['past_due', true]);
    assert.equal(mails('payment_failed', email).length, 1);
    const attempts = () => t.services.db.one('SELECT COUNT(*) AS n FROM renewal_attempts WHERE subscription_id = ?', sub(user.id).id).n;
    await run();
    assert.equal(attempts(), 1, 'no retry before 24 h');
    t.clock.t = cpe + DAY + 1;
    mock.nextCharge = 'declined';
    await run();
    assert.equal(attempts(), 2);
    assert.equal(mails('payment_failed', email).length, 1, 'failure mail once per period');
    t.clock.t = cpe + 7 * DAY;
    await run();
    assert.equal(sub(user.id).status, 'expired');
    assert.equal(ent(user.id).hasAccess, false);

    const other = await subscribed('monthly');
    const c = await other.client.post('/api/billing/cancel', {});
    assert.equal(c.data.entitlement.status, 'canceled');
    assert.equal(mails('cancel_confirmation', other.email).length, 1);
    const n = mock.charges.length;
    t.clock.t = other.cpe + DAY;
    await run();
    assert.equal(mock.charges.length, n, 'canceled subscription not charged');
    assert.equal(sub(other.user.id).status, 'expired');
  });

  test('unknown charge outcome leaves a pending attempt that blocks further automatic charges', async () => {
    const { user, cpe } = await subscribed('monthly');
    t.clock.t = cpe;
    mock.nextCharge = 'error';
    const s1 = await run();
    assert.ok(s1.blocked >= 1);
    const n = mock.charges.length;
    t.clock.t = cpe + 2 * DAY;
    const s2 = await run();
    assert.ok(s2.blocked >= 1);
    assert.equal(mock.charges.length, n);
    assert.equal(t.services.db.one("SELECT COUNT(*) AS n FROM renewal_attempts WHERE subscription_id = ? AND status = 'pending'", sub(user.id).id).n, 1);
  });

  test('yearly (fixed term): never auto-charged; statutory end notice (<= 60 days) and final reminder (<= 7 days) once each', async () => {
    const { user, email, cpe } = await subscribed('yearly');
    assert.equal(sub(user.id).renewal, 'manual');
    const n = mock.charges.length;
    t.clock.t = cpe - 61 * DAY;
    await run();
    assert.equal(mails('end_notice', email).length, 0);
    t.clock.t = cpe - 59 * DAY;
    await run();
    await run();
    assert.equal(mails('end_notice', email).length, 1);
    assert.match(mails('end_notice', email)[0].text, /לא יתחדש אוטומטית/);
    t.clock.t = cpe - 6 * DAY;
    await run();
    await run();
    assert.equal(mails('final_reminder', email).length, 1);
    t.clock.t = cpe;
    await run();
    assert.equal(mock.charges.length, n, 'fixed-term plan never charged automatically');
    assert.equal(sub(user.id).status, 'expired');
    assert.deepEqual([ent(user.id).status, ent(user.id).canRenew], ['expired', true]);
  });

  test('POST /api/billing/renew: explicit consent, only near the end, token charge or hosted page', async () => {
    const { user, email, cpe, client } = await subscribed('quarterly');
    assert.equal((await client.post('/api/billing/renew', { planId: 'quarterly' })).data.error.code, 'CONSENT_REQUIRED');
    assert.equal((await client.post('/api/billing/renew', { planId: 'quarterly', consent: 'yes' })).data.error.code, 'CONSENT_REQUIRED');
    const early = await client.post('/api/billing/renew', { planId: 'quarterly', consent: true });
    assert.equal(early.status, 409);
    assert.equal(early.data.error.code, 'NOT_RENEWABLE');
    assert.equal((await client.get('/api/me')).data.entitlement.canRenew, false);

    t.clock.t = cpe - 10 * DAY;
    const c2 = t.client();
    assert.equal((await c2.post('/api/auth/login', { email, password: PASSWORD })).status, 200);
    assert.equal((await c2.get('/api/me')).data.entitlement.canRenew, true);
    const n = mock.charges.length;
    const r = await c2.post('/api/billing/renew', { planId: 'yearly', consent: true });
    assert.equal(r.status, 200);
    assert.equal(mock.charges.length, n + 1);
    assert.equal(mock.charges.at(-1).amount, 17990);
    assert.equal(r.data.entitlement.plan, 'yearly');
    assert.equal(r.data.entitlement.status, 'active');
    const newEnd = Date.parse(r.data.entitlement.currentPeriodEnd);
    assert.ok(newEnd > cpe + 364 * DAY && newEnd < cpe + 367 * DAY, 'extends from the current end');
    assert.equal(t.services.billing.listInvoices(user.id).length, 2);
    // a manual fixed-term renewal is a new purchase (14C): the 14-day refund window re-opens for that charge
    assert.ok(Date.parse(r.data.entitlement.refundEligibleUntil) > t.clock.t + 13 * DAY, 'refund window re-opens after a manual renewal');

    // declined token => hosted page for the renewal
    t.clock.t = newEnd - 5 * DAY;
    const c3 = t.client();
    await c3.post('/api/auth/login', { email, password: PASSWORD });
    mock.nextCharge = 'declined';
    const r2 = await c3.post('/api/billing/renew', { planId: 'yearly', consent: true });
    assert.equal(r2.status, 200);
    assert.match(r2.data.url, /\/api\/billing\/mock\/checkout\/mock_cs_/);
    const path = new URL(r2.data.url).pathname;
    const csrf = /name="csrf" value="([0-9a-f]+)"/.exec((await c3.get(path)).text)[1];
    const paid = await c3.req('POST', `${path}/pay`, { body: `csrf=${csrf}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(paid.status, 303);
    const e = (await c3.get('/api/me')).data.entitlement;
    assert.ok(Date.parse(e.currentPeriodEnd) > newEnd + 364 * DAY);
  });

  test('cancel mode "now": full refund within 14 days of the first charge, otherwise REFUND_WINDOW_PASSED', async () => {
    const a = await subscribed('yearly');
    assert.equal((await a.client.post('/api/billing/cancel', { mode: 'later' })).data.error.code, 'INVALID_MODE');
    const refundsBefore = mock.refunds.length;
    t.advance(13 * DAY);
    const c = t.client();
    await c.post('/api/auth/login', { email: a.email, password: PASSWORD });
    assert.ok((await c.get('/api/me')).data.entitlement.refundEligibleUntil, 'day 13: refund option offered');
    const r = await c.post('/api/billing/cancel', { mode: 'now' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.refund, { status: 'refunded', amount: 17990, currency: 'ILS' });
    assert.equal(mock.refunds.length, refundsBefore + 1);
    assert.equal(r.data.entitlement.plan, null);
    assert.notEqual(r.data.entitlement.status, 'active');
    assert.equal(r.data.entitlement.canRenew, false);
    assert.equal(t.services.billing.listInvoices(a.user.id)[0].status, 'refunded');
    assert.equal(mails('refund_confirmation', a.email).length, 1);
    // after a refund the user may buy again
    assert.equal((await c.post('/api/billing/checkout', { planId: 'monthly' })).status, 200);

    const b = await subscribed('monthly');
    t.advance(15 * DAY);
    const cb = t.client();
    await cb.post('/api/auth/login', { email: b.email, password: PASSWORD });
    assert.equal((await cb.get('/api/me')).data.entitlement.refundEligibleUntil, null, 'day 15: no refund option');
    const late = await cb.post('/api/billing/cancel', { mode: 'now' });
    assert.equal(late.status, 400);
    assert.equal(late.data.error.code, 'REFUND_WINDOW_PASSED');
    const normal = await cb.post('/api/billing/cancel', {});
    assert.equal(normal.data.entitlement.status, 'canceled');
    assert.equal(normal.data.entitlement.hasAccess, true);
    assert.equal(normal.data.refund, undefined);
  });

  test('cancel mode "now" double-click: two concurrent requests refund the charge once (A14)', async () => {
    const a = await subscribed('monthly');
    const refundsBefore = mock.refunds.length;
    const original = mock.refund;
    // a real provider answers after a network round trip: let the second request arrive meanwhile
    mock.refund = async (req) => { await new Promise((r) => setTimeout(r, 50)); return original.call(mock, req); };
    try {
      const [r1, r2] = await Promise.all([a.client.post('/api/billing/cancel', { mode: 'now' }), a.client.post('/api/billing/cancel', { mode: 'now' })]);
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      assert.deepEqual(r2.data.refund, r1.data.refund);
    } finally { mock.refund = original; }
    assert.equal(mock.refunds.length, refundsBefore + 1, 'refunded exactly once');
    assert.equal(mails('refund_confirmation', a.email).length, 1);
  });

  test('plans: region by country/currency; INTL plans all auto-renew in USD', async () => {
    const il = (await t.client().get('/api/plans')).data;
    assert.deepEqual([il.region, il.currency], ['IL', 'ILS']);
    const intl = (await t.client().get('/api/plans?country=US')).data;
    assert.deepEqual([intl.region, intl.currency], ['INTL', 'USD']);
    assert.deepEqual(intl.plans.map((p) => [p.price, p.renewal]), [[599, 'auto'], [1499, 'auto'], [4499, 'auto']]);
    assert.equal((await t.client().get('/api/plans?currency=USD')).data.region, 'INTL');
  });
});

describe('PayPlus end to end (mocked PayPlus API)', () => {
  const SECRET = 'pp-secret-key';
  let t;
  let ipn;
  const fetchImpl = mockFetch({
    'POST PaymentPages/generateLink': (body) => [200, { results: { status: 'success' }, data: { page_request_uid: `prq-${body.more_info}`, payment_page_link: `https://paymentsdev.payplus.co.il/p/${body.more_info}` } }],
    'POST PaymentPages/ipn': (body) => [200, ipn(body.payment_request_uid)],
  });
  before(async () => {
    t = await startTestServer({
      fetchImpl,
      env: { PAYMENT_PROVIDER: 'payplus', PAYPLUS_API_KEY: 'k', PAYPLUS_SECRET_KEY: SECRET, PAYPLUS_PAGE_UID: 'page', PAYPLUS_TERMINAL_UID: 'term' },
    });
  });
  after(async () => { await t.close(); });

  const sendCallback = (ref) => {
    const raw = JSON.stringify({ transaction: { payment_page_request_uid: ref, uid: 'ignored', status_code: '000' } });
    return fetch(`${t.base}/api/webhooks/payplus`, {
      method: 'POST', body: raw,
      headers: { 'content-type': 'application/json', 'user-agent': 'PayPlus', hash: createHmac('sha256', SECRET).update(raw).digest('base64') },
    });
  };

  test('plans, checkout, signed callback + re-query => active; replay is a no-op', async () => {
    const plans = (await t.client().get('/api/plans?country=US')).data;
    assert.deepEqual([plans.provider, plans.region, plans.currency], ['payplus', 'IL', 'ILS'], 'forced provider serves everyone');
    const { client, user } = await registerUser(t);
    const co = await client.post('/api/billing/checkout', { planId: 'monthly' });
    assert.match(co.data.url, /^https:\/\/paymentsdev\.payplus\.co\.il\/p\//);
    const ref = t.services.db.one("SELECT provider_ref FROM checkout_sessions WHERE user_id = ? AND provider = 'payplus'", user.id).provider_ref;
    ipn = () => ({ results: { status: 'success' }, data: { transaction: { uid: `tx-${ref}`, status_code: '000', amount: 24.9, currency: 'ILS' }, token_uid: 'tok-1' } });
    const r = await sendCallback(ref);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { received: true, processed: 2, duplicates: 0, ignored: 0 });
    const e = (await client.get('/api/me')).data.entitlement;
    assert.deepEqual([e.status, e.plan, e.renewal], ['active', 'monthly', 'auto']);
    assert.equal(t.services.billing.currentSubscription(user.id).provider_token_ref, 'tok-1');
    const again = await (await sendCallback(ref)).json();
    assert.equal(again.duplicates, 2);
  });

  test('re-query says not paid => no access; amount mismatch => 400; bad signature => 400', async () => {
    const { client, user } = await registerUser(t);
    await client.post('/api/billing/checkout', { planId: 'yearly' });
    const ref = t.services.db.one("SELECT provider_ref FROM checkout_sessions WHERE user_id = ?", user.id).provider_ref;
    ipn = () => ({ results: { status: 'success' }, data: { transaction: { uid: 'tx-x', status_code: '006', amount: 179.9, currency: 'ILS' } } });
    assert.deepEqual(await (await sendCallback(ref)).json(), { received: true, processed: 0, duplicates: 0, ignored: 0 });
    assert.equal((await client.get('/api/me')).data.entitlement.status, 'trial');
    ipn = () => ({ results: { status: 'success' }, data: { transaction: { uid: 'tx-y', status_code: '000', amount: 1, currency: 'ILS' } } });
    const mismatch = await sendCallback(ref);
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json()).error.code, 'AMOUNT_MISMATCH');
    assert.equal((await client.get('/api/me')).data.entitlement.status, 'trial');
    const forged = await fetch(`${t.base}/api/webhooks/payplus`, { method: 'POST', body: '{}', headers: { 'user-agent': 'PayPlus', hash: 'AAAA' } });
    assert.equal(forged.status, 400);
    // return page re-queries server-to-server when the callback is late
    ipn = () => ({ results: { status: 'success' }, data: { transaction: { uid: 'tx-z', status_code: '000', amount: 179.9, currency: 'ILS' } } });
    const back = await client.get('/api/billing/return/success?page_request_uid=whatever');
    assert.equal(back.status, 303);
    assert.equal(back.headers.get('location'), `${t.base}/app/#/account?checkout=success`);
    const e = (await client.get('/api/me')).data.entitlement;
    assert.deepEqual([e.status, e.plan, e.renewal], ['active', 'yearly', 'manual']);
  });
});
