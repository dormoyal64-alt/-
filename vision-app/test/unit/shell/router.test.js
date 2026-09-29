import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash, matchRoute, sanitizeReturnTo } from '../../../public/app/js/shell/route-utils.js';
import { ROUTES, NOT_FOUND_ROUTE, NAV_TABS } from '../../../public/app/js/shell/routes.js';

test('parseHash normalises path, segments and query', () => {
  assert.deepEqual(parseHash(''), { path: '/', segments: [], query: {} });
  assert.deepEqual(parseHash('#'), { path: '/', segments: [], query: {} });
  assert.deepEqual(parseHash('#/'), { path: '/', segments: [], query: {} });
  assert.deepEqual(parseHash('#/viewer/photo'), { path: '/viewer/photo', segments: ['viewer', 'photo'], query: {} });
  assert.deepEqual(parseHash('#/Home/'), { path: '/home', segments: ['home'], query: {} });
  assert.deepEqual(parseHash('#home'), { path: '/home', segments: ['home'], query: {} });
  assert.deepEqual(parseHash('#//account//'), { path: '/account', segments: ['account'], query: {} });
  const r = parseHash('#/account?checkout=success&x=a%20b');
  assert.equal(r.path, '/account');
  assert.deepEqual(r.query, { checkout: 'success', x: 'a b' });
  assert.equal(parseHash('#/reset-password?token=AbC_123').query.token, 'AbC_123');
  assert.equal(parseHash('#/%E0%A4%A').path, '/%e0%a4%a'); // malformed escapes don't throw
});

test('buildHash round-trips and drops empty params', () => {
  assert.equal(buildHash('/home'), '#/home');
  assert.equal(buildHash('onboarding', { retest: 'id 1', new: undefined, fresh: null, off: false }), '#/onboarding?retest=id+1');
  assert.equal(buildHash('/results', { fresh: 1 }), '#/results?fresh=1');
  const parsed = parseHash(buildHash('/onboarding', { retest: 'a/b?c' }));
  assert.equal(parsed.query.retest, 'a/b?c');
});

test('matchRoute and the route table cover every required route', () => {
  const required = ['/welcome', '/login', '/register', '/reset', '/reset-password', '/paywall', '/onboarding', '/home', '/results', '/profiles',
    '/guide', '/viewer/photo', '/viewer/video', '/viewer/magnifier', '/viewer/reader', '/account', '/settings', '/help', '/share'];
  for (const p of required) assert.ok(matchRoute(ROUTES, p), `missing ${p}`);
  assert.equal(matchRoute(ROUTES, '/nope'), null);
  assert.equal(NOT_FOUND_ROUTE.access, 'public');
  for (const r of ROUTES) {
    assert.equal(typeof r.load, 'function');
    assert.ok(['public', 'guest', 'auth', 'access'].includes(r.access));
    assert.ok(['app', 'bare', 'stage', 'viewer'].includes(r.layout));
    if (r.parent) assert.ok(matchRoute(ROUTES, r.parent), `parent of ${r.path}`);
  }
  for (const tab of NAV_TABS) assert.ok(matchRoute(ROUTES, tab.path));
  assert.equal(new Set(ROUTES.map((r) => r.path)).size, ROUTES.length);
});

test('sanitizeReturnTo only allows in-app paths', () => {
  assert.equal(sanitizeReturnTo('/viewer/magnifier'), '/viewer/magnifier');
  assert.equal(sanitizeReturnTo('/onboarding?retest=x'), '/onboarding?retest=x');
  assert.equal(sanitizeReturnTo('//evil.com'), null);
  assert.equal(sanitizeReturnTo('https://evil.com'), null);
  assert.equal(sanitizeReturnTo('/javascript:alert(1)'), null);
  assert.equal(sanitizeReturnTo('home'), null);
  assert.equal(sanitizeReturnTo(42), null);
  assert.equal(sanitizeReturnTo('/' + 'a'.repeat(400)), null);
});
