import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIrisDistanceEstimator } from '../../../public/app/js/calibration/distance-tracker.js';
import { createDistanceTracker } from '../../../public/app/js/calibration/distance-tracker.js';

const F = 560; // 640-px normalised focal length
/** Frame where both irises (centred) show the size of a user at `mm` on a 1280×720 stream. */
const frame = (t, mm, extra = {}) => {
  const irisPx640 = (11.71 * F) / mm;
  const irisPx = (irisPx640 * 1280) / 640;
  const m = { diameterPx: irisPx, centerXPx: 640, centerYPx: 360, offCenterPx: 0 };
  return { t, face: true, width: 1280, height: 720, longSidePx: 1280, right: m, left: m, pose: { yawDeg: 0, pitchDeg: 0 }, ...extra };
};

test('estimator: exact distance on the first frame, then 0.9/0.1 smoothing per 1/30 s', () => {
  const est = createIrisDistanceEstimator(F);
  assert.ok(Math.abs(est.update(frame(0, 400)) - 400) < 1e-9);
  const v = est.update(frame(1000 / 30, 500));
  assert.ok(Math.abs(v - 410) < 1e-9, String(v));
});

test('estimator: rejects non-frontal frames and missing irises; null after 700 ms without a usable frame', () => {
  const est = createIrisDistanceEstimator(F);
  est.update(frame(0, 350));
  assert.ok(Math.abs(est.update(frame(100, 700, { pose: { yawDeg: 30, pitchDeg: 0 } })) - 350) < 1e-9);
  assert.ok(Math.abs(est.update(frame(200, 700, { left: null })) - 350) < 1e-9);
  assert.ok(Math.abs(est.update(frame(300, 700, { face: false })) - 350) < 1e-9);
  assert.equal(est.update(frame(800, 700, { face: false })), null);
  assert.equal(est.current(), null);
  // restarts without smoothing from the stale value
  assert.ok(Math.abs(est.update(frame(900, 300)) - 300) < 1e-9);
});

test('createDistanceTracker resolves null (never throws) without a focal calibration or camera', async () => {
  assert.equal(await createDistanceTracker({ distance: { distanceMm: 400, method: 'manual', measuredAt: '' } }), null);
  assert.equal(await createDistanceTracker(/** @type {any} */ (undefined)), null);
  // Node has no navigator.mediaDevices
  assert.equal(await createDistanceTracker({ distance: { distanceMm: 400, method: 'blindspot', focalLengthPx: 560, measuredAt: '' } }), null);
});
