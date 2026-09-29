// @ts-check
/**
 * Live eye-to-screen distance from the front camera (spec §2.2): MediaPipe iris landmarks, per-eye
 * depth = IRIS_MM·sqrt(f² + r²)/iris_px with the user's calibrated focal length (640-px normalised), frames with
 * |yaw|,|pitch| ≤ 20° and both irises only, per-eye exponential smoothing, mean of the two eyes.
 * Resolves to null (never throws) without focal calibration, camera, permission or model.
 */
import {
  distanceFromIris, normalisePx, smoothDistance, isFrontalPose, isPlausibleFocalLength,
} from './calibration-math.js';
import { startFaceEngine, cameraSupported } from './face-iris.js';

/** @typedef {import('../core/types.js').DistanceTracker} DistanceTracker */
/** @typedef {import('../core/types.js').ScreenCalibration} ScreenCalibration */
/** @typedef {import('../core/types.js').DistanceCalibration} DistanceCalibration */
/** @typedef {import('./face-iris.js').FaceFrame} FaceFrame */

/** After this long without a usable frame, current() becomes null and smoothing restarts. */
const LOST_AFTER_MS = 700;
/** Per-frame distances outside this window are treated as landmark glitches. */
const FRAME_MIN_MM = 50;
const FRAME_MAX_MM = 2000;

/**
 * Pure per-frame state machine (exported for tests and for views that already run a FaceEngine).
 * @param {number} focalLengthPx  640-px normalised
 */
export function createIrisDistanceEstimator(focalLengthPx) {
  /** @type {number|null} */ let right = null;
  /** @type {number|null} */ let left = null;
  let lastT = -Infinity;
  let lastUsable = -Infinity;
  /** @type {number|null} */ let value = null;
  return {
    /** @param {FaceFrame} frame @returns {number|null} current smoothed distance (mm) */
    update(frame) {
      let usable = false;
      if (frame.face && frame.right && frame.left && isFrontalPose(frame.pose)) {
        const depth = (/** @type {import('./face-iris.js').IrisMeasurement} */ m) => distanceFromIris({
          irisDiameterPx: normalisePx(m.diameterPx, frame.longSidePx),
          focalLengthPx,
          offCenterPx: normalisePx(m.offCenterPx, frame.longSidePx),
        });
        const dR = depth(frame.right);
        const dL = depth(frame.left);
        if ([dR, dL].every((d) => d >= FRAME_MIN_MM && d <= FRAME_MAX_MM)) {
          const dt = Number.isFinite(lastT) ? frame.t - lastT : undefined;
          right = smoothDistance(right, dR, dt);
          left = smoothDistance(left, dL, dt);
          value = (right + left) / 2;
          lastT = frame.t;
          lastUsable = frame.t;
          usable = true;
        }
      }
      if (!usable && frame.t - lastUsable > LOST_AFTER_MS) {
        right = null; left = null; value = null; lastT = -Infinity;
      }
      return value;
    },
    current: () => value,
  };
}

/**
 * @param {{screen?: ScreenCalibration, distance?: DistanceCalibration}} opts
 * @returns {Promise<DistanceTracker|null>}
 */
export async function createDistanceTracker(opts) {
  try {
    const f = opts?.distance?.focalLengthPx;
    if (!isPlausibleFocalLength(f) || !cameraSupported()) return null;
    const engine = await startFaceEngine({ fps: 12 });
    if (!engine) return null;
    const estimator = createIrisDistanceEstimator(/** @type {number} */ (f));
    /** @type {Set<(mm: number|null) => void>} */
    const subscribers = new Set();
    let stopped = false;
    engine.onFrame((frame) => {
      const mm = estimator.update(frame);
      const rounded = mm === null ? null : Math.round(mm);
      for (const cb of [...subscribers]) {
        try { cb(rounded); } catch (err) { console.error(err); }
      }
    });
    return {
      current: () => {
        const v = estimator.current();
        return stopped || v === null ? null : Math.round(v);
      },
      subscribe(cb) {
        subscribers.add(cb);
        return () => { subscribers.delete(cb); };
      },
      stop() {
        if (stopped) return;
        stopped = true;
        subscribers.clear();
        engine.stop();
      },
    };
  } catch (err) {
    console.warn('[calibration] distance tracker unavailable', err);
    return null;
  }
}
