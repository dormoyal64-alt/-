// @ts-check
/**
 * A hand-written, plausible VisionProfile used ONLY by the dev harness and tests of modules that
 * consume a profile (viewers, UI adaptation) before the real engine output is available.
 * Scenario: 58-year-old with presbyopia (reduced near acuity), mild deutan colour deficiency.
 */
import { IDENTITY3 } from './types.js';

/** @returns {import('./types.js').VisionProfile} */
export function demoProfile() {
  const now = new Date('2026-01-01T10:00:00Z').toISOString();
  return {
    version: 1,
    id: 'demo-profile',
    name: 'Demo',
    createdAt: now,
    updatedAt: now,
    input: {
      screen: { cssPxPerMm: 6.3, dpr: 3, method: 'card', screenWidthCssPx: 393, screenHeightCssPx: 852, measuredAt: now },
      distance: { distanceMm: 400, method: 'blindspot', measuredAt: now },
      age: 58,
      wearsCorrection: false,
      acuity: {
        right: { eye: 'right', logMAR: 0.4, decimal: 0.398, snellen6: '6/15', snellen20: '20/50', distanceMm: 400, reliable: true, floorLimited: false, trials: 24, durationMs: 60000 },
        left: { eye: 'left', logMAR: 0.3, decimal: 0.501, snellen6: '6/12', snellen20: '20/40', distanceMm: 400, reliable: true, floorLimited: false, trials: 22, durationMs: 55000 },
      },
      reading: { criticalPrintSizeLogMAR: 0.6, readingAcuityLogMAR: 0.35, maxReadingSpeedWpm: 160, distanceMm: 400, reliable: true },
      contrast: { eye: 'both', logCS: 1.5, reliable: true },
      color: { type: 'deutan', severity: 0.6, confidence: 0.8, reliable: true },
      prefs: { theme: 'auto', lightSensitivity: 'normal' },
    },
    text: { baseFontPx: 24, scale: 1.5, fontWeight: 500, lineHeight: 1.6, letterSpacingEm: 0.02, wordSpacingEm: 0.08 },
    media: {
      colorMatrix: [1, 0, 0, -0.2, 1.1, 0.1, 0.1, -0.1, 1],
      contrast: 1.15, brightness: 1.05, saturation: 1.1, sharpenAmount: 0.8, sharpenSigmaPx: 1.5, zoom: 1.5, invert: false, warmth: 0,
    },
    ui: {
      colorMatrix: [...IDENTITY3], contrast: 1.1, brightness: 1, saturation: 1, sharpenAmount: 0, sharpenSigmaPx: 1, zoom: 1, invert: false, warmth: 0,
    },
    system: {
      textScale: 1.5, boldText: true, increaseContrast: true,
      colorFilter: { type: 'deutan', intensity: 0.6 }, reduceWhitePoint: false, darkMode: false, displayZoom: 1.15, magnificationShortcut: true,
    },
    flags: [{ level: 'recommend', code: 'NEAR_ACUITY_REDUCED' }],
    viewing: { recommendedDistanceMm: 400 },
  };
}
