// @ts-check
/**
 * Pure helpers that turn raw results into FUNCTIONAL, plain-language findings (message keys + params).
 * No clinical notation here: technical values are shown only behind FEATURES.showTechnicalValues.
 */

import { detailScore as engineDetailScore } from '../engine/profile.js';

/** @typedef {import('../core/types.js').VisionProfile} VisionProfile */
/** @typedef {import('../core/types.js').AcuityResult} AcuityResult */
/** @typedef {import('../core/types.js').ColorResult} ColorResult */

/**
 * "Screen detail" level 0..100 at the tested distance (100 = sees the finest detail we can draw).
 * Delegates to the engine (single source of truth): score = clamp(round(100·(1.0 − logMAR)/1.2), 0, 100).
 * @param {number|null|undefined} logMAR
 * @returns {number|null}
 */
export function detailScore(logMAR) {
  return engineDetailScore(logMAR);
}

/** @param {number|null} score @returns {'excellent'|'good'|'fair'|'low'|null} */
export function detailBand(score) {
  if (score === null) return null;
  if (score >= 80) return 'excellent';
  if (score >= 58) return 'good';
  if (score >= 40) return 'fair';
  return 'low';
}

/** @param {number|null|undefined} logCS @returns {'good'|'reduced'|'low'|null} */
export function contrastBand(logCS) {
  if (typeof logCS !== 'number' || !Number.isFinite(logCS)) return null;
  if (logCS >= 1.65) return 'good';
  if (logCS >= 1.35) return 'reduced';
  return 'low';
}

/**
 * @param {ColorResult|null|undefined} c
 * @returns {{key: 'none'|'redGreen'|'blueYellow'|'other', degree: 'slight'|'moderate'|'marked'|null}|null}
 */
export function colorFinding(c) {
  if (!c) return null;
  if (c.type === 'normal' || c.severity < 0.1) return { key: 'none', degree: null };
  const degree = c.severity < 0.35 ? 'slight' : c.severity < 0.7 ? 'moderate' : 'marked';
  const key = c.type === 'protan' || c.type === 'deutan' ? 'redGreen' : c.type === 'tritan' ? 'blueYellow' : 'other';
  return { key, degree };
}

/** Text scale as a whole percentage (1.5 => 150). @param {number|null|undefined} scale */
export function textScalePercent(scale) {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return null;
  return Math.round(scale * 100);
}

/**
 * Per-eye summary rows for the results screen.
 * @param {VisionProfile} p
 */
export function eyeSummaries(p) {
  const a = p.input?.acuity || {};
  return /** @type {const} */ (['right', 'left']).map((eye) => {
    const r = a[eye];
    const score = detailScore(r?.logMAR);
    const astig = p.input?.astigmatism?.[eye];
    return {
      eye,
      measured: !!r,
      score,
      band: detailBand(score),
      reliable: r ? r.reliable !== false : true,
      floorLimited: !!r?.floorLimited,
      lines: astig ? (astig.suspected ? 'uneven' : 'even') : null,
      acuity: r || null,
    };
  });
}

/** Sort flags: urgent first, then recommend, then info. @param {import('../core/types.js').ProfileFlag[]} flags */
export function sortFlags(flags) {
  const rank = { urgent: 0, recommend: 1, info: 2 };
  return [...(flags || [])].sort((x, y) => (rank[x.level] ?? 3) - (rank[y.level] ?? 3));
}
