// @ts-check
/**
 * Subscription plans. Prices are integers in minor units (agorot for ILS), VAT included, and are
 * configured with PRICE_MONTHLY / PRICE_QUARTERLY / PRICE_YEARLY (defaults are placeholders).
 */

/** @typedef {'monthly'|'quarterly'|'yearly'} PlanId */
/**
 * @typedef {object} Plan
 * @property {PlanId} id
 * @property {number} months
 * @property {number} price           minor units, VAT included
 * @property {string} currency        ISO 4217
 * @property {number} pricePerMonth   minor units, rounded to nearest
 * @property {number} savingsPercent  integer % saved vs paying monthly (floored: never overstated)
 */

/** @type {ReadonlyArray<{id: PlanId, months: number}>} */
export const PLAN_DEFS = Object.freeze([
  Object.freeze({ id: /** @type {PlanId} */ ('monthly'), months: 1 }),
  Object.freeze({ id: /** @type {PlanId} */ ('quarterly'), months: 3 }),
  Object.freeze({ id: /** @type {PlanId} */ ('yearly'), months: 12 }),
]);

export const PLAN_IDS = PLAN_DEFS.map((p) => p.id);

/** @param {unknown} id @returns {id is PlanId} */
export function isPlanId(id) {
  return typeof id === 'string' && /** @type {string[]} */ (PLAN_IDS).includes(id);
}

/**
 * @param {{prices: Record<PlanId, number>, currency: string}} opts
 * @returns {Plan[]}
 */
export function buildPlans({ prices, currency }) {
  const monthly = prices.monthly;
  return PLAN_DEFS.map(({ id, months }) => {
    const price = prices[id];
    const exactPerMonth = price / months;
    const savings = monthly > 0 ? Math.floor((1 - exactPerMonth / monthly) * 100 + 1e-9) : 0;
    return Object.freeze({
      id,
      months,
      price,
      currency,
      pricePerMonth: Math.round(exactPerMonth),
      savingsPercent: Math.max(0, savings),
    });
  });
}

/**
 * @param {Plan[]} plans
 * @param {unknown} id
 * @returns {Plan|null}
 */
export function findPlan(plans, id) {
  return plans.find((p) => p.id === id) ?? null;
}

/**
 * Adds `months` calendar months to a UTC timestamp, clamping the day (Jan 31 + 1 month = Feb 28/29).
 * @param {number} ts epoch ms
 * @param {number} months
 * @returns {number}
 */
export function addMonthsUtc(ts, months) {
  const d = new Date(ts);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1,
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}

/**
 * Formats a minor-unit amount for display, e.g. 2990 ILS -> "₪29.90" (he) / "₪29.90" (en).
 * @param {number} minor
 * @param {string} currency
 * @param {'he'|'en'} lang
 */
export function formatPrice(minor, currency, lang) {
  try {
    return new Intl.NumberFormat(lang === 'he' ? 'he-IL' : 'en-IL', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}
