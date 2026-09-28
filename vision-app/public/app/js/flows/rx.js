// @ts-check
/**
 * Optional prescription (Rx) entry: parsing + validation (pure).
 * Ranges: SPH -20..+20 step 0.25, CYL -8..+8 step 0.25, AXIS 0..180 (integer), ADD 0..4 step 0.25.
 */

/** @typedef {import('../core/types.js').Rx} Rx */
/** @typedef {'sph'|'cyl'|'axis'|'add'} RxField */
/** @typedef {'right'|'left'} RxEye */
/** @typedef {'number'|'range'|'step'|'axisRequired'} RxError */

/** @type {Readonly<Record<RxField, {min: number, max: number, step: number, decimals: number}>>} */
export const RX_RULES = Object.freeze({
  sph: { min: -20, max: 20, step: 0.25, decimals: 2 },
  cyl: { min: -8, max: 8, step: 0.25, decimals: 2 },
  axis: { min: 0, max: 180, step: 1, decimals: 0 },
  add: { min: 0, max: 4, step: 0.25, decimals: 2 },
});

export const RX_FIELDS = /** @type {const} */ (['sph', 'cyl', 'axis', 'add']);
export const RX_EYES = /** @type {const} */ (['right', 'left']);

/**
 * Parse a user-typed number: accepts "+1.25", "-0,50", unicode minus/en-dash, surrounding spaces, "°" on axis.
 * @param {unknown} raw
 * @returns {number|null|typeof NaN} null for empty input, NaN when not a number
 */
export function parseRxNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim().replace(/[−–‒־]/g, '-').replace(',', '.').replace(/°$/, '').replace(/\s+/g, '');
  if (str === '') return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(str)) return NaN;
  return Number(str);
}

/**
 * @param {RxField} field
 * @param {unknown} raw
 * @returns {{value: number|undefined, error: RxError|null}}
 */
export function validateRxField(field, raw) {
  const rule = RX_RULES[field];
  const n = parseRxNumber(raw);
  if (n === null) return { value: undefined, error: null };
  if (Number.isNaN(n)) return { value: undefined, error: 'number' };
  if (n < rule.min || n > rule.max) return { value: undefined, error: 'range' };
  const steps = n / rule.step;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) return { value: undefined, error: 'step' };
  const value = Number((Math.round(steps) * rule.step).toFixed(rule.decimals));
  return { value: Object.is(value, -0) ? 0 : value, error: null };
}

/**
 * Validate the whole form.
 * @param {Partial<Record<RxEye, Partial<Record<RxField, unknown>>>>} input raw strings per eye/field
 * @returns {{rx: {right?: Rx, left?: Rx}, errors: Record<string, RxError>, valid: boolean, empty: boolean}}
 *   errors keyed "right.sph" etc.
 */
export function validateRx(input) {
  /** @type {{right?: Rx, left?: Rx}} */
  const rx = {};
  /** @type {Record<string, RxError>} */
  const errors = {};
  for (const eye of RX_EYES) {
    /** @type {Rx} */
    const out = {};
    for (const field of RX_FIELDS) {
      const { value, error } = validateRxField(field, input?.[eye]?.[field]);
      if (error) errors[`${eye}.${field}`] = error;
      else if (value !== undefined) out[field] = value;
    }
    if (out.cyl !== undefined && out.cyl !== 0 && out.axis === undefined && !errors[`${eye}.axis`] && !errors[`${eye}.cyl`]) {
      errors[`${eye}.axis`] = 'axisRequired';
    }
    if (Object.keys(out).length) rx[eye] = out;
  }
  const valid = Object.keys(errors).length === 0;
  return { rx, errors, valid, empty: !rx.right && !rx.left };
}

/**
 * Display a value the way prescriptions are written: signed with 2 decimals (SPH/CYL/ADD), integer axis.
 * @param {RxField} field @param {number|undefined|null} value
 */
export function formatRxValue(field, value) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '';
  if (field === 'axis') return String(Math.round(value));
  const fixed = Math.abs(value).toFixed(2);
  if (field === 'add') return '+' + fixed;
  return (value > 0 ? '+' : value < 0 ? '-' : '') + fixed;
}
