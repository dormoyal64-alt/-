// @ts-check
/**
 * Front camera + MediaPipe Face Landmarker (self-hosted under /app/vendor/mediapipe, CSP-safe: no CDN).
 * Shared by distance-tracker.js and distance-calibration-view.js. Frames are processed on-device only.
 * Low CPU: frames are processed at ~12 fps and not at all while the document is hidden.
 * Never throws: failures resolve to null.
 */
import { irisFromLandmarks, headPoseFromMatrix } from './calibration-math.js';

/** @typedef {import('./calibration-math.js').IrisMeasurement} IrisMeasurement */

/**
 * @typedef {Object} FaceFrame
 * @property {number} t              performance.now() of the frame
 * @property {boolean} face          a face was detected
 * @property {number} width          video frame width (px)
 * @property {number} height
 * @property {number} longSidePx     max(width, height): normalisation base for the 640-px convention
 * @property {IrisMeasurement|null} right   subject's right iris
 * @property {IrisMeasurement|null} left    subject's left iris
 * @property {{yawDeg: number, pitchDeg: number}|null} pose
 */

/**
 * @typedef {Object} FaceEngine
 * @property {(cb: (frame: FaceFrame) => void) => (() => void)} onFrame
 * @property {() => void} stop
 * @property {() => boolean} running
 */

const VENDOR_BASE = new URL('../../vendor/mediapipe/', import.meta.url);
const LOAD_TIMEOUT_MS = 30000;
const VIDEO_TIMEOUT_MS = 8000;

/** @returns {boolean} */
export function cameraSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
}

/**
 * @template T
 * @param {Promise<T>} p @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

// ---- shared, ref-counted landmarker (one WASM instance even if several engines run) ----
/** @type {Promise<any>|null} */
let landmarkerPromise = null;
let landmarkerRefs = 0;
let lastTimestamp = 0;

/** Monotonic timestamps across all users of the shared landmarker (VIDEO mode requirement). */
function nextTimestamp() {
  const now = performance.now();
  lastTimestamp = now > lastTimestamp ? now : lastTimestamp + 0.001;
  return lastTimestamp;
}

/** @returns {Promise<any>} */
async function createLandmarker() {
  const url = new URL('vision_bundle.mjs', VENDOR_BASE).href;
  const vision = await import(/* @vite-ignore */ url);
  const fileset = await vision.FilesetResolver.forVisionTasks(new URL('wasm', VENDOR_BASE).href);
  return vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('face_landmarker.task', VENDOR_BASE).href, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  });
}

/** @returns {Promise<any|null>} */
async function acquireLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = withTimeout(createLandmarker(), LOAD_TIMEOUT_MS);
    landmarkerPromise.catch(() => { landmarkerPromise = null; });
  }
  try {
    const lm = await landmarkerPromise;
    landmarkerRefs++;
    return lm;
  } catch (err) {
    console.warn('[calibration] face landmarker unavailable', err);
    return null;
  }
}

function releaseLandmarker() {
  landmarkerRefs = Math.max(0, landmarkerRefs - 1);
  if (landmarkerRefs > 0 || !landmarkerPromise) return;
  const p = landmarkerPromise;
  landmarkerPromise = null;
  p.then((lm) => { try { lm?.close(); } catch { /* already closed */ } }, () => {});
}

/**
 * Open the front camera at 640×480 (fixed during use).
 * @returns {Promise<MediaStream|null>}
 */
async function openFrontCamera() {
  if (!cameraSupported()) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } },
    });
  } catch (err) {
    console.warn('[calibration] camera unavailable', err?.name || err);
    return null;
  }
}

/** @param {MediaStream|null} stream */
function stopStream(stream) {
  stream?.getTracks().forEach((tr) => { try { tr.stop(); } catch { /* ignore */ } });
}

/**
 * Start the camera and the landmarker. Resolves to null when the camera or the model is unavailable.
 * @param {{fps?: number}} [opts]
 * @returns {Promise<FaceEngine|null>}
 */
export async function startFaceEngine({ fps = 12 } = {}) {
  const stream = await openFrontCamera();
  if (!stream) return null;
  // A hidden but attached video element (iOS Safari does not decode frames for detached elements).
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  video.dataset.testid = 'distance-camera-video';
  Object.assign(video.style, {
    position: 'fixed', top: '0', left: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', zIndex: '-1',
  });
  document.body.appendChild(video);
  video.srcObject = stream;
  const cleanupVideo = () => {
    stopStream(stream);
    video.srcObject = null;
    video.remove();
  };
  try {
    await withTimeout(video.play().catch(() => {}).then(() => waitForVideo(video)), VIDEO_TIMEOUT_MS);
  } catch {
    cleanupVideo();
    return null;
  }
  const landmarker = await acquireLandmarker();
  if (!landmarker) { cleanupVideo(); return null; }

  /** @type {Set<(f: FaceFrame) => void>} */
  const listeners = new Set();
  let stopped = false;
  /** @type {ReturnType<typeof setTimeout>|0} */
  let timer = 0;
  let lastVideoTime = -1;
  let errors = 0;
  const interval = 1000 / fps;

  const schedule = (/** @type {number} */ ms) => {
    if (!stopped && !timer && !document.hidden) timer = setTimeout(tick, ms);
  };
  function tick() {
    timer = 0;
    if (stopped || document.hidden) return;
    const started = performance.now();
    if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      try {
        const res = landmarker.detectForVideo(video, nextTimestamp());
        emit(toFrame(res, video.videoWidth, video.videoHeight, started));
        errors = 0;
      } catch (err) {
        if (++errors === 5) console.warn('[calibration] face landmarker errors', err);
      }
    }
    schedule(Math.max(0, interval - (performance.now() - started)));
  }
  /** @param {FaceFrame} frame */
  function emit(frame) {
    for (const cb of [...listeners]) {
      try { cb(frame); } catch (err) { console.error(err); }
    }
  }
  const onVisibility = () => { if (!document.hidden) schedule(0); else if (timer) { clearTimeout(timer); timer = 0; } };
  document.addEventListener('visibilitychange', onVisibility);
  schedule(0);

  return {
    onFrame(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    running: () => !stopped && stream.getVideoTracks().some((tr) => tr.readyState === 'live'),
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = 0;
      listeners.clear();
      document.removeEventListener('visibilitychange', onVisibility);
      cleanupVideo();
      releaseLandmarker();
    },
  };
}

/** @param {HTMLVideoElement} video @returns {Promise<void>} */
function waitForVideo(video) {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        video.removeEventListener('loadeddata', check);
        video.removeEventListener('resize', check);
        resolve();
      }
    };
    video.addEventListener('loadeddata', check);
    video.addEventListener('resize', check);
  });
}

/**
 * @param {any} res  FaceLandmarkerResult
 * @param {number} width @param {number} height @param {number} t
 * @returns {FaceFrame}
 */
function toFrame(res, width, height, t) {
  const lm = res?.faceLandmarks?.[0];
  const base = { t, width, height, longSidePx: Math.max(width, height) };
  if (!lm || lm.length < 478) return { ...base, face: false, right: null, left: null, pose: null };
  const matrix = res?.facialTransformationMatrixes?.[0]?.data;
  return {
    ...base,
    face: true,
    right: irisFromLandmarks(lm, width, height, 'right'),
    left: irisFromLandmarks(lm, width, height, 'left'),
    pose: headPoseFromMatrix(matrix),
  };
}
