// @ts-check
/**
 * Clock-dial line-sharpness check — geometry and inference (vision-science.md §6.2, item 26). Pure, no DOM.
 *
 * Angles: a spoke is a straight line through the dial centre; `phi` is its direction in degrees measured
 * counter-clockwise from the screen's horizontal (0 = horizontal, 90 = vertical), taken modulo 180.
 * Clock positions: hour h sits 30·h degrees clockwise from 12 o'clock, i.e. at math angle 90 − 30·h.
 */

import { FOCUS } from '../../calibration/calibration-math.js';

export const DIAL = Object.freeze({
  spokes: 12,               // 12 lines through the centre at 15° intervals (24 half-hour clock positions)
  spokeStepDeg: 15,
  linesPerSpoke: 3,
  lineWidthArcmin: 1.5,
  lineGapArcmin: 1.5,
  spokeLengthDeg: 5,        // full length of each spoke (both sides of the centre)
  innerClearFraction: 0.3,  // central zone kept clear so neighbouring spokes do not merge
  presentations: 3,
  consistencyTolDeg: 15,    // "consistent" = ≥ 2 of 3 answers within ±15°
  minLineDevPx: 1,
});

const ARCMIN_RAD = Math.PI / 10800;
/** Where the focus-range far sweep starts (calibration-math FOCUS.farStartMm). */
const FAR_SWEEP_START_MM = FOCUS.farStartMm;

/** Circular distance between two line orientations (mod 180), in [0, 90]. @param {number} a @param {number} b */
export function lineAngleDiff(a, b) {
  const d = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(d, 180 - d);
}

/** Normalise to [0, 180). @param {number} a */
export function norm180(a) {
  return ((a % 180) + 180) % 180;
}

/** Spoke directions for a dial rotated by `offsetDeg`. @param {number} offsetDeg */
export function spokeAngles(offsetDeg) {
  return Array.from({ length: DIAL.spokes }, (_, k) => norm180(offsetDeg + k * DIAL.spokeStepDeg));
}

/**
 * Index of the spoke closest to a tap at screen offset (dx, dy) from the dial centre (dy grows downwards).
 * @param {number} dx @param {number} dy @param {number} offsetDeg
 */
export function spokeIndexForTap(dx, dy, offsetDeg) {
  const phi = norm180((Math.atan2(-dy, dx) * 180) / Math.PI);
  let best = 0; let bestD = Infinity;
  spokeAngles(offsetDeg).forEach((a, k) => {
    const d = lineAngleDiff(a, phi);
    if (d < bestD) { bestD = d; best = k; }
  });
  return best;
}

/**
 * The two clock positions (hours in (0, 12]) a line through the centre points at.
 * @param {number} phi
 * @returns {[number, number]}
 */
export function clockHoursForLine(phi) {
  const h = ((((90 - norm180(phi)) / 30) % 12) + 12) % 12;
  const a = h === 0 ? 12 : h;
  const b = ((h + 6) % 12) === 0 ? 12 : (h + 6) % 12;
  return a < b ? [a, b] : [b, a];
}

/**
 * Axis (internal only) by the rule of 30: axis = 30° × lower clock hour of the chosen line, with the lower
 * hour snapped to half hours; 6 o'clock → 180°. Result in (0, 180].
 * Examples (fogged): 12–6 → 180, 3–9 → 90, 1–7 → 30.
 *
 * The rule of 30 assumes a FOGGED eye (both focal lines in front of the retina, §6.1): the focal line of the
 * weaker meridian (= minus-cylinder axis) is then nearest the retina and the sharp line runs perpendicular to the
 * axis. A phone cannot fog (§6.2): an unfogged eye looking at the dial with the usual accommodative lag has the
 * focal lines straddling the retina with the STRONGER meridian's line nearest, so the darkest line runs along
 * the axis meridian — the rule of 30 is then 90° off (glasses-free simulation: ≥ 90 % of detections). With
 * `fogged: false` the axis is taken from the perpendicular line. Only an uncorrected eye viewing the dial from
 * beyond its far point is fogged (see isFoggedAt).
 * @param {number} phi @param {{fogged?: boolean}} [o]
 */
export function axisFromLineAngle(phi, { fogged = true } = {}) {
  const [lower] = clockHoursForLine(fogged ? phi : phi + 90);
  const snapped = Math.round(lower * 2) / 2;
  const axis = 30 * snapped;
  return axis === 0 ? 180 : axis;
}

/**
 * Is the eye "fogged" (focus in front of the retina) while looking at the dial? True only when the focus-range
 * test measured a credible far point nearer than the dial. Not credible: a far point at the far sweep's start
 * (≤ 1.25 × 20 cm) — constant blur from astigmatism ends the sweep right there (glasses-free simulation: every
 * 1.5–2.5 D cylinder) — or one not beyond the near point. Strong myopes (≥ ~4 D) are therefore treated as
 * unfogged; their blur makes all spokes look alike, so they rarely give a consistent answer anyway.
 * @param {{nearPointMm?: number|null, farPointMm?: number|null}|null|undefined} focus  focus-range result (binocular)
 * @param {number} dialDistanceMm
 */
export function isFoggedAt(focus, dialDistanceMm) {
  const fin = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const far = focus?.farPointMm;
  const near = focus?.nearPointMm;
  if (!fin(far) || !Number.isFinite(dialDistanceMm)) return false;
  const f = /** @type {number} */ (far);
  if (f >= dialDistanceMm || f <= FAR_SWEEP_START_MM * 1.25) return false;
  return !(fin(near) && /** @type {number} */ (near) >= f);
}

/**
 * Circular mean of line orientations (period 180°).
 * @param {number[]} angles
 */
export function meanLineAngle(angles) {
  let sx = 0; let sy = 0;
  for (const a of angles) { const r = (2 * a * Math.PI) / 180; sx += Math.cos(r); sy += Math.sin(r); }
  return norm180((Math.atan2(sy, sx) * 180) / Math.PI / 2);
}

/**
 * @typedef {Object} DialInference
 * @property {boolean} suspected     a consistent darker/sharper direction was reported
 * @property {number|null} axisDeg   internal-only axis estimate, (0, 180]
 * @property {number|null} lineAngleDeg  mean orientation of the consistent answers
 * @property {number} equalCount     how many times "all look the same" was chosen
 */

/**
 * Infer from the answers of the presentations: a number (chosen line orientation) or 'equal'.
 * Consistent = at least 2 answers within ±15° of each other (§6.2). The axis uses the mean orientation of
 * the largest consistent group (rule of 30 when fogged, perpendicular line otherwise — see axisFromLineAngle).
 * @param {Array<number|'equal'>} answers @param {{fogged?: boolean}} [o]
 * @returns {DialInference}
 */
export function inferFromAnswers(answers, { fogged = true } = {}) {
  const lines = /** @type {number[]} */ (answers.filter((a) => typeof a === 'number'));
  const equalCount = answers.length - lines.length;
  /** @type {number[]} */
  let group = [];
  for (const a of lines) {
    const members = lines.filter((b) => lineAngleDiff(a, b) <= DIAL.consistencyTolDeg);
    if (members.length > group.length) group = members;
  }
  if (group.length < 2) return { suspected: false, axisDeg: null, lineAngleDeg: null, equalCount };
  const lineAngleDeg = meanLineAngle(group);
  return { suspected: true, axisDeg: axisFromLineAngle(lineAngleDeg, { fogged }), lineAngleDeg, equalCount };
}

/**
 * @typedef {{x: number, y: number}} Pt
 */

/**
 * Dial geometry in device px. Line width/gap are angular (1.5′) at distance d; the spoke length is 5°
 * unless it has to shrink to fit `maxRadiusDevPx`.
 * @param {{dMm: number, cssPxPerMm: number, dpr: number, maxRadiusDevPx: number}} o
 */
export function dialGeometry({ dMm, cssPxPerMm, dpr, maxRadiusDevPx }) {
  const devPerMm = cssPxPerMm * dpr;
  const lineDev = Math.max(DIAL.minLineDevPx, 2 * dMm * Math.tan((DIAL.lineWidthArcmin * ARCMIN_RAD) / 2) * devPerMm);
  const gapDev = Math.max(DIAL.minLineDevPx, 2 * dMm * Math.tan((DIAL.lineGapArcmin * ARCMIN_RAD) / 2) * devPerMm);
  const idealR = dMm * Math.tan(((DIAL.spokeLengthDeg / 2) * Math.PI) / 180) * devPerMm;
  const outerR = Math.min(idealR, maxRadiusDevPx);
  return { lineDev, gapDev, outerR, innerR: outerR * DIAL.innerClearFraction, idealR, shrunk: outerR < idealR };
}

/**
 * Quadrilaterals (4 corners each, device px) for all lines of one spoke: `linesPerSpoke` parallel lines,
 * each drawn on both sides of the centre from innerR to outerR.
 * @param {{cx: number, cy: number, phi: number, lineDev: number, gapDev: number, innerR: number, outerR: number}} o
 * @returns {Pt[][]}
 */
export function spokeQuads({ cx, cy, phi, lineDev, gapDev, innerR, outerR }) {
  const r = (phi * Math.PI) / 180;
  const ux = Math.cos(r); const uy = -Math.sin(r);   // along the spoke (screen y grows down)
  const nx = -uy; const ny = ux;                     // perpendicular
  const pitch = lineDev + gapDev;
  const quads = [];
  for (let i = 0; i < DIAL.linesPerSpoke; i++) {
    const off = (i - (DIAL.linesPerSpoke - 1) / 2) * pitch;
    for (const side of [1, -1]) {
      const a = innerR * side; const b = outerR * side;
      const ox = cx + nx * off; const oy = cy + ny * off;
      const hw = lineDev / 2;
      quads.push([
        { x: ox + ux * a + nx * hw, y: oy + uy * a + ny * hw },
        { x: ox + ux * b + nx * hw, y: oy + uy * b + ny * hw },
        { x: ox + ux * b - nx * hw, y: oy + uy * b - ny * hw },
        { x: ox + ux * a - nx * hw, y: oy + uy * a - ny * hw },
      ]);
    }
  }
  return quads;
}
