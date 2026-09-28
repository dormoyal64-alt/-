// @ts-check
/**
 * Brand constants: the ONLY place in the app code where the product name lives.
 * Placeholder values until the manager sets the final brand. Keep public/app/manifest.webmanifest in sync by hand.
 */

/** @typedef {import('../core/types.js').Lang} Lang */

export const BRAND = Object.freeze({
  name: 'VisionFit',
  nameHe: 'ויז׳ן פיט',
  taglineHe: 'המסך שלך, מותאם לעיניים שלך',
  taglineEn: 'Your screen, fitted to your eyes',
  supportEmail: 'support@example.com',
  /** Matches --va-primary (light) and --va-bg (dark) in css/base.css. */
  themeColor: '#0a6b66',
  themeColorDark: '#0b1220',
});

/** Public legal pages (served outside the PWA scope, owned by A2). */
export const LEGAL = Object.freeze({
  terms: '/legal/terms.html',
  privacy: '/legal/privacy.html',
  accessibility: '/legal/accessibility.html',
  cancellation: '/legal/cancellation.html',
  disclaimer: '/legal/medical-disclaimer.html',
});

/** @param {Lang} lang */
export function brandName(lang) {
  return lang === 'he' ? BRAND.nameHe : BRAND.name;
}

/** @param {Lang} lang */
export function brandTagline(lang) {
  return lang === 'he' ? BRAND.taglineHe : BRAND.taglineEn;
}

/** Shown in Settings; bump together with the service-worker VERSION. */
export const APP_VERSION = '0.1.0';
