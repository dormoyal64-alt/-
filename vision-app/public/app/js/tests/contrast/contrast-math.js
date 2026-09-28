// @ts-check
/**
 * Contrast math (vision-science.md §5, items 22–23). Pure module, no DOM.
 * Weber contrast in linear light against a white (255,255,255) background: C = (Lbg − Lletter)/Lbg,
 * logCS = −log10(C). Low contrasts are realised with "bit-stealing" (unequal R/G/B steps) because plain
 * 8-bit grey steps cannot go below C ≈ 0.89 % (logCS 2.05).
 */

/** Rec. 709 / sRGB luminance weights. */
export const LUMA = Object.freeze({ r: 0.2126, g: 0.7152, b: 0.0722 });

/** Letter height of the contrast optotype in degrees (§5.2). */
export const CONTRAST_LETTER_DEG = 2.8;

/** Pelli–Robson triplet levels: logCS 0.00 … 2.25 in 0.15 steps (16 triplets, §5.1). */
export const PELLI_ROBSON_LOGCS = Object.freeze(Array.from({ length: 16 }, (_, i) => Number((i * 0.15).toFixed(2))));

/** sRGB decode, component in 0..1 (item 27). @param {number} c */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB encode, linear 0..1 → 0..1 (item 27). @param {number} y */
export function linearToSrgb(y) {
  return y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
}

const LIN8 = Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

/** Relative luminance (0..1) of an 8-bit sRGB colour. @param {number} r @param {number} g @param {number} b */
export function luminance8(r, g, b) {
  return LUMA.r * LIN8[r] + LUMA.g * LIN8[g] + LUMA.b * LIN8[b];
}

/** Weber contrast of a letter luminance against a background luminance. @param {number} yLetter @param {number} [yBg] */
export function weberContrast(yLetter, yBg = 1) {
  return (yBg - yLetter) / yBg;
}

/** logCS = −log10(C). @param {number} C */
export function logCSFromContrast(C) {
  return -Math.log10(C);
}

/** C = 10^−logCS. @param {number} logCS */
export function contrastFromLogCS(logCS) {
  return 10 ** -logCS;
}

/** logCS of a plain grey level on white. @param {number} grey 0..255 */
export function greyLogCS(grey) {
  return logCSFromContrast(weberContrast(luminance8(grey, grey, grey)));
}

/**
 * @typedef {Object} BitStolenColour
 * @property {number} r
 * @property {number} g
 * @property {number} b
 * @property {number} luminance  relative luminance (white = 1)
 * @property {number} contrast   actual Weber contrast on white
 * @property {number} logC       log10(contrast)
 * @property {string} css        CSS colour string
 */

/**
 * Bit-stealing: the 8-bit colour whose luminance on a white background gives the Weber contrast closest to
 * `targetC`. Channels stay within ±1 code value of a common grey level (invisible chroma error on large
 * letters); among equally close candidates the most neutral one wins. Never returns pure white (C > 0).
 * @param {number} targetC Weber contrast 0 < C ≤ 1
 * @returns {BitStolenColour}
 */
export function bitStealColour(targetC) {
  const C = Math.min(1, Math.max(0, targetC));
  const yTarget = 1 - C;
  const g0 = Math.round(linearToSrgb(yTarget) * 255);
  let best = null;
  let bestErr = Infinity;
  let bestChroma = Infinity;
  for (let grey = Math.max(0, g0 - 2); grey <= Math.min(255, g0 + 2); grey++) {
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
      const r = grey + dr; const g = grey + dg; const b = grey + db;
      if (r < 0 || g < 0 || b < 0 || r > 255 || g > 255 || b > 255) continue;
      if (r === 255 && g === 255 && b === 255) continue;
      const y = luminance8(r, g, b);
      const err = Math.abs(Math.log10(weberContrast(y)) - Math.log10(Math.max(C, 1e-6)));
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (err < bestErr - 1e-12 || (Math.abs(err - bestErr) <= 1e-12 && chroma < bestChroma)) {
        best = { r, g, b, y }; bestErr = err; bestChroma = chroma;
      }
    }
  }
  const contrast = weberContrast(best.y);
  return {
    r: best.r, g: best.g, b: best.b, luminance: best.y, contrast,
    logC: Math.log10(contrast),
    css: `rgb(${best.r}, ${best.g}, ${best.b})`,
  };
}

/** Smallest non-zero contrast that bit-stealing can produce on white (B − 1 step, logCS ≈ 3.19). */
export function minAchievableContrast() {
  return weberContrast(luminance8(255, 255, 254));
}

/**
 * Letter-by-letter Pelli–Robson score (alternative clinical-style mode): logCS = 0.05·letters − 0.15.
 * @param {number} lettersCorrect
 */
export function pelliRobsonLetterScore(lettersCorrect) {
  return 0.05 * lettersCorrect - 0.15;
}

/**
 * Physical height of a letter subtending `deg` degrees at distance d: h = 2·d·tan(deg/2).
 * @param {number} deg @param {number} dMm
 */
export function sizeMmForDegrees(deg, dMm) {
  return 2 * dMm * Math.tan((deg * Math.PI) / 360);
}
