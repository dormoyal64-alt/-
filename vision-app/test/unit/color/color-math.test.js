import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY, srgbToLinear, linearToSrgb, mat3Mul, mat3Apply, mat3Invert, machadoMatrix, simulateCvd,
  daltonizeMatrix, MACHADO_2009, LMS_FROM_LINEAR_RGB, LINEAR_RGB_FROM_LMS, deltaE76, DALTONIZE_E_TRITAN_SPEC,
} from '../../../public/app/js/engine/color-math.js';
import * as renderer from '../../../public/app/js/render/filter-math.js';
import { axisColor, NEUTRAL_LINEAR } from '../../../public/app/js/tests/color/color-plates.js';

const close = (a, b, eps, msg) => {
  assert.equal(a.length, b.length, msg);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= eps, `${msg} [${i}]: ${v} vs ${b[i]}`));
};

// Spec §7.4 tables, transcribed independently for the check (severity 0.5 and 1.0 of each type).
const PUBLISHED = {
  protan: {
    0.5: [0.458064, 0.679578, -0.137642, 0.092785, 0.846313, 0.060902, -0.007494, -0.016807, 1.024301],
    1.0: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    0.3: [0.630323, 0.465641, -0.095964, 0.069181, 0.890046, 0.040773, -0.006308, -0.007724, 1.014032],
  },
  deutan: {
    0.5: [0.547494, 0.607765, -0.155259, 0.181692, 0.781742, 0.036566, -0.010410, 0.027275, 0.983136],
    1.0: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
    0.7: [0.457771, 0.731899, -0.189670, 0.226409, 0.731012, 0.042579, -0.011595, 0.034333, 0.977261],
  },
  tritan: {
    0.5: [1.017277, 0.027029, -0.044306, -0.006113, 0.958479, 0.047634, 0.006379, 0.248708, 0.744913],
    1.0: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
    0.1: [0.926670, 0.092514, -0.019184, 0.021191, 0.964503, 0.014306, 0.008437, 0.054813, 0.936750],
  },
};

test('Machado matrices equal the published values exactly at the 0.1 steps', () => {
  for (const [type, bySev] of Object.entries(PUBLISHED)) {
    for (const [sev, m] of Object.entries(bySev)) assert.deepEqual(machadoMatrix(type, Number(sev)), m, `${type} ${sev}`);
  }
  // Every step (including float-noisy ones like 0.3 = 3 * 0.1) returns the stored table row bit-exactly.
  for (const type of ['protan', 'deutan', 'tritan']) {
    for (let i = 0; i <= 10; i++) assert.deepEqual(machadoMatrix(type, i * 0.1), [...MACHADO_2009[type][i]]);
  }
});

test('severity 0 is the identity; severity is clamped; unknown types give the identity', () => {
  for (const type of ['protan', 'deutan', 'tritan']) {
    assert.deepEqual(machadoMatrix(type, 0), [...IDENTITY]);
    assert.deepEqual(machadoMatrix(type, -1), [...IDENTITY]);
    assert.deepEqual(machadoMatrix(type, 7), PUBLISHED[type]['1.0'] ?? PUBLISHED[type][1]);
  }
  assert.deepEqual(machadoMatrix('normal', 0.5), [...IDENTITY]);
});

test('published rows sum to 1 ± 1e-6 (white preserved)', () => {
  for (const type of ['protan', 'deutan', 'tritan']) {
    for (const m of MACHADO_2009[type]) for (let r = 0; r < 3; r++) assert.ok(Math.abs(m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2] - 1) <= 1.01e-6);
  }
});

test('interpolation midpoints are the mean of the neighbouring published steps', () => {
  for (const type of ['protan', 'deutan', 'tritan']) {
    for (let i = 0; i < 10; i++) {
      const a = MACHADO_2009[type][i]; const b = MACHADO_2009[type][i + 1];
      close(machadoMatrix(type, i / 10 + 0.05), a.map((v, k) => (v + b[k]) / 2), 1e-12, `${type} ${i / 10 + 0.05}`);
    }
    const q = machadoMatrix(type, 0.425); // 25 % of the way from 0.4 to 0.5
    close(q, MACHADO_2009[type][4].map((v, k) => v + 0.25 * (MACHADO_2009[type][5][k] - v)), 1e-12, `${type} 0.425`);
  }
});

test('sRGB transfer functions: IEC constants, identical to the renderer, round-trip', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(1), 1);
  assert.equal(srgbToLinear(0.04045), 0.04045 / 12.92);
  assert.ok(Math.abs(srgbToLinear(0.5) - 0.214041) < 1e-6);
  for (let i = 0; i <= 255; i++) {
    const c = i / 255;
    assert.equal(srgbToLinear(c), renderer.srgbToLinear(c));
    assert.equal(linearToSrgb(c), renderer.linearToSrgb(c));
    assert.ok(Math.abs(linearToSrgb(srgbToLinear(c)) - c) < 1e-12, `round trip ${i}`);
    assert.ok(Math.abs(srgbToLinear(linearToSrgb(c)) - c) < 1e-12);
  }
  assert.ok(Math.abs(linearToSrgb(0.2) * 255 - 124) < 1, 'neutral 0.20 is sRGB ≈ 124');
});

test('mat3 helpers', () => {
  const A = [2, 1, 0, 0, 1, 3, 1, 0, 1];
  const B = [1, 2, 3, 4, 5, 6, 7, 8, 10];
  close(mat3Mul(A, IDENTITY), A, 0, 'A·I');
  close(mat3Mul(A, mat3Invert(A)), [...IDENTITY], 1e-12, 'A·A⁻¹');
  close(mat3Apply(mat3Mul(A, B), [1, 2, 3]), mat3Apply(A, mat3Apply(B, [1, 2, 3])), 1e-12, '(AB)v = A(Bv)');
  assert.throws(() => mat3Invert([1, 2, 3, 2, 4, 6, 0, 0, 1]), RangeError);
  // The spec's LMS matrices are inverses of each other (to their published precision).
  close(mat3Mul(LINEAR_RGB_FROM_LMS, LMS_FROM_LINEAR_RGB), [...IDENTITY], 1e-6, 'LMS round trip');
});

test('simulateCvd applies the Machado matrix and clamps', () => {
  close(simulateCvd([1, 0, 0], 'protan', 1), [0.152286, 0.114503, 0], 0, 'red for protan 1.0');
  close(simulateCvd([0.3, 0.3, 0.3], 'deutan', 0.6), [0.3, 0.3, 0.3], 1e-6, 'grey unchanged');
});

test('daltonizeMatrix preserves white and neutral greys (within 1e-6), identity at severity/strength 0', () => {
  for (const type of ['protan', 'deutan', 'tritan']) {
    for (const sev of [0.1, 0.35, 0.5, 0.8, 1]) {
      for (const k of [0.3, 1]) {
        const M = daltonizeMatrix(type, sev, k);
        for (let r = 0; r < 3; r++) assert.ok(Math.abs(M[r * 3] + M[r * 3 + 1] + M[r * 3 + 2] - 1) < 1e-12, 'row sum');
        for (const g of [0, 0.05, 0.2, 0.5, 1]) close(mat3Apply(M, [g, g, g]), [g, g, g], 1e-6, `${type} ${sev} grey ${g}`);
      }
    }
    assert.deepEqual(daltonizeMatrix(type, 0), [...IDENTITY]);
    close(daltonizeMatrix(type, 0.7, 0), [...IDENTITY], 0, 'strength 0');
  }
  assert.deepEqual(daltonizeMatrix('unclassified', 1), [...IDENTITY]);
});

test('daltonizeMatrix implements M = I + k·E·(I − S) (spec item 33)', () => {
  const S = machadoMatrix('protan', 1);
  const E = [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1];
  const expected = [...IDENTITY].map((v, i) => v + mat3Mul(E, [...IDENTITY].map((w, j) => w - S[j]))[i]);
  close(daltonizeMatrix('protan', 1), expected, 2e-6, 'protan 1.0');
  const rgb = [0.6, 0.2, 0.1];
  const err = rgb.map((v, i) => v - mat3Apply(S, rgb)[i]);
  close(mat3Apply(daltonizeMatrix('protan', 1, 0.5), rgb), rgb.map((v, i) => v + 0.5 * mat3Apply(E, err)[i]), 2e-6, 'per-pixel form');
});

test('daltonised confusion colours are more distinguishable under simulation (quantified)', (t) => {
  const g = [NEUTRAL_LINEAR, NEUTRAL_LINEAR, NEUTRAL_LINEAR];
  // Pairs along each type's confusion axis (cone-isolating direction) plus classic red/green and blue/yellow pairs.
  const pairs = {
    protan: [[g, axisColor('protan', 0.3)], [g, axisColor('protan', 0.5)], [[0.5, 0.15, 0.08], [0.15, 0.3, 0.08]]],
    deutan: [[g, axisColor('deutan', 0.3)], [g, axisColor('deutan', 0.5)], [[0.5, 0.15, 0.08], [0.15, 0.3, 0.08]]],
    tritan: [[g, axisColor('tritan', 1)], [g, axisColor('tritan', 2)], [[0.12, 0.2, 0.55], [0.3, 0.3, 0.05]]],
  };
  const clamp = (v) => v.map((x) => Math.min(1, Math.max(0, x)));
  for (const [type, list] of Object.entries(pairs)) {
    for (const sev of [0.3, 0.6, 1]) {
      const S = machadoMatrix(type, sev);
      const M = daltonizeMatrix(type, sev);
      const ratios = list.map(([a, b]) => {
        const before = deltaE76(clamp(mat3Apply(S, a)), clamp(mat3Apply(S, b)));
        const after = deltaE76(clamp(mat3Apply(S, clamp(mat3Apply(M, a)))), clamp(mat3Apply(S, clamp(mat3Apply(M, b)))));
        return after / before;
      });
      const min = Math.min(...ratios);
      t.diagnostic(`${type} ${sev}: simulated ΔE76 gain ×${ratios.map((r) => r.toFixed(2)).join(', ×')}`);
      if (sev >= 0.6) assert.ok(min > 1.25, `${type} ${sev}: every pair must be > 1.25× more distinguishable (got ${min.toFixed(2)})`);
      // Mild (0.3): the classic confusion pair must still gain. (The spec's [V] red–green E slightly REDUCES the
      // pure cone-isolating pairs at severity ≤ 0.4, ×0.82–0.94 — reported to the spec owner, E kept as published.)
      else assert.ok(ratios[2] > 1.05, `${type} ${sev}: classic confusion pair must gain (got ${ratios[2].toFixed(2)})`);
    }
  }
});

test('the spec tritan proposal (item 33) is worse than no filter at moderate severity (why it was replaced)', () => {
  const S = machadoMatrix('tritan', 0.6);
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const M = I.map((v, i) => v + mat3Mul(DALTONIZE_E_TRITAN_SPEC, I.map((w, j) => w - S[j]))[i]);
  const a = [NEUTRAL_LINEAR, NEUTRAL_LINEAR, NEUTRAL_LINEAR]; const b = axisColor('tritan', 1);
  const clamp = (v) => v.map((x) => Math.min(1, Math.max(0, x)));
  const before = deltaE76(mat3Apply(S, a), mat3Apply(S, b));
  const after = deltaE76(clamp(mat3Apply(S, clamp(mat3Apply(M, a)))), clamp(mat3Apply(S, clamp(mat3Apply(M, b)))));
  assert.ok(after < before);
});
