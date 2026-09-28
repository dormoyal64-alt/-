import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  srgbToLinear, linearToSrgb, applyPixel, colorStage, toneStage, sanitizeParams, scaleParams, isNeutralParams,
  gaussianKernel, linearSampleKernel, unsharpCombine, processImageData, toColumnMajor, cssFilterApprox, gaussianBlur,
  IDENTITY_MATRIX,
} from '../../../public/app/js/render/filter-math.js';
import { neutralFilterParams } from '../../../public/app/js/core/types.js';
import { demoProfile } from '../../../public/app/js/core/demo-profile.js';

const near = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a} (eps ${eps})`);

test('sRGB transfer functions: IEC 61966-2-1 anchor values and round trip', () => {
  near(srgbToLinear(0), 0);
  near(srgbToLinear(1), 1, 1e-12);
  near(srgbToLinear(0.04045), 0.04045 / 12.92, 1e-12);
  near(srgbToLinear(0.5), 0.21404114048223255, 1e-12);
  near(linearToSrgb(0.0031308), 0.0031308 * 12.92, 1e-12);
  near(linearToSrgb(0.21404114048223255), 0.5, 1e-12);
  for (let i = 0; i <= 255; i++) near(linearToSrgb(srgbToLinear(i / 255)), i / 255, 1e-12, `v=${i}`);
});

test('identity params leave every 8-bit value unchanged within 1/255', () => {
  const p = neutralFilterParams();
  for (let v = 0; v <= 255; v += 1) {
    const [r, g, b] = applyPixel(v / 255, ((v * 7) % 256) / 255, ((v * 13) % 256) / 255, p);
    near(r, v / 255, 1 / 255); near(g, ((v * 7) % 256) / 255, 1 / 255); near(b, ((v * 13) % 256) / 255, 1 / 255);
  }
  // Whole-buffer path too (with sharpening off and on a flat image)
  const data = new Uint8ClampedArray([10, 20, 30, 255, 200, 100, 50, 255, 0, 255, 128, 255, 255, 255, 255, 255]);
  const copy = new Uint8ClampedArray(data);
  processImageData(data, 2, 2, p);
  assert.deepEqual([...data], [...copy]);
  assert.equal(isNeutralParams(p), true);
});

test('colour matrix is applied in LINEAR light', () => {
  // Swap R and B
  const p = sanitizeParams({ colorMatrix: [0, 0, 1, 0, 1, 0, 1, 0, 0] });
  const out = colorStage(0.8, 0.5, 0.2, p, [0, 0, 0]);
  near(out[0], 0.2, 1e-9); near(out[1], 0.5, 1e-9); near(out[2], 0.8, 1e-9);
  // Averaging R and G in linear space differs from averaging sRGB codes: mean(1, 0) linear = 0.5 -> sRGB 0.7354
  const avg = sanitizeParams({ colorMatrix: [0.5, 0.5, 0, 0.5, 0.5, 0, 0, 0, 1] });
  const o2 = colorStage(1, 0, 0, avg, [0, 0, 0]);
  near(o2[0], linearToSrgb(0.5), 1e-9);
  near(o2[0], 0.7353569830524495, 1e-9);
  near(o2[1], 0.7353569830524495, 1e-9);
  // Out-of-range results are clamped in linear light
  const boost = sanitizeParams({ colorMatrix: [2, 0, 0, 0, 1, 0, 0, 0, -1] });
  const o3 = colorStage(0.9, 0.3, 0.6, boost, [0, 0, 0]);
  near(o3[0], 1, 1e-12); near(o3[1], 0.3, 1e-9); near(o3[2], 0, 1e-12);
});

test('contrast pivots around 0.5, brightness multiplies, invert reverses', () => {
  const c = sanitizeParams({ contrast: 2 });
  near(toneStage(0.5, 0.5, 0.5, c, [0, 0, 0])[0], 0.5);
  near(toneStage(0.6, 0.6, 0.6, c, [0, 0, 0])[0], 0.7);
  near(toneStage(0.2, 0.2, 0.2, c, [0, 0, 0])[0], 0);   // clamped
  near(toneStage(0.9, 0.9, 0.9, c, [0, 0, 0])[0], 1);   // clamped
  const b = sanitizeParams({ brightness: 1.5 });
  near(toneStage(0.4, 0.2, 0.8, b, [0, 0, 0])[0], 0.6);
  near(toneStage(0.4, 0.2, 0.8, b, [0, 0, 0])[2], 1);
  const inv = sanitizeParams({ invert: true });
  const o = toneStage(0.1, 0.5, 1, inv, [0, 0, 0]);
  near(o[0], 0.9); near(o[1], 0.5); near(o[2], 0);
  // order: brightness before contrast: (0.4*1.5 - 0.5)*2 + 0.5 = 0.7
  near(toneStage(0.4, 0.4, 0.4, sanitizeParams({ brightness: 1.5, contrast: 2 }), [0, 0, 0])[0], 0.7);
});

test('saturation uses Rec.709 luma; 0 = grey, 1 = unchanged, >1 boosts', () => {
  const grey = toneStage(1, 0, 0, sanitizeParams({ saturation: 0 }), [0, 0, 0]);
  near(grey[0], 0.2126); near(grey[1], 0.2126); near(grey[2], 0.2126);
  const same = toneStage(0.3, 0.6, 0.9, sanitizeParams({ saturation: 1 }), [0, 0, 0]);
  near(same[0], 0.3); near(same[1], 0.6); near(same[2], 0.9);
  const l = 0.2126 * 0.4 + 0.7152 * 0.5 + 0.0722 * 0.6;
  const boosted = toneStage(0.4, 0.5, 0.6, sanitizeParams({ saturation: 2 }), [0, 0, 0]);
  near(boosted[0], l + 2 * (0.4 - l), 1e-12);
  near(boosted[2], l + 2 * (0.6 - l), 1e-12);
});

test('warmth reduces blue (and a little green) proportionally; tint multiplies last', () => {
  const w = toneStage(1, 1, 1, sanitizeParams({ warmth: 1 }), [0, 0, 0]);
  near(w[0], 1); near(w[1], 0.88); near(w[2], 0.5);
  const half = toneStage(0.8, 0.8, 0.8, sanitizeParams({ warmth: 0.5 }), [0, 0, 0]);
  near(half[1], 0.8 * 0.94); near(half[2], 0.8 * 0.75);
  const yellow = toneStage(0, 0, 0, sanitizeParams({ invert: true, tint: [1, 1, 0] }), [0, 0, 0]);
  assert.deepEqual(yellow.map((x) => Math.round(x * 255)), [255, 255, 0]);
});

test('gaussian kernel: normalized, symmetric, radius ceil(3 sigma)', () => {
  for (const sigma of [0.5, 1, 1.5, 2.7, 4.5, 10]) {
    const k = gaussianKernel(sigma);
    const r = Math.ceil(3 * sigma);
    assert.equal(k.length, 2 * r + 1);
    near(k.reduce((a, b) => a + b, 0), 1, 1e-12, `sum sigma=${sigma}`);
    for (let i = 0; i < r; i++) near(k[i], k[k.length - 1 - i], 1e-15);
    assert.ok(k[r] === Math.max(...k));
  }
  assert.deepEqual(gaussianKernel(0), [1]);
});

test('linear-sampled kernel reproduces the discrete kernel', () => {
  for (const sigma of [0.8, 1.5, 4.5, 12]) {
    const k = gaussianKernel(sigma);
    const r = (k.length - 1) / 2;
    const ls = linearSampleKernel(sigma);
    near(ls.center + 2 * ls.weights.reduce((a, b) => a + b, 0), 1, 1e-12);
    // Emulate bilinear fetches on a 1-D impulse response and compare to the discrete taps.
    const resp = new Array(r + 1).fill(0);
    resp[0] = ls.center;
    ls.offsets.forEach((o, i) => {
      const f = Math.floor(o); const frac = o - f;
      resp[f] += ls.weights[i] * (1 - frac);
      if (f + 1 <= r) resp[f + 1] += ls.weights[i] * frac;
    });
    for (let i = 0; i <= r; i++) near(resp[i], k[r + i], 1e-12, `tap ${i} sigma ${sigma}`);
  }
});

test('unsharp combine: out = orig + amount * (orig - blurred)', () => {
  assert.deepEqual(unsharpCombine([0.5, 0.2], [0.5, 0.4], 1), [0.5, 0]);
  assert.deepEqual(unsharpCombine([0.8], [0.6], 0.5), [0.9000000000000001]);
  assert.deepEqual(unsharpCombine([0.3], [0.1], 0), [0.3]);
  // Full pipeline: an edge gains overshoot, a flat field is unchanged
  const w = 16; const h = 1;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let x = 0; x < w; x++) { const v = x < 8 ? 64 : 192; data.set([v, v, v, 255], x * 4); }
  processImageData(data, w, h, { sharpenAmount: 1, sharpenSigmaPx: 1 });
  assert.ok(data[7 * 4] < 64, 'dark side of the edge gets darker');
  assert.ok(data[8 * 4] > 192, 'bright side of the edge gets brighter');
  assert.equal(data[0], 64);
  assert.equal(data[15 * 4], 192);
  const flat = new Uint8ClampedArray(9 * 4).fill(100);
  processImageData(flat, 3, 3, { sharpenAmount: 2, sharpenSigmaPx: 1 });
  assert.equal(flat[0], 100);
});

test('gaussianBlur preserves the mean of a constant image and clamps at edges', () => {
  const src = new Float32Array(5 * 4 * 3).fill(0.25);
  const out = gaussianBlur(src, 5, 4, 3, 2);
  out.forEach((v) => near(v, 0.25, 1e-6));
});

test('scaleParams: 0 -> neutral, 1 -> unchanged, 1.5 -> 150 % deviation (zoom untouched)', () => {
  const media = demoProfile().media;
  assert.equal(isNeutralParams(scaleParams(media, 0)), true);
  const one = scaleParams(media, 1);
  assert.deepEqual(one.colorMatrix, media.colorMatrix);
  near(one.contrast, media.contrast); near(one.sharpenAmount, media.sharpenAmount);
  const more = scaleParams(media, 1.5);
  near(more.contrast, 1 + 1.5 * (media.contrast - 1), 1e-12);
  near(more.colorMatrix[3], 1.5 * media.colorMatrix[3], 1e-12);
  near(more.colorMatrix[4], 1 + 1.5 * (media.colorMatrix[4] - 1), 1e-12);
  near(more.sharpenAmount, 1.5 * media.sharpenAmount, 1e-12);
  assert.equal(more.zoom, media.zoom);
  assert.equal(scaleParams({ warmth: 0.9 }, 1.5).warmth, 1);
  assert.equal(scaleParams({ invert: true }, 0.4).invert, false);
  assert.equal(scaleParams({ invert: true }, 0.6).invert, true);
});

test('sanitizeParams rejects garbage and clamps', () => {
  const p = sanitizeParams({ colorMatrix: [1, 2, 'x'], contrast: NaN, brightness: -3, warmth: 7, sharpenAmount: Infinity, invert: 'yes' });
  assert.deepEqual(p.colorMatrix, [...IDENTITY_MATRIX]);
  assert.equal(p.contrast, 1);
  assert.equal(p.brightness, 0);
  assert.equal(p.warmth, 1);
  assert.equal(p.sharpenAmount, 0);
  assert.equal(p.invert, false);
  assert.deepEqual(p.tint, [1, 1, 1]);
});

test('toColumnMajor transposes for gl.uniformMatrix3fv', () => {
  assert.deepEqual([...toColumnMajor([1, 2, 3, 4, 5, 6, 7, 8, 9])], [1, 4, 7, 2, 5, 8, 3, 6, 9]);
});

test('cssFilterApprox', () => {
  assert.equal(cssFilterApprox(neutralFilterParams()), 'none');
  assert.equal(cssFilterApprox({ contrast: 1.2, brightness: 1.1, saturation: 0, invert: true }), 'brightness(1.1) contrast(1.2) saturate(0) invert(1)');
});

test('demo profile media params change pixels', () => {
  const [r, g, b] = applyPixel(0.4, 0.6, 0.3, demoProfile().media);
  assert.ok(Math.abs(r - 0.4) + Math.abs(g - 0.6) + Math.abs(b - 0.3) > 0.02);
});
