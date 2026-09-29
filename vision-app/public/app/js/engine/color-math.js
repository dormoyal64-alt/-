// @ts-check
/**
 * COLOUR MATHS — pure (no DOM, no globals). Everything here works in LINEAR-LIGHT sRGB (Rec.709 primaries,
 * D65), never on gamma-encoded values (docs/research/vision-science.md §7.1, §7.4, §7.6, items 27–33).
 *
 * Matrices are 3x3 ROW-MAJOR flat arrays `[m00, m01, m02, m10, …, m22]`, applied to column vectors:
 * `out = M · [R, G, B]ᵀ` — the same convention as `FilterParams.colorMatrix` (core/types.js) and the renderer.
 *
 * Contents
 *  - IEC 61966-2-1 transfer functions (bit-identical to render/filter-math.js).
 *  - 3x3 helpers: mat3Mul, mat3Apply, mat3Invert.
 *  - Machado, Oliveira & Fernandes 2009 anomalous-trichromacy simulation matrices, EXACT per-0.1-severity values
 *    (spec §7.4), with linear interpolation in between (as colorspacious does).
 *  - Daltonisation (Fidaner et al. 2005 error redistribution, spec item 33) collapsed into ONE 3x3 matrix.
 *  - Cone (Smith & Pokorny, sRGB primaries) and CIE XYZ / u′v′ / L*a*b* conversions used by the colour test.
 */
import { IDENTITY3 } from '../core/types.js';

/** @typedef {'protan'|'deutan'|'tritan'} CvdType */

/** Identity 3x3 (row-major), shared with core/types.js. */
export const IDENTITY = IDENTITY3;

// ---------------------------------------------------------------------------------------------------------------
// Transfer functions (spec §7.1 / item 27)
// ---------------------------------------------------------------------------------------------------------------

/**
 * sRGB-encoded (0..1) -> linear light (IEC 61966-2-1).
 * @param {number} c
 */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Linear light (0..1) -> sRGB-encoded (IEC 61966-2-1).
 * @param {number} l
 */
export function linearToSrgb(l) {
  return l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
}

// ---------------------------------------------------------------------------------------------------------------
// 3x3 helpers (row-major)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Matrix product A·B (apply B first, then A).
 * @param {ArrayLike<number>} a @param {ArrayLike<number>} b
 * @returns {number[]}
 */
export function mat3Mul(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/**
 * M · v for a column vector v = [x, y, z].
 * @param {ArrayLike<number>} m @param {ArrayLike<number>} v
 * @returns {number[]}
 */
export function mat3Apply(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * Inverse of a 3x3 matrix (adjugate / determinant). Throws RangeError when the matrix is singular.
 * @param {ArrayLike<number>} m
 * @returns {number[]}
 */
export function mat3Invert(m) {
  const [a, b, c, d, e, f, g, h, i] = Array.from(m);
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new RangeError('matrix is singular');
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------------------------------------------
// Machado, Oliveira & Fernandes 2009 — EXACT published matrices (spec §7.4), severity 0.0, 0.1, …, 1.0.
// Rows copied verbatim from the spec tables (which were cross-checked against colorspacious 1.1.2 and
// DaltonLens-Python 0.1.5). "-0.000000" entries at severity 0 are written as 0 (identity).
// ---------------------------------------------------------------------------------------------------------------

/** @type {Readonly<Record<CvdType, ReadonlyArray<ReadonlyArray<number>>>>} */
export const MACHADO_2009 = Object.freeze({
  protan: Object.freeze([
    Object.freeze([1.000000, 0.000000, 0.000000, 0.000000, 1.000000, 0.000000, 0.000000, 0.000000, 1.000000]),
    Object.freeze([0.856167, 0.182038, -0.038205, 0.029342, 0.955115, 0.015544, -0.002880, -0.001563, 1.004443]),
    Object.freeze([0.734766, 0.334872, -0.069637, 0.051840, 0.919198, 0.028963, -0.004928, -0.004209, 1.009137]),
    Object.freeze([0.630323, 0.465641, -0.095964, 0.069181, 0.890046, 0.040773, -0.006308, -0.007724, 1.014032]),
    Object.freeze([0.539009, 0.579343, -0.118352, 0.082546, 0.866121, 0.051332, -0.007136, -0.011959, 1.019095]),
    Object.freeze([0.458064, 0.679578, -0.137642, 0.092785, 0.846313, 0.060902, -0.007494, -0.016807, 1.024301]),
    Object.freeze([0.385450, 0.769005, -0.154455, 0.100526, 0.829802, 0.069673, -0.007442, -0.022190, 1.029632]),
    Object.freeze([0.319627, 0.849633, -0.169261, 0.106241, 0.815969, 0.077790, -0.007025, -0.028051, 1.035076]),
    Object.freeze([0.259411, 0.923008, -0.182420, 0.110296, 0.804340, 0.085364, -0.006276, -0.034346, 1.040622]),
    Object.freeze([0.203876, 0.990338, -0.194214, 0.112975, 0.794542, 0.092483, -0.005222, -0.041043, 1.046265]),
    Object.freeze([0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998]),
  ]),
  deutan: Object.freeze([
    Object.freeze([1.000000, 0.000000, 0.000000, 0.000000, 1.000000, 0.000000, 0.000000, 0.000000, 1.000000]),
    Object.freeze([0.866435, 0.177704, -0.044139, 0.049567, 0.939063, 0.011370, -0.003453, 0.007233, 0.996220]),
    Object.freeze([0.760729, 0.319078, -0.079807, 0.090568, 0.889315, 0.020117, -0.006027, 0.013325, 0.992702]),
    Object.freeze([0.675425, 0.433850, -0.109275, 0.125303, 0.847755, 0.026942, -0.007950, 0.018572, 0.989378]),
    Object.freeze([0.605511, 0.528560, -0.134071, 0.155318, 0.812366, 0.032316, -0.009376, 0.023176, 0.986200]),
    Object.freeze([0.547494, 0.607765, -0.155259, 0.181692, 0.781742, 0.036566, -0.010410, 0.027275, 0.983136]),
    Object.freeze([0.498864, 0.674741, -0.173604, 0.205199, 0.754872, 0.039929, -0.011131, 0.030969, 0.980162]),
    Object.freeze([0.457771, 0.731899, -0.189670, 0.226409, 0.731012, 0.042579, -0.011595, 0.034333, 0.977261]),
    Object.freeze([0.422823, 0.781057, -0.203881, 0.245752, 0.709602, 0.044646, -0.011843, 0.037423, 0.974421]),
    Object.freeze([0.392952, 0.823610, -0.216562, 0.263559, 0.690210, 0.046232, -0.011910, 0.040281, 0.971630]),
    Object.freeze([0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881]),
  ]),
  tritan: Object.freeze([
    Object.freeze([1.000000, 0.000000, 0.000000, 0.000000, 1.000000, 0.000000, 0.000000, 0.000000, 1.000000]),
    Object.freeze([0.926670, 0.092514, -0.019184, 0.021191, 0.964503, 0.014306, 0.008437, 0.054813, 0.936750]),
    Object.freeze([0.895720, 0.133330, -0.029050, 0.029997, 0.945400, 0.024603, 0.013027, 0.104707, 0.882266]),
    Object.freeze([0.905871, 0.127791, -0.033662, 0.026856, 0.941251, 0.031893, 0.013410, 0.148296, 0.838294]),
    Object.freeze([0.948035, 0.089490, -0.037526, 0.014364, 0.946792, 0.038844, 0.010853, 0.193991, 0.795156]),
    Object.freeze([1.017277, 0.027029, -0.044306, -0.006113, 0.958479, 0.047634, 0.006379, 0.248708, 0.744913]),
    Object.freeze([1.104996, -0.046633, -0.058363, -0.032137, 0.971635, 0.060503, 0.001336, 0.317922, 0.680742]),
    Object.freeze([1.193214, -0.109812, -0.083402, -0.058496, 0.979410, 0.079086, -0.002346, 0.403492, 0.598854]),
    Object.freeze([1.257728, -0.139648, -0.118081, -0.078003, 0.975409, 0.102594, -0.003316, 0.501214, 0.502102]),
    Object.freeze([1.278864, -0.125333, -0.153531, -0.084748, 0.957674, 0.127074, -0.000989, 0.601151, 0.399838]),
    Object.freeze([1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900]),
  ]),
});

/** @param {string} type @returns {type is CvdType} */
export function isCvdType(type) {
  return type === 'protan' || type === 'deutan' || type === 'tritan';
}

/**
 * Machado 2009 simulation matrix for `type` at `severity` (clamped to 0..1). At the published 0.1 steps the
 * EXACT table values are returned; in between, entries are linearly interpolated between the two neighbouring
 * steps. Severity 0 is the identity. Unknown types return the identity.
 * @param {CvdType|string} type @param {number} severity
 * @returns {number[]}
 */
export function machadoMatrix(type, severity) {
  if (!isCvdType(type)) return [...IDENTITY];
  const table = MACHADO_2009[type];
  const s = clamp(Number.isFinite(severity) ? severity : 0, 0, 1) * 10;
  const nearest = Math.round(s);
  // Snap float noise (e.g. 0.3 * 10 = 3.0000000000000004) so the published steps come back bit-exact.
  if (Math.abs(s - nearest) < 1e-9) return [...table[nearest]];
  const lo = Math.floor(s);
  const t = s - lo;
  const a = table[lo];
  const b = table[lo + 1];
  return a.map((v, i) => v + (b[i] - v) * t);
}

/**
 * Simulate how a linear-RGB colour appears to an observer of the given type and severity (spec pipeline §7.1:
 * matrix, then clamp to [0, 1]).
 * @param {ArrayLike<number>} rgbLinear @param {CvdType|string} type @param {number} severity
 * @returns {number[]}
 */
export function simulateCvd(rgbLinear, type, severity) {
  return mat3Apply(machadoMatrix(type, severity), rgbLinear).map((v) => clamp(v, 0, 1));
}

// ---------------------------------------------------------------------------------------------------------------
// Daltonisation (spec §7.6 / item 33) as ONE linear-RGB matrix.
// ---------------------------------------------------------------------------------------------------------------

/** Error-redistribution matrix for protan/deutan: the red–green error is pushed into G and B (Fidaner 2005). */
export const DALTONIZE_E_RED_GREEN = Object.freeze([0, 0, 0, 0.7, 1, 0, 0.7, 0, 1]);
/**
 * Error-redistribution matrix for tritan. DEVIATES from the spec's [D] proposal E = [[1,0,0.7],[0,1,0.7],[0,0,0]]
 * (item 33): with the Machado tritan matrices that proposal makes blue/yellow confusion pairs LESS distinct under
 * simulation (ΔE76 ×0.8–0.9 at severity 0.3–0.6; test/unit/color/color-math.test.js). Here the blue error is
 * re-encoded as a red–green opponent signal instead (R += 0.7·errB, G −= 0.7·errB, B unchanged), which the user
 * still sees: simulated ΔE76 gain ×1.1–1.2 at severity 0.3, ×1.3–1.7 at 0.6, ×1.6–5.6 at 1.0.
 */
export const DALTONIZE_E_TRITAN = Object.freeze([0, 0, 0.7, 0, 0, -0.7, 0, 0, 0]);
/** The spec's original tritan proposal (item 33), kept for reference and regression tests. */
export const DALTONIZE_E_TRITAN_SPEC = Object.freeze([1, 0, 0.7, 0, 1, 0.7, 0, 0, 0]);

/**
 * Recolouring ("colour filter") matrix for a user of `type`/`severity`, as a single 3x3 LINEAR-RGB matrix that
 * the renderer can use directly as `FilterParams.colorMatrix`.
 *
 * Derivation. The spec's per-pixel algorithm (item 33) is
 *     sim  = S·rgb                      S = machadoMatrix(type, severity)
 *     err  = rgb − sim = (I − S)·rgb    the part of the signal the user cannot see
 *     out  = rgb + k·E·err              E = DALTONIZE_E_RED_GREEN (protan/deutan, spec) or DALTONIZE_E_TRITAN
 * Every step is linear, so out = [I + k·E·(I − S)]·rgb = M·rgb with
 *     M = I + k·E·(I − S).
 * Grey/white preservation. A neutral grey g·(1,1,1) is unchanged by M iff every row of M sums to 1, i.e. iff
 * every row of E·(I − S) sums to 0, which holds when every row of S sums to exactly 1. The published Machado
 * rows sum to 1 only to ±1e-6 (6-decimal rounding), so S is first row-normalised (S'ᵢⱼ = Sᵢⱼ / Σⱼ Sᵢⱼ, a change
 * of at most ~1e-6 per entry). Then (I − S') has zero row sums, hence M·(1,1,1) = (1,1,1) to float precision and
 * white and every neutral grey are preserved exactly — with no clamping needed for neutrals. Out-of-gamut
 * results for saturated colours are clamped per pixel to [0, 1] by the renderer (filter-math.js step 3).
 * `severity` and `strength` are clamped to [0, 1]; severity 0, strength 0 or a non-CVD type give the identity.
 *
 * @param {CvdType|string} type
 * @param {number} severity  0..1 (Machado severity)
 * @param {number} [strength] user strength k, 0..1 (default 1)
 * @returns {number[]}
 */
export function daltonizeMatrix(type, severity, strength = 1) {
  if (!isCvdType(type)) return [...IDENTITY];
  const k = clamp(Number.isFinite(strength) ? strength : 1, 0, 1);
  const S = machadoMatrix(type, severity);
  const Sn = S.slice();
  for (let r = 0; r < 3; r++) {
    const sum = S[r * 3] + S[r * 3 + 1] + S[r * 3 + 2];
    for (let c = 0; c < 3; c++) Sn[r * 3 + c] = S[r * 3 + c] / sum;
  }
  const IminusS = IDENTITY.map((v, i) => v - Sn[i]);
  const E = type === 'tritan' ? DALTONIZE_E_TRITAN : DALTONIZE_E_RED_GREEN;
  const EI = mat3Mul(E, IminusS);
  const M = IDENTITY.map((v, i) => v + k * EI[i]);
  // Remove the last ~1e-16 of float drift so each row sums to exactly 1 (put the residue on the diagonal).
  for (let r = 0; r < 3; r++) {
    const sum = M[r * 3] + M[r * 3 + 1] + M[r * 3 + 2];
    M[r * 4] += 1 - sum;
  }
  return M;
}

// ---------------------------------------------------------------------------------------------------------------
// Cone space, XYZ, u′v′, CIELAB (spec §7.1, §7.3, item 28)
// ---------------------------------------------------------------------------------------------------------------

/** Smith & Pokorny cone fundamentals with sRGB primaries (spec §7.3, DaltonLens). */
export const LMS_FROM_LINEAR_RGB = Object.freeze([
  0.17885956, 0.43997117, 0.03596577,
  0.03380394, 0.27515242, 0.03620635,
  0.00031087, 0.00191661, 0.01528089,
]);
/** Inverse of LMS_FROM_LINEAR_RGB, as published in the spec (§7.3). */
export const LINEAR_RGB_FROM_LMS = Object.freeze([
  8.0053286, -12.8819545, 11.68064943,
  -0.97821149, 5.26944903, -10.18300433,
  -0.04016823, -0.39885058, 66.48078797,
]);
/** Linear sRGB -> CIE XYZ (D65), spec §7.1. */
export const XYZ_FROM_LINEAR_RGB = Object.freeze([
  0.4124564, 0.3575761, 0.1804375,
  0.2126729, 0.7151522, 0.0721750,
  0.0193339, 0.1191920, 0.9503041,
]);
/** Relative luminance weights for linear RGB (row 2 of the XYZ matrix, rounded as in §7.1). */
export const LUMINANCE_WEIGHTS = Object.freeze([0.2126, 0.7152, 0.0722]);

/** @param {ArrayLike<number>} rgb */
export function linearRgbToLms(rgb) { return mat3Apply(LMS_FROM_LINEAR_RGB, rgb); }
/** @param {ArrayLike<number>} lms */
export function lmsToLinearRgb(lms) { return mat3Apply(LINEAR_RGB_FROM_LMS, lms); }
/** @param {ArrayLike<number>} rgb */
export function linearRgbToXyz(rgb) { return mat3Apply(XYZ_FROM_LINEAR_RGB, rgb); }
/** @param {ArrayLike<number>} rgb */
export function relativeLuminance(rgb) {
  return LUMINANCE_WEIGHTS[0] * rgb[0] + LUMINANCE_WEIGHTS[1] * rgb[1] + LUMINANCE_WEIGHTS[2] * rgb[2];
}

/**
 * CIE 1976 u′v′ chromaticity of a linear-RGB colour.
 * @param {ArrayLike<number>} rgb
 * @returns {[number, number]}
 */
export function linearRgbToUv(rgb) {
  const [X, Y, Z] = linearRgbToXyz(rgb);
  const den = X + 15 * Y + 3 * Z;
  if (den <= 0) return [0, 0];
  return [(4 * X) / den, (9 * Y) / den];
}

const WHITE_XYZ = linearRgbToXyz([1, 1, 1]);

/**
 * CIE L*a*b* (D65 white = sRGB white) of a linear-RGB colour.
 * @param {ArrayLike<number>} rgb
 * @returns {[number, number, number]}
 */
export function linearRgbToLab(rgb) {
  const xyz = linearRgbToXyz(rgb);
  const f = (/** @type {number} */ t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(xyz[0] / WHITE_XYZ[0]);
  const fy = f(xyz[1] / WHITE_XYZ[1]);
  const fz = f(xyz[2] / WHITE_XYZ[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * CIE76 colour difference ΔE*ab between two linear-RGB colours.
 * @param {ArrayLike<number>} a @param {ArrayLike<number>} b
 */
export function deltaE76(a, b) {
  const la = linearRgbToLab(a);
  const lb = linearRgbToLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}
