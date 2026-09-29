import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardRoute, defaultPath } from '../../../public/app/js/shell/guards.js';

const anon = { loggedIn: false, hasAccess: false, hasProfile: false };
const expired = { loggedIn: true, hasAccess: false, hasProfile: true };
const fresh = { loggedIn: true, hasAccess: true, hasProfile: false };
const ready = { loggedIn: true, hasAccess: true, hasProfile: true };

test('defaultPath', () => {
  assert.equal(defaultPath(anon), '/welcome');
  assert.equal(defaultPath(expired), '/paywall');
  assert.equal(defaultPath(fresh), '/onboarding');
  assert.equal(defaultPath(ready), '/home');
});

test('guardRoute per access level', () => {
  assert.deepEqual(guardRoute('public', anon), { type: 'allow' });
  assert.deepEqual(guardRoute('guest', anon), { type: 'allow' });
  assert.deepEqual(guardRoute('guest', ready), { type: 'redirect', to: '/home' });
  assert.deepEqual(guardRoute('guest', fresh), { type: 'redirect', to: '/onboarding' });
  assert.deepEqual(guardRoute('auth', anon, '/account'), { type: 'redirect', to: '/welcome', returnTo: '/account' });
  assert.deepEqual(guardRoute('auth', expired), { type: 'allow' });
  assert.deepEqual(guardRoute('access', anon, '/viewer/reader'), { type: 'redirect', to: '/welcome', returnTo: '/viewer/reader' });
  assert.deepEqual(guardRoute('access', expired, '/home'), { type: 'redirect', to: '/paywall', returnTo: '/home' });
  assert.deepEqual(guardRoute('access', ready), { type: 'allow' });
  assert.deepEqual(guardRoute(/** @type {any} */ ('weird'), ready), { type: 'redirect', to: '/home' });
});
