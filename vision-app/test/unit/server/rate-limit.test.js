import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlidingWindowLimiter, enforceLimits } from '../../../server/http/rate-limit.js';
import { HttpError } from '../../../server/http/errors.js';

test('allows max hits per window, then blocks with retry-after until the oldest hit slides out', () => {
  let t = 1_000_000;
  const l = new SlidingWindowLimiter({ windowMs: 60_000, max: 3, now: () => t });
  assert.equal(l.hit('k').allowed, true);
  t += 10_000;
  assert.equal(l.hit('k').allowed, true);
  t += 10_000;
  const third = l.hit('k');
  assert.deepEqual([third.allowed, third.remaining], [true, 0]);
  const blocked = l.hit('k');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 40_000); // first hit at t0 leaves the window at t0+60s
  t += 40_000;
  assert.equal(l.hit('k').allowed, true);
  assert.equal(l.hit('k').allowed, false);
});

test('keys are independent; reset clears a key; sweep drops idle keys', () => {
  let t = 0;
  const l = new SlidingWindowLimiter({ windowMs: 1000, max: 1, now: () => t });
  assert.equal(l.hit('a').allowed, true);
  assert.equal(l.hit('b').allowed, true);
  assert.equal(l.hit('a').allowed, false);
  l.reset('a');
  assert.equal(l.hit('a').allowed, true);
  t = 5000;
  l.sweep();
  assert.equal(l.hits.size, 0);
});

test('maxKeys bounds memory by evicting the oldest key', () => {
  const l = new SlidingWindowLimiter({ windowMs: 1000, max: 1, now: () => 0, maxKeys: 2 });
  l.hit('a'); l.hit('b'); l.hit('c');
  assert.equal(l.hits.size, 2);
  assert.equal(l.hits.has('a'), false);
});

test('enforceLimits throws 429 with Retry-After and does not consume budget when rejected', () => {
  let t = 0;
  const perKey = new SlidingWindowLimiter({ windowMs: 60_000, max: 1, now: () => t });
  const perIp = new SlidingWindowLimiter({ windowMs: 60_000, max: 5, now: () => t });
  enforceLimits([[perKey, 'x'], [perIp, 'ip']]);
  t = 1500;
  assert.throws(() => enforceLimits([[perKey, 'x'], [perIp, 'ip']]), (err) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 429);
    assert.equal(err.code, 'RATE_LIMITED');
    assert.equal(err.headers['Retry-After'], '59');
    return true;
  });
  assert.equal(perIp.peek('ip').remaining, 4); // only the first, accepted request counted
});
