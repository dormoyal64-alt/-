// @ts-check
/** Transactional e-mail templates, Hebrew (RTL) and English. */

/** @param {string} s */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/**
 * @typedef {object} MailMessage
 * @property {string} to
 * @property {string} subject
 * @property {string} text
 * @property {string} html
 * @property {'he'|'en'} lang
 * @property {string} tag      e.g. "password-reset"
 */

const STRINGS = {
  he: {
    subject: (/** @type {string} */ app) => `איפוס סיסמה ל-${app}`,
    hello: 'שלום,',
    body: 'קיבלנו בקשה לאפס את הסיסמה לחשבון שלך. לבחירת סיסמה חדשה יש ללחוץ על הקישור:',
    button: 'בחירת סיסמה חדשה',
    expiry: (/** @type {number} */ m) => `הקישור תקף ל-${m} דקות ולשימוש חד-פעמי.`,
    ignore: 'אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהודעה זו. הסיסמה שלך לא תשתנה.',
  },
  en: {
    subject: (/** @type {string} */ app) => `Reset your ${app} password`,
    hello: 'Hello,',
    body: 'We received a request to reset the password for your account. Choose a new password here:',
    button: 'Choose a new password',
    expiry: (/** @type {number} */ m) => `This link is valid for ${m} minutes and can be used once.`,
    ignore: "If you didn't ask to reset your password, you can ignore this e-mail. Your password will not change.",
  },
};

/**
 * @param {{to: string, lang: string, appName: string, resetUrl: string, expiresMinutes: number}} p
 * @returns {MailMessage}
 */
export function passwordResetEmail({ to, lang, appName, resetUrl, expiresMinutes }) {
  const l = lang === 'en' ? 'en' : 'he';
  const s = STRINGS[l];
  const dir = l === 'he' ? 'rtl' : 'ltr';
  const text = [s.hello, '', s.body, resetUrl, '', s.expiry(expiresMinutes), s.ignore, '', appName].join('\n');
  const html = `<!doctype html><html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(s.subject(appName))}</title></head>`
    + `<body style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.5;color:#111;background:#fff;margin:0;padding:24px" dir="${dir}">`
    + `<p>${escapeHtml(s.hello)}</p><p>${escapeHtml(s.body)}</p>`
    + `<p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#0b57d0;color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(s.button)}</a></p>`
    + `<p style="font-size:15px;word-break:break-all" dir="ltr">${escapeHtml(resetUrl)}</p>`
    + `<p>${escapeHtml(s.expiry(expiresMinutes))}</p><p>${escapeHtml(s.ignore)}</p><p>${escapeHtml(appName)}</p></body></html>`;
  return { to, subject: s.subject(appName), text, html, lang: l, tag: 'password-reset' };
}
