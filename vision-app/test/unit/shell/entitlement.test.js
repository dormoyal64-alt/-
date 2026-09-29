import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accessEndsAt, trialDaysLeft, shouldShowTrialBanner, isCacheUsable, hasEffectiveAccess, readCache, writeCache, clearCache,
  subscriptionActions, refundWindowOpen, CACHE_KEY, DAY_MS,
} from '../../../public/app/js/account/entitlement.js';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const trial = (daysLeft, extra = {}) => ({
  status: 'trial', plan: null, trialEndsAt: iso(NOW + daysLeft * DAY_MS), currentPeriodEnd: null, cancelAtPeriodEnd: false, daysLeft, hasAccess: daysLeft > 0, ...extra,
});
const active = (daysLeft, extra = {}) => ({
  status: 'active', plan: 'monthly', trialEndsAt: iso(NOW - 40 * DAY_MS), currentPeriodEnd: iso(NOW + daysLeft * DAY_MS), cancelAtPeriodEnd: false, daysLeft, hasAccess: true, ...extra,
});
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

test('accessEndsAt uses trial end for trials, period end otherwise', () => {
  assert.equal(accessEndsAt(trial(5)), NOW + 5 * DAY_MS);
  assert.equal(accessEndsAt(active(10)), NOW + 10 * DAY_MS);
  assert.equal(accessEndsAt(null), null);
  assert.equal(accessEndsAt({ ...active(3), currentPeriodEnd: null }), NOW - 40 * DAY_MS);
  assert.equal(accessEndsAt({ ...trial(3), trialEndsAt: 'garbage' }), null);
});

test('trial days left and banner window (last 7 days)', () => {
  assert.equal(trialDaysLeft(trial(10), NOW), 10);
  assert.equal(trialDaysLeft(trial(0.2), NOW), 1);
  assert.equal(trialDaysLeft(active(10), NOW), null);
  assert.equal(trialDaysLeft({ ...trial(3), trialEndsAt: null, daysLeft: 3 }, NOW), 3);
  assert.equal(shouldShowTrialBanner(trial(8), NOW), false);
  assert.equal(shouldShowTrialBanner(trial(7), NOW), true);
  assert.equal(shouldShowTrialBanner(trial(1), NOW), true);
  assert.equal(shouldShowTrialBanner(trial(-1), NOW), false); // no access any more
  assert.equal(shouldShowTrialBanner(active(3), NOW), false);
});

test('offline cache is usable only while access has not ended', () => {
  const user = { id: 'u1', email: 'a@b.co', lang: 'he' };
  const store = memStore();
  writeCache(store, { user, entitlement: trial(5) }, NOW);
  const cache = readCache(store);
  assert.equal(cache.v, 1);
  assert.equal(cache.user.email, 'a@b.co');
  assert.equal(isCacheUsable(cache, NOW), true);
  assert.equal(isCacheUsable(cache, NOW + 6 * DAY_MS), false, 'trial ended');
  assert.equal(isCacheUsable({ ...cache, entitlement: { ...cache.entitlement, hasAccess: false } }, NOW), false);
  assert.equal(isCacheUsable({ ...cache, savedAt: iso(NOW + DAY_MS) }, NOW), false, 'saved in the future => clock moved');
  assert.equal(isCacheUsable({ ...cache, entitlement: { ...active(0), currentPeriodEnd: null, trialEndsAt: null } }, NOW), false);
  assert.equal(isCacheUsable(null, NOW), false);
  clearCache(store);
  assert.equal(readCache(store), null);
  store.setItem(CACHE_KEY, '{not json');
  assert.equal(readCache(store), null);
});

test('effective access trusts the network, checks dates for cache', () => {
  assert.equal(hasEffectiveAccess(active(3), 'network', NOW), true);
  assert.equal(hasEffectiveAccess(active(3), 'cache', NOW), true);
  assert.equal(hasEffectiveAccess(active(3), 'cache', NOW + 4 * DAY_MS), false);
  assert.equal(hasEffectiveAccess({ ...trial(3), hasAccess: false }, 'network', NOW), false);
  assert.equal(hasEffectiveAccess(null, 'network', NOW), false);
});

test('subscription actions', () => {
  assert.deepEqual(subscriptionActions(trial(10), NOW), { canCancel: false, canResume: false, canSubscribe: true, needsPaymentFix: false });
  assert.equal(subscriptionActions(active(10), NOW).canCancel, true);
  const canceled = active(10, { cancelAtPeriodEnd: true });
  assert.equal(subscriptionActions(canceled, NOW).canCancel, false);
  assert.equal(subscriptionActions(canceled, NOW).canResume, true);
  assert.equal(subscriptionActions({ ...canceled, status: 'canceled' }, NOW + 11 * DAY_MS).canSubscribe, true);
  assert.equal(subscriptionActions(active(10, { status: 'past_due' }), NOW).needsPaymentFix, true);
  assert.equal(subscriptionActions({ ...active(-1), status: 'expired', hasAccess: false }, NOW).canSubscribe, true);
});

test('refund window: 14 days from the first paid invoice', () => {
  assert.equal(refundWindowOpen([], NOW), false);
  assert.equal(refundWindowOpen(null, NOW), false);
  assert.equal(refundWindowOpen([{ status: 'paid', issuedAt: iso(NOW - 3 * DAY_MS) }], NOW), true);
  assert.equal(refundWindowOpen([{ status: 'paid', issuedAt: iso(NOW - 3 * DAY_MS) }, { status: 'paid', issuedAt: iso(NOW - 20 * DAY_MS) }], NOW), false);
  assert.equal(refundWindowOpen([{ status: 'refunded', issuedAt: iso(NOW - 1 * DAY_MS) }], NOW), false);
});
