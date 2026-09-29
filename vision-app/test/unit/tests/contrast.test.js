import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  srgbToLinear, linearToSrgb, luminance8, weberContrast, logCSFromContrast, greyLogCS, bitStealColour,
  minAchievableContrast, pelliRobsonLetterScore, sizeMmForDegrees, PELLI_ROBSON_LOGCS, CONTRAST_LETTER_DEG,
} from '../../../public/app/js/tests/contrast/contrast-math.js';
import { createContrastProcedure, simulatedContrastObserver, CONTRAST_PARAMS } from '../../../public/app/js/tests/contrast/contrast-procedure.js';
import { mulberry32 } from '../../../public/app/js/tests/acuity/random.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('sRGB transfer functions round-trip (item 27)', () => {
  for (let i = 0; i <= 255; i++) close(linearToSrgb(srgbToLinear(i / 255)), i / 255, 1e-12);
  close(srgbToLinear(0.04045), 0.04045 / 12.92, 1e-12);
  close(srgbToLinear(1), 1, 1e-12);
  close(luminance8(255, 255, 255), 1, 1e-12);
});

test('8-bit grey steps near white give logCS 2.05 / 1.75 / 1.58 / 1.36 (§5.3)', () => {
  close(greyLogCS(254), 2.05, 0.005);
  close(greyLogCS(253), 1.75, 0.005);
  close(greyLogCS(252), 1.58, 0.005);
  close(greyLogCS(250), 1.36, 0.005);
});

test('single-channel steps near white: B 3.19, R 2.72, G 2.20 (item 23)', () => {
  close(logCSFromContrast(weberContrast(luminance8(255, 255, 254))), 3.19, 0.005);
  close(logCSFromContrast(weberContrast(luminance8(254, 255, 255))), 2.72, 0.005);
  close(logCSFromContrast(weberContrast(luminance8(255, 254, 255))), 2.20, 0.005);
  close(logCSFromContrast(minAchievableContrast()), 3.19, 0.005);
});

test('bit-stealing realises contrasts between grey steps with a few codes of chroma at most', () => {
  let maxErr = 0;
  let maxErrNormalRange = 0;
  for (let logCS = 0; logCS <= 2.5 + 1e-9; logCS += 0.01) {
    const c = bitStealColour(10 ** -logCS);
    const err = Math.abs(-c.logC - logCS);
    maxErr = Math.max(maxErr, err);
    if (logCS <= 2.2) maxErrNormalRange = Math.max(maxErrNormalRange, err);
    assert.ok(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 4, `chroma at ${logCS}`);
    close(c.contrast, weberContrast(luminance8(c.r, c.g, c.b)), 1e-12);
    assert.match(c.css, /^rgb\(\d+, \d+, \d+\)$/);
  }
  // Near white the achievable levels are inherently discrete (≈0.08 log apart around logCS 2.4–2.5);
  // the procedure always uses the ACTUAL rendered contrast in the likelihood.
  assert.ok(maxErrNormalRange < 0.02, `max logCS error up to 2.2: ${maxErrNormalRange}`);
  assert.ok(maxErr < 0.04, `max logCS error up to 2.5: ${maxErr}`);
  // between the 254 grey (2.05) and white, plain grey has no level; bit-stealing does
  const c = bitStealColour(10 ** -2.4);
  close(-c.logC, 2.4, 0.03);
  assert.notDeepEqual([c.r, c.g, c.b], [255, 255, 255]);
  assert.deepEqual([bitStealColour(1).r, bitStealColour(1).g, bitStealColour(1).b], [0, 0, 0]);
});

test('chart constants and scoring helpers', () => {
  assert.equal(PELLI_ROBSON_LOGCS.length, 16);
  assert.equal(PELLI_ROBSON_LOGCS[15], 2.25);
  close(pelliRobsonLetterScore(33), 1.5, 1e-12);
  close(sizeMmForDegrees(CONTRAST_LETTER_DEG, 300), 14.7, 0.05, '1.47 cm at 30 cm');
  close(sizeMmForDegrees(CONTRAST_LETTER_DEG, 400), 19.6, 0.05, '1.96 cm at 40 cm');
});

test('contrast procedure: plan, parameters and determinism', () => {
  assert.equal(CONTRAST_PARAMS.beta, 3.5);
  assert.equal(CONTRAST_PARAMS.priorMean, -1.7);
  const proc = createContrastProcedure({ rng: mulberry32(1) });
  const kinds = [];
  const obs = simulatedContrastObserver({ trueLogCS: 1.8, rng: mulberry32(2) });
  while (!proc.isDone()) {
    const tr = proc.next();
    kinds.push(tr.kind);
    if (tr.index === 1) close(tr.contrast, 0.5, 0.01);
    if (tr.index === 2) close(tr.contrast, 0.25, 0.01);
    if (tr.kind === 'catch') close(tr.contrast, 0.5, 0.01);
    proc.respond(obs(tr), { rtMs: 900 });
  }
  assert.equal(kinds.length, 26);
  assert.equal(kinds[8], 'catch');
  assert.equal(kinds[16], 'catch');
  const r = proc.result();
  close(r.logCS / 0.05, Math.round(r.logCS / 0.05), 1e-9, 'reported to 0.05');
  const again = createContrastProcedure({ rng: mulberry32(1) });
  const obs2 = simulatedContrastObserver({ trueLogCS: 1.8, rng: mulberry32(2) });
  while (!again.isDone()) { const tr = again.next(); again.respond(obs2(tr), { rtMs: 900 }); }
  assert.deepEqual(again.result(), r);
});

test('contrast Monte-Carlo: small bias, precision comparable to published digital tests', () => {
  const N = 200;
  const rows = [];
  for (const T of [1.0, 1.5, 1.8, 2.0]) {
    const errs = [];
    let unreliable = 0;
    for (let i = 0; i < N; i++) {
      const proc = createContrastProcedure({ rng: mulberry32(10 + i * 7919) });
      const obs = simulatedContrastObserver({ trueLogCS: T, rng: mulberry32(20 + i * 104729) });
      while (!proc.isDone()) { const tr = proc.next(); proc.respond(obs(tr), { rtMs: 900 }); }
      const r = proc.result();
      errs.push(r.logCS - T);
      if (!r.reliable) unreliable++;
    }
    const m = errs.reduce((a, b) => a + b, 0) / N;
    const sd = Math.sqrt(errs.reduce((a, b) => a + (b - m) ** 2, 0) / (N - 1));
    rows.push({ trueLogCS: T, bias: +m.toFixed(3), sd: +sd.toFixed(3), loa: +(1.96 * Math.SQRT2 * sd).toFixed(3), unreliablePct: +(100 * unreliable / N).toFixed(1) });
    assert.ok(Math.abs(m) <= 0.03, `bias ${m} at ${T}`);
    assert.ok(1.96 * Math.SQRT2 * sd <= 0.22, `LoA at ${T}`); // iPad test ±0.19, PeekCS ±0.3 (§5.1)
    assert.ok(unreliable / N <= 0.25);
  }
  console.log('contrast simulation (logCS):');
  console.table(rows);
});
