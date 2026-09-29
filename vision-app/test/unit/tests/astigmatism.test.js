import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAL, axisFromLineAngle, clockHoursForLine, lineAngleDiff, spokeAngles, spokeIndexForTap, inferFromAnswers,
  meanLineAngle, dialGeometry, spokeQuads,
} from '../../../public/app/js/tests/astigmatism/astigmatism-math.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('rule of 30: 12–6 → 180°, 3–9 → 90°, 1–7 → 30°, half hours allowed (§6.1/6.2)', () => {
  assert.deepEqual(clockHoursForLine(90), [6, 12]);
  assert.deepEqual(clockHoursForLine(0), [3, 9]);
  assert.deepEqual(clockHoursForLine(60), [1, 7]);
  assert.equal(axisFromLineAngle(90), 180);
  assert.equal(axisFromLineAngle(0), 90);
  assert.equal(axisFromLineAngle(60), 30);
  assert.equal(axisFromLineAngle(45), 45, '1:30–7:30 → 1.5 h → 45°');
  assert.equal(axisFromLineAngle(120), 150, '11–5 → lower hour 5 → 150°');
  assert.equal(axisFromLineAngle(88), 180, 'near-vertical snaps to 6 → 180°');
  for (let phi = 0; phi < 180; phi += 7) {
    const ax = axisFromLineAngle(phi);
    assert.ok(ax > 0 && ax <= 180 && ax % 15 === 0, `axis ${ax}`);
  }
});

test('dial: 12 spokes 15° apart; taps map to the nearest spoke (screen y grows down)', () => {
  assert.equal(DIAL.spokes, 12);
  assert.deepEqual(spokeAngles(0), [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165]);
  assert.equal(spokeIndexForTap(100, 0, 0), 0);        // right → horizontal
  assert.equal(spokeIndexForTap(-100, 0, 0), 0);       // left → same line
  assert.equal(spokeIndexForTap(0, -100, 0), 6);       // up → vertical
  assert.equal(spokeIndexForTap(70, -70, 0), 3);       // upper right → 45°
  assert.equal(spokeIndexForTap(70, 70, 0), 9);        // lower right → 135°
  assert.equal(spokeIndexForTap(0, -100, 7), 6);       // rotated dial: 97° is closest to vertical
  close(lineAngleDiff(179, 2), 3, 1e-9);
  close(meanLineAngle([178, 4]), 1, 1e-9);
});

test('inference: consistent ≥ 2 of 3 within ±15° → suspected with axis; otherwise not', () => {
  const a = inferFromAnswers([62, 55, 'equal']);
  assert.equal(a.suspected, true);
  assert.equal(a.axisDeg, 30, 'mean 58.5° → about 1 o’clock → 30°');
  const wrap = inferFromAnswers([176, 3, 100]);
  assert.equal(wrap.suspected, true);
  assert.equal(wrap.axisDeg, 90, 'near-horizontal answers across the 0/180 wrap');
  assert.deepEqual(inferFromAnswers(['equal', 'equal', 40]), { suspected: false, axisDeg: null, lineAngleDeg: null, equalCount: 2 });
  assert.equal(inferFromAnswers([10, 60, 120]).suspected, false);
  assert.equal(inferFromAnswers([10, 40, 70]).suspected, false, '30° apart is not consistent');
});

test('geometry: 1.5′ lines with 1.5′ gaps, 5° spoke length (at 35 cm on 460 ppi, 1.5′ = 0.153 mm)', () => {
  const devPerMm = 460 / 25.4;
  const g = dialGeometry({ dMm: 350, cssPxPerMm: devPerMm / 3, dpr: 3, maxRadiusDevPx: 10000 });
  close(g.lineDev / devPerMm, 0.153, 0.001);
  close(g.gapDev, g.lineDev, 1e-9);
  close((2 * g.outerR) / devPerMm, 2 * 350 * Math.tan((2.5 * Math.PI) / 180), 1e-6, 'full spoke length = 5°');
  assert.equal(g.shrunk, false);
  const small = dialGeometry({ dMm: 400, cssPxPerMm: 16.5, dpr: 2.625, maxRadiusDevPx: 300 });
  assert.equal(small.outerR, 300);
  assert.equal(small.shrunk, true);
  const quads = spokeQuads({ cx: 0, cy: 0, phi: 0, lineDev: 2, gapDev: 2, innerR: 10, outerR: 100 });
  assert.equal(quads.length, 6, '3 lines × 2 sides');
  const ys = quads.map((q) => (q[0].y + q[3].y) / 2);
  assert.deepEqual([...new Set(ys.map((y) => Math.round(y)))].sort((a, b) => a - b), [-4, 0, 4], 'pitch = width + gap');
  close(Math.abs(quads[0][0].y - quads[0][3].y), 2, 1e-9, 'line width');
});
