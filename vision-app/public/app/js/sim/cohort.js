// @ts-check
/**
 * SYNTHETIC COHORT for the glasses-free validation (internal research data — prescriptions are fine here).
 *
 * Assumptions (stated for the report):
 * - Prescriptions are exact spectacle-plane refractions of otherwise healthy eyes (no amblyopia, cataract, disease).
 * - Both eyes share the prescription unless stated (anisometropia case).
 * - Pupil: Watson & Yellott 2012 at 150 cd/m², 270 deg², age-dependent, + individual N(0, 0.3 mm).
 * - Amplitude: Hofstetter mean + individual N(0, 1 D), kept within Hofstetter [min − 0.5, max] and ≥ 0.
 * - Best-corrected logMAR: age norm (−0.08 to 40 y, +0.0025/y after) + individual N(0, 0.03).
 * - Habitual phone distance 30–45 cm (teens 28–35 cm: they hold phones closer).
 * - Devices: iPhone-15-like (393×852 CSS px, dpr 3, 6.035 px/mm) and Pixel-8-like (412×915, dpr 2.625, 6.42 px/mm).
 */
import { createEye, hofstetterAmplitude, watsonYellottPupilMm, neuralFloorLogMAR } from './eye-model.js';
import { mulberry32 } from '../tests/acuity/random.js';
import { gauss } from './observers.js';

/** @typedef {import('./eye-model.js').SimulatedEye} SimulatedEye */

/**
 * @typedef {Object} Rx
 * @property {number} sphere
 * @property {number} [cyl]
 * @property {number} [axisDeg]
 */

/**
 * @typedef {Object} Device
 * @property {string} name
 * @property {number} cssPxPerMm
 * @property {number} dpr
 * @property {number} widthCssPx
 * @property {number} heightCssPx
 */

/**
 * @typedef {Object} SimUser
 * @property {string} id
 * @property {string} group       prescription group for the coverage table
 * @property {string} label       human-readable prescription (internal)
 * @property {number} age
 * @property {Rx} right
 * @property {Rx} left
 * @property {number} habitualMm
 * @property {Device} device
 */

export const DEVICES = Object.freeze({
  iphone15: Object.freeze({ name: 'iPhone-15-like', cssPxPerMm: 1 / 0.1657, dpr: 3, widthCssPx: 393, heightCssPx: 852 }),
  pixel8: Object.freeze({ name: 'Pixel-8-like', cssPxPerMm: 428 / 25.4 / 2.625, dpr: 2.625, widthCssPx: 412, heightCssPx: 915 }),
});

/** @param {number} n */
const fmt = (n) => (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));
/** @param {Rx} rx */
export function rxLabel(rx) {
  return rx.cyl ? `${fmt(rx.sphere)}/${fmt(rx.cyl)}×${rx.axisDeg}` : `${fmt(rx.sphere)}`;
}

/**
 * The full cohort (61 users).
 * @returns {SimUser[]}
 */
export function buildCohort() {
  /** @type {Array<Omit<SimUser, 'habitualMm'|'device'|'label'> & {habitualMm?: number}>} */
  const list = [];
  const same = (/** @type {Rx} */ rx) => ({ right: rx, left: rx });
  list.push({ id: 'emm-25', group: 'emmetropic <45', age: 25, ...same({ sphere: 0 }) });
  // Myopia, adults 25–40
  const myopes = [[-0.5, 28], [-1, 30], [-1.5, 32], [-2, 35], [-3, 27], [-4, 38], [-5, 31], [-6, 36], [-8, 40]];
  for (const [s, age] of myopes) list.push({ id: `myo${s}-${age}`, group: myopiaGroup(s), age, ...same({ sphere: s }) });
  // Myopia, teens 12–16
  for (const [s, age] of [[-0.75, 12], [-1, 13], [-2, 15], [-3, 16]]) {
    list.push({ id: `teen${s}-${age}`, group: 'teens (12–16)', age, habitualMm: 280 + (age - 12) * 15, ...same({ sphere: s }) });
  }
  // Hyperopia at 25 / 45 / 60
  for (const s of [0.5, 1, 2, 3]) for (const age of [25, 45, 60]) {
    list.push({ id: `hyp+${s}-${age}`, group: age < 45 ? 'hyperopia <45' : 'hyperopia ≥45', age, ...same({ sphere: s }) });
  }
  // Emmetropic presbyopes
  for (const age of [45, 50, 55, 60, 65, 75]) list.push({ id: `presb-${age}`, group: 'emmetropic presbyopes', age, ...same({ sphere: 0 }) });
  // Astigmatism: cyl −0.75 / −1.5 / −2.5 at axes 0/45/90/180, sphere 0 and −1
  for (const cyl of [-0.75, -1.5, -2.5]) for (const axisDeg of [0, 45, 90, 180]) for (const s of [0, -1]) {
    list.push({ id: `ast${s}${cyl}x${axisDeg}`, group: `astigmatism ${cyl === -0.75 ? '0.75' : cyl === -1.5 ? '1.5' : '2.5'}`, age: 30, ...same({ sphere: s, cyl, axisDeg }) });
  }
  // Mixed cases
  list.push({ id: 'myo-2-55', group: 'mixed', age: 55, ...same({ sphere: -2 }) });
  list.push({ id: 'myoast-1-1x180-50', group: 'mixed', age: 50, ...same({ sphere: -1, cyl: -1, axisDeg: 180 }) });
  list.push({ id: 'hyp+2-65', group: 'mixed', age: 65, ...same({ sphere: 2 }) });
  list.push({ id: 'myo-6-60', group: 'mixed', age: 60, ...same({ sphere: -6 }) });
  list.push({ id: 'aniso-1-3', group: 'mixed', age: 30, right: { sphere: -1 }, left: { sphere: -3 } });

  return list.map((u, i) => {
    const habitualMm = u.habitualMm ?? 300 + ((i * 37) % 16) * 10; // 300–450 mm
    const device = i % 2 === 0 ? DEVICES.iphone15 : DEVICES.pixel8;
    const label = rxLabel(u.right) === rxLabel(u.left) ? rxLabel(u.right) : `R ${rxLabel(u.right)} / L ${rxLabel(u.left)}`;
    return { ...u, habitualMm, device, label: `${label}, ${u.age} y` };
  });
}

/** @param {number} s */
function myopiaGroup(s) {
  if (s >= -1) return 'myopia ≤1 D';
  if (s >= -2) return 'myopia 1.5–2 D';
  if (s >= -4) return 'myopia 3–4 D';
  return 'myopia 5–8 D';
}

/** Small deterministic hash for per-user seeds. @param {string} s */
export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * The person's two eyes with individual (seeded) variation of pupil, amplitude and floor (shared by both eyes).
 * @param {SimUser} u
 * @returns {{right: SimulatedEye, left: SimulatedEye}}
 */
export function eyesFor(u) {
  const rng = mulberry32(hashSeed(`eyes:${u.id}`));
  const pupilMm = Math.max(2.2, watsonYellottPupilMm({ age: u.age }) + 0.3 * gauss(rng));
  const H = hofstetterAmplitude(u.age);
  const ampD = Math.max(0, Math.min(H.max, Math.max(H.min - 0.5, H.mean + gauss(rng))));
  const floorLogMAR = neuralFloorLogMAR(u.age) + 0.03 * gauss(rng);
  const mk = (/** @type {Rx} */ rx) => createEye({ sphere: rx.sphere, cyl: rx.cyl ?? 0, axisDeg: rx.axisDeg ?? 180, age: u.age, pupilMm, ampD, floorLogMAR });
  return { right: mk(u.right), left: mk(u.left) };
}

/** A small, fast subset that still covers every group (unit tests). @returns {SimUser[]} */
export function reducedCohort() {
  const keep = new Set(['emm-25', 'myo-0.5-28', 'myo-2-35', 'myo-4-38', 'myo-8-40', 'teen-2-15', 'hyp+1-25', 'hyp+2-45',
    'presb-45', 'presb-60', 'ast0-1.5x90', 'ast-1-2.5x45', 'myo-2-55', 'aniso-1-3']);
  return buildCohort().filter((u) => keep.has(u.id));
}
