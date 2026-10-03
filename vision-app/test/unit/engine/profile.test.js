import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProfile, recomputeProfile, detailScore, targetXHeightArcmin, fontPxForAngle, sharpenSigmaCssPx,
  enhancementGain, contrastTier, deriveMetrics, isIdentityMatrix, SAFE_RANGES, describeFlag,
} from '../../../public/app/js/engine/profile.js';
import { daltonizeMatrix } from '../../../public/app/js/engine/color-math.js';
import { demoProfile } from '../../../public/app/js/core/demo-profile.js';
import { IPHONE15_MM_PER_CSS, baseInput, eyesInput, acuity, PERSONAS, allNumbers } from './fixtures.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const codes = (p) => p.flags.map((f) => f.code);
const flag = (p, code) => p.flags.find((f) => f.code === code);

describe('text-size formula (spec §4.3 worked examples)', () => {
  // iPhone 15, 0.1657 mm/px, SF x-height ratio 0.508, d = 350 mm, R = 2
  const fs = (L, R = 2) => fontPxForAngle(targetXHeightArcmin({ logMAR: L, reserve: R }), 350, 0.508, IPHONE15_MM_PER_CSS);
  test('L 0.0 → 12′ floor → 14.5 px', () => near(fs(0), 14.5, 0.05));
  test('L 0.3 → 24.1 px', () => near(fs(0.3), 24.1, 0.05));
  test('L 0.5 → 38.2 px', () => near(fs(0.5), 38.2, 0.05));
  test('L 0.7 → 60.6 px', () => near(fs(0.7), 60.6, 0.05));
  test('L 0.5, R = 3 → 57.4 px', () => near(fs(0.5, 3), 57.4, 0.05));
  test('Pixel 8 / Roboto: L 0.5 → 39.1 px', () => {
    near(fontPxForAngle(targetXHeightArcmin({ logMAR: 0.5 }), 350, 0.528, 0.1558), 39.1, 0.05);
  });
  test('x-height angle: floor, Hebrew margin, CPS rule', () => {
    near(targetXHeightArcmin({ logMAR: -0.3 }), 12, 1e-12);
    near(targetXHeightArcmin({ logMAR: null }), 12, 1e-12);
    near(targetXHeightArcmin({ logMAR: 0.3, hebrew: true }), 5 * 10 ** 0.3 * 2 * 1.12, 1e-9);
    near(targetXHeightArcmin({ logMAR: 0.9, cps: 0.2 }), 12, 1e-12, 'CPS replaces acuity; 9.98′ is floored');
    near(targetXHeightArcmin({ cps: 0.5 }), 5 * 10 ** 0.6, 1e-9);
    near(targetXHeightArcmin({ cps: 0.0, hebrew: true }), 13.44, 1e-9);
  });
});

describe('computeProfile: text', () => {
  test('worked example at profile level: iPhone 15, 350 mm, both eyes 0.3 → 23.7 px (Hebrew rule wins)', () => {
    const p = computeProfile(eyesInput(0.3));
    // Latin: 20′ → 2.031 mm / 0.52 / 0.1657 = 23.58 px; Hebrew: 22.35′ → 2.275 mm / 0.58 / 0.1657 = 23.67 px
    assert.equal(p.text.baseFontPx, 23.7);
    near(p.text.scale, 23.7 / 16, 1e-3);
    near(p.system.textScale * 16, 23.67, 0.02);
  });
  test('a reliable reading test (CPS) wins over acuity; an unreliable one is ignored', () => {
    const reading = { criticalPrintSizeLogMAR: 0.5, readingAcuityLogMAR: 0.3, maxReadingSpeedWpm: 180, distanceMm: 350, reliable: true };
    assert.equal(computeProfile(eyesInput(0.3, { reading })).text.baseFontPx, 23.5); // 19.9′ → Latin 23.52 px
    assert.equal(computeProfile(eyesInput(0.3, { reading: { ...reading, reliable: false } })).text.baseFontPx, 23.7);
    assert.equal(deriveMetrics(eyesInput(0.3, { reading })).sizeSource, 'reading');
  });
  test('binocular result is preferred, else the better eye; reliable before unreliable', () => {
    const both = baseInput({ acuity: { right: acuity('right', 0.5), left: acuity('left', 0.6), both: acuity('both', 0.3) } });
    assert.equal(deriveMetrics(both).L, 0.3);
    const mono = baseInput({ acuity: { right: acuity('right', 0.5), left: acuity('left', 0.2) } });
    assert.equal(deriveMetrics(mono).L, 0.2);
    const mixed = baseInput({ acuity: { right: acuity('right', 0.5), left: acuity('left', 0.1, { reliable: false }) } });
    assert.equal(deriveMetrics(mixed).L, 0.5);
    assert.equal(deriveMetrics(mixed).acuitySource, 'better-eye');
  });
  test('never below the 16 px platform default; capped at 64 px for the UI', () => {
    assert.equal(computeProfile(eyesInput(-0.2)).text.baseFontPx, 16);
    const p = computeProfile(eyesInput(1.3));
    assert.equal(p.text.baseFontPx, 64);
    assert.ok(p.system.textScale > 4, 'the system target keeps the true need');
    assert.equal(p.system.magnificationShortcut, true);
  });
  test('monotonic: worse acuity → larger text, more sharpening, more zoom', () => {
    let prev = null;
    for (let L = -0.2; L <= 1.3 + 1e-9; L += 0.1) {
      const p = computeProfile(eyesInput(Math.round(L * 10) / 10));
      if (prev) {
        assert.ok(p.text.baseFontPx >= prev.text.baseFontPx, `text at L=${L}`);
        assert.ok(p.system.textScale >= prev.system.textScale, `textScale at L=${L}`);
        assert.ok(p.media.sharpenAmount >= prev.media.sharpenAmount, `sharpen at L=${L}`);
        assert.ok(p.media.sharpenSigmaPx >= prev.media.sharpenSigmaPx, `sigma at L=${L}`);
        assert.ok(p.media.zoom >= prev.media.zoom, `zoom at L=${L}`);
      }
      prev = p;
    }
    const a = computeProfile(eyesInput(0.3));
    const b = computeProfile(eyesInput(0.7));
    assert.ok(b.text.baseFontPx > a.text.baseFontPx);
    assert.ok(b.media.sharpenAmount > a.media.sharpenAmount);
    assert.ok(b.media.zoom > a.media.zoom);
  });
  test('contrast tiers (§5.5): weight, size step, bold/contrast targets', () => {
    const at = (logCS) => computeProfile(eyesInput(0.3, { contrast: { eye: 'both', logCS, reliable: true } }));
    assert.equal(contrastTier(1.65), 0);
    assert.equal(contrastTier(1.64), 1);
    assert.equal(contrastTier(1.35), 1);
    assert.equal(contrastTier(1.0), 2);
    assert.equal(contrastTier(0.99), 3);
    assert.equal(contrastTier(null), null);
    const [n, r, l, v] = [at(1.8), at(1.5), at(1.2), at(0.8)];
    assert.deepEqual([n.text.fontWeight, r.text.fontWeight, l.text.fontWeight, v.text.fontWeight], [600, 600, 700, 700]); // L 0.3 → bold
    const n0 = computeProfile(eyesInput(0.0, { contrast: { eye: 'both', logCS: 1.8, reliable: true } }));
    const r0 = computeProfile(eyesInput(0.0, { contrast: { eye: 'both', logCS: 1.5, reliable: true } }));
    assert.deepEqual([n0.text.fontWeight, r0.text.fontWeight], [400, 600]);
    assert.ok(n.text.baseFontPx < r.text.baseFontPx && r.text.baseFontPx < l.text.baseFontPx && l.text.baseFontPx < v.text.baseFontPx);
    assert.equal(n0.system.increaseContrast, false);
    assert.equal(r.system.increaseContrast, true);
    assert.equal(r.system.contrastLevel, 'medium');
    assert.equal(l.system.contrastLevel, 'high');
    assert.equal(n0.media.contrast, 1);
    assert.ok(v.media.contrast > l.media.contrast && l.media.contrast > r.media.contrast);
    assert.ok(v.ui.contrast <= 1.15 && v.ui.contrast < v.media.contrast);
  });
  test('line-sharpness results → heavier weight and letter spacing (§6.4)', () => {
    const slight = computeProfile(eyesInput(0.0, { astigmatism: { right: { eye: 'right', suspected: true, axisDeg: 30, consistent: false } } }));
    const firm = computeProfile(eyesInput(0.0, { astigmatism: { left: { eye: 'left', suspected: true, axisDeg: 30, consistent: true } } }));
    assert.equal(slight.text.fontWeight, 500);
    assert.equal(slight.text.letterSpacingEm, 0.02);
    assert.equal(firm.text.fontWeight, 600);
    assert.equal(firm.text.letterSpacingEm, 0.04);
    assert.ok(firm.text.wordSpacingEm > 0 && firm.text.wordSpacingEm <= 0.16);
    assert.equal(firm.system.boldText, true);
  });
});

describe('computeProfile: filters', () => {
  test('enhancement parameters (§10.2)', () => {
    near(enhancementGain(1.8, null), 0, 1e-12);
    near(enhancementGain(1.5, null), 0.375, 1e-9);
    near(enhancementGain(1.2, null), 0.75, 1e-9);
    near(enhancementGain(1.0, null), 1.0, 1e-9);
    near(enhancementGain(0.6, null), 1.5, 1e-9);
    near(enhancementGain(null, 0.7), 0.75, 1e-9);
    near(enhancementGain(1.5, 0.7), 0.75, 1e-9);
    // ppd: iPhone 15 at 30 cm ≈ 95 device px/deg = 31.6 CSS px/deg; σ1 = ppd/(2π·0.35·30) at L = 0
    near(sharpenSigmaCssPx(0, 300, IPHONE15_MM_PER_CSS) * 3, 94.8 / (2 * Math.PI * 10.5), 0.01);
    near(sharpenSigmaCssPx(0.3, 350, IPHONE15_MM_PER_CSS) / sharpenSigmaCssPx(0, 350, IPHONE15_MM_PER_CSS), 10 ** 0.3, 1e-9);
  });
  test('magnification: L 0.7 at 350 mm → 3.75× (59.2 px needed / 16 px)', () => {
    assert.equal(computeProfile(eyesInput(0.7)).media.zoom, 3.75);
    assert.equal(computeProfile(eyesInput(0.0)).media.zoom, 1);
    assert.equal(computeProfile(eyesInput(1.6)).media.zoom, 8);
  });
  test('normal colour vision → identity matrices', () => {
    const p = computeProfile(eyesInput(0, { color: { type: 'normal', severity: 0, confidence: 0.9, reliable: true } }));
    assert.ok(isIdentityMatrix(p.media.colorMatrix));
    assert.ok(isIdentityMatrix(p.ui.colorMatrix));
    assert.equal(p.system.colorFilter, null);
  });
  test('deutan → daltonisation matrix that preserves greys; UI milder; unreliable → identity', () => {
    const color = { type: 'deutan', severity: 0.9, confidence: 0.9, reliable: true };
    const p = computeProfile(eyesInput(0, { color }));
    assert.deepEqual(p.media.colorMatrix, daltonizeMatrix('deutan', 0.9, 1));
    assert.ok(!isIdentityMatrix(p.media.colorMatrix));
    for (const m of [p.media.colorMatrix, p.ui.colorMatrix]) {
      for (let r = 0; r < 3; r++) near(m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2], 1, 1e-12, `row ${r} sum`);
    }
    const dist = (m) => m.reduce((s, v, i) => s + Math.abs(v - [1, 0, 0, 0, 1, 0, 0, 0, 1][i]), 0);
    assert.ok(dist(p.ui.colorMatrix) > 0 && dist(p.ui.colorMatrix) < dist(p.media.colorMatrix));
    assert.deepEqual(p.system.colorFilter, { type: 'deutan', intensity: 0.9 });
    const mild = computeProfile(eyesInput(0, { color: { ...color, severity: 0.3 } }));
    assert.ok(!isIdentityMatrix(mild.media.colorMatrix));
    assert.ok(isIdentityMatrix(mild.ui.colorMatrix), 'UI is recoloured only from severity 0.5');
    const unreliable = computeProfile(eyesInput(0, { color: { ...color, reliable: false } }));
    assert.ok(isIdentityMatrix(unreliable.media.colorMatrix));
    assert.equal(unreliable.system.colorFilter, null);
    const unclassified = computeProfile(eyesInput(0, { color: { type: 'unclassified', severity: 0.8, confidence: 0.5, reliable: true } }));
    assert.ok(isIdentityMatrix(unclassified.media.colorMatrix));
  });
  test('UI never gets sharpening or zoom; light sensitivity → warmth and white-point target', () => {
    const p = computeProfile(eyesInput(0.9, { prefs: { lightSensitivity: 'high', theme: 'dark' } }));
    assert.equal(p.ui.sharpenAmount, 0);
    assert.equal(p.ui.zoom, 1);
    assert.ok(p.media.warmth > 0 && p.ui.warmth > 0 && p.ui.warmth <= p.media.warmth);
    assert.equal(p.system.reduceWhitePoint, true);
    assert.equal(p.system.darkMode, true);
    const q = computeProfile(eyesInput(0.9));
    assert.equal(q.media.warmth, 0);
    assert.equal(q.system.reduceWhitePoint, false);
  });
});

describe('computeProfile: robustness', () => {
  const weird = [
    undefined, null, {}, { acuity: null }, baseInput(),
    baseInput({ screen: { cssPxPerMm: 0, dpr: NaN, method: 'card' }, distance: { distanceMm: -5 } }),
    baseInput({ screen: { cssPxPerMm: NaN }, distance: { distanceMm: Infinity } }),
    baseInput({ acuity: { right: acuity('right', NaN), left: { logMAR: 'x' } } }),
    baseInput({ acuity: { right: acuity('right', 0.4, { reliable: false }), left: acuity('left', 3, { reliable: false }) } }),
    baseInput({ acuity: { both: acuity('both', -2) }, contrast: { logCS: NaN, reliable: true }, color: { type: 'deutan', severity: NaN, reliable: true } }),
    baseInput({ reading: { criticalPrintSizeLogMAR: NaN, reliable: true }, focus: { nearPointMm: 0, farPointMm: -1 } }),
    baseInput({ focus: { nearPointMm: 100000, farPointMm: 1 }, age: NaN, prefs: { theme: 'x', lightSensitivity: 'y' } }),
    baseInput({ acuity: { right: acuity('right', 0.5, { ceilingLimited: true }) }, astigmatism: { right: null } }),
    { ...eyesInput(0.2), amsler: { right: { eye: 'right', abnormal: true, findings: ['wavy'] } } },
  ];
  test('never NaN/Infinity and every output within its safe range', () => {
    for (const [i, input] of weird.entries()) {
      const p = computeProfile(/** @type {any} */ (input), { now: new Date('2026-09-29T00:00:00Z') });
      for (const [path, v] of allNumbers({ text: p.text, media: p.media, ui: p.ui, system: p.system, viewing: p.viewing })) {
        assert.ok(Number.isFinite(v), `input #${i} ${path} = ${v}`);
      }
      assert.ok(p.text.baseFontPx >= SAFE_RANGES.baseFontPx[0] && p.text.baseFontPx <= SAFE_RANGES.baseFontPx[1]);
      assert.ok(p.text.fontWeight >= 400 && p.text.fontWeight <= 700);
      assert.ok(p.text.lineHeight >= 1.4 && p.text.lineHeight <= 1.8);
      assert.ok(p.media.sharpenAmount >= 0 && p.media.sharpenAmount <= 1.5);
      assert.ok(p.media.sharpenSigmaPx >= 0.5 && p.media.sharpenSigmaPx <= 8);
      assert.ok(p.media.zoom >= 1 && p.media.zoom <= 8);
      assert.ok(p.media.contrast >= 1 && p.media.contrast <= 1.35);
      assert.ok(p.system.textScale >= 1 && p.system.textScale <= 8);
      assert.equal(p.media.colorMatrix.length, 9);
      assert.ok(Array.isArray(p.flags));
      for (const f of p.flags) assert.match(f.code, /^[A-Z_]+$/);
      const r = p.viewing.recommendedDistanceMm;
      assert.ok(r === null || (r >= 150 && r <= 600));
    }
  });
  test('missing acuity → platform defaults and an info flag; Amsler input is ignored and not stored', () => {
    const p = computeProfile(baseInput());
    assert.equal(p.text.baseFontPx, 16);
    assert.equal(p.media.sharpenAmount, 0);
    assert.ok(codes(p).includes('NO_ACUITY'));
    const q = computeProfile(weird.at(-1));
    assert.equal(q.input.amsler, undefined);
    assert.ok(!codes(q).some((c) => c.includes('AMSLER')));
  });
  test('uncalibrated screen → DEFAULT_CALIBRATION info flag', () => {
    const p = computeProfile(eyesInput(0, { screen: { cssPxPerMm: 3.78, dpr: 3, method: 'default' } }));
    assert.ok(codes(p).includes('DEFAULT_CALIBRATION'));
    assert.ok(!codes(computeProfile(eyesInput(0))).includes('DEFAULT_CALIBRATION'));
  });
  test('metadata, input copy, recomputeProfile', () => {
    const input = eyesInput(0.3);
    const snapshot = JSON.stringify(input);
    const t0 = new Date('2026-01-01T00:00:00Z');
    const p = computeProfile(input, { id: 'abc', name: 'Mom', now: t0 });
    assert.equal(JSON.stringify(input), snapshot, 'input not mutated');
    assert.equal(p.version, 1);
    assert.equal(p.id, 'abc');
    assert.equal(p.name, 'Mom');
    assert.equal(p.createdAt, t0.toISOString());
    assert.equal(p.updatedAt, t0.toISOString());
    assert.notEqual(p.input, input);
    assert.deepEqual(p.input, input);
    assert.ok(computeProfile(input).id.length > 5);
    const t1 = new Date('2026-09-29T00:00:00Z');
    const q = recomputeProfile(p, { now: t1 });
    assert.equal(q.id, 'abc');
    assert.equal(q.name, 'Mom');
    assert.equal(q.createdAt, t0.toISOString());
    assert.equal(q.updatedAt, t1.toISOString());
    assert.deepEqual(q.text, p.text);
  });
  test('describeFlag is re-exported for screens/results.js', () => {
    assert.equal(typeof describeFlag, 'function');
    assert.ok(describeFlag({ level: 'recommend', code: 'LOW_CONTRAST' }, 'en').text.length > 10);
  });
});

describe('recommended viewing distance (§9.5)', () => {
  const withFocus = (nearPointMm, farPointMm, over = {}) => eyesInput(0.1, { age: 50, focus: { eye: 'both', nearPointMm, farPointMm }, ...over });
  test('d_rec = clamp(max(d_hab, 2000/Amp), 250, min(d_fp, 600))', () => {
    assert.equal(computeProfile(withFocus(250, null)).viewing.recommendedDistanceMm, 500); // Amp 4 D → 500 mm
    assert.equal(computeProfile(withFocus(100, null)).viewing.recommendedDistanceMm, 350); // Amp 10 D → habitual
    const far = withFocus(120, 450, { distance: { distanceMm: 550, method: 'camera' } }); // Amp 6.1 D, habitual 550
    assert.equal(computeProfile(far).viewing.recommendedDistanceMm, 450); // capped by the far point
  });
  test('no comfortable near distance → habitual distance, larger text, reading-glasses flag', () => {
    const p = computeProfile(withFocus(700, null));
    assert.equal(p.viewing.recommendedDistanceMm, 350);
    assert.ok(codes(p).includes('NEAR_FOCUS_FAR'));
  });
  test('measured far point: comfortable near limit = 1000/(F + Amp/2); narrow range (< 10 cm) → exam flag', () => {
    // Uncorrected myope: at d the focusing effort is 1000/d − F (F = 1000/far point), so the comfortable near limit is
    // 1000/(F + Amp/2), not 2000/Amp (validation simulation, docs/validation/SIMULATION-REPORT.md).
    const p = computeProfile(withFocus(250, 300)); // F 3.33, Amp 0.67 → 273 mm; range 27–30 cm
    assert.ok(codes(p).includes('FOCUS_RANGE_LIMITED'));
    assert.ok(!codes(p).includes('NEAR_FOCUS_FAR'));
    const q = computeProfile(withFocus(200, 300)); // Amp 1.67 → 240 mm; range 24–30 cm
    assert.ok(codes(q).includes('FOCUS_RANGE_LIMITED'));
    const r = computeProfile(withFocus(150, 300)); // Amp ≥ 3.33 → 200 mm; range 20–30 cm: comfortable, no flag
    assert.ok(!codes(r).includes('FOCUS_RANGE_LIMITED') && !codes(r).includes('NEAR_FOCUS_FAR'));
    assert.equal(r.viewing.recommendedDistanceMm, 300); // capped by the far point
    // A young myope whose near point is at the camera floor is never told about reading glasses.
    const young = computeProfile(eyesInput(0.6, { age: 38, focus: { eye: 'both', nearPointMm: 150, farPointMm: 290 } }));
    assert.ok(!codes(young).includes('NEAR_FOCUS_FAR') && !codes(young).includes('FOCUS_RANGE_LIMITED'));
  });
  test('text is sized at d_rec and a re-check is suggested when it differs > 15 % from the test distance', () => {
    const at350 = computeProfile(eyesInput(0.3));
    const at500 = computeProfile(eyesInput(0.3, { focus: { eye: 'both', nearPointMm: 250, farPointMm: null } }));
    assert.ok(at500.text.baseFontPx > at350.text.baseFontPx);
    assert.ok(codes(at500).includes('RECHECK_AT_DISTANCE'));
    assert.equal(flag(at500, 'RECHECK_AT_DISTANCE').params.cm, 50);
  });
  test('no focus result → null', () => assert.equal(computeProfile(eyesInput(0)).viewing.recommendedDistanceMm, null));
});

describe('red flags (§13) at exact thresholds', () => {
  const mono = (r, l, over = {}) => baseInput({ age: 40, acuity: { right: acuity('right', r), left: acuity('left', l) }, ...over });
  test('R3: worse than 0.30 → recommend; worse than 0.50 → urgent', () => {
    assert.ok(!codes(computeProfile(mono(0.3, 0.3))).some((c) => c.startsWith('LOW_ACUITY')));
    const a = computeProfile(mono(0.32, 0.1));
    assert.equal(flag(a, 'LOW_ACUITY_RIGHT').level, 'recommend');
    assert.equal(flag(a, 'LOW_ACUITY_RIGHT').params.score, 57);
    assert.equal(flag(a, 'LOW_ACUITY_LEFT'), undefined);
    assert.equal(flag(computeProfile(mono(0.1, 0.5)), 'LOW_ACUITY_LEFT').level, 'recommend');
    assert.equal(flag(computeProfile(mono(0.1, 0.52)), 'LOW_ACUITY_LEFT').level, 'urgent');
    const ceil = baseInput({ acuity: { right: acuity('right', 0.2, { ceilingLimited: true }) } });
    assert.equal(flag(computeProfile(ceil), 'LOW_ACUITY_RIGHT').level, 'urgent');
    const both = baseInput({ acuity: { both: acuity('both', 0.4) } });
    assert.ok(codes(computeProfile(both)).includes('LOW_ACUITY_BOTH'));
  });
  test('unreliable acuity raises no acuity red flag but an UNRELIABLE info flag', () => {
    const p = computeProfile(baseInput({ acuity: { right: acuity('right', 0.9, { reliable: false }) } }));
    assert.ok(!codes(p).some((c) => c.startsWith('LOW_ACUITY')));
    assert.equal(flag(p, 'UNRELIABLE').level, 'info');
    assert.equal(flag(p, 'UNRELIABLE').params.tests, 'acuity-right');
  });
  test('R3a: age ≥ 45, ≤ 45 cm, without reading correction, similar eyes → reading-glasses flag instead', () => {
    const over = { wearsCorrection: false };
    const p = computeProfile(mono(0.4, 0.35, { ...over, age: 45 }));
    assert.ok(codes(p).includes('NEAR_ACUITY_REDUCED'));
    assert.ok(!codes(p).some((c) => c.startsWith('LOW_ACUITY')));
    assert.equal(flag(p, 'NEAR_ACUITY_REDUCED').level, 'recommend');
    assert.ok(codes(computeProfile(mono(0.4, 0.35, { ...over, age: 44 }))).includes('LOW_ACUITY_RIGHT'));
    assert.ok(codes(computeProfile(mono(0.4, 0.35, { age: 60, wearsCorrection: true }))).includes('LOW_ACUITY_RIGHT'));
    assert.ok(codes(computeProfile(mono(0.6, 0.35, { ...over, age: 60 }))).includes('LOW_ACUITY_RIGHT'), 'eyes differ by ≥ 0.2');
  });
  test('R4: interocular difference ≥ 0.20 (urgent when an eye is worse than 0.30)', () => {
    assert.equal(flag(computeProfile(mono(0.1, 0.3)), 'ACUITY_DIFFERENCE').level, 'recommend');
    assert.equal(flag(computeProfile(mono(0.1, 0.28)), 'ACUITY_DIFFERENCE'), undefined);
    assert.equal(flag(computeProfile(mono(0.2, 0.4)), 'ACUITY_DIFFERENCE').level, 'urgent');
  });
  test('R5: worsening ≥ 0.20 against a baseline', () => {
    const before = mono(0.1, 0.1);
    assert.equal(flag(computeProfile(mono(0.3, 0.1), { baseline: before }), 'ACUITY_WORSENED_RIGHT').level, 'urgent');
    assert.equal(flag(computeProfile(mono(0.28, 0.1), { baseline: computeProfile(before) }), 'ACUITY_WORSENED_RIGHT'), undefined);
  });
  test('R6: contrast below 1.65 (< 60 y) / 1.50 (≥ 60 y); urgent below 1.0; drop ≥ 0.30', () => {
    const cs = (logCS, age, extra = {}) => computeProfile(eyesInput(0, { age, contrast: { eye: 'both', logCS, reliable: true }, ...extra }));
    assert.equal(flag(cs(1.65, 30), 'LOW_CONTRAST'), undefined);
    assert.equal(flag(cs(1.64, 30), 'LOW_CONTRAST').level, 'recommend');
    assert.equal(flag(cs(1.5, 60), 'LOW_CONTRAST'), undefined);
    assert.equal(flag(cs(1.49, 60), 'LOW_CONTRAST').level, 'recommend');
    assert.equal(flag(cs(0.99, 60), 'LOW_CONTRAST').level, 'urgent');
    assert.equal(flag(cs(1.0, 60), 'LOW_CONTRAST').level, 'recommend');
    const drop = cs(1.6, 70, {});
    assert.equal(flag(drop, 'CONTRAST_WORSENED'), undefined);
    const baseline = eyesInput(0, { contrast: { eye: 'both', logCS: 1.9, reliable: true } });
    assert.ok(codes(computeProfile(eyesInput(0, { age: 70, contrast: { eye: 'both', logCS: 1.6, reliable: true } }), { baseline })).includes('CONTRAST_WORSENED'));
    assert.equal(flag(cs(1.2, 30, { contrast: { eye: 'both', logCS: 1.2, reliable: false } }), 'LOW_CONTRAST'), undefined);
  });
  test('R7: blue–yellow / generalised → urgent; red–green → info only; change from baseline → urgent', () => {
    const col = (type, severity, extra = {}) => computeProfile(eyesInput(0, { color: { type, severity, confidence: 0.8, reliable: true }, ...extra }));
    assert.equal(flag(col('tritan', 0.5), 'COLOR_BLUE_YELLOW').level, 'urgent');
    assert.equal(flag(col('unclassified', 0.5), 'COLOR_GENERAL').level, 'urgent');
    assert.equal(flag(col('deutan', 0.9), 'COLOR_RED_GREEN').level, 'info');
    assert.equal(flag(col('protan', 0.4), 'COLOR_RED_GREEN').level, 'info');
    assert.deepEqual(col('normal', 0).flags.filter((f) => f.code.startsWith('COLOR')), []);
    const baseline = eyesInput(0, { color: { type: 'normal', severity: 0, reliable: true } });
    assert.equal(flag(computeProfile(eyesInput(0, { color: { type: 'deutan', severity: 0.5, reliable: true } }), { baseline }), 'COLOR_CHANGED').level, 'urgent');
  });
  test('R8: near point vs Hofstetter minimum − 2 D (age < 40), not at the 150 mm camera floor', () => {
    const f = (nearPointMm, age) => computeProfile(eyesInput(0, { age, focus: { eye: 'both', nearPointMm, farPointMm: null } }));
    // age 30 → minimum 15 − 7.5 − 2 = 5.5 D ⇔ near point 181.8 mm
    assert.ok(codes(f(182, 30)).includes('NEAR_FOCUS_REDUCED'));
    assert.ok(!codes(f(181, 30)).includes('NEAR_FOCUS_REDUCED'));
    assert.ok(!codes(f(150, 20)).includes('NEAR_FOCUS_REDUCED'));
    assert.ok(!codes(f(400, 40)).includes('NEAR_FOCUS_REDUCED'));
  });
  test('R9: only a consistent line-dial result is flagged', () => {
    const a = (consistent) => computeProfile(eyesInput(0, { astigmatism: { left: { eye: 'left', suspected: true, axisDeg: 60, consistent } } }));
    assert.equal(flag(a(true), 'LINES_UNEVEN_LEFT').level, 'recommend');
    assert.ok(!codes(a(false)).some((c) => c.startsWith('LINES_UNEVEN')));
  });
  test('R10: measurable far point (≤ 650 mm) without correction', () => {
    const f = (farPointMm, wearsCorrection) => computeProfile(eyesInput(0, { age: 30, wearsCorrection, focus: { eye: 'both', nearPointMm: 120, farPointMm } }));
    assert.equal(flag(f(650, false), 'DISTANCE_FOCUS_LIMITED').params.cm, 65);
    assert.equal(flag(f(651, false), 'DISTANCE_FOCUS_LIMITED'), undefined);
    assert.equal(flag(f(500, true), 'DISTANCE_FOCUS_LIMITED'), undefined);
  });
  test('R12: no red flag → exam-interval reminder by age; none when a referral flag exists', () => {
    const r = (age) => flag(computeProfile(eyesInput(0, { age })), 'EXAM_REMINDER');
    assert.equal(r(30).params.interval, '5–10');
    assert.equal(r(40).params.interval, '2–4');
    assert.equal(r(55).params.interval, '1–3');
    assert.equal(r(65).params.interval, '1–2');
    assert.equal(flag(computeProfile(eyesInput(0)), 'EXAM_REMINDER').params, undefined);
    assert.equal(flag(computeProfile(eyesInput(0.6, { age: 30 })), 'EXAM_REMINDER'), undefined);
  });
  test('flags are ordered urgent → recommend → info and carry a timeframe', () => {
    const p = computeProfile(PERSONAS.lowVision());
    const order = { urgent: 0, recommend: 1, info: 2 };
    for (let i = 1; i < p.flags.length; i++) assert.ok(order[p.flags[i - 1].level] <= order[p.flags[i].level]);
    for (const f of p.flags) if (f.level !== 'info') assert.ok(['routine', 'soon'].includes(f.params.timeframe));
  });
});

describe('detailScore (item 60 anchors)', () => {
  test('anchors', () => {
    const anchors = [[-0.2, 100], [0.0, 83], [0.1, 75], [0.2, 67], [0.3, 58], [0.5, 42], [0.7, 25], [1.0, 0], [-0.5, 100], [1.4, 0]];
    for (const [L, s] of anchors) assert.equal(detailScore(L), s, `L=${L}`);
    assert.equal(detailScore(NaN), null);
    assert.equal(detailScore(undefined), null);
  });
  test('the L > 0.30 red-flag cut-off corresponds to a score below 58', () => {
    assert.ok(detailScore(0.32) < 58);
  });
});

describe('personas (sanity of the whole pipeline)', () => {
  test('demo-profile input', () => {
    const p = computeProfile(demoProfile().input);
    assert.ok(p.text.baseFontPx > 30 && p.text.baseFontPx < 45);
    assert.equal(p.system.boldText, true);
    assert.deepEqual(p.system.colorFilter, { type: 'deutan', intensity: 0.6 });
    assert.ok(codes(p).includes('NEAR_ACUITY_REDUCED'));
  });
  test('young normal: platform defaults, no filters, only the exam reminder', () => {
    const p = computeProfile(PERSONAS.youngNormal());
    assert.equal(p.text.baseFontPx, 16);
    assert.equal(p.text.fontWeight, 400);
    assert.equal(p.media.sharpenAmount, 0);
    assert.equal(p.media.zoom, 1);
    assert.ok(isIdentityMatrix(p.media.colorMatrix));
    assert.deepEqual(codes(p), ['EXAM_REMINDER']);
  });
  test('low vision: large text, magnification shortcut, urgent acuity flags', () => {
    const p = computeProfile(PERSONAS.lowVision());
    assert.ok(p.text.baseFontPx >= 55);
    assert.equal(p.system.magnificationShortcut, true);
    assert.equal(p.text.fontWeight, 700);
    assert.equal(flag(p, 'LOW_ACUITY_RIGHT').level, 'urgent');
    assert.equal(p.system.darkMode, true);
  });
});
