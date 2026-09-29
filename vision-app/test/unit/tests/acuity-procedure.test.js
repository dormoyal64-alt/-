import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAcuityProcedure, simulatedObserver, ACUITY_PARAMS } from '../../../public/app/js/tests/acuity/acuity-procedure.js';
import { psi, createQuest, reliabilityReasons, longestIdenticalRun, roundTo } from '../../../public/app/js/tests/acuity/quest.js';
import { mulberry32 } from '../../../public/app/js/tests/acuity/random.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

/** Run one full simulated test. */
function simulate({ trueLogMAR, seed, beta = 6, lambda = 0.03, age, minLogMAR, rtMs = 1500 }) {
  const proc = createAcuityProcedure({ rng: mulberry32(seed), age });
  const obs = simulatedObserver({ trueLogMAR, beta, lambda, rng: mulberry32(seed * 7 + 1) });
  while (!proc.isDone()) {
    const trial = proc.next({ minLogMAR });
    proc.respond(obs(trial), { rtMs, distanceMm: 400 });
  }
  return { proc, res: proc.result() };
}

function stats(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  return { m, sd };
}

test('psychometric function: γ + (1−γ−λ)(1 − e^−1) ≈ 72 % at threshold', () => {
  const P = { gamma: 0.25, lambda: 0.03, beta: 6 };
  close(psi(0.3, 0.3, P), 0.25 + 0.72 * (1 - Math.exp(-1)), 1e-12);
  close(psi(5, 0, P), 0.97, 1e-9);
  close(psi(-5, 0, P), 0.25, 1e-9);
});

test('grid, prior and posterior', () => {
  const q = createQuest({ ...ACUITY_PARAMS, priorMean: 0.2 });
  assert.equal(q.grid.length, 221);
  close(q.grid[0], -0.6, 1e-12);
  close(q.grid[220], 1.6, 1e-9);
  // N(0.2, 0.6) truncated to the grid [−0.6, 1.6] (asymmetric) has mean ≈ 0.29
  close(q.mean(), 0.291, 0.005, 'prior mean of the truncated normal');
  close(q.sd(), 0.49, 0.01, 'prior SD of the truncated normal');
  assert.equal(createAcuityProcedure({ age: 30 }).priorMean, 0.0);
  assert.equal(createAcuityProcedure({ age: 50 }).priorMean, 0.2);
  assert.equal(createAcuityProcedure({}).priorMean, 0.2);
});

test('trial plan: familiarisation at mean+0.3, catch trials 9 and 17 at mean+0.5, 24 non-catch trials', () => {
  const proc = createAcuityProcedure({ rng: mulberry32(3), age: 60, params: { earlyStopSD: 0 } });
  const kinds = [];
  while (!proc.isDone()) {
    const mean = proc.posteriorMean();
    const tr = proc.next({ minLogMAR: -1 });
    kinds.push(tr.kind);
    if (tr.kind === 'familiarisation') close(tr.logMAR, mean + 0.3, 1e-9);
    if (tr.kind === 'catch') close(tr.logMAR, Math.min(1.5, mean + 0.5), 1e-9);
    if (tr.kind === 'main') close(tr.logMAR, Math.min(1.5, Math.max(-0.5, mean)), 1e-9);
    // a consistent observer with threshold 0.1
    proc.respond(tr.logMAR >= 0.1 ? tr.orientation : 'unsure', { rtMs: 1000 });
  }
  assert.deepEqual(kinds.slice(0, 2), ['familiarisation', 'familiarisation']);
  assert.equal(kinds[8], 'catch');
  assert.equal(kinds[16], 'catch');
  assert.equal(kinds.filter((k) => k === 'catch').length, 2);
  assert.equal(kinds.length, 26, '24 non-catch + 2 catch');
});

test('early stop at ≥ 18 trials when posterior SD ≤ 0.035; hard cap 30', () => {
  const early = createAcuityProcedure({ rng: mulberry32(9), params: { earlyStopSD: 1 } });
  let n = 0;
  while (!early.isDone()) { const tr = early.next(); early.respond(tr.orientation); n++; }
  assert.equal(n, 20, '18 non-catch + 2 catch (trials 9 and 17)');
  const capped = createAcuityProcedure({ rng: mulberry32(9), params: { mainTrials: 99, earlyStopSD: 0 } });
  n = 0;
  while (!capped.isDone()) { const tr = capped.next(); capped.respond(tr.orientation); n++; }
  assert.equal(n, 30);
});

test('deterministic with an injected RNG', () => {
  const a = simulate({ trueLogMAR: 0.3, seed: 11 });
  const b = simulate({ trueLogMAR: 0.3, seed: 11 });
  assert.deepEqual(a.proc.history(), b.proc.history());
  assert.deepEqual(a.res, b.res);
});

test('result: rounded to 0.02 with SD and 95 % credible interval', () => {
  const { res } = simulate({ trueLogMAR: 0.44, seed: 5 });
  close(res.logMAR / 0.02, Math.round(res.logMAR / 0.02), 1e-9, 'multiple of 0.02');
  assert.ok(res.ci95[0] < res.mean && res.mean < res.ci95[1]);
  assert.ok(res.sd > 0 && res.sd < 0.1);
  assert.equal(res.meanDistanceMm, 400);
  assert.equal(roundTo(0.4349, 0.02), 0.44);
});

test('floor-limited: excellent observer on a low-resolution screen reports the floor, "at least as good as"', () => {
  const { proc, res } = simulate({ trueLogMAR: -0.35, seed: 21, minLogMAR: -0.083 });
  assert.equal(res.floorLimited, true);
  assert.equal(res.logMAR, -0.08, 'floor rounded conservatively');
  assert.ok(proc.history().some((t) => t.floorClamped));
  assert.ok(proc.history().every((t) => t.logMAR >= -0.083 - 1e-12));
  const normal = simulate({ trueLogMAR: 0.2, seed: 21, minLogMAR: -0.083 }).res;
  assert.equal(normal.floorLimited, false);
});

test('reliability flags (§3.5)', () => {
  const base = (over) => ({ kind: 'main', correct: true, response: 'up', rtMs: 1000, ...over });
  const resp = ['up', 'left', 'down', 'right'];
  const ok = Array.from({ length: 24 }, (_, i) => base({ response: resp[i % 4] }));
  assert.deepEqual(reliabilityReasons(ok, 0.04), []);
  const catchMiss = ok.map((t, i) => (i === 8 || i === 16 ? { ...t, kind: 'catch', correct: false } : t));
  assert.ok(reliabilityReasons(catchMiss, 0.04).includes('both-catch-missed'));
  const famMiss = ok.map((t, i) => (i < 2 ? { ...t, kind: 'familiarisation', correct: false } : i === 8 ? { ...t, kind: 'catch', correct: false } : t));
  assert.ok(reliabilityReasons(famMiss, 0.04).includes('familiarisation-catch-misses'));
  assert.ok(reliabilityReasons(ok, 0.081).includes('posterior-sd'));
  assert.ok(reliabilityReasons(ok.map((t) => ({ ...t, rtMs: 250 })), 0.04).includes('fast-responses'));
  const run = ok.map((t, i) => (i >= 5 && i < 10 ? { ...t, response: 'left' } : t));
  assert.ok(reliabilityReasons(run, 0.04).includes('identical-run'));
  assert.equal(longestIdenticalRun(['up', 'up', 'unsure', 'up', 'up']), 2);
  const blanked = ok.map((t, i) => ({ ...t, blanked: i < 5 }));
  assert.ok(reliabilityReasons(blanked, 0.04).includes('distance-out-of-range'));
  assert.ok(!reliabilityReasons(ok.map((t, i) => ({ ...t, blanked: i < 4 })), 0.04).includes('distance-out-of-range'));
});

test('random tapper is flagged unreliable', () => {
  let flagged = 0;
  for (let s = 0; s < 50; s++) {
    const proc = createAcuityProcedure({ rng: mulberry32(s + 500) });
    const r = mulberry32(s + 900);
    while (!proc.isDone()) { proc.next(); proc.respond(['up', 'down', 'left', 'right'][Math.floor(r() * 4)], { rtMs: 200 }); }
    if (!proc.result().reliable) flagged++;
  }
  assert.equal(flagged, 50);
});

test('Monte-Carlo accuracy: bias and SD at several true acuities match the spec simulation (§3.4)', () => {
  // Spec: 4AFC / 24 trials → test–retest 95 % LoA ±0.09–0.14 logMAR (β 4.6–8), bias ≤ 0.01.
  // LoA = 1.96·√2·SD  ⇒ SD ≈ 0.033–0.05. We allow a small margin for Monte-Carlo noise.
  const N = 200;
  const rows = [];
  for (const beta of [4.6, 6, 8]) {
    for (const T of [-0.2, 0.0, 0.3, 0.7, 1.0]) {
      const errs = [];
      let unreliable = 0;
      for (let i = 0; i < N; i++) {
        const { res } = simulate({ trueLogMAR: T, seed: 1 + i * 104729 + Math.round((T + 1) * 1000) + beta * 7, beta });
        errs.push(res.logMAR - T);
        if (!res.reliable) unreliable++;
      }
      const { m, sd } = stats(errs);
      const loa = 1.96 * Math.SQRT2 * sd;
      rows.push({ beta, T, bias: +m.toFixed(3), sd: +sd.toFixed(3), loa: +loa.toFixed(3), unreliablePct: +(100 * unreliable / N).toFixed(1) });
      assert.ok(Math.abs(m) <= 0.02, `bias ${m} at T=${T}, β=${beta}`);
      assert.ok(sd <= 0.062, `SD ${sd} at T=${T}, β=${beta}`);
      assert.ok(loa <= 0.17, `LoA ${loa} at T=${T}, β=${beta}`);
      assert.ok(unreliable / N <= 0.15, `false-unreliable rate ${unreliable / N}`);
    }
  }
  console.log('acuity simulation (bias/SD/LoA in logMAR):');
  console.table(rows);
});

test('lapses degrade precision as the spec predicts (8 % lapse → wider limits, small positive bias)', () => {
  const errs = [];
  for (let i = 0; i < 200; i++) errs.push(simulate({ trueLogMAR: 0.3, seed: 77 + i * 31, lambda: 0.08 }).res.logMAR - 0.3);
  const { m, sd } = stats(errs);
  assert.ok(m > -0.01 && m < 0.06, `bias ${m}`);
  assert.ok(1.96 * Math.SQRT2 * sd < 0.3, `LoA ${1.96 * Math.SQRT2 * sd}`);
});
