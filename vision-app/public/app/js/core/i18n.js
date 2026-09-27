// @ts-check
/**
 * Minimal i18n. Every module owns its own strings object: { he: {...}, en: {...} }.
 * Hebrew is the primary language; English is the fallback for missing keys.
 */

/** @typedef {import('./types.js').Lang} Lang */

export const SUPPORTED_LANGS = /** @type {const} */ (['he', 'en']);
const STORAGE_KEY = 'va.lang';

/**
 * Build a translate function for a module dictionary.
 * @param {Record<string, Record<string, string>>} dict  e.g. { he: { hello: 'שלום {name}' }, en: { hello: 'Hello {name}' } }
 * @param {Lang} lang
 * @returns {(key: string, params?: Record<string, string|number>) => string}
 */
export function makeT(dict, lang) {
  return (key, params) => {
    const raw = dict[lang]?.[key] ?? dict.en?.[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  };
}

/** @param {string} lang @returns {'rtl'|'ltr'} */
export function dirFor(lang) {
  return lang === 'he' ? 'rtl' : 'ltr';
}

/** @returns {Lang} */
export function getInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'he' || saved === 'en') return saved;
  } catch { /* storage unavailable */ }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'he';
  return nav.toLowerCase().startsWith('en') ? 'en' : 'he';
}

/** @param {Lang} lang */
export function saveLang(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
}

/**
 * Apply lang + dir to <html>.
 * @param {Lang} lang
 * @param {Document} [doc]
 */
export function applyLangToDocument(lang, doc = document) {
  doc.documentElement.lang = lang;
  doc.documentElement.dir = dirFor(lang);
}

/**
 * Locale-aware number formatting.
 * @param {number} n @param {Lang} lang @param {Intl.NumberFormatOptions} [opts]
 */
export function formatNumber(n, lang, opts) {
  return new Intl.NumberFormat(lang === 'he' ? 'he-IL' : 'en-US', opts).format(n);
}
