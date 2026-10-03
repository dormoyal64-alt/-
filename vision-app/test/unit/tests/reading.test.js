import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fontPxForPrintSize, printSizeForFontPx, printSizeSequence, largestFittingPrintSize, smallestRenderablePrintSize,
  standardWords, wordsPerMinute, fitReadingCurve, analyseReading, shouldStopReading, xHeightMm,
  corroboratedPoints, READING_PARAMS,
} from '../../../public/app/js/tests/reading/reading-math.js';
import { SENTENCES, splitIntoLines, containsWord } from '../../../public/app/js/tests/reading/sentences.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('print size → CSS font size matches the §4.3 worked example', () => {
  // iPhone 15: 0.1657 mm per CSS px, SF x/em 0.508, d = 350 mm; θx = 20′ ⇔ p = log10(20/5)
  const cssPxPerMm = 1 / 0.1657;
  close(xHeightMm(Math.log10(4), 350), 2.03, 0.01, 'x-height');
  close(fontPxForPrintSize(Math.log10(4), 350, cssPxPerMm, 0.508), 24.1, 0.15, 'font px');
  close(fontPxForPrintSize(Math.log10(31.6 / 5), 350, cssPxPerMm, 0.508), 38.2, 0.2);
  for (const p of [-0.3, 0.1, 0.8]) close(printSizeForFontPx(fontPxForPrintSize(p, 400, 6.2, 0.52), 400, 6.2, 0.52), p, 1e-9);
});

test('print-size sequence and range limits', () => {
  assert.deepEqual(printSizeSequence(0.7, 0.3), [0.7, 0.6, 0.5, 0.4, 0.3]);
  assert.equal(printSizeSequence(1.3, -0.5).length, 19);
  // widest line 11 em in 356 CSS px at 400 mm, 6.2 px/mm, xr 0.52 → font ≤ 32.4 px
  const p = largestFittingPrintSize({ widestLineEm: 11, availableCssPx: 356, dMm: 400, cssPxPerMm: 6.2, xRatio: 0.52 });
  assert.ok(fontPxForPrintSize(p, 400, 6.2, 0.52) <= 356 / 11 + 1e-9);
  assert.ok(fontPxForPrintSize(p + 0.1, 400, 6.2, 0.52) > 356 / 11);
  assert.equal(largestFittingPrintSize({ widestLineEm: 1, availableCssPx: 5000, dMm: 400, cssPxPerMm: 6.2, xRatio: 0.52 }), 1.3);
  const floor = smallestRenderablePrintSize({ dMm: 400, cssPxPerMm: 6.2, dpr: 2.625 });
  const xDev = (p) => xHeightMm(p, 400) * 6.2 * 2.625;
  assert.ok(floor >= -0.5 && xDev(floor) >= 3 && (floor === -0.5 || xDev(floor - 0.1) < 3), `floor ${floor}`);
  assert.equal(smallestRenderablePrintSize({ dMm: 400, cssPxPerMm: 12, dpr: 3 }), -0.5);
  const coarse = smallestRenderablePrintSize({ dMm: 300, cssPxPerMm: 3.8, dpr: 2 });
  assert.ok(coarse > -0.5 && coarse < 0.2, `coarse screen floor ${coarse}`);
});

test('reading speed: 60 characters = 10 standard words; wpm = 60 × words / s', () => {
  assert.equal(standardWords('x'.repeat(60)), 10);
  assert.equal(wordsPerMinute(10, 3000), 200);
  assert.equal(wordsPerMinute(10, 0), 0);
});

/** Synthetic MNREAD-like data from the model itself. */
function synth({ mrs, p0, tau, sizes, noise = 0 }) {
  let k = 1;
  return sizes.map((p) => {
    const rs = p > p0 ? mrs * (1 - Math.exp(-(p - p0) / tau)) : 0;
    k = -k;
    const wpm = Math.max(0, rs * (1 + k * noise));
    return { p, wpm, passed: wpm > 15 };
  });
}

test('curve fit recovers MRS and CPS = p0 + τ·ln5 (80 % of MRS)', () => {
  const pts = synth({ mrs: 200, p0: -0.2, tau: 0.12, sizes: printSizeSequence(0.8, -0.2) });
  const fit = fitReadingCurve(pts);
  assert.ok(fit);
  close(fit.mrs, 200, 3);
  close(fit.cps, -0.2 + 0.12 * Math.log(5), 0.02);
  const a = analyseReading(pts);
  assert.equal(a.method, 'fit');
  close(a.cps, -0.2 + 0.12 * Math.log(5), 0.02);
  close(a.readingAcuity, -0.1, 1e-9);
  assert.equal(a.reliable, true);
  // noisy data still lands near the truth
  const noisy = analyseReading(synth({ mrs: 180, p0: 0.1, tau: 0.15, sizes: printSizeSequence(1.0, 0.0), noise: 0.06 }));
  close(noisy.cps, 0.1 + 0.15 * Math.log(5), 0.08);
  close(noisy.mrs, 180, 20);
});

test('fallback CPS rule when fewer than 4 sizes were read', () => {
  const pts = [
    { p: 0.5, wpm: 150, passed: true }, { p: 0.4, wpm: 160, passed: true }, { p: 0.3, wpm: 110, passed: true },
    { p: 0.2, wpm: 0, passed: false }, { p: 0.1, wpm: 0, passed: false },
  ];
  const a = analyseReading(pts);
  assert.equal(a.method, 'fallback');
  // mean of 3 fastest = 140; 80 % = 112 → smallest size with speed ≥ 112 is 0.4
  assert.equal(a.cps, 0.4);
  close(a.mrs, 140, 1e-9);
  assert.equal(a.readingAcuity, 0.3);
  assert.equal(analyseReading([{ p: 0.5, wpm: 0, passed: false }]).reliable, false);
});

test('reliability: implausibly fast tapping and inconsistent failures', () => {
  const fast = synth({ mrs: 900, p0: -0.3, tau: 0.1, sizes: printSizeSequence(0.6, -0.1) });
  assert.ok(analyseReading(fast).reasons.includes('implausibly-fast'));
  const pts = synth({ mrs: 200, p0: -0.2, tau: 0.12, sizes: printSizeSequence(0.8, -0.1) });
  pts[0].passed = false; pts[1].passed = false;
  assert.ok(analyseReading(pts).reasons.includes('inconsistent'));
});

test('lucky word-check passes below a failed size are not counted (A14: single-run reading size was noisy)', () => {
  // Reads down to 0.4; fails 0.3; a lucky guess "passes" 0.2 (slowly); fails 0.1 and 0.0 -> stop.
  const pts = [
    { p: 0.8, wpm: 190, passed: true }, { p: 0.7, wpm: 188, passed: true }, { p: 0.6, wpm: 180, passed: true },
    { p: 0.5, wpm: 150, passed: true }, { p: 0.4, wpm: 90, passed: true }, { p: 0.3, wpm: 0, passed: false },
    { p: 0.2, wpm: 50, passed: true }, { p: 0.1, wpm: 0, passed: false }, { p: 0.0, wpm: 0, passed: false },
  ];
  const a = analyseReading(pts);
  assert.equal(a.readingAcuity, 0.4, 'reading acuity is the smallest corroborated size, not the lucky 0.2');
  assert.ok(a.cps !== null && a.cps >= 0.4, `cps ${a.cps}`);
  // a pass directly after a failure is cleared; the next pass (corroborated by it) counts again
  const c = corroboratedPoints([
    { p: 1.0, wpm: 0, passed: false }, { p: 0.9, wpm: 120, passed: true }, { p: 0.8, wpm: 150, passed: true },
  ]);
  assert.deepEqual(c.map((q) => q.passed), [false, false, true]);
  assert.equal(c[1].wpm, 0);
  // order does not matter; the largest tested size stands on its own
  const shuffledPts = [pts[6], pts[0], pts[5], pts[4]];
  assert.deepEqual(corroboratedPoints(shuffledPts).map((q) => q.passed), [false, true, false, true]);
  // single largest size read
  assert.equal(analyseReading([{ p: 0.6, wpm: 100, passed: true }, { p: 0.5, wpm: 0, passed: false }]).readingAcuity, 0.6);
});

test('word check is 3-choice: two distinct foils that are not in the sentence', () => {
  assert.equal(READING_PARAMS.checkChoices, 3);
  for (const lang of ['he', 'en']) {
    for (const s of [SENTENCES[lang].practice, ...SENTENCES[lang].sentences]) {
      assert.equal(new Set([s.word, s.foil, s.foil2]).size, 3, `${lang}: ${s.word}/${s.foil}/${s.foil2}`);
      assert.ok(typeof s.foil2 === 'string' && s.foil2.length > 1);
      assert.ok(!containsWord(s.text, s.foil2), `foil2 "${s.foil2}" not in "${s.text}"`);
      assert.ok(!s.text.includes(s.foil2), `foil2 "${s.foil2}" is not a substring of "${s.text}"`);
    }
  }
});

test('stopping rule: > 20 s, 2 consecutive failures, or smallest size', () => {
  assert.equal(shouldStopReading([{ passed: true, timeMs: 5000 }], false), false);
  assert.equal(shouldStopReading([{ passed: true, timeMs: 20001 }], false), true);
  assert.equal(shouldStopReading([{ passed: false, timeMs: 0 }], false), false);
  assert.equal(shouldStopReading([{ passed: true, timeMs: 3000 }, { passed: false, timeMs: 0 }, { passed: false, timeMs: 0 }], false), true);
  assert.equal(shouldStopReading([{ passed: false, timeMs: 0 }, { passed: true, timeMs: 9000 }], false), false);
  assert.equal(shouldStopReading([{ passed: true, timeMs: 3000 }], true), true);
});

test('sentence sets: original, parallel, ~60 characters, valid word checks, 3 balanced lines', () => {
  for (const lang of ['he', 'en']) {
    const all = [SENTENCES[lang].practice, ...SENTENCES[lang].sentences];
    assert.equal(SENTENCES[lang].sentences.length, 20);
    for (const s of all) {
      assert.ok(s.text.length >= 57 && s.text.length <= 63, `${lang} length ${s.text.length}: ${s.text}`);
      assert.ok(!/[0-9.,!?;:"]/.test(s.text), `no digits/punctuation: ${s.text}`);
      assert.ok(containsWord(s.text, s.word), `word "${s.word}" in "${s.text}"`);
      assert.ok(!containsWord(s.text, s.foil), `foil "${s.foil}" not in "${s.text}"`);
      const lines = splitIntoLines(s.text);
      assert.equal(lines.length, 3);
      assert.equal(lines.join(' '), s.text);
      assert.ok(Math.max(...lines.map((l) => l.length)) <= 25, `balanced lines: ${lines.join(' | ')}`);
    }
    const mean = all.reduce((a, s) => a + s.text.length, 0) / all.length;
    close(mean, 60, 1.5, `${lang} mean length`);
  }
  const heMean = SENTENCES.he.sentences.reduce((a, s) => a + s.text.length, 0) / 20;
  const enMean = SENTENCES.en.sentences.reduce((a, s) => a + s.text.length, 0) / 20;
  close(heMean, enMean, 1.5, 'Hebrew and English sets of equal length');
});
