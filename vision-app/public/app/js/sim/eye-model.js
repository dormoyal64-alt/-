// @ts-check
/**
 * SIMULATED EYE — pure optics + psychophysics model of an UNCORRECTED eye looking at a screen (Node + browser).
 * Used only by the validation simulator (scripts/sim/**, test/unit/sim/**), never by the product UI.
 * Internal research code: refractions are in dioptres here on purpose (they never reach a user).
 *
 * Conventions
 * - Prescription in MINUS-cylinder form: sphere S, cyl C ≤ 0, axis A (TABO, degrees, 0..180).
 *   Power in meridian A = S, power in meridian A+90 = S + C. Spherical equivalent SE = S + C/2.
 *   A meridian with refraction R is focused on the retina for a target at vergence −R (far point 1/|R| m for R < 0).
 * - Accommodation a (D) adds to both meridians. For a target at d metres, the residual defocus in a meridian is
 *   r = 1/d + R − a  (r > 0: image behind the retina, "not enough focus"; r < 0: "too much focus", myopic blur).
 * - The eye places the circle of least confusion on the retina when it can: a = clamp(1/d + SE, 0, a_max).
 *   a_max = full amplitude for brief tasks (tests), ½ amplitude for sustained, comfortable reading (§9.5).
 * - Blur strength (power-vector length, Thibos et al. 1997): B = √(M² + J0² + J45²) = √(M² + (C/2)²), M = mean residual.
 *
 * Defocus → acuity (Smith 1991, Optom Vis Sci 68:591, form with a depth-of-focus dead zone):
 *   MAR(′) = √(MAR0² + (k · P · max(0, B − z/P))²),  logMAR = log10 MAR
 *   P pupil diameter (mm), MAR0 = 10^(neural floor). k and z were fitted (scripts/sim/run-cohort.js --fit prints the
 *   fit) jointly to (a) the adult myope regression of Rushton, Armstrong & Dunne 2016 (Clin Exp Optom 99:4,
 *   MAR = 2.91·U + 0.51·P − 3.14, 663 eyes) evaluated at U = 1–4 D, and (b) the lens-induced myopic-defocus losses
 *   in young adults reported as +0.163 logMAR at 0.50 D and +0.825 at 2.00 D (2024–25 repeated-measures study),
 *   both at an assumed chart-viewing pupil of 4.5 mm: k = 0.64 (Smith's typical range 0.55–1.33), z = 0.86 mm·D
 *   (a 0.19 D dead zone at 4.5 mm, 0.23 D at 3.7 mm). RMS error 0.04 logMAR over the fitted points.
 * - Blur disk (geometric, §11.1): β(′) = P(mm) · |ΔD| · 3.4377.
 * - Pupil: Watson & Yellott 2012 (J Vis 12(10):12) unified formula, default luminance 150 cd/m² (typical phone
 *   brightness) over a 270 deg² field (a phone at ~35 cm), binocular → ≈ 3.7 mm at 29 y, 3.3 mm at 60 y.
 * - Amplitude of accommodation: Hofstetter 1950 (mean 18.5 − 0.3·age), clamped at 0 (depth of focus is modelled
 *   separately by the dead zone, so an old eye keeps a small sharp range around its far point).
 * - Neural floor (best corrected logMAR): −0.08 up to 40 y, worsening 0.0025/y (after Elliott, Yang & Whitaker 1995).
 */

export const ARCMIN_PER_MRAD = 10800 / Math.PI / 1000; // 3.4377′ per mrad (1 mm·D = 1 mrad)

/** Fitted defocus → acuity constants (see header). */
export const DEFOCUS_MODEL = Object.freeze({
  k: 0.64,
  deadZoneMmD: 0.86,
  refPupilMm: 4.5,
  /** Data the constants were fitted to: [blur strength D, logMAR at the reference pupil, source]. */
  fitData: Object.freeze([
    ...[1, 1.5, 2, 2.5, 3, 4].map((u) => Object.freeze([u, Math.log10(2.91 * u + 0.51 * 4.5 - 3.14), 'Rushton 2016'])),
    Object.freeze([0.5, -0.05 + 0.163, 'lens-induced defocus, young adults']),
    Object.freeze([2.0, -0.05 + 0.825, 'lens-induced defocus, young adults']),
  ]),
});

/** Comfortable sustained accommodation = this fraction of the amplitude (half-amplitude rule, spec §9.5). */
export const COMFORT_FRACTION = 0.5;

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Hofstetter (1950) amplitude of accommodation by age (D), clamped at 0.
 * @param {number} age
 */
export function hofstetterAmplitude(age) {
  return {
    min: Math.max(0, 15 - 0.25 * age),
    mean: Math.max(0, 18.5 - 0.3 * age),
    max: Math.max(0, 25 - 0.4 * age),
  };
}

/**
 * Watson & Yellott (2012) unified pupil formula (mm).
 * D_SD(F) = 7.75 − 5.75·[(F/846)^0.41 / ((F/846)^0.41 + 2)],  F = L·a·M(e) (M = 1 binocular, 0.1 monocular)
 * D_U = D_SD + (y − 28.58)·(0.02132 − 0.009562·D_SD)
 * @param {{luminance?: number, fieldDeg2?: number, age?: number, binocular?: boolean}} [o]
 */
export function watsonYellottPupilMm({ luminance = 150, fieldDeg2 = 270, age = 28.58, binocular = true } = {}) {
  const F = luminance * fieldDeg2 * (binocular ? 1 : 0.1);
  const x = (F / 846) ** 0.41;
  const dsd = 7.75 - 5.75 * (x / (x + 2));
  return clamp(dsd + (age - 28.58) * (0.02132 - 0.009562 * dsd), 2, 8);
}

/** Age-typical best-corrected logMAR (neural + residual optical floor). @param {number} age */
export function neuralFloorLogMAR(age) {
  return -0.08 + 0.0025 * Math.max(0, age - 40);
}

/**
 * Smith-type defocus → logMAR.
 * @param {number} blurD blur strength (D, ≥ 0)
 * @param {number} pupilMm
 * @param {number} floorLogMAR
 */
export function logMARForBlur(blurD, pupilMm, floorLogMAR) {
  const { k, deadZoneMmD } = DEFOCUS_MODEL;
  const eff = Math.max(0, Math.abs(blurD) - deadZoneMmD / pupilMm);
  const mar0 = 10 ** floorLogMAR;
  return Math.log10(Math.sqrt(mar0 * mar0 + (k * pupilMm * eff) ** 2));
}

/**
 * Inverse of logMARForBlur: the blur strength (D) that brings the threshold to `logMAR` (0 when logMAR ≤ floor).
 * Note: any blur inside the dead zone gives the floor, so the inverse returns the dead-zone edge for L slightly above it.
 * @param {number} logMAR @param {number} pupilMm @param {number} floorLogMAR
 */
export function blurForLogMAR(logMAR, pupilMm, floorLogMAR) {
  const { k, deadZoneMmD } = DEFOCUS_MODEL;
  if (!(logMAR > floorLogMAR)) return 0;
  const m = 10 ** logMAR;
  const m0 = 10 ** floorLogMAR;
  return Math.sqrt(m * m - m0 * m0) / (k * pupilMm) + deadZoneMmD / pupilMm;
}

/** Geometric blur-disk diameter (arcmin) for a pupil and a defocus. @param {number} pupilMm @param {number} defocusD */
export function blurDiskArcmin(pupilMm, defocusD) {
  return pupilMm * Math.abs(defocusD) * ARCMIN_PER_MRAD;
}

/**
 * @typedef {Object} SimulatedEye
 * @property {number} sphere      D (minus-cyl form)
 * @property {number} cyl         D, ≤ 0
 * @property {number} axisDeg     0..180 (TABO)
 * @property {number} age
 * @property {number} pupilMm
 * @property {number} ampD        amplitude of accommodation (D)
 * @property {number} floorLogMAR best-corrected logMAR
 */

/**
 * @param {{sphere?: number, cyl?: number, axisDeg?: number, age?: number, pupilMm?: number, ampD?: number,
 *   floorLogMAR?: number, luminance?: number}} o
 * @returns {SimulatedEye}
 */
export function createEye(o = {}) {
  const age = o.age ?? 30;
  let sphere = o.sphere ?? 0;
  let cyl = o.cyl ?? 0;
  let axisDeg = o.axisDeg ?? 180;
  if (cyl > 0) { sphere += cyl; cyl = -cyl; axisDeg = (axisDeg + 90) % 180; } // transpose to minus cyl
  return Object.freeze({
    sphere, cyl, axisDeg: axisDeg === 0 ? 180 : axisDeg, age,
    pupilMm: o.pupilMm ?? watsonYellottPupilMm({ age, luminance: o.luminance ?? 150 }),
    ampD: o.ampD ?? hofstetterAmplitude(age).mean,
    floorLogMAR: o.floorLogMAR ?? neuralFloorLogMAR(age),
  });
}

/** Spherical equivalent. @param {SimulatedEye} eye */
export const sphericalEquivalent = (eye) => eye.sphere + eye.cyl / 2;

/**
 * Principal meridians: refraction (D) in the axis meridian and the perpendicular one.
 * @param {SimulatedEye} eye
 */
export function meridionalRefraction(eye) {
  return [
    { angleDeg: eye.axisDeg % 180, refractionD: eye.sphere },
    { angleDeg: (eye.axisDeg + 90) % 180, refractionD: eye.sphere + eye.cyl },
  ];
}

/**
 * Accommodation demand (D) of a target for the circle of least confusion: 1/d + SE (negative = beyond the far point).
 * @param {SimulatedEye} eye @param {number} distanceMm
 */
export function accommodationDemand(eye, distanceMm) {
  return 1000 / distanceMm + sphericalEquivalent(eye);
}

/**
 * @typedef {Object} EyeState
 * @property {number} demandD          accommodation needed for best focus
 * @property {number} accommodationD   accommodation actually used
 * @property {[number, number]} residualD  residual defocus in the axis meridian and the perpendicular meridian
 * @property {number} meanResidualD    M
 * @property {number} blurD            blur strength B = √(M² + (C/2)²)
 * @property {[number, number]} blurDiskArcmin  blur-patch diameters along the two principal meridians
 * @property {number} logMAR           predicted threshold (logMAR) at this distance
 */

/**
 * Optical state of the eye looking at a target at `distanceMm`.
 * @param {SimulatedEye} eye @param {number} distanceMm
 * @param {{mode?: 'max'|'comfortable', lagD?: number}} [o]  mode: full amplitude (brief test) or ½ amplitude (sustained)
 * @returns {EyeState}
 */
export function eyeState(eye, distanceMm, { mode = 'max', lagD = 0 } = {}) {
  const demandD = accommodationDemand(eye, distanceMm);
  const aMax = mode === 'comfortable' ? COMFORT_FRACTION * eye.ampD : eye.ampD;
  const accommodationD = clamp(demandD - (demandD > lagD ? lagD : 0), 0, aMax);
  const v = 1000 / distanceMm;
  const r1 = v + eye.sphere - accommodationD;
  const r2 = v + eye.sphere + eye.cyl - accommodationD;
  const M = (r1 + r2) / 2;
  const blurD = Math.sqrt(M * M + (eye.cyl / 2) ** 2);
  return {
    demandD, accommodationD, residualD: [r1, r2], meanResidualD: M, blurD,
    blurDiskArcmin: [blurDiskArcmin(eye.pupilMm, r1), blurDiskArcmin(eye.pupilMm, r2)],
    logMAR: logMARForBlur(blurD, eye.pupilMm, eye.floorLogMAR),
  };
}

/** Predicted uncorrected logMAR at a distance. @param {SimulatedEye} eye @param {number} distanceMm @param {'max'|'comfortable'} [mode] */
export function logMARAt(eye, distanceMm, mode = 'max') {
  return eyeState(eye, distanceMm, { mode }).logMAR;
}

/**
 * Binocular threshold: the better eye at that distance (no summation bonus — conservative).
 * @param {SimulatedEye[]} eyes @param {number} distanceMm @param {'max'|'comfortable'} [mode]
 */
export function binocularLogMARAt(eyes, distanceMm, mode = 'max') {
  return Math.min(...eyes.map((e) => logMARAt(e, distanceMm, mode)));
}

/** Optical far point (mm) from the spherical equivalent; null = beyond optical infinity (SE ≥ 0). @param {SimulatedEye} eye */
export function farPointMm(eye) {
  const se = sphericalEquivalent(eye);
  return se < 0 ? 1000 / -se : null;
}

/** Optical near point (mm) with full amplitude; null when even infinity needs more than the amplitude. @param {SimulatedEye} eye */
export function nearPointMm(eye) {
  const v = eye.ampD - sphericalEquivalent(eye);
  return v > 0 ? 1000 / v : null;
}

/**
 * Distance range (mm) where the threshold stays within `maxLossLogMAR` of the eye's best (numeric scan, works with
 * astigmatism). Returns nulls when no distance between minMm and maxMm qualifies; toMm = Infinity when sharp at maxMm.
 * @param {SimulatedEye|SimulatedEye[]} eyeOrEyes
 * @param {{mode?: 'max'|'comfortable', maxLossLogMAR?: number, minMm?: number, maxMm?: number}} [o]
 * @returns {{fromMm: number|null, toMm: number|null}}
 */
export function sharpRangeMm(eyeOrEyes, { mode = 'comfortable', maxLossLogMAR = 0.1, minMm = 50, maxMm = 6000 } = {}) {
  const eyes = Array.isArray(eyeOrEyes) ? eyeOrEyes : [eyeOrEyes];
  const best = Math.min(...eyes.map((e) => e.floorLogMAR));
  /** @type {number|null} */ let from = null;
  /** @type {number|null} */ let to = null;
  for (let d = minMm; d <= maxMm; d *= 1.01) {
    if (binocularLogMARAt(eyes, d, mode) <= best + maxLossLogMAR + 1e-9) { if (from === null) from = d; to = d; }
  }
  if (to !== null && to * 1.01 > maxMm) to = Infinity;
  return { fromMm: from === null ? null : Math.round(from), toMm: to === null ? null : to === Infinity ? Infinity : Math.round(to) };
}

/**
 * 2D point-spread function on a pixel grid: elliptical pillbox (geometric defocus with astigmatism) convolved with a
 * Gaussian (diffraction Airy core approximated by σ = 0.42·λ/P, plus an optional extra σ for higher-order aberrations).
 * Orientation: TABO angle θ (examiner's view) appears at 180° − θ on the screen as the viewer sees it.
 * @param {{residualD: [number, number], axisDeg: number, pupilMm: number, pxPerArcmin: number,
 *   diffraction?: boolean, extraSigmaArcmin?: number, wavelengthNm?: number, maxRadiusPx?: number}} o
 * @returns {{size: number, radius: number, data: Float32Array}}  normalised (sum 1), row-major, y down
 */
export function psfKernel({ residualD, axisDeg, pupilMm, pxPerArcmin, diffraction = true, extraSigmaArcmin = 0.4, wavelengthNm = 555, maxRadiusPx = 80 }) {
  const a = (blurDiskArcmin(pupilMm, residualD[0]) / 2) * pxPerArcmin; // semi-axis along the axis meridian (px)
  const b = (blurDiskArcmin(pupilMm, residualD[1]) / 2) * pxPerArcmin; // semi-axis along the perpendicular meridian
  const diffSigmaArcmin = diffraction ? (0.42 * wavelengthNm * 1e-6 / pupilMm) * 1000 * ARCMIN_PER_MRAD : 0;
  const sigma = Math.hypot(diffSigmaArcmin, extraSigmaArcmin) * pxPerArcmin;
  const radius = Math.min(maxRadiusPx, Math.ceil(Math.max(a, b) + 3 * sigma + 1));
  const size = 2 * radius + 1;
  const theta = ((180 - axisDeg) * Math.PI) / 180; // screen angle of the axis meridian, CCW from horizontal
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const aa = Math.max(a, 0.25);
  const bb = Math.max(b, 0.25);
  const SS = 5; // supersampling for the pillbox edge
  const pill = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x - radius + (sx + 0.5) / SS - 0.5;
          const py = -(y - radius + (sy + 0.5) / SS - 0.5); // y up for the angle maths
          const u = px * c + py * s;
          const v = -px * s + py * c;
          if ((u / aa) ** 2 + (v / bb) ** 2 <= 1) inside++;
        }
      }
      pill[y * size + x] = inside;
    }
  }
  let out = pill;
  if (sigma > 0.05) {
    const g = [];
    const gr = Math.ceil(3 * sigma);
    for (let i = -gr; i <= gr; i++) g.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
    const tmp = new Float32Array(size * size);
    out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let i = -gr; i <= gr; i++) { const xx = x + i; if (xx >= 0 && xx < size) acc += pill[y * size + xx] * g[i + gr]; }
      tmp[y * size + x] = acc;
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let i = -gr; i <= gr; i++) { const yy = y + i; if (yy >= 0 && yy < size) acc += tmp[yy * size + x] * g[i + gr]; }
      out[y * size + x] = acc;
    }
  }
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i];
  if (sum > 0) for (let i = 0; i < out.length; i++) out[i] /= sum;
  return { size, radius, data: out };
}
