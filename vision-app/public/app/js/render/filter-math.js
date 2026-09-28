// @ts-check
/**
 * CPU REFERENCE of the per-pixel enhancement pipeline (pure: no DOM, no globals).
 * Used by (a) the 2D-canvas fallback of filter-renderer.js for still images and (b) unit tests.
 * The WebGL shaders in filter-renderer.js implement EXACTLY the same order of operations:
 *
 *  Stage A — colour (GPU pass 1, source -> FBO A; also the first half of the fused single pass):
 *    1. input: sRGB-encoded 0..1; transparent pixels are composited onto white: c = c*a + (1 - a)
 *    2. sRGB -> linear  (IEC 61966-2-1 piecewise transfer function)
 *    3. lin' = clamp(M · lin, 0, 1)        M = FilterParams.colorMatrix, 3x3 row-major, LINEAR RGB
 *    4. linear -> sRGB                     (steps 2–4 are skipped when M is the identity: exact no-op)
 *  Stage B — unsharp mask (GPU passes 2–4), on the sRGB-encoded output of stage A:
 *    5. blurred = separable Gaussian, sigma = sharpenSigmaPx × devicePixelRatio (device px of the OUTPUT),
 *       radius = ceil(3·sigma), clamp-to-edge
 *    6. v = clamp(orig + amount·(orig − blurred), 0, 1)      (skipped entirely when amount == 0)
 *  Stage C — tone (GPU pass 4 / fused pass), in sRGB-encoded space:
 *    7. warmth w:   G ×= 1 − 0.12·w ;  B ×= 1 − 0.5·w
 *    8. brightness: v ×= brightness
 *    9. contrast:   v = (v − 0.5)·contrast + 0.5
 *   10. saturation: L = 0.2126 R + 0.7152 G + 0.0722 B (Rec.709 luma);  v = L + saturation·(v − L)
 *   11. clamp 0..1
 *   12. invert:     v = 1 − v            (when invert)
 *   13. tint:       v ×= tint            (renderer extension, default [1,1,1]; used by magnifier presets)
 *   14. clamp 0..1
 */

/** @typedef {import('../core/types.js').FilterParams} FilterParams */
/**
 * FilterParams plus renderer-only extensions.
 * @typedef {FilterParams & {tint?: number[]}} RenderParams
 */
/**
 * Fully-populated, validated parameters (what the renderer actually uses).
 * @typedef {{colorMatrix: number[], contrast: number, brightness: number, saturation: number,
 *   sharpenAmount: number, sharpenSigmaPx: number, zoom: number, invert: boolean, warmth: number, tint: number[]}} SanitizedParams
 */

export const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
/** Rec.709 / sRGB luma coefficients (applied to sRGB-encoded values, like CSS saturate()). */
export const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);
export const WARMTH_GREEN = 0.12;
export const WARMTH_BLUE = 0.5;
/** Largest blur sigma (device px) the renderer supports; larger values are clamped. */
export const MAX_SIGMA_DEVICE_PX = 20;
/** Largest number of bilinear tap pairs per blur direction (radius = ceil(3 * MAX_SIGMA) = 60 taps => 30 pairs). */
export const MAX_KERNEL_PAIRS = 32;

/** @param {number} v @param {number} lo @param {number} hi */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** @param {unknown} v @param {number} fallback */
function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

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

/**
 * @param {ArrayLike<number>|null|undefined} m
 * @param {number} [eps]
 */
export function isIdentityMatrix(m, eps = 1e-6) {
  if (!m || m.length !== 9) return true;
  for (let i = 0; i < 9; i++) if (Math.abs(m[i] - IDENTITY_MATRIX[i]) > eps) return false;
  return true;
}

/**
 * Row-major 3x3 (our contract) -> column-major Float32Array (what gl.uniformMatrix3fv expects with transpose=false).
 * @param {ArrayLike<number>} m
 */
export function toColumnMajor(m) {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

/**
 * Validate and complete parameters (untrusted input from storage). Out-of-range values are clamped
 * to safe ranges; missing values fall back to neutral.
 * @param {Partial<RenderParams>|null|undefined} p
 * @returns {SanitizedParams}
 */
export function sanitizeParams(p) {
  const src = p || {};
  const m = Array.isArray(src.colorMatrix) && src.colorMatrix.length === 9 && src.colorMatrix.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? src.colorMatrix.map((x) => clamp(x, -8, 8))
    : [...IDENTITY_MATRIX];
  const tint = Array.isArray(src.tint) && src.tint.length === 3 ? src.tint.map((x) => clamp(num(x, 1), 0, 1)) : [1, 1, 1];
  return {
    colorMatrix: m,
    contrast: clamp(num(src.contrast, 1), 0, 5),
    brightness: clamp(num(src.brightness, 1), 0, 5),
    saturation: clamp(num(src.saturation, 1), 0, 5),
    sharpenAmount: clamp(num(src.sharpenAmount, 0), 0, 8),
    sharpenSigmaPx: clamp(num(src.sharpenSigmaPx, 1), 0.3, 12),
    zoom: clamp(num(src.zoom, 1), 0.1, 20),
    invert: src.invert === true,
    warmth: clamp(num(src.warmth, 0), 0, 1),
    tint,
  };
}

/**
 * True when the parameters do not change pixels (zoom is geometry, not a pixel operation, and is ignored).
 * @param {Partial<RenderParams>|null|undefined} p
 */
export function isNeutralParams(p) {
  const s = sanitizeParams(p);
  return isIdentityMatrix(s.colorMatrix) && s.contrast === 1 && s.brightness === 1 && s.saturation === 1 &&
    s.sharpenAmount === 0 && !s.invert && s.warmth === 0 && s.tint.every((x) => x === 1);
}

/**
 * "Strength" control: scales the DEVIATION of every pixel parameter from neutral by `strength`
 * (0 = original, 1 = as prescribed, 1.5 = 150 %). Zoom (geometry) is left untouched.
 * The colour matrix is interpolated element-wise from identity: I + s·(M − I).
 * Invert (boolean) is kept when strength >= 0.5. Tint scales like a multiplier from 1.
 * @param {Partial<RenderParams>|null|undefined} p
 * @param {number} strength
 * @returns {SanitizedParams}
 */
export function scaleParams(p, strength) {
  const s = sanitizeParams(p);
  const k = Math.max(0, num(strength, 1));
  const lerp = (/** @type {number} */ v, /** @type {number} */ neutral) => neutral + k * (v - neutral);
  return sanitizeParams({
    colorMatrix: s.colorMatrix.map((v, i) => lerp(v, IDENTITY_MATRIX[i])),
    contrast: Math.max(0, lerp(s.contrast, 1)),
    brightness: Math.max(0, lerp(s.brightness, 1)),
    saturation: Math.max(0, lerp(s.saturation, 1)),
    sharpenAmount: Math.max(0, lerp(s.sharpenAmount, 0)),
    sharpenSigmaPx: s.sharpenSigmaPx,
    zoom: s.zoom,
    invert: s.invert && k >= 0.5,
    warmth: clamp(lerp(s.warmth, 0), 0, 1),
    tint: s.tint.map((v) => clamp(lerp(v, 1), 0, 1)),
  });
}

/**
 * Stage A for one pixel: sRGB in -> colour matrix in linear light -> sRGB out (clamped).
 * @param {number} r @param {number} g @param {number} b  sRGB-encoded 0..1
 * @param {SanitizedParams} p
 * @param {number[]|Float32Array} out  length >= 3
 */
export function colorStage(r, g, b, p, out) {
  const m = p.colorMatrix;
  if (isIdentityMatrix(m)) { out[0] = r; out[1] = g; out[2] = b; return out; }
  const lr = srgbToLinear(r); const lg = srgbToLinear(g); const lb = srgbToLinear(b);
  out[0] = linearToSrgb(clamp(m[0] * lr + m[1] * lg + m[2] * lb, 0, 1));
  out[1] = linearToSrgb(clamp(m[3] * lr + m[4] * lg + m[5] * lb, 0, 1));
  out[2] = linearToSrgb(clamp(m[6] * lr + m[7] * lg + m[8] * lb, 0, 1));
  return out;
}

/**
 * Stage C for one pixel (steps 7–14). Input and output sRGB-encoded 0..1.
 * @param {number} r @param {number} g @param {number} b
 * @param {SanitizedParams} p
 * @param {number[]|Float32Array} out
 */
export function toneStage(r, g, b, p, out) {
  const w = p.warmth; const br = p.brightness; const c = p.contrast; const s = p.saturation;
  // 7. warmth
  g *= 1 - WARMTH_GREEN * w;
  b *= 1 - WARMTH_BLUE * w;
  // 8. brightness
  r *= br; g *= br; b *= br;
  // 9. contrast around mid-grey
  r = (r - 0.5) * c + 0.5; g = (g - 0.5) * c + 0.5; b = (b - 0.5) * c + 0.5;
  // 10. saturation around Rec.709 luma
  const l = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
  r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s;
  // 11. clamp
  r = clamp(r, 0, 1); g = clamp(g, 0, 1); b = clamp(b, 0, 1);
  // 12. invert
  if (p.invert) { r = 1 - r; g = 1 - g; b = 1 - b; }
  // 13–14. tint + clamp
  out[0] = clamp(r * p.tint[0], 0, 1);
  out[1] = clamp(g * p.tint[1], 0, 1);
  out[2] = clamp(b * p.tint[2], 0, 1);
  return out;
}

/**
 * Unsharp-mask combine (step 6 before its clamp): out = orig + amount·(orig − blurred), element-wise.
 * The pipeline clamps the result to 0..1 afterwards.
 * @template {number[]|Float32Array|Float64Array} T
 * @param {ArrayLike<number>} orig
 * @param {ArrayLike<number>} blurred
 * @param {number} amount
 * @param {T} [out]
 * @returns {T|number[]}
 */
export function unsharpCombine(orig, blurred, amount, out) {
  const o = out || new Array(orig.length);
  for (let i = 0; i < orig.length; i++) o[i] = orig[i] + amount * (orig[i] - blurred[i]);
  return o;
}

/**
 * The whole per-pixel pipeline for a single pixel when no neighbourhood is available
 * (equivalently: blurred == orig, so the unsharp mask is a no-op).
 * @param {number} r @param {number} g @param {number} b  sRGB 0..1
 * @param {Partial<RenderParams>|SanitizedParams} params
 * @returns {number[]}
 */
export function applyPixel(r, g, b, params) {
  const p = sanitizeParams(params);
  const tmp = [0, 0, 0];
  colorStage(r, g, b, p, tmp);
  return toneStage(tmp[0], tmp[1], tmp[2], p, [0, 0, 0]);
}

/**
 * Normalized, symmetric 1-D Gaussian kernel, radius = ceil(3·sigma). sigma <= 0 => [1].
 * @param {number} sigma  in pixels
 * @returns {number[]}  length 2·radius + 1, sums to 1
 */
export function gaussianKernel(sigma) {
  if (!(sigma > 0)) return [1];
  const radius = Math.ceil(3 * sigma);
  const k = new Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/**
 * The same kernel re-expressed for GPU "linear sampling": one centre tap plus symmetric pairs of
 * bilinear taps, each pair merging two adjacent discrete taps (i, i+1) into one fetch at a fractional
 * offset. With exact bilinear filtering the result equals the discrete convolution.
 * sum(center + 2·Σ weights) == 1.
 * @param {number} sigma  device px (clamped to MAX_SIGMA_DEVICE_PX)
 * @returns {{center: number, offsets: number[], weights: number[]}}
 */
export function linearSampleKernel(sigma) {
  const k = gaussianKernel(Math.min(sigma, MAX_SIGMA_DEVICE_PX));
  const r = (k.length - 1) / 2;
  /** @type {number[]} */ const offsets = [];
  /** @type {number[]} */ const weights = [];
  for (let i = 1; i <= r; i += 2) {
    const w1 = k[r + i];
    const w2 = i + 1 <= r ? k[r + i + 1] : 0;
    const w = w1 + w2;
    offsets.push(w > 0 ? (i * w1 + (i + 1) * w2) / w : i);
    weights.push(w);
  }
  return { center: k[r], offsets: offsets.slice(0, MAX_KERNEL_PAIRS), weights: weights.slice(0, MAX_KERNEL_PAIRS) };
}

/**
 * Separable Gaussian blur of a planar/interleaved float image with clamp-to-edge.
 * @param {Float32Array} src  interleaved, `channels` values per pixel
 * @param {number} width @param {number} height @param {number} channels
 * @param {number} sigma  px
 * @returns {Float32Array}
 */
export function gaussianBlur(src, width, height, channels, sigma) {
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  if (r === 0) return new Float32Array(src);
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  // horizontal
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) {
          const xx = x + i < 0 ? 0 : x + i >= width ? width - 1 : x + i;
          acc += k[i + r] * src[(row + xx) * channels + c];
        }
        tmp[(row + x) * channels + c] = acc;
      }
    }
  }
  // vertical
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) {
          const yy = y + i < 0 ? 0 : y + i >= height ? height - 1 : y + i;
          acc += k[i + r] * tmp[(yy * width + x) * channels + c];
        }
        dst[(y * width + x) * channels + c] = acc;
      }
    }
  }
  return dst;
}

/**
 * Full pipeline on an RGBA8 buffer (e.g. ImageData.data), IN PLACE. Output alpha is 255.
 * @param {Uint8ClampedArray|Uint8Array} data  RGBA, width·height·4
 * @param {number} width @param {number} height
 * @param {Partial<RenderParams>|SanitizedParams} params
 * @param {number} [sigmaDevicePx]  blur sigma in pixels of this buffer (default: params.sharpenSigmaPx, i.e. dpr 1)
 */
export function processImageData(data, width, height, params, sigmaDevicePx) {
  const p = sanitizeParams(params);
  const n = width * height;
  const a = new Float32Array(n * 3);
  const px = [0, 0, 0];
  const identity = isIdentityMatrix(p.colorMatrix);
  /** @type {Float32Array|null} */
  let lut = null;
  if (!identity) {
    lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  }
  const m = p.colorMatrix;
  // Stage A
  for (let i = 0; i < n; i++) {
    const al = data[i * 4 + 3] / 255;
    let r = data[i * 4] / 255; let g = data[i * 4 + 1] / 255; let b = data[i * 4 + 2] / 255;
    if (al < 1) { r = r * al + (1 - al); g = g * al + (1 - al); b = b * al + (1 - al); }
    if (identity) { a[i * 3] = r; a[i * 3 + 1] = g; a[i * 3 + 2] = b; continue; }
    // Exact 8-bit inputs use the LUT; composited (fractional) inputs use the formula.
    const lr = al < 1 ? srgbToLinear(r) : /** @type {Float32Array} */ (lut)[data[i * 4]];
    const lg = al < 1 ? srgbToLinear(g) : /** @type {Float32Array} */ (lut)[data[i * 4 + 1]];
    const lb = al < 1 ? srgbToLinear(b) : /** @type {Float32Array} */ (lut)[data[i * 4 + 2]];
    a[i * 3] = linearToSrgb(clamp(m[0] * lr + m[1] * lg + m[2] * lb, 0, 1));
    a[i * 3 + 1] = linearToSrgb(clamp(m[3] * lr + m[4] * lg + m[5] * lb, 0, 1));
    a[i * 3 + 2] = linearToSrgb(clamp(m[6] * lr + m[7] * lg + m[8] * lb, 0, 1));
  }
  // Stage B
  let v = a;
  if (p.sharpenAmount > 0) {
    const sigma = sigmaDevicePx === undefined ? p.sharpenSigmaPx : Math.min(sigmaDevicePx, MAX_SIGMA_DEVICE_PX);
    const blurred = gaussianBlur(a, width, height, 3, sigma);
    v = /** @type {Float32Array} */ (unsharpCombine(a, blurred, p.sharpenAmount, new Float32Array(a.length)));
    for (let i = 0; i < v.length; i++) v[i] = clamp(v[i], 0, 1);
  }
  // Stage C
  for (let i = 0; i < n; i++) {
    toneStage(v[i * 3], v[i * 3 + 1], v[i * 3 + 2], p, px);
    data[i * 4] = Math.round(px[0] * 255);
    data[i * 4 + 1] = Math.round(px[1] * 255);
    data[i * 4 + 2] = Math.round(px[2] * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}

/**
 * CSS/canvas `filter` string approximating the tone stage (used by the 2D fallback for video and
 * during gestures). Colour matrix, sharpening and tint are NOT represented (approximation only).
 * CSS brightness/contrast/saturate/invert are defined in sRGB exactly like steps 8–12.
 * @param {Partial<RenderParams>|SanitizedParams} params
 */
export function cssFilterApprox(params) {
  const p = sanitizeParams(params);
  const parts = [];
  if (p.warmth > 0) parts.push(`sepia(${round(p.warmth * 0.35, 3)})`);
  if (p.brightness !== 1) parts.push(`brightness(${round(p.brightness, 3)})`);
  if (p.contrast !== 1) parts.push(`contrast(${round(p.contrast, 3)})`);
  if (p.saturation !== 1) parts.push(`saturate(${round(p.saturation, 3)})`);
  if (p.invert) parts.push('invert(1)');
  return parts.length ? parts.join(' ') : 'none';
}

/** @param {number} v @param {number} d */
function round(v, d) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
