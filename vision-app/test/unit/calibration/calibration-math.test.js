import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_WIDTH_MM, CARD_HEIGHT_MM, BLIND_SPOT, IRIS_MM, FOCUS,
  cssPxPerMmFromCard, cssPxPerMmFromLength, devicePixelPitchMm, isPlausibleCssPxPerMm, plausibleCssPxPerMmRange,
  evaluateCardMatches, knownDevicePpi, cssPxPerMmFromPpi, crossCheckKnownDevice, defaultCssPxPerMm, isTabletSize,
  distanceFromBlindSpot, offsetMmForAngle, angleDegForOffset, blindSpotSpeedMmPerS, blindSpotTrialSchedule,
  blindSpotLayout, isBlindSpotFeasible, blindSpotStartOffsetMm, blindSpotKeepWindow, evaluateBlindSpotRun,
  blindSpotRunningEstimate, combineBlindSpotEyes, isPlausibleDistanceMm, defaultDistanceMm,
  distanceFromIris, focalLengthFromKnownDistance, normalisePx, isPlausibleFocalLength, irisFromLandmarks,
  headPoseFromMatrix, isFrontalPose, smoothDistance, distanceToStimulus,
  xHeightMmForLogMAR, fontPxForXHeight, nearTargetLogMAR, farTargetLogMAR, combineNearPointRuns,
  combineFarPointRuns, movementSpeedMmPerS, median, sampleSd, coefficientOfVariation,
} from '../../../public/app/js/calibration/calibration-math.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b} (±${eps})`);
const TAN135 = Math.tan((13.5 * Math.PI) / 180);

describe('card calibration', () => {
  test('ID-1 constants', () => {
    assert.equal(CARD_WIDTH_MM, 85.6);
    assert.equal(CARD_HEIGHT_MM, 53.98);
  });

  test('cssPxPerMmFromCard: iPhone 15 card ≈ 517 px ⇒ 0.1657 mm per CSS px', () => {
    // 460 ppi, dpr 3: 1 css px = 3·25.4/460 mm
    const mmPerCss = (3 * 25.4) / 460;
    const cardPx = CARD_WIDTH_MM / mmPerCss;
    close(cardPx, 517.0, 0.5); // spec: ≈ 517 px_css
    close(cssPxPerMmFromCard(cardPx), 1 / mmPerCss, 1e-12);
    close(cssPxPerMmFromCard(856), 10, 1e-12);
  });

  test('cssPxPerMmFromCard rejects invalid input', () => {
    for (const bad of [0, -5, NaN, Infinity, /** @type {any} */ ('500')]) {
      assert.throws(() => cssPxPerMmFromCard(bad), RangeError);
    }
  });

  test('ruler length', () => {
    close(cssPxPerMmFromLength(504, 80), 6.3, 1e-12);
    assert.throws(() => cssPxPerMmFromLength(504, 0), RangeError);
  });

  test('device pixel pitch = mmPerCss / dpr', () => {
    // Pixel 8: 428 ppi, dpr 2.625 → pitch 25.4/428 = 0.05935 mm
    const cssPxPerMm = cssPxPerMmFromPpi(428, 2.625);
    close(devicePixelPitchMm(cssPxPerMm, 2.625), 25.4 / 428, 1e-12);
    close(1 / cssPxPerMm, 0.1558, 5e-5); // spec: 1 px_css = 0.1558 mm
  });

  test('plausibility: pitch between 0.040 and 0.120 mm (≈210–635 ppi)', () => {
    assert.ok(isPlausibleCssPxPerMm(cssPxPerMmFromPpi(460, 3), 3));
    assert.ok(isPlausibleCssPxPerMm(cssPxPerMmFromPpi(264, 2), 2));
    // edges are inclusive
    assert.ok(isPlausibleCssPxPerMm(1 / (0.040 * 2), 2));
    assert.ok(isPlausibleCssPxPerMm(1 / (0.120 * 2), 2));
    // just outside
    assert.ok(!isPlausibleCssPxPerMm(1 / (0.0399 * 2), 2));
    assert.ok(!isPlausibleCssPxPerMm(1 / (0.1201 * 2), 2));
    // a 96 dpi desktop monitor at dpr 1 (pitch 0.2646 mm) is rejected
    assert.ok(!isPlausibleCssPxPerMm(96 / 25.4, 1));
    // garbage
    for (const bad of [0, -1, NaN, Infinity]) assert.ok(!isPlausibleCssPxPerMm(bad, 2));
    assert.ok(!isPlausibleCssPxPerMm(6, 0));
    const r = plausibleCssPxPerMmRange(2.5);
    close(r.min, 1 / 0.3, 1e-12);
    close(r.max, 10, 1e-12);
  });

  test('two matches within 1.5% ⇒ mean', () => {
    const r = evaluateCardMatches([6.0, 6.08]);
    assert.equal(r.status, 'accept');
    close(/** @type {any} */ (r).cssPxPerMm, 6.04, 1e-12);
  });

  test('exactly 1.5% apart is accepted; 1.6% needs a third match', () => {
    // relative difference = |a−b| / mean(a,b)
    const a = 6; const b = a * (1 + 0.015 / (1 - 0.0075)); // (b−a)/((a+b)/2) = 0.015
    close(Math.abs(b - a) / ((a + b) / 2), 0.015, 1e-12);
    assert.equal(evaluateCardMatches([a, b]).status, 'accept');
    assert.equal(evaluateCardMatches([6.0, 6.1]).status, 'repeat');
  });

  test('three matches ⇒ median', () => {
    const r = evaluateCardMatches([6.0, 6.3, 6.05]);
    assert.equal(r.status, 'accept');
    assert.equal(/** @type {any} */ (r).cssPxPerMm, 6.05);
  });

  test('fewer than two valid matches ⇒ repeat', () => {
    assert.equal(evaluateCardMatches([]).status, 'repeat');
    assert.equal(evaluateCardMatches([6]).status, 'repeat');
    assert.equal(evaluateCardMatches([6, NaN]).status, 'repeat');
  });

  test('known device cross-check (> 3% ⇒ warn)', () => {
    assert.equal(knownDevicePpi({ screenWidthCssPx: 393, screenHeightCssPx: 852, dpr: 3, apple: true }), 460);
    assert.equal(knownDevicePpi({ screenWidthCssPx: 852, screenHeightCssPx: 393, dpr: 3, apple: true }), 460);
    assert.equal(knownDevicePpi({ screenWidthCssPx: 393, screenHeightCssPx: 852, dpr: 3, apple: false }), null);
    assert.equal(knownDevicePpi({ screenWidthCssPx: 412, screenHeightCssPx: 915, dpr: 2.625, apple: true }), null);
    const expected = cssPxPerMmFromPpi(460, 3);
    assert.equal(crossCheckKnownDevice(expected * 1.02, expected).warn, false);
    assert.equal(crossCheckKnownDevice(expected * 1.04, expected).warn, true);
    assert.deepEqual(crossCheckKnownDevice(6, null), { relDiff: null, warn: false });
  });

  test('default estimate', () => {
    close(defaultCssPxPerMm({ screenWidthCssPx: 393, screenHeightCssPx: 852, dpr: 3, apple: true, touch: true }), 460 / (25.4 * 3));
    close(defaultCssPxPerMm({ screenWidthCssPx: 412, screenHeightCssPx: 915, dpr: 2.625, apple: false, touch: true }), 160 / 25.4);
    close(defaultCssPxPerMm({ screenWidthCssPx: 1920, screenHeightCssPx: 1080, dpr: 1, apple: false, touch: false }), 96 / 25.4);
    assert.ok(isTabletSize(820, 1180));
    assert.ok(!isTabletSize(412, 915));
  });
});

describe('blind-spot distance', () => {
  test('d = offset_mm / tan(13.5°)', () => {
    // 350 mm ⇒ offset 84.0 mm (spec table: 35 cm → 8.40 cm)
    close(offsetMmForAngle(350, 13.5), 84.03, 0.01);
    close(offsetMmForAngle(300, 13.5), 72.02, 0.01);
    close(offsetMmForAngle(450, 13.5), 108.04, 0.01);
    const cssPxPerMm = 6.3;
    const offsetCssPx = 84.0336 * cssPxPerMm;
    close(distanceFromBlindSpot({ offsetCssPx, cssPxPerMm }), 84.0336 / TAN135, 1e-9);
    const exact = offsetMmForAngle(350, 13.5) * cssPxPerMm;
    close(distanceFromBlindSpot({ offsetCssPx: exact, cssPxPerMm }), 350, 1e-9);
    // sign-agnostic (right-eye runs move the other way)
    close(distanceFromBlindSpot({ offsetCssPx: -exact, cssPxPerMm }), 350, 1e-9);
    // custom angle
    close(distanceFromBlindSpot({ offsetCssPx: 100, cssPxPerMm: 1, angleDeg: 45 }), 100, 1e-9);
    assert.throws(() => distanceFromBlindSpot({ offsetCssPx: 100, cssPxPerMm: 0 }), RangeError);
    assert.throws(() => distanceFromBlindSpot({ offsetCssPx: NaN, cssPxPerMm: 6 }), RangeError);
    close(angleDegForOffset(offsetMmForAngle(420, 13.5), 420), 13.5, 1e-9);
  });

  test('speed 2°/s at the 35 cm guess and 4+4 alternating schedule', () => {
    close(blindSpotSpeedMmPerS(), 350 * Math.tan((2 * Math.PI) / 180), 1e-9);
    close(blindSpotSpeedMmPerS(), 12.22, 0.01);
    const s = blindSpotTrialSchedule();
    assert.equal(s.length, 8);
    assert.deepEqual(s.slice(0, 4), ['disappear', 'reappear', 'disappear', 'reappear']);
    assert.equal(s.filter((x) => x === 'reappear').length, 4);
  });

  test('layout, feasibility (portrait phones must rotate) and start offsets', () => {
    const cssPxPerMm = 6.3;
    // iPhone-15-like: portrait 65 mm wide vs landscape 141 mm
    const portrait = blindSpotLayout({ surfaceWidthCssPx: 65 * cssPxPerMm, cssPxPerMm, eye: 'left' });
    const landscape = blindSpotLayout({ surfaceWidthCssPx: 141 * cssPxPerMm, cssPxPerMm, eye: 'left' });
    assert.ok(!isBlindSpotFeasible(portrait.maxTravelMm));
    assert.ok(isBlindSpotFeasible(landscape.maxTravelMm));
    close(landscape.maxTravelMm, 141 - BLIND_SPOT.fixationMarginMm - BLIND_SPOT.edgeMarginMm, 1e-9);
    assert.equal(landscape.direction, -1);
    close(landscape.fixationXCssPx, (141 - BLIND_SPOT.fixationMarginMm) * cssPxPerMm, 1e-9);
    const right = blindSpotLayout({ surfaceWidthCssPx: 141 * cssPxPerMm, cssPxPerMm, eye: 'right', insetLeftCssPx: 30 });
    assert.equal(right.direction, 1);
    close(right.fixationXCssPx, 30 + BLIND_SPOT.fixationMarginMm * cssPxPerMm, 1e-9);
    // reappear trials start at 16°, clamped to the available travel
    close(blindSpotStartOffsetMm('reappear', 350, 200), 350 * Math.tan((16 * Math.PI) / 180), 1e-9);
    close(blindSpotStartOffsetMm('disappear', 350, 200), 350 * Math.tan((4 * Math.PI) / 180), 1e-9);
    assert.equal(blindSpotStartOffsetMm('reappear', 600, 100), 100);
    const w = blindSpotKeepWindow(400);
    close(w.minMm, 400 * Math.tan((4 * Math.PI) / 180), 1e-9);
    close(w.maxMm, 400 * Math.tan((22 * Math.PI) / 180), 1e-9);
  });

  const trialsAt = (/** @type {number[]} */ dists) => dists.map((d, i) => ({
    type: /** @type {'disappear'|'reappear'} */ (i % 2 ? 'reappear' : 'disappear'), offsetMm: d * TAN135,
  }));

  test('run: consistent trials are kept; result is the median', () => {
    const run = evaluateBlindSpotRun(trialsAt([380, 400, 390, 410, 395, 405, 385, 415]));
    assert.equal(run.ok, true);
    assert.equal(run.kept, 8);
    close(run.distanceMm, 397.5, 1e-9);
    assert.ok(run.cv < 0.1);
  });

  test('run: trials outside 4°–22° of the estimate are discarded (outliers, early taps)', () => {
    // one very early tap (offset ≈ 2° ⇒ d ≈ 58 mm) and one missed trial (null)
    const trials = trialsAt([400, 390, 410, 395, 405, 385]);
    trials.push({ type: 'disappear', offsetMm: 400 * Math.tan((2 * Math.PI) / 180) });
    trials.push({ type: 'reappear', offsetMm: null });
    const run = evaluateBlindSpotRun(trials);
    assert.equal(run.ok, true);
    assert.equal(run.kept, 6);
    assert.equal(run.discarded, 2);
    close(run.distanceMm, 397.5, 1e-9);
    // an offset at 25° of the estimate is also dropped
    const far = trialsAt([400, 400, 400, 400, 400, 400]);
    far.push({ type: 'disappear', offsetMm: 400 * Math.tan((25 * Math.PI) / 180) });
    assert.equal(evaluateBlindSpotRun(far).kept, 6);
    // explicit current estimate
    assert.equal(evaluateBlindSpotRun(trialsAt([400, 400, 400, 400]), { estimateMm: 1500 }).kept, 0);
  });

  test('run: CV > 10% ⇒ rejected as unstable', () => {
    const run = evaluateBlindSpotRun(trialsAt([300, 450, 320, 480, 310, 470, 330, 440]));
    assert.ok(run.cv > 0.1);
    assert.equal(run.ok, false);
    assert.equal(run.reason, 'unstable');
  });

  test('run: too few kept trials / missing a trial type ⇒ rejected', () => {
    assert.equal(evaluateBlindSpotRun(trialsAt([400, 400, 400])).reason, 'too-few');
    const onlyDisappear = [400, 402, 398, 401].map((d) => ({ type: /** @type {const} */ ('disappear'), offsetMm: d * TAN135 }));
    onlyDisappear.push({ type: 'reappear', offsetMm: 400 * TAN135 });
    assert.equal(evaluateBlindSpotRun(onlyDisappear).reason, 'too-few');
    assert.equal(evaluateBlindSpotRun([]).reason, 'too-few');
    assert.equal(evaluateBlindSpotRun([{ type: 'disappear', offsetMm: null }]).ok, false);
  });

  test('eyes: > 12% difference ⇒ repeat; else median of all kept trials', () => {
    const L = evaluateBlindSpotRun(trialsAt([380, 400, 390, 410]));
    const R = evaluateBlindSpotRun(trialsAt([400, 420, 410, 430]));
    const both = combineBlindSpotEyes(L, R);
    assert.equal(both.ok, true);
    close(both.distanceMm, 405, 1e-9);
    const far = evaluateBlindSpotRun(trialsAt([460, 470, 465, 475]));
    const differ = combineBlindSpotEyes(L, far);
    assert.ok(differ.eyeDifference > 0.12);
    assert.equal(differ.reason, 'eyes-differ');
    const bad = evaluateBlindSpotRun(trialsAt([400]));
    assert.equal(combineBlindSpotEyes(L, bad).reason, 'run-rejected');
    const tiny = evaluateBlindSpotRun(trialsAt([100, 101, 99, 100]));
    assert.equal(combineBlindSpotEyes(tiny, tiny).reason, 'implausible');
  });

  test('running estimate ignores implausible distances', () => {
    assert.equal(blindSpotRunningEstimate([], 350), 350);
    close(blindSpotRunningEstimate(trialsAt([420, 20]), 350), 420, 1e-9);
  });

  test('distance plausibility and defaults', () => {
    assert.ok(isPlausibleDistanceMm(350));
    assert.ok(isPlausibleDistanceMm(150));
    assert.ok(isPlausibleDistanceMm(1000));
    assert.ok(!isPlausibleDistanceMm(149));
    assert.ok(!isPlausibleDistanceMm(1001));
    assert.ok(!isPlausibleDistanceMm(NaN));
    assert.equal(defaultDistanceMm(false), 350);
    assert.equal(defaultDistanceMm(true), 400);
  });
});

describe('camera / iris distance', () => {
  test('depth = IRIS_MM · sqrt(f² + r²) / iris_px', () => {
    assert.equal(IRIS_MM, 11.71);
    close(distanceFromIris({ irisDiameterPx: 20, focalLengthPx: 600 }), (11.71 * 600) / 20, 1e-9);
    close(distanceFromIris({ irisDiameterPx: 20, focalLengthPx: 600, offCenterPx: 80 }), (11.71 * Math.sqrt(600 ** 2 + 80 ** 2)) / 20, 1e-9);
    close(distanceFromIris({ irisDiameterPx: 20, focalLengthPx: 600, irisMm: 11.8 }), 354, 1e-9);
    assert.throws(() => distanceFromIris({ irisDiameterPx: 0, focalLengthPx: 600 }), RangeError);
    assert.throws(() => distanceFromIris({ irisDiameterPx: 10, focalLengthPx: -1 }), RangeError);
  });

  test('focal length from a known distance inverts the depth formula (K = D_bs·I0 cancels iris size)', () => {
    close(focalLengthFromKnownDistance({ irisDiameterPx: 20, distanceMm: 351.3 }), (351.3 * 20) / 11.71, 1e-9);
    const f = focalLengthFromKnownDistance({ irisDiameterPx: 18.5, distanceMm: 420, offCenterPx: 60 });
    close(distanceFromIris({ irisDiameterPx: 18.5, focalLengthPx: f, offCenterPx: 60 }), 420, 1e-9);
    // a user with a bigger iris (12.5 mm) calibrated at 400 mm: later distance is still exact
    const trueF = 560;
    const iris = (d) => (12.5 * trueF) / d;
    const fCal = focalLengthFromKnownDistance({ irisDiameterPx: iris(400), distanceMm: 400 });
    close(distanceFromIris({ irisDiameterPx: iris(300), focalLengthPx: fCal }), 300, 1e-9);
    assert.ok(Number.isNaN(focalLengthFromKnownDistance({ irisDiameterPx: 1, distanceMm: 100, offCenterPx: 1000 })));
    assert.throws(() => focalLengthFromKnownDistance({ irisDiameterPx: 10, distanceMm: 0 }), RangeError);
  });

  test('640-px normalisation and focal plausibility', () => {
    close(normalisePx(1000, 1280), 500, 1e-12);
    close(normalisePx(500, 640), 500, 1e-12);
    assert.ok(isPlausibleFocalLength(500));
    assert.ok(!isPlausibleFocalLength(100));
    assert.ok(!isPlausibleFocalLength(5000));
    assert.ok(!isPlausibleFocalLength(NaN));
  });

  test('iris measurement from landmarks', () => {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    // right iris centred at (0.4, 0.5) of a 640×480 frame, horizontal diameter 20 px, vertical 16 px
    lm[468] = { x: 0.4, y: 0.5 };
    lm[469] = { x: 0.4 + 10 / 640, y: 0.5 };
    lm[470] = { x: 0.4, y: 0.5 - 8 / 480 };
    lm[471] = { x: 0.4 - 10 / 640, y: 0.5 };
    lm[472] = { x: 0.4, y: 0.5 + 8 / 480 };
    const m = irisFromLandmarks(lm, 640, 480, 'right');
    assert.ok(m);
    close(m.diameterPx, 18, 1e-9);
    close(m.offCenterPx, 64, 1e-9);
    assert.equal(irisFromLandmarks(lm.slice(0, 470), 640, 480, 'right'), null);
    assert.equal(irisFromLandmarks(lm, 640, 480, 'left'), null); // all left contour points coincide ⇒ 0 diameter
  });

  test('head pose from the facial transformation matrix', () => {
    const rotY = (deg) => {
      const a = (deg * Math.PI) / 180; const c = Math.cos(a); const s = Math.sin(a);
      // column-major 4×4 of a rotation about Y
      return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, -400, 1];
    };
    close(/** @type {any} */ (headPoseFromMatrix(rotY(15))).yawDeg, 15, 1e-9);
    close(/** @type {any} */ (headPoseFromMatrix(rotY(15))).pitchDeg, 0, 1e-9);
    assert.ok(isFrontalPose(headPoseFromMatrix(rotY(15))));
    assert.ok(!isFrontalPose(headPoseFromMatrix(rotY(25))));
    assert.ok(!isFrontalPose({ yawDeg: 0, pitchDeg: -21 }));
    assert.equal(headPoseFromMatrix([1, 2, 3]), null);
    assert.ok(isFrontalPose(null));
  });

  test('smoothing: 0.9·old + 0.1·new per 1/30 s frame', () => {
    assert.equal(smoothDistance(null, 400), 400);
    close(smoothDistance(400, 500), 410, 1e-9);
    close(smoothDistance(400, 500, 1000 / 15), 400 * 0.81 + 500 * 0.19, 1e-9);
    assert.equal(smoothDistance(400, 500, 0), 400);
    close(smoothDistance(NaN, 380), 380, 0);
  });

  test('distance to an off-camera stimulus', () => {
    close(distanceToStimulus(300, 40), 500 * 0 + Math.sqrt(300 ** 2 + 40 ** 2), 1e-9);
  });
});

describe('focus range', () => {
  test('x-height for a logMAR level (5·10^L arcmin)', () => {
    // logMAR 0 at 1 m: 5 arcmin ⇒ 1.4544 mm (1 M)
    close(xHeightMmForLogMAR(1000, 0), 1.4544, 1e-4);
    close(xHeightMmForLogMAR(400, 0.3), 2 * 400 * Math.tan((5 * 10 ** 0.3 * Math.PI) / 10800 / 2), 1e-12);
    close(fontPxForXHeight(1.0, 0.5, 6), 12, 1e-12);
  });

  test('target levels', () => {
    close(nearTargetLogMAR(undefined), 0.3, 1e-12);
    close(nearTargetLogMAR(0), 0.3, 1e-12);
    close(nearTargetLogMAR(0.4), 0.6, 1e-12);
    close(farTargetLogMAR(null), 0.1, 1e-12);
    close(farTargetLogMAR(-0.1), 0, 1e-12);
  });

  test('near point = median of runs, floored at 150 mm', () => {
    assert.deepEqual(combineNearPointRuns([220, 250, 240]), { nearPointMm: 240, floorLimited: false });
    assert.deepEqual(combineNearPointRuns([140, 150, 260]), { nearPointMm: 150, floorLimited: true });
    assert.deepEqual(combineNearPointRuns([]), { nearPointMm: null, floorLimited: false });
    assert.equal(FOCUS.cameraFloorMm, 150);
  });

  test('far point = median of runs; beyond 650 mm ⇒ null', () => {
    assert.equal(combineFarPointRuns([400, 420, 410]), 410);
    assert.equal(combineFarPointRuns([400, null, 420]), 420);
    assert.equal(combineFarPointRuns([null, null, 420]), null);
    assert.equal(combineFarPointRuns([700, 690, 660]), null);
    assert.equal(combineFarPointRuns([]), null);
  });

  test('movement speed over the last 500 ms', () => {
    const h = [{ t: 0, mm: 400 }, { t: 400, mm: 390 }, { t: 800, mm: 370 }, { t: 1000, mm: 360 }];
    close(movementSpeedMmPerS(h), 30 / 0.6, 1e-9);
    assert.equal(movementSpeedMmPerS([{ t: 0, mm: 1 }]), 0);
  });
});

describe('stats helpers', () => {
  test('median / SD / CV', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.ok(Number.isNaN(median([])));
    close(sampleSd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935, 1e-9);
    close(coefficientOfVariation([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935 / 5, 1e-9);
  });
});
