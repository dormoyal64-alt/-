// @ts-check
/**
 * COLOUR-TEST STIMULI — pure (no DOM). Procedural, CCT-style plates (vision-science.md §7.2–7.3, item 29):
 * a Landolt-C ring (4AFC gap: up/right/down/left) made of non-overlapping discs of random size, on a background of
 * the same kind of discs. Every disc carries random LUMINANCE noise (6 equally spaced levels, ±20 % around the
 * mean), drawn from the same distribution for ring and background, so only chromaticity marks the ring.
 * The ring colour is the neutral grey (linear RGB 0.20) displaced along ONE cone-isolating axis:
 *     LMS_target = LMS_bg ⊙ (1 + σ_k·c·e_k)     k = L (protan), M (deutan), S (tritan)
 * σ_k is a fixed polarity per axis chosen to maximise the in-gamut range [D, extends §7.3 which only shows +c]:
 * +L for protan (ceiling ≈ 17× the normal limit), −M for deutan (+M would clip red at ≈ 6.7×), +S for tritan.
 * Colours are computed in linear RGB, multiplied by the luminance-noise factor, encoded with the IEC sRGB curve and
 * quantised to 8 bits with per-disc random dither (unbiased sub-step resolution, §7.3 "spatial dithering").
 * All randomness comes from a seeded PRNG, so a (seed, gap, stimulus) triple always gives the same plate.
 *
 * Plate geometry is in "plate units" (plate radius = 1, +x right, +y DOWN = screen orientation, never mirrored).
 */
import {
  linearRgbToLms, lmsToLinearRgb, linearRgbToUv, linearToSrgb,
} from '../../engine/color-math.js';

/** @typedef {'up'|'right'|'down'|'left'} Direction */
/** @typedef {'protan'|'deutan'|'tritan'} Axis */
/**
 * @typedef {{kind: 'axis', axis: Axis, c: number} | {kind: 'catch'} | {kind: 'none'}} PlateStimulus
 * 'axis': chromatic ring at cone contrast c; 'catch': luminance-defined (dark) ring everyone can see;
 * 'none': no ring (mask shown after the stimulus time or between trials).
 */
/**
 * @typedef {Object} Disc
 * @property {number} x       centre, plate units
 * @property {number} y
 * @property {number} r       radius, plate units
 * @property {boolean} target true when the centre lies on the ring (outside the gap)
 * @property {number} level   luminance-noise level index 0..5
 */
/** @typedef {{gap: Direction, seed: number, discs: Disc[]}} PlateLayout */

/** @type {readonly Axis[]} */
export const AXES = Object.freeze(['protan', 'deutan', 'tritan']);
/** @type {readonly Direction[]} */
export const DIRECTIONS = Object.freeze(['up', 'right', 'down', 'left']);

/** Neutral grey in linear RGB (sRGB ≈ 124), spec §7.3. */
export const NEUTRAL_LINEAR = 0.2;
/** 6 equally spaced luminance factors spanning ±20 % (spec §7.3). */
export const NOISE_LEVELS = Object.freeze([0.8, 0.88, 0.96, 1.04, 1.12, 1.2]);
/** Luminance factor of catch-trial ring discs (a dark ring visible to every observer). */
export const CATCH_LUMINANCE = 0.5;
/** Linear luminance of the gaps between discs and of the surround (dark neutral, sRGB ≈ 40). */
export const GAP_LINEAR = 0.021;

/** Plate geometry in degrees of visual angle (spec: ring ≈ 5°, discs 0.2–0.5°; smallest discs fill the gaps). */
export const GEOMETRY_DEG = Object.freeze({
  plate: 8.75,        // plate diameter
  ringOuter: 5,       // Landolt-ring outer diameter
  stroke: 1.15,       // ring thickness
  gap: 1.15,          // gap width
  discMax: 0.46,      // largest disc diameter
  discMin: 0.13,      // smallest (gap-filling) disc diameter
  spacing: 0.035,     // minimum clearance between discs
});

const R_DEG = GEOMETRY_DEG.plate / 2;
/** Geometry in plate units (radius 1). */
export const GEOMETRY = Object.freeze({
  ringOuter: GEOMETRY_DEG.ringOuter / 2 / R_DEG,
  ringInner: (GEOMETRY_DEG.ringOuter / 2 - GEOMETRY_DEG.stroke) / R_DEG,
  gapHalf: GEOMETRY_DEG.gap / 2 / R_DEG,
  rMax: GEOMETRY_DEG.discMax / 2 / R_DEG,
  rMin: GEOMETRY_DEG.discMin / 2 / R_DEG,
  spacing: GEOMETRY_DEG.spacing / R_DEG,
});

/** Cone index and polarity for each axis. */
export const CONE_AXIS = Object.freeze({
  protan: Object.freeze({ index: 0, sign: 1 }),
  deutan: Object.freeze({ index: 1, sign: -1 }),
  tritan: Object.freeze({ index: 2, sign: 1 }),
});

/** CCT normal limits in Δu′v′ (spec §7.2: 100 / 100 / 150 × 10⁻⁴). */
export const NORMAL_LIMIT_DUV = Object.freeze({ protan: 100e-4, deutan: 100e-4, tritan: 150e-4 });

/**
 * mulberry32 — small seeded PRNG, floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEUTRAL_RGB = Object.freeze([NEUTRAL_LINEAR, NEUTRAL_LINEAR, NEUTRAL_LINEAR]);
const NEUTRAL_LMS = linearRgbToLms(NEUTRAL_RGB);
const NEUTRAL_UV = linearRgbToUv(NEUTRAL_RGB);

/**
 * Linear-RGB colour of the neutral grey displaced by cone contrast `c` along `axis` (before luminance noise).
 * @param {Axis} axis @param {number} c
 * @returns {number[]}
 */
export function axisColor(axis, c) {
  const { index, sign } = CONE_AXIS[axis];
  const lms = NEUTRAL_LMS.slice();
  lms[index] *= 1 + sign * c;
  return lmsToLinearRgb(lms);
}

/**
 * Chromaticity shift Δu′v′ produced by cone contrast `c` on `axis`.
 * @param {Axis} axis @param {number} c
 */
export function duvOfContrast(axis, c) {
  const uv = linearRgbToUv(axisColor(axis, c));
  return Math.hypot(uv[0] - NEUTRAL_UV[0], uv[1] - NEUTRAL_UV[1]);
}

/**
 * Cone contrast that produces a chromaticity shift of `duv` on `axis` (bisection; duv is monotonic in c).
 * @param {Axis} axis @param {number} duv
 */
export function contrastForDuv(axis, duv) {
  let lo = 0; let hi = 5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (duvOfContrast(axis, mid) < duv) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Largest cone contrast whose colour stays inside [0, 1] for every luminance-noise level (the gamut ceiling).
 * @param {Axis} axis
 */
export function maxAxisContrast(axis) {
  const lo = NOISE_LEVELS[0]; const hi = NOISE_LEVELS[NOISE_LEVELS.length - 1];
  const ok = (/** @type {number} */ c) => axisColor(axis, c).every((v) => v * hi <= 1 && v * lo >= 0);
  let a = 0; let b = 5;
  for (let i = 0; i < 60; i++) {
    const mid = (a + b) / 2;
    if (ok(mid)) a = mid; else b = mid;
  }
  return a * 0.999;
}

/** Cone contrast at the CCT normal limit, per axis. */
export const NORMAL_LIMIT_C = Object.freeze({
  protan: contrastForDuv('protan', NORMAL_LIMIT_DUV.protan),
  deutan: contrastForDuv('deutan', NORMAL_LIMIT_DUV.deutan),
  tritan: contrastForDuv('tritan', NORMAL_LIMIT_DUV.tritan),
});
/** Gamut ceiling (cone contrast), per axis. */
export const CEILING_C = Object.freeze({
  protan: maxAxisContrast('protan'),
  deutan: maxAxisContrast('deutan'),
  tritan: maxAxisContrast('tritan'),
});
/** Gamut ceiling in multiples of the normal limit (Xceil of the severity formula, item 30). */
export const CEILING_RATIO = Object.freeze({
  protan: CEILING_C.protan / NORMAL_LIMIT_C.protan,
  deutan: CEILING_C.deutan / NORMAL_LIMIT_C.deutan,
  tritan: CEILING_C.tritan / NORMAL_LIMIT_C.tritan,
});

/**
 * Is plate point (x, y) on the Landolt ring (outside its gap)?
 * @param {number} x @param {number} y @param {Direction} gap
 */
export function onRing(x, y, gap) {
  const rho = Math.hypot(x, y);
  if (rho < GEOMETRY.ringInner || rho > GEOMETRY.ringOuter) return false;
  const h = GEOMETRY.gapHalf;
  switch (gap) {
    case 'right': return !(x > 0 && Math.abs(y) < h);
    case 'left': return !(x < 0 && Math.abs(y) < h);
    case 'up': return !(y < 0 && Math.abs(x) < h);
    default: return !(y > 0 && Math.abs(x) < h);
  }
}

/**
 * Disc layout: dart-throwing with decreasing radius (large discs first, then smaller ones fill the gaps), all
 * discs fully inside the plate circle and separated by GEOMETRY.spacing. Deterministic for a given seed.
 * @param {{seed: number, gap: Direction}} opts
 * @returns {PlateLayout}
 */
export function layoutPlate({ seed, gap }) {
  const rng = mulberry32(seed);
  const { rMax, rMin, spacing } = GEOMETRY;
  const cell = 2 * rMax + spacing;
  const n = Math.ceil(2 / cell) + 1;
  /** @type {Disc[][]} */
  const grid = Array.from({ length: n * n }, () => []);
  /** @type {Disc[]} */
  const discs = [];
  const cellOf = (/** @type {number} */ v) => Math.min(n - 1, Math.max(0, Math.floor((v + 1) / cell)));
  const fits = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r) => {
    if (Math.hypot(x, y) + r > 1) return false;
    const cx = cellOf(x); const cy = cellOf(y);
    for (let j = Math.max(0, cy - 1); j <= Math.min(n - 1, cy + 1); j++) {
      for (let i = Math.max(0, cx - 1); i <= Math.min(n - 1, cx + 1); i++) {
        for (const d of grid[j * n + i]) {
          const min = d.r + r + spacing;
          const dx = d.x - x; const dy = d.y - y;
          if (dx * dx + dy * dy < min * min) return false;
        }
      }
    }
    return true;
  };
  const BANDS = 8;
  for (let b = 0; b < BANDS; b++) {
    const bandR = rMax * Math.pow(rMin / rMax, b / (BANDS - 1));
    const attempts = 160 + b * b * 90;
    for (let a = 0; a < attempts; a++) {
      const r = bandR * (0.9 + 0.1 * rng());
      const ang = rng() * 2 * Math.PI;
      const rad = Math.sqrt(rng()) * (1 - r);
      const x = rad * Math.cos(ang); const y = rad * Math.sin(ang);
      if (!fits(x, y, r)) continue;
      const disc = { x, y, r, target: onRing(x, y, gap), level: Math.min(NOISE_LEVELS.length - 1, Math.floor(rng() * NOISE_LEVELS.length)) };
      discs.push(disc);
      grid[cellOf(y) * n + cellOf(x)].push(disc);
    }
  }
  return { gap, seed, discs };
}

/**
 * Linear-RGB colour of one disc for a stimulus (before quantisation).
 * @param {Disc} disc @param {PlateStimulus} stimulus
 * @returns {number[]}
 */
export function discLinearColor(disc, stimulus) {
  const f = NOISE_LEVELS[disc.level];
  if (disc.target && stimulus.kind === 'axis') return axisColor(stimulus.axis, stimulus.c).map((v) => Math.min(1, Math.max(0, v * f)));
  if (disc.target && stimulus.kind === 'catch') return NEUTRAL_RGB.map((v) => v * f * CATCH_LUMINANCE);
  return NEUTRAL_RGB.map((v) => v * f);
}

/**
 * 8-bit sRGB colour of every disc, with unbiased random dither: code = floor(255·sRGB + u), u ~ U[0, 1).
 * @param {PlateLayout} layout @param {PlateStimulus} stimulus @param {number} [ditherSeed]
 * @returns {Array<[number, number, number]>}
 */
export function colorizePlate(layout, stimulus, ditherSeed = layout.seed ^ 0x9e3779b9) {
  const rng = mulberry32(ditherSeed);
  return layout.discs.map((d) => {
    const lin = discLinearColor(d, stimulus);
    return /** @type {[number, number, number]} */ (lin.map((v) => Math.min(255, Math.floor(linearToSrgb(v) * 255 + rng()))));
  });
}

/** 8-bit sRGB code of the dark neutral gap/surround colour. */
export const GAP_SRGB8 = Math.round(linearToSrgb(GAP_LINEAR) * 255);

/**
 * CSS px per degree of visual angle at viewing distance `distanceMm` (exact: s = 2·d·tan(θ/2)).
 * @param {number} distanceMm @param {number} cssPxPerMm
 */
export function cssPxPerDeg(distanceMm, cssPxPerMm) {
  return 2 * distanceMm * Math.tan((0.5 * Math.PI) / 180) * cssPxPerMm;
}

/**
 * Plate diameter in CSS px at the given distance (the view may scale it down to fit the screen).
 * @param {number} distanceMm @param {number} cssPxPerMm
 */
export function plateDiameterCssPx(distanceMm, cssPxPerMm) {
  return 2 * distanceMm * Math.tan(((GEOMETRY_DEG.plate / 2) * Math.PI) / 180) * cssPxPerMm;
}
