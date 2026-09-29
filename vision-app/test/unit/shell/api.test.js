import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, api, configureApi, ApiError, safeCheckoutUrl, codeForStatus } from '../../../public/app/js/account/api.js';
import { errorKey, isWrongPassword } from '../../../public/app/js/account/errors.js';

function fakeFetch(status, body, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, statusText: 'x', text: async () => text };
  };
}

test('JSON requests: credentials, headers, body; empty responses => null', async () => {
  const calls = [];
  configureApi({ fetchImpl: fakeFetch(200, { url: 'https://pay.example/x' }, calls), onUnauthorized: null });
  const res = await api.checkout('yearly');
  assert.deepEqual(res, { url: 'https://pay.example/x' });
  assert.equal(calls[0].url, '/api/billing/checkout');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { planId: 'yearly' });
  configureApi({ fetchImpl: fakeFetch(204) });
  assert.equal(await api.logout(), null);
  const c2 = [];
  configureApi({ fetchImpl: fakeFetch(200, { entitlement: {} }, c2) });
  await api.cancel('now');
  assert.deepEqual(JSON.parse(c2[0].init.body), { mode: 'now' });
  await api.renew('yearly');
  assert.deepEqual(JSON.parse(c2[1].init.body), { planId: 'yearly', consent: true });
  const c3 = [];
  configureApi({ fetchImpl: fakeFetch(200, { plans: [] }, c3) });
  await api.plans();
  assert.equal(c3[0].init.method, 'GET');
  assert.equal(c3[0].init.body, undefined);
});

test('errors are uniform ApiErrors; 401 triggers the hook only when authenticated', async () => {
  let hooked = 0;
  configureApi({ fetchImpl: fakeFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } }), onUnauthorized: () => { hooked++; } });
  await assert.rejects(api.cancel(), (e) => e instanceof ApiError && e.status === 401 && e.code === 'UNAUTHENTICATED');
  assert.equal(hooked, 1);
  await assert.rejects(api.me(), (e) => e.status === 401);
  await assert.rejects(api.login({ email: 'a', password: 'b' }), (e) => e.status === 401);
  assert.equal(hooked, 1, 'me/login 401 do not redirect');
  configureApi({ fetchImpl: fakeFetch(500, 'oops not json') });
  await assert.rejects(apiRequest('GET', '/api/x'), (e) => e.code === 'SERVER_ERROR');
  configureApi({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(api.plans(), (e) => e.isNetwork && e.code === 'NETWORK');
  configureApi({ fetchImpl: null, onUnauthorized: null });
});

test('error messages and helpers', () => {
  assert.equal(errorKey({ status: 409, code: 'EMAIL_TAKEN' }), 'err.emailTaken');
  assert.equal(errorKey({ status: 400, code: 'PASSWORD_TOO_COMMON' }), 'err.commonPassword');
  assert.equal(errorKey({ status: 400, code: 'TERMS_NOT_ACCEPTED' }), 'err.terms');
  assert.equal(errorKey({ status: 409, code: 'REFUND_WINDOW_PASSED' }), 'err.refundWindow');
  assert.equal(errorKey({ status: 429, code: 'SOMETHING' }), 'err.rateLimited');
  assert.equal(errorKey({ status: 0, code: 'NETWORK' }), 'err.network');
  assert.equal(errorKey({ status: 503 }), 'err.server');
  assert.equal(errorKey(null), 'err.generic');
  assert.equal(isWrongPassword({ status: 403, code: 'INVALID_PASSWORD' }), true);
  assert.equal(isWrongPassword({ status: 401, code: 'UNAUTHENTICATED' }), false);
  assert.equal(codeForStatus(429), 'RATE_LIMITED');
  assert.equal(safeCheckoutUrl('https://pay.example/c/1', 'http://127.0.0.1:4105'), 'https://pay.example/c/1');
  assert.equal(safeCheckoutUrl('/api/billing/mock/checkout/1', 'http://127.0.0.1:4105'), 'http://127.0.0.1:4105/api/billing/mock/checkout/1');
  assert.equal(safeCheckoutUrl('http://evil.example/x', 'http://127.0.0.1:4105'), null);
  assert.equal(safeCheckoutUrl('javascript:alert(1)', 'http://127.0.0.1:4105'), null);
  assert.equal(safeCheckoutUrl(null, 'http://127.0.0.1:4105'), null);
});
