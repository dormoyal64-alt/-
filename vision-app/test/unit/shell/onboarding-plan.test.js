import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN, newDraft, isValidDraft, nextPhase, completedSteps, hasProgress, resumeDecision, completeIntro, setBasics, setRx,
  recordResult, recordSkip, isGroupStart, fallbackScreen, fallbackDistance, buildProfileInput, DRAFT_STALE_MS,
} from '../../../public/app/js/flows/onboarding-plan.js';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const basics = { name: 'Me', age: 58, wearsCorrection: true, hasRx: false };
const screenCal = { cssPxPerMm: 6.3, dpr: 3, method: 'card', screenWidthCssPx: 393, screenHeightCssPx: 852, measuredAt: 'x' };

function throughForms(d) {
  return setBasics(completeIntro(d, NOW), basics, NOW);
}

test('plan order follows the contract, without the Amsler grid', () => {
  assert.deepEqual(PLAN.map((s) => s.fn), [
    'runScreenCalibration', 'runDistanceCalibration', 'runAcuityTest', 'runAcuityTest', 'runReadingTest', 'runContrastTest',
    'runColorTest', 'runAstigmatismTest', 'runAstigmatismTest', 'runFocusRangeTest',
  ]);
  assert.deepEqual(PLAN.filter((s) => s.eye).map((s) => s.eye), ['right', 'left', 'both', 'both', 'both', 'right', 'left', 'both']);
  assert.ok(!PLAN.some((s) => /amsler/i.test(s.id)));
  assert.deepEqual(PLAN.filter((s) => s.optional).map((s) => s.id), ['focus']);
});

test('phases: intro -> basics -> (rx) -> steps -> compute', () => {
  let d = newDraft({ mode: 'new', profileId: 'p1' }, NOW);
  assert.equal(isValidDraft(d), true);
  assert.deepEqual(nextPhase(d), { kind: 'intro' });
  d = completeIntro(d, NOW);
  assert.deepEqual(nextPhase(d), { kind: 'basics' });
  d = setBasics(d, { ...basics, hasRx: true }, NOW);
  assert.deepEqual(nextPhase(d), { kind: 'rx' });
  d = setRx(d, {}, NOW);
  assert.equal(nextPhase(d).kind, 'step');
  assert.equal(nextPhase(d).step.id, 'screen');
  for (const [i, s] of PLAN.entries()) {
    const ph = nextPhase(d);
    assert.equal(ph.kind, 'step');
    assert.equal(ph.index, i);
    d = s.optional ? recordSkip(d, s.id, NOW) : recordResult(d, s.id, { ok: s.id }, NOW);
  }
  assert.deepEqual(nextPhase(d), { kind: 'compute' });
  assert.equal(completedSteps(d), PLAN.length);
});

test('resume continues at the first unfinished step', () => {
  let d = throughForms(newDraft({ mode: 'new', profileId: 'p1' }, NOW));
  d = recordResult(d, 'screen', screenCal, NOW);
  d = recordResult(d, 'distance', { distanceMm: 400, method: 'blindspot', measuredAt: 'x' }, NOW);
  const restored = JSON.parse(JSON.stringify(d));
  assert.equal(nextPhase(restored).step.id, 'acuity-right');
  assert.equal(completedSteps(restored), 2);
  assert.equal(hasProgress(restored), true);
  assert.equal(hasProgress(newDraft({ mode: 'new', profileId: 'x' }, NOW)), false);
});

test('resumeDecision', () => {
  const d = throughForms(newDraft({ mode: 'retest', profileId: 'p1' }, NOW));
  assert.equal(resumeDecision(null, { mode: null, profileId: null }, NOW), 'fresh');
  assert.equal(resumeDecision(newDraft({ mode: 'new', profileId: 'x' }, NOW), { mode: 'new', profileId: null }, NOW), 'fresh');
  assert.equal(resumeDecision(d, { mode: null, profileId: null }, NOW), 'resume');
  assert.equal(resumeDecision(d, { mode: 'retest', profileId: 'p1' }, NOW), 'resume');
  assert.equal(resumeDecision(d, { mode: 'retest', profileId: 'p2' }, NOW), 'ask');
  assert.equal(resumeDecision(d, { mode: 'new', profileId: null }, NOW), 'ask');
  assert.equal(resumeDecision(d, { mode: null, profileId: null }, NOW + DRAFT_STALE_MS + 1), 'ask');
  assert.equal(resumeDecision({ v: 2 }, { mode: null, profileId: null }, NOW), 'fresh');
});

test('skips, groups, fallbacks', () => {
  let d = throughForms(newDraft({ mode: 'new', profileId: 'p1' }, NOW));
  const focus = PLAN.find((s) => s.id === 'focus');
  assert.equal(isGroupStart(d, focus), true);
  assert.equal(isGroupStart(d, PLAN[0]), false);
  d = recordSkip(d, 'color', NOW);
  assert.ok(d.skipped.includes('color'));
  d = recordResult(d, 'color', { type: 'normal' }, NOW);
  assert.ok(!d.skipped.includes('color'), 'a later result replaces a skip');
  d = recordResult(d, 'screen', fallbackScreen({ cssPxPerMm: 3.78, dpr: 2, screenWidthCssPx: 400, screenHeightCssPx: 800 }, NOW), NOW, { fallback: true });
  assert.deepEqual(d.fallbacks, ['screen']);
  assert.equal(d.results.screen.method, 'default');
  assert.equal(fallbackDistance(NOW).distanceMm, 400);
});

test('buildProfileInput maps results onto ProfileInput', () => {
  let d = setRx(setBasics(completeIntro(newDraft({ mode: 'new', profileId: 'p1' }, NOW), NOW), { ...basics, hasRx: true }, NOW), { right: { sph: -1 } }, NOW);
  const acR = { eye: 'right', logMAR: 0.2 };
  d = recordResult(d, 'screen', screenCal, NOW);
  d = recordResult(d, 'acuity-right', acR, NOW);
  d = recordResult(d, 'astig-left', { eye: 'left', suspected: true, axisDeg: 90 }, NOW);
  d = recordResult(d, 'contrast', { eye: 'both', logCS: 1.5, reliable: true }, NOW);
  d = recordSkip(d, 'focus', NOW);
  const input = buildProfileInput(d, { theme: 'auto', now: NOW, screenFallback: fallbackScreen({ cssPxPerMm: 1, dpr: 1, screenWidthCssPx: 1, screenHeightCssPx: 1 }, NOW) });
  assert.equal(input.screen, screenCal);
  assert.equal(input.distance.method, 'manual');
  assert.deepEqual(input.acuity, { right: acR });
  assert.equal(input.age, 58);
  assert.equal(input.wearsCorrection, true);
  assert.deepEqual(input.rx, { right: { sph: -1 } });
  assert.deepEqual(Object.keys(input.astigmatism), ['left']);
  assert.equal(input.contrast.logCS, 1.5);
  assert.equal('focus' in input, false);
  assert.equal('amsler' in input, false);
  assert.deepEqual(input.prefs, { theme: 'auto' });
});
