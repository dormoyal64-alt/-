// Reduced-cohort validation (fast): runs the REAL procedures + engine for simulated people without glasses and
// checks the key properties documented in docs/validation/SIMULATION-REPORT.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCohort, reducedCohort, eyesFor } from '../../../public/app/js/sim/cohort.js';
import { simulateUser, runAcuity } from '../../../public/app/js/sim/pipeline.js';
import { evaluateRun } from '../../../public/app/js/sim/evaluate.js';
import { allFiniteNumbers } from '../../../public/app/js/sim/util.js';
import { binocularLogMARAt } from '../../../public/app/js/sim/eye-model.js';
import { mulberry32 } from '../../../public/app/js/tests/acuity/random.js';
import { computeProfile } from '../../../public/app/js/engine/profile.js';

const REPS = 3;
const users = reducedCohort();
const runs = users.flatMap((u) => Array.from({ length: REPS }, (_, rep) => simulateUser(u, { rep })));
const evals = runs.map(evaluateRun);

describe('synthetic cohort', () => {
  test('full cohort has ≥ 45 users covering every group; the reduced cohort keeps one of each kind', () => {
    const all = buildCohort();
    assert.ok(all.length >= 45);
    for (const g of ['myopia ≤1 D', 'myopia 5–8 D', 'teens (12–16)', 'hyperopia ≥45', 'emmetropic presbyopes', 'astigmatism 2.5', 'mixed']) {
      assert.ok(all.some((u) => u.group === g), g);
    }
    assert.ok(all.every((u) => u.habitualMm >= 280 && u.habitualMm <= 450));
    assert.ok(new Set(users.map((u) => u.group)).size >= 9);
  });
  test('deterministic: same user + repetition → identical profile', () => {
    const a = simulateUser(users[1], { rep: 7 });
    const b = simulateUser(users[1], { rep: 7 });
    assert.deepEqual(a.profile, b.profile);
  });
  test('acuity observer + real QUEST procedure recovers the eye-model threshold', () => {
    const u = users.find((x) => x.id === 'myo-2-35');
    const eyes = eyesFor(u);
    const c = { user: u, eyes, pxTrue: u.device.cssPxPerMm, pxApp: u.device.cssPxPerMm, dTrue: 1000, dApp: 1000, rng: mulberry32(5) };
    const diffs = Array.from({ length: 10 }, () => runAcuity(c, 'right').logMAR - binocularLogMARAt([eyes.right], 1000));
    assert.ok(Math.abs(diffs.reduce((s, d) => s + d, 0) / diffs.length) < 0.08);
  });
});

describe('reduced-cohort properties (glasses-free)', () => {
  test('no NaN / Infinity anywhere in the profiles', () => {
    for (const r of runs) assert.ok(allFiniteNumbers(r.profile), r.user.id);
  });
  test('measured uncorrected acuity: bias within ±0.1 logMAR', () => {
    const d = evals.flatMap((e) => ['right', 'left'].filter((k) => !e.acc[k].floorLimited).map((k) => e.acc[k].measured - e.acc[k].truth));
    const bias = d.reduce((s, x) => s + x, 0) / d.length;
    assert.ok(Math.abs(bias) < 0.1, `bias ${bias}`);
  });
  test("every 'yes' reaches PASS legibility (reserve ≥ 2) for the true eye at the recommended distance", () => {
    const yes = evals.filter((e) => e.feasible === 'yes');
    assert.ok(yes.length >= 10, 'enough yes runs');
    for (const e of yes) assert.equal(e.legibility, 'PASS', `${e.id} rep ${e.rep}: reserve ${e.reserve.toFixed(2)}`);
  });
  test("no under-18 ever gets 'yes' (also when an input wrongly says 'tested without glasses')", () => {
    for (const r of runs.filter((x) => x.user.age < 18)) {
      assert.notEqual(r.profile.glassesFree?.feasible, 'yes');
      const forced = computeProfile({ ...r.input, wearsCorrection: false });
      assert.equal(forced.glassesFree.feasible, 'no');
      assert.ok(forced.viewing.recommendedDistanceMm === null || forced.viewing.recommendedDistanceMm >= 330);
    }
  });
  test("strong myopes (≤ −4 D), whose sharp range ends near or before 25 cm, are never 'yes'", () => {
    for (const e of evals.filter((x) => x.se <= -4)) assert.notEqual(e.feasible, 'yes', e.id);
  });
  test('recommended distances are practical and the app beats the default 16 px on legibility', () => {
    for (const e of evals) assert.ok(e.distanceOk, `${e.id}: ${e.dEval}`);
    const passApp = evals.filter((e) => e.legibility === 'PASS').length;
    const passBase = evals.filter((e) => e.baseLegibility === 'PASS').length;
    assert.ok(passApp > passBase);
    for (const e of evals) assert.ok(e.reserve >= e.baseReserve * 0.85 || e.legibility === 'PASS', `${e.id} got worse`);
  });
});
