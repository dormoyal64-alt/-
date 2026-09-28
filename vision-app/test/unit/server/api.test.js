// Integration tests: createApp() on an ephemeral port, temp DATA_DIR, fetch + cookie jar.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startTestServer, registerUser, payWithMock, PASSWORD } from './helpers.js';

const DAY = 86_400_000;

describe('API (NODE_ENV=test, mock payments)', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let t;
  before(async () => { t = await startTestServer(); });
  after(async () => { await t.close(); });

  test('health', async () => {
    const r = await t.client().get('/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true });
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test('security headers on API and static responses; no x-powered-by; no HSTS outside production', async () => {
    for (const path of ['/api/health', '/app/css/base.css', '/does-not-exist']) {
      const r = await t.client().get(path);
      const csp = r.headers.get('content-security-policy');
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /form-action 'self'/);
      assert.match(csp, /object-src 'none'/);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.equal(r.headers.get('permissions-policy'), 'camera=(self), microphone=(), geolocation=(), payment=(self)');
      assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
      assert.equal(r.headers.get('x-frame-options'), 'DENY');
      assert.equal(r.headers.get('x-powered-by'), null);
      assert.equal(r.headers.get('strict-transport-security'), null);
    }
  });

  test('static caching and MIME types', async () => {
    const c = t.client();
    const css = await c.get('/app/css/base.css');
    assert.equal(css.status, 200);
    assert.equal(css.headers.get('cache-control'), 'public, max-age=300');
    assert.ok(css.headers.get('etag'));
    const html = await c.get('/app/dev/harness.html'); // exists outside production
    assert.equal(html.status, 200);
    assert.equal(html.headers.get('cache-control'), 'no-cache');
    const wasm = await c.get('/app/vendor/mediapipe/wasm/vision_wasm_internal.wasm');
    if (wasm.status === 200) {
      assert.equal(wasm.headers.get('content-type'), 'application/wasm');
      assert.equal(wasm.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    }
    const nf = await c.get('/api/nope');
    assert.equal(nf.status, 404);
    assert.equal(nf.data.error.code, 'NOT_FOUND');
  });

  test('plans', async () => {
    const r = await t.client().get('/api/plans');
    assert.equal(r.status, 200);
    assert.equal(r.data.trialDays, 30);
    assert.equal(r.data.currency, 'ILS');
    assert.deepEqual(r.data.plans.map((p) => p.id), ['monthly', 'quarterly', 'yearly']);
    assert.deepEqual(r.data.plans.map((p) => [p.price, p.renewal]), [[2490, 'auto'], [5990, 'manual'], [17990, 'manual']]);
    assert.equal(r.data.region, 'IL');
    for (const p of r.data.plans) {
      assert.deepEqual(Object.keys(p).sort(), ['currency', 'id', 'months', 'price', 'pricePerMonth', 'provider', 'renewal', 'savingsPercent']);
      assert.equal(p.provider, 'mock');
    }
  });

  test('register -> me -> logout -> login (session rotation)', async () => {
    const c = t.client();
    const reg = await c.post('/api/auth/register', { email: '  Dana.Cohen@Example.COM ', password: PASSWORD, lang: 'en', acceptTerms: true });
    assert.equal(reg.status, 201);
    assert.equal(reg.data.user.email, 'dana.cohen@example.com');
    assert.equal(reg.data.user.lang, 'en');
    assert.deepEqual(Object.keys(reg.data.user).sort(), ['createdAt', 'email', 'id', 'lang']);
    assert.equal(reg.data.entitlement.status, 'trial');
    assert.equal(reg.data.entitlement.daysLeft, 30);
    assert.equal(reg.data.entitlement.hasAccess, true);
    const sc = c.lastSetCookie.join('\n');
    assert.match(sc, /^sid=[A-Za-z0-9_-]{43};/);
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /SameSite=Lax/);
    assert.match(sc, /Path=\//);
    const firstToken = c.jar.get('sid');

    const me = await c.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.user.id, reg.data.user.id);

    const out = await c.post('/api/auth/logout');
    assert.equal(out.status, 204);
    assert.equal(c.jar.has('sid'), false);
    assert.equal((await c.get('/api/me')).status, 401);

    // old token is dead server-side too
    const stale = t.client();
    stale.jar.set('sid', firstToken);
    assert.equal((await stale.get('/api/me')).status, 401);

    const login = await c.post('/api/auth/login', { email: 'DANA.cohen@example.com', password: PASSWORD });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.id, reg.data.user.id);
    assert.equal(login.data.entitlement.status, 'trial');
    const second = c.jar.get('sid');
    assert.notEqual(second, firstToken);

    // logging in again rotates: the previous session token stops working
    const again = await c.post('/api/auth/login', { email: 'dana.cohen@example.com', password: PASSWORD });
    assert.equal(again.status, 200);
    const old = t.client();
    old.jar.set('sid', second);
    assert.equal((await old.get('/api/me')).status, 401);
    assert.equal((await c.get('/api/me')).status, 200);
  });

  test('registration validation and duplicate e-mail', async () => {
    const c = t.client();
    const email = 'dup@example.com';
    assert.equal((await c.post('/api/auth/register', { email, password: PASSWORD, lang: 'he', acceptTerms: true })).status, 201);
    const dup = await t.client().post('/api/auth/register', { email: 'DUP@example.com', password: PASSWORD, lang: 'he', acceptTerms: true });
    assert.equal(dup.status, 409);
    assert.equal(dup.data.error.code, 'EMAIL_TAKEN');
    const cases = [
      [{ email: 'not-an-email', password: PASSWORD, acceptTerms: true }, 'INVALID_EMAIL'],
      [{ email: 'a@example.com', password: 'short', acceptTerms: true }, 'PASSWORD_TOO_SHORT'],
      [{ email: 'a@example.com', password: '12345678', acceptTerms: true }, 'PASSWORD_TOO_COMMON'],
      [{ email: 'a@example.com', password: PASSWORD, acceptTerms: 'yes' }, 'TERMS_NOT_ACCEPTED'],
      [{ email: 'a@example.com', password: PASSWORD }, 'TERMS_NOT_ACCEPTED'],
      [{ email: 'a@example.com', password: PASSWORD, acceptTerms: true, lang: 'fr' }, 'INVALID_LANG'],
    ];
    for (const [body, code] of cases) {
      const r = await t.client().post('/api/auth/register', body);
      assert.equal(r.status, 400, code);
      assert.equal(r.data.error.code, code);
      assert.equal(typeof r.data.error.message, 'string');
    }
  });

  test('wrong password and unknown e-mail give the same 401', async () => {
    const { email } = await registerUser(t);
    const a = await t.client().post('/api/auth/login', { email, password: 'Wrong-Password-1' });
    const b = await t.client().post('/api/auth/login', { email: 'nobody@example.com', password: 'Wrong-Password-1' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.deepEqual(a.data, b.data);
    assert.equal(a.data.error.code, 'INVALID_CREDENTIALS');
  });

  test('CSRF: missing or foreign Origin is rejected with 403', async () => {
    const { client } = await registerUser(t);
    const noOrigin = await client.post('/api/billing/cancel', {}, { origin: false });
    assert.equal(noOrigin.status, 403);
    assert.equal(noOrigin.data.error.code, 'BAD_ORIGIN');
    const evil = await client.post('/api/billing/checkout', { planId: 'monthly' }, { origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    assert.equal(evil.data.error.code, 'BAD_ORIGIN');
    const nullOrigin = await client.del('/api/me', { password: PASSWORD }, { origin: 'null' });
    assert.equal(nullOrigin.status, 403);
    assert.equal((await client.get('/api/me')).status, 200); // GET needs no Origin
  });

  test('JSON content-type enforcement, malformed JSON and body size limit', async () => {
    const c = t.client();
    const form = await c.req('POST', '/api/auth/login', { body: 'email=a%40b.co&password=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 403);
    assert.equal(form.data.error.code, 'JSON_REQUIRED');
    const plain = await c.req('POST', '/api/auth/login', { body: '{}', headers: { 'content-type': 'text/plain' } });
    assert.equal(plain.status, 403);
    assert.equal(plain.data.error.code, 'JSON_REQUIRED');
    const bad = await c.req('POST', '/api/auth/login', { body: '{"email":', headers: { 'content-type': 'application/json' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error.code, 'INVALID_JSON');
    assert.doesNotMatch(bad.text, /at |node_modules|stack/i);
    const big = await c.post('/api/auth/login', { email: 'a@example.com', password: 'x'.repeat(40 * 1024) });
    assert.equal(big.status, 413);
    assert.equal(big.data.error.code, 'PAYLOAD_TOO_LARGE');
  });

  test('login rate limit: 10 attempts per 15 min per IP+e-mail, then 429 with Retry-After', async () => {
    const { email } = await registerUser(t);
    for (let i = 0; i < 10; i++) {
      const r = await t.client().post('/api/auth/login', { email, password: `Wrong-Password-${i}` });
      assert.equal(r.status, 401);
    }
    const blocked = await t.client().post('/api/auth/login', { email, password: PASSWORD });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.error.code, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    // other e-mails from the same IP are unaffected
    const other = await registerUser(t);
    assert.equal((await t.client().post('/api/auth/login', { email: other.email, password: PASSWORD })).status, 200);
    // the window slides
    t.advance(15 * 60_000 + 1);
    assert.equal((await t.client().post('/api/auth/login', { email, password: PASSWORD })).status, 200);
  });

  test('trial entitlement expires after TRIAL_DAYS', async () => {
    const { client, entitlement } = await registerUser(t);
    assert.equal(entitlement.status, 'trial');
    t.advance(20 * DAY);
    const mid = await client.get('/api/me');
    assert.equal(mid.data.entitlement.daysLeft, 10);
    t.advance(10 * DAY);
    const end = await client.get('/api/me');
    assert.equal(end.data.entitlement.status, 'expired');
    assert.equal(end.data.entitlement.hasAccess, false);
    assert.equal(end.data.entitlement.daysLeft, 0);
  });

  test('checkout with mock -> pay -> active; invoices; second checkout 409; cancel keeps access; resume', async () => {
    const { client, user } = await registerUser(t);
    const trialEndsAt = Date.parse((await client.get('/api/me')).data.entitlement.trialEndsAt);

    assert.equal((await client.post('/api/billing/checkout', { planId: 'weekly' })).data.error.code, 'INVALID_PLAN');
    assert.equal((await t.client().post('/api/billing/checkout', { planId: 'monthly' })).status, 401);

    const { page, paid, checkoutUrl } = await payWithMock(client, 'quarterly');
    assert.equal(checkoutUrl.origin, t.base);
    assert.match(checkoutUrl.pathname, /^\/api\/billing\/mock\/checkout\/mock_cs_/);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(page.text, /<html lang="he" dir="rtl">/);
    assert.doesNotMatch(page.text, /<script/i);
    assert.equal(paid.status, 303);
    assert.equal(paid.headers.get('location'), `${t.base}/app/#/account?checkout=success`);

    const me = await client.get('/api/me');
    const e = me.data.entitlement;
    assert.equal(e.status, 'active');
    assert.equal(e.plan, 'quarterly');
    assert.equal(e.hasAccess, true);
    // paid period starts when the trial ends: no trial days are lost
    const cpe = Date.parse(e.currentPeriodEnd);
    assert.ok(cpe > trialEndsAt + 88 * DAY && cpe < trialEndsAt + 93 * DAY);

    const inv = await client.get('/api/billing/invoices');
    assert.equal(inv.status, 200);
    assert.equal(inv.data.invoices.length, 1);
    assert.deepEqual([inv.data.invoices[0].amount, inv.data.invoices[0].currency, inv.data.invoices[0].plan], [5990, 'ILS', 'quarterly']);

    // paying the same checkout twice is impossible
    const again = await client.req('POST', `${checkoutUrl.pathname}/pay`, { body: 'csrf=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(again.status, 409);

    const second = await client.post('/api/billing/checkout', { planId: 'yearly' });
    assert.equal(second.status, 409);
    assert.equal(second.data.error.code, 'ALREADY_SUBSCRIBED');

    // cancel: one request, no body needed
    const cancel = await client.req('POST', '/api/billing/cancel');
    assert.equal(cancel.status, 200);
    assert.equal(cancel.data.entitlement.status, 'canceled');
    assert.equal(cancel.data.entitlement.hasAccess, true);
    assert.equal(cancel.data.entitlement.cancelAtPeriodEnd, true);
    assert.equal((await client.post('/api/billing/cancel')).data.entitlement.status, 'canceled'); // idempotent

    const resume = await client.post('/api/billing/resume');
    assert.equal(resume.status, 200);
    assert.equal(resume.data.entitlement.status, 'active');
    assert.equal(resume.data.entitlement.cancelAtPeriodEnd, false);

    // cancel again and let the period run out
    await client.post('/api/billing/cancel');
    const sub = t.services.billing.currentSubscription(user.id);
    t.services.db.run('UPDATE subscriptions SET current_period_end = ? WHERE id = ?', t.clock.t - 1, sub.id);
    t.services.db.run('UPDATE users SET trial_ends_at = ? WHERE id = ?', t.clock.t - 1, user.id);
    const after = await client.get('/api/me');
    assert.equal(after.data.entitlement.status, 'expired');
    assert.equal(after.data.entitlement.hasAccess, false);
    assert.equal((await client.post('/api/billing/resume')).data.error.code, 'NOT_RESUMABLE');
    // an expired subscriber may check out again
    assert.equal((await client.post('/api/billing/checkout', { planId: 'monthly' })).status, 200);
  });

  test('mock checkout: cancel button, CSRF token, other users cannot see the page', async () => {
    const { client } = await registerUser(t);
    const co = await client.post('/api/billing/checkout', { planId: 'monthly' });
    const path = new URL(co.data.url).pathname;
    const intruder = await registerUser(t);
    assert.equal((await intruder.client.get(path)).status, 404);
    assert.equal((await t.client().get(path)).status, 401);
    const badCsrf = await client.req('POST', `${path}/pay`, { body: 'csrf=deadbeef', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(badCsrf.status, 403);
    const csrf = /name="csrf" value="([0-9a-f]+)"/.exec((await client.get(`${path}?lang=en`)).text)[1];
    const foreign = await client.req('POST', `${path}/pay`, { body: `csrf=${csrf}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    const cancel = await client.req('POST', `${path}/cancel`, { body: `csrf=${csrf}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(cancel.status, 303);
    assert.equal(cancel.headers.get('location'), `${t.base}/app/#/account?checkout=cancel`);
    assert.equal((await client.get('/api/me')).data.entitlement.status, 'trial');
  });

  test('cancel/resume without subscription => 409', async () => {
    const { client } = await registerUser(t);
    assert.equal((await client.post('/api/billing/cancel')).data.error.code, 'NO_ACTIVE_SUBSCRIPTION');
    assert.equal((await client.post('/api/billing/resume')).data.error.code, 'NOT_RESUMABLE');
    assert.deepEqual((await client.get('/api/billing/invoices')).data, { invoices: [] });
  });

  describe('webhooks', () => {
    const sign = (body) => createHmac('sha256', 'whsec-test').update(body).digest('hex');
    const send = (body, sig = sign(body), extraHeaders = {}) => fetch(`${t.base}/api/webhooks/mock`, {
      method: 'POST', body, headers: { 'content-type': 'application/json', 'x-mock-signature': sig, ...extraHeaders },
    });

    test('bad or missing signature => 400, nothing applied', async () => {
      const { user } = await registerUser(t);
      const body = JSON.stringify({ id: 'evt_bad_1', type: 'subscription.activated', userId: user.id, subscriptionId: 'sub_x', plan: 'monthly', currentPeriodEnd: t.clock.t + 30 * DAY });
      const r1 = await send(body, sign(body + ' '));
      assert.equal(r1.status, 400);
      assert.equal((await r1.json()).error.code, 'INVALID_SIGNATURE');
      const r2 = await fetch(`${t.base}/api/webhooks/mock`, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
      assert.equal(r2.status, 400);
      assert.equal(t.services.billing.currentSubscription(user.id), null);
      assert.equal((await send('not json', sign('not json'))).status, 400);
      assert.equal((await send(body, sign(body), {}).then(() => fetch(`${t.base}/api/webhooks/unknown`, { method: 'POST', body }))).status, 404);
    });

    test('valid events apply (no Origin needed), duplicates are no-ops, stale events ignored', async () => {
      const { client, user } = await registerUser(t);
      const t0 = t.clock.t;
      const activated = JSON.stringify({ events: [
        { id: 'evt_a1', type: 'subscription.activated', userId: user.id, subscriptionId: 'sub_w1', customerId: 'cus_1', plan: 'monthly', currentPeriodEnd: t0 + 30 * DAY, occurredAt: t0 },
        { id: 'evt_a2', type: 'invoice.issued', userId: user.id, subscriptionId: 'sub_w1', invoice: { id: 'inv_1', amount: 2990, currency: 'ILS', url: 'https://provider.example/inv/1' } },
      ] });
      const r = await send(activated);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { received: true, processed: 2, duplicates: 0, ignored: 0 });
      assert.equal((await client.get('/api/me')).data.entitlement.status, 'active');

      const dup = await send(activated);
      assert.equal(dup.status, 200);
      assert.deepEqual(await dup.json(), { received: true, processed: 0, duplicates: 2, ignored: 0 });
      assert.equal((await client.get('/api/billing/invoices')).data.invoices.length, 1);

      const failed = JSON.stringify({ id: 'evt_f1', type: 'payment.failed', subscriptionId: 'sub_w1', occurredAt: t0 + 30 * DAY });
      assert.equal((await send(failed)).status, 200);
      const failedEnt = (await client.get('/api/me')).data.entitlement; // payment failed while period still running
      assert.deepEqual([failedEnt.status, failedEnt.hasAccess], ['past_due', true]);

      t.advance(20 * DAY);
      await client.get('/api/me'); // keeps the 30-day sliding session alive
      t.advance(11 * DAY);
      const pd = (await client.get('/api/me')).data.entitlement;
      assert.deepEqual([pd.status, pd.hasAccess], ['past_due', true]);

      const renewed = JSON.stringify({ id: 'evt_r1', type: 'subscription.renewed', subscriptionId: 'sub_w1', currentPeriodEnd: t0 + 61 * DAY, occurredAt: t0 + 31 * DAY });
      assert.equal((await send(renewed)).status, 200);
      const act = (await client.get('/api/me')).data.entitlement;
      assert.deepEqual([act.status, act.currentPeriodEnd], ['active', new Date(t0 + 61 * DAY).toISOString()]);

      // an older event delivered late must not overwrite newer state
      const stale = JSON.stringify({ id: 'evt_old', type: 'subscription.expired', subscriptionId: 'sub_w1', occurredAt: t0 + DAY });
      assert.deepEqual(await (await send(stale)).json(), { received: true, processed: 0, duplicates: 0, ignored: 1 });
      assert.equal((await client.get('/api/me')).data.entitlement.status, 'active');

      const expired = JSON.stringify({ id: 'evt_e1', type: 'subscription.expired', subscriptionId: 'sub_w1', occurredAt: t0 + 32 * DAY });
      await send(expired);
      assert.equal((await client.get('/api/me')).data.entitlement.status, 'expired');
    });

    test('unknown event types are rejected as invalid payload', async () => {
      const body = JSON.stringify({ id: 'evt_u', type: 'something.else' });
      const r = await send(body);
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error.code, 'INVALID_PAYLOAD');
    });
  });

  test('password reset: 202 always, single-use token, other sessions invalidated', async () => {
    const { client, email, user } = await registerUser(t);
    const before = t.mail.length;
    const unknown = await t.client().post('/api/auth/password-reset/request', { email: 'ghost@example.com' });
    assert.equal(unknown.status, 202);
    assert.equal(t.mail.length, before);

    const r = await t.client().post('/api/auth/password-reset/request', { email: email.toUpperCase() });
    assert.equal(r.status, 202);
    assert.equal(t.mail.length, before + 1);
    const msg = t.mail.at(-1);
    assert.equal(msg.to, email);
    assert.equal(msg.lang, 'he');
    assert.match(msg.html, /dir="rtl"/);
    const token = /#\/reset-password\?token=([A-Za-z0-9_-]{43})/.exec(msg.text)[1];
    assert.ok(!t.services.db.one('SELECT 1 AS x FROM password_resets WHERE token_hash = ?', token), 'raw token must not be stored');

    assert.equal((await t.client().post('/api/auth/password-reset/confirm', { token, password: '123' })).data.error.code, 'PASSWORD_TOO_SHORT');
    assert.equal((await t.client().post('/api/auth/password-reset/confirm', { token: 'x'.repeat(43), password: 'New-Password-77' })).data.error.code, 'INVALID_TOKEN');
    const ok = await t.client().post('/api/auth/password-reset/confirm', { token, password: 'New-Password-77' });
    assert.equal(ok.status, 204);
    assert.equal((await client.get('/api/me')).status, 401); // old session killed
    const reuse = await t.client().post('/api/auth/password-reset/confirm', { token, password: 'Other-Password-88' });
    assert.equal(reuse.status, 400);
    assert.equal(reuse.data.error.code, 'INVALID_TOKEN');
    assert.equal((await t.client().post('/api/auth/login', { email, password: PASSWORD })).status, 401);
    const login = await t.client().post('/api/auth/login', { email, password: 'New-Password-77' });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.id, user.id);
  });

  test('password reset token expires after 1 hour', async () => {
    const { email } = await registerUser(t);
    await t.client().post('/api/auth/password-reset/request', { email });
    const token = /token=([A-Za-z0-9_-]{43})/.exec(t.mail.at(-1).text)[1];
    t.advance(60 * 60_000 + 1);
    const r = await t.client().post('/api/auth/password-reset/confirm', { token, password: 'New-Password-77' });
    assert.equal(r.data.error.code, 'INVALID_TOKEN');
  });

  test('password reset request is rate limited per IP+e-mail (5/hour)', async () => {
    const email = 'limited-reset@example.com';
    for (let i = 0; i < 5; i++) assert.equal((await t.client().post('/api/auth/password-reset/request', { email })).status, 202);
    const r = await t.client().post('/api/auth/password-reset/request', { email });
    assert.equal(r.status, 429);
    assert.ok(r.headers.get('retry-after'));
  });

  test('delete account: requires password, cancels subscription, anonymises invoices, no second trial', async () => {
    const { client, email, user } = await registerUser(t);
    await payWithMock(client, 'monthly');
    assert.equal((await client.get('/api/me')).data.entitlement.status, 'active');

    assert.equal((await client.del('/api/me', {})).data.error.code, 'VALIDATION_ERROR');
    const wrong = await client.del('/api/me', { password: 'Wrong-Password-1' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.data.error.code, 'INVALID_PASSWORD');

    const del = await client.del('/api/me', { password: PASSWORD });
    assert.equal(del.status, 204);
    assert.equal((await client.get('/api/me')).status, 401);
    assert.equal((await t.client().post('/api/auth/login', { email, password: PASSWORD })).status, 401);

    const db = t.services.db;
    assert.equal(db.one('SELECT COUNT(*) AS n FROM users WHERE id = ?', user.id).n, 0);
    assert.equal(db.one('SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?', user.id).n, 0);
    assert.equal(db.one('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', user.id).n, 0);
    assert.equal(db.one('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?', user.id).n, 0);
    assert.equal(db.one('SELECT COUNT(*) AS n FROM webhook_events WHERE user_id = ?', user.id).n, 0);
    const kept = db.all("SELECT user_id, amount FROM invoices WHERE provider = 'mock' AND user_id IS NULL");
    assert.ok(kept.some((i) => i.amount === 2490), 'invoice kept, anonymised');

    const re = await t.client().post('/api/auth/register', { email, password: PASSWORD, lang: 'he', acceptTerms: true });
    assert.equal(re.status, 201);
    assert.equal(re.data.entitlement.status, 'expired', 'one free trial per e-mail, ever');
    assert.equal(re.data.entitlement.hasAccess, false);
  });
});

describe('API (production mode)', () => {
  let t;
  const stubProvider = {
    id: 'stub',
    cspFormActionOrigins: ['https://pay.provider.example'],
    async createCheckout() { return { url: 'https://pay.provider.example/c/1', providerRef: 'ref1' }; },
    async cancelSubscription() {},
    async resumeSubscription() {},
    verifyAndParseWebhook() { return []; },
  };
  before(async () => {
    t = await startTestServer({
      provider: stubProvider,
      configOverrides: { nodeEnv: 'production', isProduction: true, publicBaseUrl: 'https://app.example.co.il', rateLimitIpScale: 1 },
    });
  });
  after(async () => { await t.close(); });

  test('/app/dev/** is 404 (including encoded and case variants)', async () => {
    const c = t.client();
    for (const p of ['/app/dev/harness.html', '/app/dev/', '/app/dev', '/app/%64ev/harness.html', '/APP/DEV/harness.html', '/app//dev/harness.html', '/app/./dev/harness.html']) {
      assert.equal((await c.get(p)).status, 404, p);
    }
    assert.equal((await c.get('/app/css/base.css')).status, 200);
  });

  test('HSTS, provider origin in CSP form-action, mock routes absent', async () => {
    const c = t.client();
    const r = await c.get('/api/health');
    assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
    assert.match(r.headers.get('content-security-policy'), /form-action 'self' https:\/\/pay\.provider\.example;/);
    assert.equal((await c.get('/api/billing/mock/checkout/mock_cs_x')).status, 404);
  });

  test('__Host-sid cookie is Secure; Origin must equal PUBLIC_BASE_URL; checkout returns the provider URL', async () => {
    const c = t.client();
    const own = await c.post('/api/auth/register', { email: 'prod@example.com', password: PASSWORD, lang: 'he', acceptTerms: true }, { origin: t.base });
    assert.equal(own.status, 403, 'request-host origin is not accepted when PUBLIC_BASE_URL is set');
    const reg = await c.post('/api/auth/register', { email: 'prod@example.com', password: PASSWORD, lang: 'he', acceptTerms: true });
    assert.equal(reg.status, 201);
    const sc = c.lastSetCookie.join('\n');
    assert.match(sc, /^__Host-sid=/);
    assert.match(sc, /Secure/);
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /Path=\//);
    assert.doesNotMatch(sc, /Domain=/i);
    const co = await c.post('/api/billing/checkout', { planId: 'yearly' });
    assert.deepEqual(co.data, { url: 'https://pay.provider.example/c/1' });
  });
});
