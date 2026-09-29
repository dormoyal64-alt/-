import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  letterHeightMm, strokeMm, strokeDevicePx, strokeCssPx, optotypeCssPx, minRenderableLogMAR, maxFittingLogMAR,
  logMARForStrokeMm, decimalFromLogMAR, snellen6, snellen20, mUnits, etdrsLetters, mmPerDevicePx, STIMULUS_EXTENT_STROKES,
} from '../../../public/app/js/tests/acuity/acuity-math.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('letter height matches the spec examples (§3.1)', () => {
  close(letterHeightMm(0, 400), 0.582, 0.0006, 'L0 @40cm');
  close(letterHeightMm(0.3, 400), 1.161, 0.0006, 'L0.3 @40cm');
  close(letterHeightMm(0.5, 400), 1.840, 0.0006, 'L0.5 @40cm');
  close(letterHeightMm(1.0, 400), 5.818, 0.0006, 'L1.0 @40cm');
  close(letterHeightMm(0, 300), 0.436, 0.0006, 'L0 @30cm');
  close(letterHeightMm(1.3, 400), 11.6, 0.05, 'L1.3 @40cm (11.6 mm in §3.4)');
});

test('stroke uses the exact formula stroke = 2·d·tan(10^L·π/21600) and letter = 5 strokes', () => {
  for (const [L, d] of [[0, 400], [0.7, 350], [-0.2, 300], [1.2, 500]]) {
    const exact = 2 * d * Math.tan((10 ** L * Math.PI) / 21600);
    assert.equal(strokeMm(L, d), exact);
    close(5 * strokeMm(L, d), letterHeightMm(L, d), 1e-4 * letterHeightMm(L, d), 'letter ≈ 5 strokes (tan non-linearity < 0.01 %)');
  }
  // CSS px via cssPxPerMm
  close(strokeCssPx(0, 400, 6), strokeMm(0, 400) * 6, 1e-12);
  close(optotypeCssPx(0.3, 400, 6), 5 * strokeMm(0.3, 400) * 6, 1e-12);
});

test('device-pixel stroke table (§1.3): iPhone 15 (460 ppi) and iPad (264 ppi)', () => {
  // cssPxPerMm·dpr = device px per mm = ppi/25.4
  const iphone = { cssPxPerMm: 460 / 25.4 / 3, dpr: 3 };
  close(mmPerDevicePx(iphone.cssPxPerMm, iphone.dpr), 25.4 / 460, 1e-12);
  close(strokeDevicePx(0, 300, iphone.cssPxPerMm, iphone.dpr), 1.58, 0.005, 'iPhone 30cm');
  close(strokeDevicePx(0, 400, iphone.cssPxPerMm, iphone.dpr), 2.11, 0.005, 'iPhone 40cm');
  close(minRenderableLogMAR(300, iphone.cssPxPerMm, iphone.dpr), -0.20, 0.005, 'iPhone best L 30cm');
  close(minRenderableLogMAR(400, iphone.cssPxPerMm, iphone.dpr), -0.32, 0.006, 'iPhone best L 40cm');
  const ipad = { cssPxPerMm: 264 / 25.4 / 2, dpr: 2 };
  close(strokeDevicePx(0, 300, ipad.cssPxPerMm, ipad.dpr), 0.91, 0.005, 'iPad 30cm');
  close(minRenderableLogMAR(300, ipad.cssPxPerMm, ipad.dpr), 0.04, 0.005, 'iPad best L 30cm');
  close(minRenderableLogMAR(400, ipad.cssPxPerMm, ipad.dpr), -0.08, 0.005, 'iPad best L 40cm');
  // at the floor the stroke is exactly 1 device px
  const Lmin = minRenderableLogMAR(350, 6.2, 2.625);
  close(strokeDevicePx(Lmin, 350, 6.2, 2.625), 1, 1e-9);
});

test('inverse and fitting helpers', () => {
  for (const L of [-0.3, 0, 0.44, 1.3]) close(logMARForStrokeMm(strokeMm(L, 420), 420), L, 1e-12);
  assert.equal(STIMULUS_EXTENT_STROKES, 12);
  const Lmax = maxFittingLogMAR(400, 6.2, 360);
  close(12 * strokeCssPx(Lmax, 400, 6.2), 360, 1e-9, 'stimulus fills the area exactly');
});

test('conversions: decimal, Snellen chart denominators, M-units, ETDRS', () => {
  const table = [
    [-0.3, 2.0, '6/3', '20/10', 100], [-0.2, 1.58, '6/3.8', '20/12.5', 95], [-0.1, 1.26, '6/4.8', '20/16', 90],
    [0, 1, '6/6', '20/20', 85], [0.1, 0.79, '6/7.5', '20/25', 80], [0.2, 0.63, '6/9.5', '20/32', 75],
    [0.3, 0.5, '6/12', '20/40', 70], [0.4, 0.4, '6/15', '20/50', 65], [0.5, 0.32, '6/19', '20/63', 60],
    [0.6, 0.25, '6/24', '20/80', 55], [0.7, 0.2, '6/30', '20/100', 50], [0.8, 0.16, '6/38', '20/125', 45],
    [0.9, 0.13, '6/48', '20/160', 40], [1.0, 0.1, '6/60', '20/200', 35], [1.3, 0.05, '6/120', '20/400', 20],
  ];
  for (const [L, dec, s6, s20, etdrs] of table) {
    close(decimalFromLogMAR(L), dec, 0.006, `decimal ${L}`);
    assert.equal(snellen6(L), s6, `6/x at ${L}`);
    assert.equal(snellen20(L), s20, `20/x at ${L}`);
    close(etdrsLetters(L), etdrs, 1e-9);
  }
  // 0.02-step values snap to the nearest chart line
  assert.equal(snellen20(-0.18), '20/12.5');
  assert.equal(snellen6(0.32), '6/12');
  close(mUnits(0.3, 400), 0.4 * 10 ** 0.3, 1e-12);
});
