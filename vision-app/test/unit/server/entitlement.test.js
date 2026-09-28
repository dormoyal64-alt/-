import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEntitlement, hasPaidAccess, DAY_MS, PAST_DUE_GRACE_DAYS } from '../../../server/billing/entitlement.js';

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0); // 2026-09-27T12:00:00Z
const sub = (over = {}) => ({ plan: 'monthly', status: 'active', current_period_end: NOW + 10 * DAY_MS, cancel_at_period_end: 0, ...over });

test('trial: days left rounded up, access granted', () => {
  const e = computeEntitlement({ trialEndsAt: NOW + 29.2 * DAY_MS }, null, NOW);
  assert.equal(e.status, 'trial');
  assert.equal(e.daysLeft, 30);
  assert.equal(e.hasAccess, true);
  assert.equal(e.plan, null);
  assert.equal(e.trialEndsAt, new Date(NOW + 29.2 * DAY_MS).toISOString());
  assert.equal(e.currentPeriodEnd, null);
  assert.equal(e.cancelAtPeriodEnd, false);
});

test('trial last day: 1 ms left still counts as 1 day with access', () => {
  const e = computeEntitlement({ trial_ends_at: NOW + 1 }, null, NOW);
  assert.deepEqual([e.status, e.daysLeft, e.hasAccess], ['trial', 1, true]);
});

test('trial ends exactly now => expired', () => {
  const e = computeEntitlement({ trialEndsAt: NOW }, null, NOW);
  assert.deepEqual([e.status, e.daysLeft, e.hasAccess], ['expired', 0, false]);
});

test('no trial and no subscription => expired', () => {
  const e = computeEntitlement({ trialEndsAt: NOW - DAY_MS }, null, NOW);
  assert.equal(e.status, 'expired');
  assert.equal(e.hasAccess, false);
  assert.equal(computeEntitlement(null, null, NOW).status, 'expired');
});

test('active subscription', () => {
  const e = computeEntitlement({ trialEndsAt: NOW - DAY_MS }, sub(), NOW);
  assert.deepEqual([e.status, e.plan, e.daysLeft, e.hasAccess, e.cancelAtPeriodEnd], ['active', 'monthly', 10, true, false]);
  assert.ok(hasPaidAccess(e));
});

test('paid subscription wins over a running trial', () => {
  const e = computeEntitlement({ trialEndsAt: NOW + 5 * DAY_MS }, sub({ plan: 'yearly', current_period_end: NOW + 300 * DAY_MS }), NOW);
  assert.equal(e.status, 'active');
  assert.equal(e.plan, 'yearly');
});

test('canceled but paid until period end => canceled with access, then expired', () => {
  const s = sub({ status: 'canceled', cancel_at_period_end: 1 });
  const e = computeEntitlement({ trialEndsAt: 0 }, s, NOW);
  assert.deepEqual([e.status, e.hasAccess, e.cancelAtPeriodEnd, e.daysLeft], ['canceled', true, true, 10]);
  assert.ok(hasPaidAccess(e));
  const later = computeEntitlement({ trialEndsAt: 0 }, s, NOW + 10 * DAY_MS);
  assert.deepEqual([later.status, later.hasAccess, later.daysLeft], ['expired', false, 0]);
});

test('active with cancel_at_period_end flag is reported as canceled', () => {
  const e = computeEntitlement({}, sub({ cancelAtPeriodEnd: true }), NOW);
  assert.equal(e.status, 'canceled');
  assert.equal(e.hasAccess, true);
});

test('past_due keeps access for a 7-day grace after period end (configurable)', () => {
  const s = sub({ status: 'past_due', current_period_end: NOW - DAY_MS });
  const e = computeEntitlement({}, s, NOW);
  assert.equal(PAST_DUE_GRACE_DAYS, 7);
  assert.deepEqual([e.status, e.hasAccess, e.daysLeft], ['past_due', true, 6]);
  const last = computeEntitlement({}, s, NOW + 6 * DAY_MS - 1);
  assert.deepEqual([last.status, last.hasAccess, last.daysLeft], ['past_due', true, 1]);
  const after = computeEntitlement({}, s, NOW + 6 * DAY_MS);
  assert.deepEqual([after.status, after.hasAccess], ['expired', false]);
  assert.equal(computeEntitlement({}, s, NOW + 2 * DAY_MS, { graceDays: 3 }).status, 'expired');
});

test('fixed-term (manual) plan ends exactly at period end, no grace; renewable within the window', () => {
  const s = sub({ plan: 'yearly', renewal: 'manual', current_period_end: NOW + 5 * DAY_MS });
  const e = computeEntitlement({}, s, NOW);
  assert.deepEqual([e.status, e.renewal, e.canRenew, e.cancelAtPeriodEnd], ['active', 'manual', true, false]);
  const early = computeEntitlement({}, sub({ plan: 'yearly', renewal: 'manual', current_period_end: NOW + 40 * DAY_MS }), NOW);
  assert.equal(early.canRenew, false);
  const ended = computeEntitlement({}, s, NOW + 5 * DAY_MS);
  assert.deepEqual([ended.status, ended.hasAccess, ended.canRenew], ['expired', false, true]);
  assert.equal(computeEntitlement({}, s, NOW + 36 * DAY_MS).canRenew, false);
  assert.equal(computeEntitlement({}, { ...s, ended_reason: 'refunded' }, NOW).canRenew, false);
  const auto = computeEntitlement({}, sub(), NOW);
  assert.deepEqual([auto.renewal, auto.canRenew], ['auto', false]);
});

test('active subscription whose period ended without a renewal event gets the same grace', () => {
  const s = sub({ current_period_end: NOW - 1000 });
  assert.equal(computeEntitlement({}, s, NOW).status, 'past_due');
  assert.equal(computeEntitlement({}, s, NOW + 7 * DAY_MS).status, 'expired');
});

test('expired subscription falls back to an unused trial', () => {
  const e = computeEntitlement({ trialEndsAt: NOW + DAY_MS }, sub({ status: 'expired' }), NOW);
  assert.equal(e.status, 'trial');
});

test('time zones: ISO strings with offsets resolve to the same instant; result independent of TZ', () => {
  const endIsoUtc = '2026-09-28T00:00:00Z';
  const endIsoIL = '2026-09-28T03:00:00+03:00'; // same instant
  const nowIL = '2026-09-27T23:30:00+03:00'; // 20:30Z => 3.5 h left
  const a = computeEntitlement({ trialEndsAt: endIsoUtc }, null, nowIL);
  const b = computeEntitlement({ trialEndsAt: endIsoIL }, null, new Date('2026-09-27T20:30:00Z'));
  assert.deepEqual(a, b);
  assert.equal(a.daysLeft, 1);
  assert.equal(a.trialEndsAt, '2026-09-28T00:00:00.000Z');
  const prevTz = process.env.TZ;
  process.env.TZ = 'Pacific/Kiritimati';
  try {
    assert.deepEqual(computeEntitlement({ trialEndsAt: endIsoUtc }, null, nowIL), a);
  } finally {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  }
});

test('unknown plan strings are not echoed', () => {
  assert.equal(computeEntitlement({}, sub({ plan: 'weird' }), NOW).plan, null);
});
