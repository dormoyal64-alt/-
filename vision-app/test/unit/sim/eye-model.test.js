import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFOCUS_MODEL, logMARForBlur, blurForLogMAR, watsonYellottPupilMm, hofstetterAmplitude, createEye, eyeState,
  farPointMm, nearPointMm, sharpRangeMm, psfKernel, blurDiskArcmin, binocularLogMARAt,
} from '../../../public/app/js/sim/eye-model.js';
import { gfLogMARForBlur, gfPupilMm, GF_MODEL } from '../../../public/app/js/engine/profile.js';

describe('defocus → acuity model', () => {
  test('fits the published data (RMS < 0.05 logMAR at the reference pupil)', () => {
    let sse = 0;
    for (const [u, L] of DEFOCUS_MODEL.fitData) sse += (logMARForBlur(Number(u), DEFOCUS_MODEL.refPupilMm, -0.05) - Number(L)) ** 2;
    assert.ok(Math.sqrt(sse / DEFOCUS_MODEL.fitData.length) < 0.05);
  });
  test('monotonic in blur and pupil; inverse round-trips; dead zone keeps the floor', () => {
    assert.ok(Math.abs(logMARForBlur(0.1, 3.7, -0.08) + 0.08) < 1e-12);
    for (let u = 0.25; u < 8; u += 0.25) assert.ok(logMARForBlur(u + 0.25, 3.7, -0.08) > logMARForBlur(u, 3.7, -0.08) - 1e-12);
    assert.ok(logMARForBlur(1, 5, 0) > logMARForBlur(1, 3, 0));
    for (const L of [0.1, 0.4, 0.9]) assert.ok(Math.abs(logMARForBlur(blurForLogMAR(L, 3.7, -0.05), 3.7, -0.05) - L) < 1e-9);
  });
  test('the engine uses the same constants as the simulator', () => {
    assert.equal(GF_MODEL.k, DEFOCUS_MODEL.k);
    assert.equal(GF_MODEL.deadZoneMmD, DEFOCUS_MODEL.deadZoneMmD);
    assert.ok(Math.abs(gfPupilMm(45) - watsonYellottPupilMm({ age: 45 })) < 1e-9);
    assert.ok(Math.abs(gfLogMARForBlur(1.3, 3.5, -0.05) - logMARForBlur(1.3, 3.5, -0.05)) < 1e-12);
  });
  test('typical uncorrected values at a 3.7 mm phone-viewing pupil', () => {
    const at = (u) => logMARForBlur(u, 3.7, -0.05);
    assert.ok(at(0.5) < 0.1 && at(1) > 0.2 && at(1) < 0.4 && at(2) > 0.5 && at(2) < 0.75 && at(6) > 1.0);
  });
});

describe('pupil, accommodation and eye states', () => {
  test('Watson & Yellott pupil at phone luminance: 3–4.5 mm, smaller with age and brightness', () => {
    const p30 = watsonYellottPupilMm({ age: 30 });
    assert.ok(p30 > 3.3 && p30 < 4.2);
    assert.ok(watsonYellottPupilMm({ age: 70 }) < p30);
    assert.ok(watsonYellottPupilMm({ age: 30, luminance: 500 }) < p30);
  });
  test('Hofstetter amplitudes', () => {
    assert.deepEqual(hofstetterAmplitude(45), { min: 3.75, mean: 5, max: 7 });
    assert.equal(hofstetterAmplitude(70).mean, 0);
  });
  test('myope: sharp inside the far point, blurred beyond it', () => {
    const e = createEye({ sphere: -2, age: 30 });
    assert.equal(farPointMm(e), 500);
    assert.ok(eyeState(e, 400).blurD < 1e-9);
    assert.ok(Math.abs(eyeState(e, 1000).blurD - 1) < 1e-9);
    assert.equal(eyeState(e, 1000).accommodationD, 0);
  });
  test('presbyope: comfortable mode uses half the amplitude', () => {
    const e = createEye({ sphere: 0, age: 50, ampD: 2 });
    assert.equal(nearPointMm(e), 500);
    assert.ok(Math.abs(eyeState(e, 400, { mode: 'max' }).blurD - 0.5) < 1e-9);
    assert.ok(Math.abs(eyeState(e, 400, { mode: 'comfortable' }).blurD - 1.5) < 1e-9);
  });
  test('astigmatism: circle of least confusion on the retina → blur = |cyl|/2; plus-cyl is transposed', () => {
    const e = createEye({ sphere: 0, cyl: -1.5, axisDeg: 90, age: 30 });
    assert.ok(Math.abs(eyeState(e, 350).blurD - 0.75) < 1e-9);
    const t = createEye({ sphere: -1.5, cyl: 1.5, axisDeg: 0, age: 30 });
    assert.deepEqual([t.sphere, t.cyl, t.axisDeg], [0, -1.5, 90]);
  });
  test('sharp range and binocular threshold (better eye)', () => {
    const e = createEye({ sphere: -3, age: 30, floorLogMAR: -0.05, pupilMm: 3.7 });
    const r = sharpRangeMm(e, { maxLossLogMAR: 0.1 });
    assert.ok(r.toMm > 333 && r.toMm < 420 && r.fromMm < 150);
    const far = createEye({ sphere: -6, age: 30 });
    assert.equal(binocularLogMARAt([far, e], 350), binocularLogMARAt([e], 350));
  });
});

describe('PSF kernel', () => {
  const moments = (k) => {
    let sx = 0; let sy = 0; let sum = 0;
    for (let y = 0; y < k.size; y++) for (let x = 0; x < k.size; x++) {
      const w = k.data[y * k.size + x]; sum += w; sx += w * (x - k.radius) ** 2; sy += w * (y - k.radius) ** 2;
    }
    return { sum, sx, sy };
  };
  test('normalised; circular for spherical defocus; disk size matches β = P·ΔD', () => {
    const k = psfKernel({ residualD: [1, 1], axisDeg: 180, pupilMm: 4, pxPerArcmin: 1, diffraction: false, extraSigmaArcmin: 0 });
    const m = moments(k);
    assert.ok(Math.abs(m.sum - 1) < 1e-5);
    assert.ok(Math.abs(m.sx - m.sy) / m.sx < 0.02);
    const r = blurDiskArcmin(4, 1) / 2; // uniform disk: variance per axis = r²/4
    assert.ok(Math.abs(m.sx - (r * r) / 4) / ((r * r) / 4) < 0.05);
  });
  test('astigmatic blur is elongated along the defocused meridian (vertical for axis 180)', () => {
    const k = psfKernel({ residualD: [0, 2], axisDeg: 180, pupilMm: 4, pxPerArcmin: 1 });
    const m = moments(k);
    assert.ok(m.sy > 10 * m.sx);
    const k45 = psfKernel({ residualD: [0, 2], axisDeg: 45, pupilMm: 4, pxPerArcmin: 1 });
    // TABO 45° is seen at 135° on the screen; the defocused meridian (135° TABO) appears at 45° on the screen:
    // up-right / down-left in screen coordinates (y down) → negative x·y covariance.
    let cxy = 0;
    for (let y = 0; y < k45.size; y++) for (let x = 0; x < k45.size; x++) cxy += k45.data[y * k45.size + x] * (x - k45.radius) * (y - k45.radius);
    assert.ok(cxy < 0);
  });
});
