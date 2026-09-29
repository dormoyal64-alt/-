import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutPlate, colorizePlate, axisColor, onRing, NORMAL_LIMIT_C, CEILING_C, CEILING_RATIO, NOISE_LEVELS,
  GEOMETRY, duvOfContrast, NORMAL_LIMIT_DUV, discLinearColor, mulberry32,
} from '../../../public/app/js/tests/color/color-plates.js';
import { linearRgbToLms, srgbToLinear } from '../../../public/app/js/engine/color-math.js';

test('plate generation is deterministic for a seed and differs across seeds', () => {
  const a = layoutPlate({ seed: 1234, gap: 'up' });
  const b = layoutPlate({ seed: 1234, gap: 'up' });
  assert.deepEqual(a, b);
  const stim = { kind: 'axis', axis: 'deutan', c: 0.1 };
  assert.deepEqual(colorizePlate(a, stim), colorizePlate(b, stim));
  assert.notDeepEqual(layoutPlate({ seed: 1235, gap: 'up' }).discs, a.discs);
});

test('discs are inside the plate, non-overlapping, and the ring is well populated', () => {
  for (const gap of ['up', 'right', 'down', 'left']) {
    const { discs } = layoutPlate({ seed: 77, gap });
    assert.ok(discs.length > 400, `disc count ${discs.length}`);
    const ring = discs.filter((d) => d.target);
    assert.ok(ring.length > 80, `ring discs ${ring.length}`);
    for (const d of discs) assert.ok(Math.hypot(d.x, d.y) + d.r <= 1 + 1e-12);
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const p = discs[i]; const q = discs[j];
        assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= p.r + q.r + GEOMETRY.spacing - 1e-12);
      }
    }
    // No ring disc sits in the gap.
    for (const d of ring) assert.equal(onRing(d.x, d.y, gap), true);
  }
});

test('gap geometry is absolute (screen up = −y)', () => {
  const mid = (GEOMETRY.ringInner + GEOMETRY.ringOuter) / 2;
  assert.equal(onRing(0, -mid, 'up'), false);
  assert.equal(onRing(0, mid, 'up'), true);
  assert.equal(onRing(mid, 0, 'right'), false);
  assert.equal(onRing(-mid, 0, 'right'), true);
  assert.equal(onRing(-mid, 0, 'left'), false);
  assert.equal(onRing(0, mid, 'down'), false);
});

test('axis colours are cone-isolating displacements of the neutral grey', () => {
  const n = linearRgbToLms([0.2, 0.2, 0.2]);
  const cases = { protan: [0, 1], deutan: [1, -1], tritan: [2, 1] };
  for (const [axis, [k, sign]] of Object.entries(cases)) {
    const lms = linearRgbToLms(axisColor(axis, 0.1));
    for (let i = 0; i < 3; i++) {
      const expected = i === k ? n[i] * (1 + sign * 0.1) : n[i];
      assert.ok(Math.abs(lms[i] - expected) / n[i] < 1e-5, `${axis} cone ${i}`);
    }
  }
});

test('normal limits and gamut ceilings', () => {
  for (const axis of ['protan', 'deutan', 'tritan']) {
    assert.ok(Math.abs(duvOfContrast(axis, NORMAL_LIMIT_C[axis]) - NORMAL_LIMIT_DUV[axis]) < 1e-8);
    for (const f of NOISE_LEVELS) for (const v of axisColor(axis, CEILING_C[axis])) assert.ok(v * f >= 0 && v * f <= 1);
    assert.ok(CEILING_RATIO[axis] > 14, `${axis} ceiling ${CEILING_RATIO[axis]}`);
  }
});

test('luminance noise is shared by ring and background; dither is unbiased', () => {
  const layout = layoutPlate({ seed: 5, gap: 'left' });
  const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  // Chromatic stimulus: every disc's colour is (axis colour or neutral) × one of the 6 noise levels.
  for (const d of layout.discs) {
    const lin = discLinearColor(d, { kind: 'axis', axis: 'tritan', c: 0.5 });
    const base = d.target ? axisColor('tritan', 0.5) : [0.2, 0.2, 0.2];
    lin.forEach((v, i) => assert.ok(Math.abs(v - base[i] * NOISE_LEVELS[d.level]) < 1e-12));
  }
  // Catch trial: ring is clearly lighter than any background disc.
  const ring = layout.discs.find((d) => d.target);
  assert.ok(lum(discLinearColor(ring, { kind: 'catch' })) > 1.3 * 0.2 * NOISE_LEVELS[NOISE_LEVELS.length - 1]);
  // Dither: the mean of many 8-bit codes decodes to the intended value.
  const rng = mulberry32(9);
  const target = 0.2 * 1.04;
  let sum = 0; const N = 20000;
  const enc = Math.pow(target, 1 / 2.4) * 1.055 - 0.055;
  for (let i = 0; i < N; i++) sum += Math.floor(enc * 255 + rng());
  assert.ok(Math.abs(sum / N / 255 - enc) < 0.002);
  assert.ok(srgbToLinear(Math.round(enc * 255) / 255) > 0);
});
