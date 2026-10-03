import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProfile, deriveMetrics, fontPxForAngle, targetXHeightArcmin, charsPerLine, XR_LATIN, XR_HEBREW,
  gfLogMARForBlur, gfBlurForLogMAR, gfPupilMm, MIN_DISTANCE_CHILD_MM,
} from '../../../public/app/js/engine/profile.js';
import { describeGlassesFree, GLASSES_FREE_REASONS } from '../../../public/app/js/engine/summary.js';
import { baseInput, acuity, allNumbers, allStrings, IPHONE15_MM_PER_CSS } from './fixtures.js';

/** Tests done WITHOUT glasses: both eyes at L (measured at 350 mm) plus a focus range. */
const noGlasses = (L, { age = 30, near = 150, far = null, over = {} } = {}) => baseInput({
  age, wearsCorrection: false,
  acuity: { right: acuity('right', L), left: acuity('left', L) },
  focus: { eye: 'both', nearPointMm: near, farPointMm: far },
  ...over,
});
const gf = (input) => computeProfile(input).glassesFree;

describe('glasses-free assessment (VisionProfile.glassesFree)', () => {
  test('only present when the tests were done without correction', () => {
    assert.equal(computeProfile({ ...noGlasses(0), wearsCorrection: true }).glassesFree, undefined);
    const { wearsCorrection: _w, ...unknown } = noGlasses(0);
    assert.equal(computeProfile(unknown).glassesFree, undefined);
    assert.ok(gf(noGlasses(0)));
  });

  test('defocus model: monotonic, inverse round-trip, plausible pupil', () => {
    const P = gfPupilMm(30);
    assert.ok(P > 3.3 && P < 4.2, `pupil ${P}`);
    assert.ok(gfPupilMm(70) < gfPupilMm(30));
    let prev = -Infinity;
    for (let u = 0; u <= 8; u += 0.25) { const L = gfLogMARForBlur(u, P, -0.08); assert.ok(L >= prev); prev = L; }
    for (const L of [0.1, 0.3, 0.7, 1.1]) assert.ok(Math.abs(gfLogMARForBlur(gfBlurForLogMAR(L, P, -0.08), P, -0.08) - L) < 1e-9);
    assert.equal(gfBlurForLogMAR(-0.2, P, -0.08), 0);
  });

  test('young eye sharp at every practical distance → yes at the habitual distance, default text', () => {
    const a = gf(noGlasses(-0.06));
    assert.equal(a.feasible, 'yes');
    assert.deepEqual(a.reasons, ['SHARP_RANGE_OK']);
    assert.equal(a.recommendedDistanceMm, 350);
    assert.equal(a.sharpToMm, null); // beyond arm's length
    assert.ok(a.sharpFromMm > 100 && a.sharpFromMm < 300);
    assert.equal(computeProfile(noGlasses(-0.06)).text.baseFontPx, 16);
  });

  test('moderately near-sighted: the distance stays inside the sharp range', () => {
    const p = computeProfile(noGlasses(0.0, { far: 400 }));
    const a = p.glassesFree;
    assert.ok(a.sharpToMm !== null && a.sharpToMm <= 400);
    assert.ok(a.recommendedDistanceMm <= a.sharpToMm && a.recommendedDistanceMm >= 250);
    assert.equal(p.viewing.recommendedDistanceMm, a.recommendedDistanceMm);
    assert.notEqual(a.feasible, 'no');
  });

  test('strongly near-sighted (sharp only closer than 25 cm) → no, never yes', () => {
    const a = gf(noGlasses(0.9, { far: 200, age: 36 }));
    assert.equal(a.feasible, 'no');
    assert.ok(a.reasons.includes('NO_COMFORTABLE_DISTANCE'));
    assert.ok(a.recommendedDistanceMm >= 250);
  });

  test('no focusing range left (60+, blurry at the start of the near sweep) → no', () => {
    const a = gf(noGlasses(0.75, { age: 62, near: 395 }));
    assert.equal(a.feasible, 'no');
    assert.ok(a.reasons.includes('NO_COMFORTABLE_DISTANCE'));
    // With no focusing left the needed size barely depends on distance: the habitual distance (≥ 30 cm) is kept
    // unless another distance needs > 3 % less enlargement.
    assert.ok(a.recommendedDistanceMm >= 300 && a.recommendedDistanceMm <= 600);
  });

  test('text is sized for the recommended distance with the predicted (not the measured) threshold', () => {
    const input = noGlasses(0.1, { age: 48, near: 260 });
    const m = deriveMetrics(input);
    const a = m.glassesFree;
    assert.ok(a.recommendedDistanceMm > 350, 'farther than the test distance');
    const L = m.glassesFreePlan.predictedLogMAR;
    const fl = fontPxForAngle(targetXHeightArcmin({ logMAR: L, hebrew: false }), a.recommendedDistanceMm, XR_LATIN, IPHONE15_MM_PER_CSS);
    const fh = fontPxForAngle(targetXHeightArcmin({ logMAR: L, hebrew: true }), a.recommendedDistanceMm, XR_HEBREW, IPHONE15_MM_PER_CSS);
    assert.ok(Math.abs(m.fsNeeded / Math.max(16, fl, fh) - 1) < 0.005); // predictedLogMAR is rounded to 0.001
    assert.equal(m.textDistanceMm, a.recommendedDistanceMm);
    assert.equal(a.charsPerLine, charsPerLine(m.fsNeeded, 0));
  });

  test('under 18: always no (CHILD), no glasses-free distance, viewing distance ≥ 33 cm', () => {
    for (const L of [-0.1, 0.3, 0.9]) {
      const p = computeProfile(noGlasses(L, { age: 14, far: L > 0.5 ? 200 : null, over: { distance: { distanceMm: 280, method: 'camera' } } }));
      assert.equal(p.glassesFree.feasible, 'no');
      assert.ok(p.glassesFree.reasons.includes('CHILD'));
      assert.equal(p.glassesFree.recommendedDistanceMm, null);
      assert.ok(p.viewing.recommendedDistanceMm >= MIN_DISTANCE_CHILD_MM);
    }
  });

  test('blur at every distance with a consistent line-dial answer → at most partial', () => {
    const astig = { right: { eye: 'right', suspected: true, axisDeg: 90 }, left: { eye: 'left', suspected: true, axisDeg: 90 } };
    const a = gf(noGlasses(0.3, { far: 205, over: { astigmatism: astig } }));
    assert.notEqual(a.feasible, 'yes');
    assert.ok(a.reasons.includes('HIGH_ASTIGMATISM'));
    assert.ok(a.reasons.includes('FOCUS_INCONSISTENT'), 'a 20 cm far point contradicts the 35 cm threshold');
    const p = computeProfile(noGlasses(0.3, { far: 205, over: { astigmatism: astig } }));
    assert.ok(!p.flags.some((f) => f.code === 'DISTANCE_FOCUS_LIMITED'), 'no misleading far-point flag');
  });

  test('focus range not measured → no distance advice, text from the measurement, at most partial after 40', () => {
    const base = baseInput({ age: 50, wearsCorrection: false, acuity: { right: acuity('right', 0.2), left: acuity('left', 0.2) } });
    const p = computeProfile(base);
    assert.equal(p.glassesFree.recommendedDistanceMm, null);
    assert.equal(p.viewing.recommendedDistanceMm, null);
    assert.ok(p.glassesFree.reasons.includes('FOCUS_NOT_MEASURED'));
    assert.equal(p.glassesFree.feasible, 'partial');
    assert.equal(p.text.baseFontPx, computeProfile({ ...base, wearsCorrection: true }).text.baseFontPx);
    const young = computeProfile(baseInput({ age: 25, wearsCorrection: false, acuity: { right: acuity('right', -0.05) } }));
    assert.equal(young.glassesFree.feasible, 'yes');
    assert.deepEqual(young.glassesFree.reasons, ['SHARP_AT_HABITUAL']);
  });

  test('worse eyes never get smaller text or a better verdict (near-sighted series)', () => {
    const rank = { yes: 0, partial: 1, no: 2 };
    let prev = null;
    for (const [L, far] of [[-0.05, null], [0.0, 500], [0.1, 400], [0.4, 300], [0.6, 250], [0.9, 200], [1.2, 200]]) {
      const p = computeProfile(noGlasses(L, { far }));
      const angle = (p.text.baseFontPx * IPHONE15_MM_PER_CSS) / p.viewing.recommendedDistanceMm;
      if (prev) {
        assert.ok(rank[p.glassesFree.feasible] >= rank[prev.v], `verdict at L ${L}`);
        assert.ok(angle >= 0.9 * prev.angle, `text angle at L ${L}`);
      }
      prev = { v: p.glassesFree.feasible, angle };
    }
  });

  test('every number is finite and every reason code is known', () => {
    const inputs = [noGlasses(0), noGlasses(1.5, { far: 150, near: 150 }), noGlasses(0.5, { age: 90, near: 400 }),
      noGlasses(0.2, { age: undefined }), baseInput({ wearsCorrection: false }), noGlasses(0.3, { near: 100, far: 120 })];
    for (const input of inputs) {
      const p = computeProfile(input);
      for (const [path, v] of allNumbers(p.glassesFree)) assert.ok(Number.isFinite(v), `${path} = ${v}`);
      for (const r of p.glassesFree.reasons) assert.ok(GLASSES_FREE_REASONS.includes(r), r);
      assert.ok(['yes', 'partial', 'no'].includes(p.glassesFree.feasible));
    }
  });
});

describe('engine fixes found by the simulation', () => {
  test('a line-dial result without a `consistent` field is consistent (the view only reports agreed answers)', () => {
    const p = computeProfile(baseInput({ acuity: { right: acuity('right', 0) }, astigmatism: { right: { eye: 'right', suspected: true, axisDeg: 30 } } }));
    assert.ok(p.flags.some((f) => f.code === 'LINES_UNEVEN_RIGHT'));
  });
  test('a critical print size far below the letter acuity is ignored and reported as unreliable', () => {
    const reading = { criticalPrintSizeLogMAR: 0.1, readingAcuityLogMAR: 0.1, maxReadingSpeedWpm: 55, distanceMm: 350, reliable: true };
    const m = deriveMetrics(baseInput({ acuity: { right: acuity('right', 0.54) }, reading }));
    assert.equal(m.cps, null);
    assert.equal(m.sizeSource, 'acuity');
    const p = computeProfile(baseInput({ acuity: { right: acuity('right', 0.54) }, reading }));
    assert.ok(p.flags.find((f) => f.code === 'UNRELIABLE').params.tests.includes('reading'));
  });
  test('a critical print size far above the reading acuity is capped at reading acuity + 0.4', () => {
    const reading = { criticalPrintSizeLogMAR: 0.79, readingAcuityLogMAR: 0.0, maxReadingSpeedWpm: 280, distanceMm: 350, reliable: true };
    assert.equal(deriveMetrics(baseInput({ acuity: { right: acuity('right', -0.02) }, reading })).cps, 0.4);
  });
});

describe('describeGlassesFree (wording)', () => {
  const FORBIDDEN = [/snellen/i, /log ?mar/i, /dioptr|diopter/i, /\bacuity\b/i, /astigmat/i, /myop/i, /hyperop/i, /presbyop/i,
    /diagnos/i, /prescription/i, /glasses-free screen/i, /replaces? (your )?glasses/i, /correct(s|ed)? (your )?(vision|eyesight)/i,
    /protect/i, /improv/i, /treat/i, /אסטיגמט/, /קוצר ראייה/, /רוחק ראייה/, /פרסביופ/, /חדות ראייה/, /אבחנה|אבחון/, /דיופטר/, /מרשם/];
  const assessments = [];
  for (const feasible of ['yes', 'partial', 'no']) {
    for (const reasons of [['SHARP_RANGE_OK'], ['SHARP_AT_HABITUAL'], ['NO_COMFORTABLE_DISTANCE', 'TEXT_TOO_LARGE'], GLASSES_FREE_REASONS.filter((r) => r !== 'CHILD'), ['CHILD']]) {
      for (const rec of [null, 340]) assessments.push({ feasible, reasons, recommendedDistanceMm: rec, sharpFromMm: rec ? 200 : null, sharpToMm: rec ? 410 : null, charsPerLine: 20 });
    }
  }
  test('he + en: no clinical terms or promises; titles, bodies and tips present', () => {
    for (const a of assessments) for (const lang of ['he', 'en']) {
      const d = describeGlassesFree(a, lang);
      assert.ok(d.title && d.body && d.tips.length >= 2);
      for (const s of allStrings(d)) {
        for (const re of FORBIDDEN) assert.ok(!re.test(s), `${lang}: ${re} in "${s}"`);
        assert.ok(!/\{\w+\}/.test(s), `unfilled placeholder in "${s}"`);
      }
    }
  });
  test('verdict-specific advice: exam always; glasses recommended unless yes; children never told to go without', () => {
    const d = (a) => describeGlassesFree(a, 'en');
    const yes = d({ feasible: 'yes', reasons: ['SHARP_RANGE_OK'], recommendedDistanceMm: 350, sharpFromMm: 190, sharpToMm: null, charsPerLine: 36 });
    assert.match(yes.title, /35 cm/);
    assert.ok(yes.tips.some((t) => /eye exam|eye-care professional/.test(t)));
    const no = d({ feasible: 'no', reasons: ['NO_COMFORTABLE_DISTANCE'], recommendedDistanceMm: 600, sharpFromMm: null, sharpToMm: null, charsPerLine: 9 });
    assert.ok(no.tips.some((t) => /glasses or lenses is recommended/.test(t)));
    const child = d({ feasible: 'no', reasons: ['CHILD'], recommendedDistanceMm: null, sharpFromMm: null, sharpToMm: null, charsPerLine: 30 });
    assert.match(child.body, /keep wearing them/);
    assert.ok(!/without glasses, hold/i.test(allStrings(child).join(' ')));
    assert.equal(describeGlassesFree(null, 'he'), null);
  });
  test('real profiles: wording for engine output', () => {
    for (const input of [noGlasses(-0.05), noGlasses(0.9, { far: 200 }), noGlasses(0.75, { age: 62, near: 395 })]) {
      const p = computeProfile(input);
      for (const lang of ['he', 'en']) assert.ok(describeGlassesFree(p.glassesFree, lang).body.length > 20);
    }
  });
});
