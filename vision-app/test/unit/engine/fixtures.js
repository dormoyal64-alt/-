// Shared inputs for the engine tests: an iPhone-15-like calibrated screen and a few realistic personas.
/** iPhone 15: 0.1657 mm per CSS px (spec §1, §4.3 worked examples). */
export const IPHONE15_MM_PER_CSS = 0.1657;
export const IPHONE15_PX_PER_MM = 1 / IPHONE15_MM_PER_CSS;
const AT = '2026-09-29T08:00:00.000Z';

/** @param {'right'|'left'|'both'} eye @param {number} logMAR @param {object} [extra] */
export function acuity(eye, logMAR, extra = {}) {
  return {
    eye, logMAR, decimal: 10 ** -logMAR, snellen6: '', snellen20: '', distanceMm: 350,
    reliable: true, floorLimited: false, trials: 24, durationMs: 60000, ...extra,
  };
}

/** Base input: calibrated iPhone 15 at 350 mm, nothing measured yet. @param {object} [over] */
export function baseInput(over = {}) {
  return {
    screen: { cssPxPerMm: IPHONE15_PX_PER_MM, dpr: 3, method: 'card', screenWidthCssPx: 393, screenHeightCssPx: 852, measuredAt: AT },
    distance: { distanceMm: 350, method: 'camera', measuredAt: AT },
    acuity: {},
    ...over,
  };
}

/** Binocular-equivalent: both eyes at L (reliable). @param {number} L @param {object} [over] */
export function eyesInput(L, over = {}) {
  return baseInput({ acuity: { right: acuity('right', L), left: acuity('left', L) }, ...over });
}

export const PERSONAS = {
  youngNormal: () => baseInput({
    age: 28, wearsCorrection: false,
    acuity: { right: acuity('right', -0.1), left: acuity('left', -0.08) },
    reading: { criticalPrintSizeLogMAR: 0.05, readingAcuityLogMAR: -0.1, maxReadingSpeedWpm: 210, distanceMm: 350, reliable: true },
    contrast: { eye: 'both', logCS: 1.95, reliable: true },
    color: { type: 'normal', severity: 0, confidence: 0.9, reliable: true },
    astigmatism: { right: { eye: 'right', suspected: false, axisDeg: null }, left: { eye: 'left', suspected: false, axisDeg: null } },
    focus: { eye: 'both', nearPointMm: 110, farPointMm: null },
    prefs: { theme: 'auto', lightSensitivity: 'normal' },
  }),
  presbyope: () => baseInput({
    age: 64, wearsCorrection: false,
    distance: { distanceMm: 380, method: 'camera', measuredAt: AT },
    acuity: { right: acuity('right', 0.45, { distanceMm: 380 }), left: acuity('left', 0.4, { distanceMm: 380 }) },
    reading: { criticalPrintSizeLogMAR: 0.55, readingAcuityLogMAR: 0.35, maxReadingSpeedWpm: 150, distanceMm: 380, reliable: true },
    contrast: { eye: 'both', logCS: 1.55, reliable: true },
    color: { type: 'normal', severity: 0, confidence: 0.8, reliable: true },
    focus: { eye: 'both', nearPointMm: 700, farPointMm: null },
    prefs: { theme: 'light', lightSensitivity: 'high' },
  }),
  strongDeutan: () => baseInput({
    age: 25, wearsCorrection: false,
    acuity: { right: acuity('right', -0.05), left: acuity('left', 0.0) },
    contrast: { eye: 'both', logCS: 1.9, reliable: true },
    color: { type: 'deutan', severity: 0.9, confidence: 0.95, reliable: true },
    prefs: { theme: 'auto' },
  }),
  lowVision: () => baseInput({
    age: 55, wearsCorrection: true,
    distance: { distanceMm: 300, method: 'camera', measuredAt: AT },
    acuity: { right: acuity('right', 0.7, { distanceMm: 300 }), left: acuity('left', 0.75, { distanceMm: 300 }) },
    contrast: { eye: 'both', logCS: 1.2, reliable: true },
    color: { type: 'normal', severity: 0, confidence: 0.6, reliable: true },
    astigmatism: { right: { eye: 'right', suspected: true, axisDeg: 90, consistent: true } },
    prefs: { theme: 'dark', lightSensitivity: 'normal' },
  }),
};

/** Every number anywhere inside `v` (deep). @param {any} v @param {string} [path] @returns {Array<[string, number]>} */
export function allNumbers(v, path = '') {
  if (typeof v === 'number') return [[path, v]];
  if (!v || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => allNumbers(x, `${path}.${k}`));
}

/** Every string anywhere inside `v` (deep). @param {any} v @returns {string[]} */
export function allStrings(v) {
  if (typeof v === 'string') return [v];
  if (!v || typeof v !== 'object') return [];
  return Object.values(v).flatMap(allStrings);
}
