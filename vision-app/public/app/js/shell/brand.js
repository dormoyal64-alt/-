// @ts-check
/**
 * Brand constants: the ONLY place in the app code where the product name lives.
 * Keep public/app/manifest.webmanifest in sync by hand.
 */

/** @typedef {import('../core/types.js').Lang} Lang */

export const BRAND = Object.freeze({
  name: 'SeeTuned',
  nameHe: 'סיטיונד',
  taglineHe: 'המסך שלך, מכוון לעיניים שלך.',
  taglineEn: 'Your screen, tuned to your eyes.',
  supportEmail: 'support@example.com',
  /** Matches --va-primary (light) and --va-bg (dark) in css/base.css. */
  themeColor: '#0a6b66',
  themeColorDark: '#0b1220',
});

/** Public legal pages (owned by A2): Hebrew at /legal/<doc>.html, English at /legal/en/<doc>.html. */
export const LEGAL_DOCS = /** @type {const} */ (['terms', 'privacy', 'accessibility', 'cancellation', 'disclaimer']);

/** @param {typeof LEGAL_DOCS[number]} doc @param {Lang} lang */
export function legalUrl(doc, lang) {
  return lang === 'en' ? `/legal/en/${doc}.html` : `/legal/${doc}.html`;
}

/** @param {Lang} lang */
export function brandName(lang) {
  return lang === 'he' ? BRAND.nameHe : BRAND.name;
}

/** @param {Lang} lang */
export function brandTagline(lang) {
  return lang === 'he' ? BRAND.taglineHe : BRAND.taglineEn;
}

/**
 * Where people get the SeeTuned Android app (Google Play or a download page). Empty = pilot testers only
 * (the guide then says so instead of linking). See docs/android/ANDROID-APP.md.
 */
export const ANDROID_APP_URL = '';

/** Shown in Settings; bump together with the service-worker VERSION. */
export const APP_VERSION = '0.1.0';

/**
 * Feature flags. The product is a display-personalisation and viewing-comfort tool, not a medical device:
 * clinical notation (logMAR, Snellen, decimal acuity, CS units) stays hidden unless this is switched on,
 * and even then it is shown collapsed as "technical details".
 */
export const FEATURES = Object.freeze({
  showTechnicalValues: false,
});
