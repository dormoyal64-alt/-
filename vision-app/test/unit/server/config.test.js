import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError } from '../../../server/config.js';
import { buildPlans, addMonthsUtc } from '../../../server/billing/plans.js';

const SECRET = 'x'.repeat(40);

test('development defaults', () => {
  const c = loadConfig({});
  assert.equal(c.nodeEnv, 'development');
  assert.equal(c.port, 3000);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.trialDays, 30);
  assert.equal(c.paymentProvider, 'mock');
  assert.equal(c.currency, 'ILS');
  assert.equal(c.mailProvider, 'console');
  assert.equal(c.trustProxy, false);
  assert.equal(c.sessionSecretGenerated, true);
  assert.equal(c.termsVersion, '2026-09-28');
  assert.equal(c.pastDueGraceDays, 7);
  assert.equal(c.refundWindowDays, 14);
  assert.deepEqual(c.pricing.INTL.plans.map((p) => [p.price, p.currency]), [[599, 'USD'], [1499, 'USD'], [4499, 'USD']]);
  assert.deepEqual(c.plans.map((p) => [p.id, p.months, p.price]), [['monthly', 1, 2490], ['quarterly', 3, 5990], ['yearly', 12, 17990]]);
});

test('production requires SESSION_SECRET (>= 32 chars), PUBLIC_BASE_URL (https) and a real provider', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /SESSION_SECRET is required/);
    assert.match(err.message, /PUBLIC_BASE_URL is required/);
    assert.match(err.message, /PAYMENT_PROVIDER=mock is refused in production/);
    return true;
  });
  assert.throws(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short', PUBLIC_BASE_URL: 'http://x.example' }), (err) => {
    assert.match(err.message, /SESSION_SECRET must be at least 32 characters/);
    assert.match(err.message, /PUBLIC_BASE_URL must use https/);
    return true;
  });
  const base = { NODE_ENV: 'production', SESSION_SECRET: SECRET, PUBLIC_BASE_URL: 'https://app.example.co.il' };
  assert.throws(() => loadConfig(base), /mock is refused/);
  assert.throws(() => loadConfig({ ...base, PAYMENT_PROVIDER: 'nope' }), /not supported/);
});

test('validation of numbers, URLs, enums', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ TRIAL_DAYS: '999' }), /TRIAL_DAYS must be between/);
  assert.throws(() => loadConfig({ PUBLIC_BASE_URL: 'https://a.example/path' }), /origin only/);
  assert.throws(() => loadConfig({ MAIL_PROVIDER: 'http' }), /MAIL_HTTP_URL is required/);
  assert.throws(() => loadConfig({ CURRENCY: 'shekel' }), /CURRENCY/);
  assert.throws(() => loadConfig({ NODE_ENV: 'staging' }), /NODE_ENV/);
  const c = loadConfig({ PUBLIC_BASE_URL: 'https://app.example.co.il/', TRUST_PROXY: '1', PRICE_MONTHLY: '3990', HOST: '0.0.0.0' });
  assert.equal(c.publicBaseUrl, 'https://app.example.co.il');
  assert.equal(c.trustProxy, 1);
  assert.equal(c.plans[0].price, 3990);
  assert.equal(c.host, '0.0.0.0');
});

test('plans: price per month and savings (floored, never overstated)', () => {
  const [m, q, y] = buildPlans({ prices: { monthly: 2990, quarterly: 7990, yearly: 24900 }, currency: 'ILS' });
  assert.deepEqual([m.pricePerMonth, m.savingsPercent], [2990, 0]);
  assert.deepEqual([q.pricePerMonth, q.savingsPercent], [2663, 10]); // 10.9% -> 10
  assert.deepEqual([y.pricePerMonth, y.savingsPercent], [2075, 30]); // 30.6% -> 30
  const [, dearer] = buildPlans({ prices: { monthly: 1000, quarterly: 4000, yearly: 12000 }, currency: 'ILS' });
  assert.equal(dearer.savingsPercent, 0);
});

test('addMonthsUtc clamps to month end', () => {
  assert.equal(new Date(addMonthsUtc(Date.UTC(2026, 0, 31, 10), 1)).toISOString(), '2026-02-28T10:00:00.000Z');
  assert.equal(new Date(addMonthsUtc(Date.UTC(2027, 11, 15), 3)).toISOString(), '2028-03-15T00:00:00.000Z');
  assert.equal(new Date(addMonthsUtc(Date.UTC(2027, 10, 30), 3)).toISOString(), '2028-02-29T00:00:00.000Z');
});

test('server/index.js fails fast with a clear message when SESSION_SECRET is missing in production', () => {
  const entry = fileURLToPath(new URL('../../../server/index.js', import.meta.url));
  const env = { ...process.env, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://app.example.co.il', PORT: '0' };
  delete env.SESSION_SECRET;
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', entry], { env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SESSION_SECRET is required in production/);
});
