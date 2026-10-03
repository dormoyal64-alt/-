// @ts-check
/** Small helpers shared by the validation simulator. */

/**
 * True when every number anywhere inside `v` (deep) is finite. null/undefined/strings/booleans are ignored.
 * @param {unknown} v
 * @returns {boolean}
 */
export function allFiniteNumbers(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (!v || typeof v !== 'object') return true;
  return Object.values(v).every(allFiniteNumbers);
}
