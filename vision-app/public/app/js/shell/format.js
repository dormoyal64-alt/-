// @ts-check
/**
 * Locale-aware formatting helpers (pure; Intl only).
 */

/** @typedef {import('../core/types.js').Lang} Lang */

/** @param {Lang} lang */
export function localeFor(lang) {
  return lang === 'he' ? 'he-IL' : 'en-US';
}

/**
 * "27 October 2026" / "27 באוקטובר 2026". Returns '' for invalid input.
 * @param {string|number|Date|null|undefined} value @param {Lang} lang
 */
export function formatDate(value, lang) {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(localeFor(lang), { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

/** Short date for lists ("27/10/2026" / "Oct 27, 2026"). @param {string|number|Date|null|undefined} value @param {Lang} lang */
export function formatShortDate(value, lang) {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(localeFor(lang), lang === 'he' ? { day: 'numeric', month: 'numeric', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/**
 * Currency with up to 2 decimals, dropping ".00" for whole amounts.
 * @param {number} amount @param {string} currency @param {Lang} lang
 */
export function formatMoney(amount, currency, lang) {
  if (!Number.isFinite(amount)) return '';
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  try {
    return new Intl.NumberFormat(localeFor(lang), {
      style: 'currency', currency: currency || 'ILS', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * Fixed decimals with locale digits and a real minus sign.
 * @param {number|null|undefined} n @param {number} decimals @param {Lang} lang @param {{signed?: boolean}} [opts]
 */
export function formatFixed(n, decimals, lang, opts = {}) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return new Intl.NumberFormat(localeFor(lang), {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals, signDisplay: opts.signed ? 'exceptZero' : 'auto',
  }).format(n);
}

/** Millimetres to a friendly centimetre string. @param {number|null|undefined} mm @param {Lang} lang */
export function formatCm(mm, lang) {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return '–';
  return new Intl.NumberFormat(localeFor(lang), { style: 'unit', unit: 'centimeter', maximumFractionDigits: 0 }).format(mm / 10);
}

/**
 * Number of minor-unit digits for a currency (ILS/USD 2, JPY 0).
 * @param {string} currency
 */
export function minorDigits(currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currency || 'ILS' }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * The API sends prices as integer minor units (agorot): 2990 ILS => 29.90.
 * @param {number} minor @param {string} currency
 */
export function fromMinor(minor, currency) {
  return minor / 10 ** minorDigits(currency);
}

/** @param {number} minor @param {string} currency @param {Lang} lang */
export function formatMinor(minor, currency, lang) {
  return formatMoney(fromMinor(minor, currency), currency, lang);
}
