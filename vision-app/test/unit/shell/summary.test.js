import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detailScore, detailBand, contrastBand, colorFinding, textScalePercent, eyeSummaries, sortFlags, glassesFreeInfo, recommendedDistanceMm, coachState,
} from '../../../public/app/js/screens/summary.js';
import { describeFlag } from '../../../public/app/js/screens/flag-messages.js';
import { passwordStrength, looksLikeEmail } from '../../../public/app/js/account/password.js';
import { guideProgress } from '../../../public/app/js/screens/guide-progress.js';
import { formatMinor, fromMinor } from '../../../public/app/js/shell/format.js';
import { demoProfile } from '../../../public/app/js/core/demo-profile.js';

test('functional detail score and bands', () => {
  assert.equal(detailScore(-0.2), 100);
  assert.equal(detailScore(1.0), 0);
  assert.equal(detailScore(2), 0);
  assert.equal(detailScore(0), 83);
  assert.equal(detailScore(0.3), 58);
  assert.equal(detailScore(undefined), null);
  assert.equal(detailBand(83), 'excellent');
  assert.equal(detailBand(58), 'good');
  assert.equal(detailBand(57), 'fair');
  assert.equal(detailBand(10), 'low');
  assert.equal(contrastBand(1.8), 'good');
  assert.equal(contrastBand(1.5), 'reduced');
  assert.equal(contrastBand(1.0), 'low');
  assert.deepEqual(colorFinding({ type: 'deutan', severity: 0.6, confidence: 1, reliable: true }), { key: 'redGreen', degree: 'moderate' });
  assert.deepEqual(colorFinding({ type: 'normal', severity: 0, confidence: 1, reliable: true }), { key: 'none', degree: null });
  assert.deepEqual(colorFinding({ type: 'tritan', severity: 0.9, confidence: 1, reliable: true }), { key: 'blueYellow', degree: 'marked' });
  assert.equal(textScalePercent(1.5), 150);
  assert.equal(textScalePercent(0), null);
});

test('eye summaries from a profile', () => {
  const p = demoProfile();
  const [r, l] = eyeSummaries(p);
  assert.equal(r.eye, 'right');
  assert.equal(r.score, detailScore(0.4));
  assert.equal(l.measured, true);
  assert.equal(r.lines, null);
});

test('flag messages: plain language, eye suffix, level fallback, no clinical terms', () => {
  const f = describeFlag({ level: 'recommend', code: 'LOW_ACUITY_RIGHT' }, 'en');
  assert.match(f.text, /right eye/);
  assert.match(f.advice, /optometrist or ophthalmologist/);
  const he = describeFlag({ level: 'urgent', code: 'SOMETHING_NEW' }, 'he');
  assert.equal(he.known, false);
  assert.ok(he.advice.length > 10);
  assert.equal(describeFlag({ level: 'info', code: 'UNRELIABLE' }, 'en').advice, null);
  for (const code of ['LOW_ACUITY_LEFT', 'ASTIGMATISM_SUSPECTED_RIGHT', 'COLOR_DEFICIENCY', 'NEAR_ACUITY_REDUCED']) {
    const txt = describeFlag({ level: 'recommend', code }, 'en').text;
    assert.doesNotMatch(txt, /astigmat|deutan|protan|presbyop|myop|logMAR|snellen/i);
  }
  assert.deepEqual(sortFlags([{ level: 'info', code: 'a' }, { level: 'urgent', code: 'b' }, { level: 'recommend', code: 'c' }]).map((x) => x.code), ['b', 'c', 'a']);
});

test('password strength hint and email check', () => {
  assert.equal(passwordStrength('').key, 'empty');
  assert.equal(passwordStrength('short').key, 'tooShort');
  assert.equal(passwordStrength('password').key, 'weak');
  assert.equal(passwordStrength('abcdefgh').key, 'weak');
  assert.equal(passwordStrength('abcdefg1').key, 'fair');
  assert.equal(passwordStrength('Correct-Horse-9').score >= 3, true);
  assert.equal(looksLikeEmail('a@b.co'), true);
  assert.equal(looksLikeEmail('a@b'), false);
});

test('guide progress counts recommended sections; money in minor units', () => {
  const s = [{ id: 'a', recommended: true }, { id: 'b', recommended: true }, { id: 'c', recommended: false }];
  assert.deepEqual(guideProgress(s, new Set(['a', 'c'])), { done: 1, total: 2, percent: 50 });
  assert.deepEqual(guideProgress([], new Set()), { done: 0, total: 0, percent: 0 });
  assert.equal(fromMinor(2490, 'ILS'), 24.9);
  assert.match(formatMinor(17990, 'ILS', 'en'), /179\.90/);
  assert.match(formatMinor(2400, 'ILS', 'he'), /24/);
});

test('glassesFreeInfo: engine assessment first, honest fallback otherwise', () => {
  const base = { id: 'p', viewing: { recommendedDistanceMm: 360 }, input: { wearsCorrection: false, focus: { eye: 'both', nearPointMm: 150, farPointMm: null } } };
  const fb = glassesFreeInfo(/** @type {any} */ (base));
  assert.equal(fb.verdict, null);
  assert.equal(fb.distanceMm, 360);
  assert.equal(fb.sharpFromMm, 150);
  assert.equal(fb.sharpToMm, null);
  assert.equal(fb.sharpToBeyond, true);
  const gf = { feasible: 'partial', recommendedDistanceMm: 300, sharpFromMm: 120, sharpToMm: 330, charsPerLine: 24, reasons: [] };
  const withEngine = glassesFreeInfo(/** @type {any} */ ({ ...base, glassesFree: gf }));
  assert.equal(withEngine.verdict, 'partial');
  assert.equal(withEngine.distanceMm, 300);
  assert.equal(withEngine.sharpToMm, 330);
  assert.equal(withEngine.sharpToBeyond, false);
  assert.equal(glassesFreeInfo(/** @type {any} */ ({ ...base, input: { wearsCorrection: true } })), null);
  assert.equal(glassesFreeInfo(null), null);
  assert.equal(recommendedDistanceMm(/** @type {any} */ ({ viewing: { recommendedDistanceMm: 400 }, input: { wearsCorrection: true } })), 400);
  assert.equal(recommendedDistanceMm(/** @type {any} */ ({ viewing: { recommendedDistanceMm: null }, input: {} })), null);
});

test('coachState: closer / farther / good with a ±12 % (min 3 cm) band', () => {
  assert.equal(coachState(null, 350), 'noface');
  assert.equal(coachState(350, 350), 'good');
  assert.equal(coachState(390, 350), 'good');
  assert.equal(coachState(400, 350), 'closer');
  assert.equal(coachState(300, 350), 'farther');
  assert.equal(coachState(180, 200), 'good');
  assert.equal(coachState(160, 200), 'farther');
});
