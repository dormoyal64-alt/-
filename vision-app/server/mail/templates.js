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

/**
 * @typedef {'cancel_confirmation'|'refund_confirmation'|'pre_charge'|'renewal_notice'|'end_notice'|'final_reminder'|'payment_failed'} BillingMailKind
 */

const PLAN_NAMES = {
  he: { monthly: 'חודשי', quarterly: 'שלושה חודשים', yearly: 'שנתי' },
  en: { monthly: 'monthly', quarterly: '3-month', yearly: 'yearly' },
};

const BILLING = {
  he: {
    cancel_confirmation: {
      subject: 'אישור ביטול מנוי',
      body: (/** @type {any} */ p) => [`המנוי ה${p.planName} שלך בוטל. לא יבוצעו חיובים נוספים.`, `הגישה נשארת פעילה עד ${p.date}.`, `מספר אסמכתא לביטול: ${p.reference}`],
    },
    refund_confirmation: {
      subject: 'אישור ביטול והחזר כספי',
      body: (/** @type {any} */ p) => [`המנוי ה${p.planName} שלך בוטל היום (${p.date}) ולא יבוצעו חיובים נוספים.`, `החזר מלא בסך ${p.amount} יבוצע לאמצעי התשלום המקורי בתוך 7 ימי עסקים.`, `מספר אסמכתא לביטול: ${p.reference}`],
    },
    pre_charge: {
      subject: 'תזכורת: המנוי החודשי יתחדש בקרוב',
      body: (/** @type {any} */ p) => [`המנוי החודשי שלך יתחדש ב-${p.date} בחיוב של ${p.amount}.`, 'אפשר לבטל בלחיצה אחת, ללא דמי ביטול, בעמוד החשבון:'],
    },
    renewal_notice: {
      subject: 'תזכורת: המנוי יתחדש בקרוב',
      body: (/** @type {any} */ p) => [`המנוי ה${p.planName} שלך יתחדש אוטומטית ב-${p.date} בחיוב של ${p.amount}.`, 'אפשר לבטל בלחיצה אחת בעמוד החשבון:'],
    },
    end_notice: {
      subject: 'הודעה על סיום תקופת המנוי',
      body: (/** @type {any} */ p) => [`תקופת המנוי ה${p.planName} שלך תסתיים ב-${p.date}.`, 'המנוי לא יתחדש אוטומטית ולא תחויב/י ללא הסכמתך המפורשת.', 'אם תרצה/י להמשיך, אפשר לחדש בלחיצה אחת בעמוד החשבון:'],
    },
    final_reminder: {
      subject: 'תזכורת: המנוי מסתיים בעוד כמה ימים',
      body: (/** @type {any} */ p) => [`תקופת המנוי ה${p.planName} שלך תסתיים ב-${p.date}, ללא חידוש אוטומטי.`, 'לחידוש בלחיצה אחת (בהסכמתך בלבד):'],
    },
    payment_failed: {
      subject: 'החיוב עבור המנוי לא הצליח',
      body: (/** @type {any} */ p) => [`לא הצלחנו לחייב ${p.amount} עבור המנוי החודשי.`, `ננסה שוב בימים הקרובים. הגישה נשמרת עד ${p.date}.`, 'אפשר לבדוק את פרטי החשבון כאן:'],
    },
    footer: 'עמוד החשבון',
  },
  en: {
    cancel_confirmation: {
      subject: 'Your subscription has been cancelled',
      body: (/** @type {any} */ p) => [`Your ${p.planName} subscription has been cancelled. You will not be charged again.`, `You keep access until ${p.date}.`, `Cancellation reference: ${p.reference}`],
    },
    refund_confirmation: {
      subject: 'Cancellation and refund confirmation',
      body: (/** @type {any} */ p) => [`Your ${p.planName} subscription was cancelled today (${p.date}) and you will not be charged again.`, `A full refund of ${p.amount} will be issued to your original payment method within 7 business days.`, `Cancellation reference: ${p.reference}`],
    },
    pre_charge: {
      subject: 'Reminder: your monthly plan renews soon',
      body: (/** @type {any} */ p) => [`Your monthly plan renews on ${p.date} for ${p.amount}.`, 'You can cancel with one click, with no fee, on your account page:'],
    },
    renewal_notice: {
      subject: 'Reminder: your subscription renews soon',
      body: (/** @type {any} */ p) => [`Your ${p.planName} subscription renews automatically on ${p.date} for ${p.amount}.`, 'You can cancel with one click on your account page:'],
    },
    end_notice: {
      subject: 'Your subscription period is ending',
      body: (/** @type {any} */ p) => [`Your ${p.planName} plan ends on ${p.date}.`, 'It will NOT renew automatically and you will not be charged without your explicit consent.', 'To continue, renew with one tap on your account page:'],
    },
    final_reminder: {
      subject: 'Reminder: your plan ends in a few days',
      body: (/** @type {any} */ p) => [`Your ${p.planName} plan ends on ${p.date} and will not renew automatically.`, 'Renew with one tap (only with your consent):'],
    },
    payment_failed: {
      subject: 'We could not charge your subscription',
      body: (/** @type {any} */ p) => [`We could not charge ${p.amount} for your monthly plan.`, `We will retry over the next few days. You keep access until ${p.date}.`, 'Check your account here:'],
    },
    footer: 'Account page',
  },
};

/**
 * Billing notices (cancellation confirmation, reminders, statutory end-of-term notice).
 * @param {BillingMailKind} kind
 * @param {{to: string, lang: string, appName: string, planId: string, dateMs: number, amountText?: string,
 *   reference?: string, accountUrl: string, timeZone?: string}} p
 * @returns {MailMessage}
 */
export function billingEmail(kind, p) {
  const l = p.lang === 'en' ? 'en' : 'he';
  const dir = l === 'he' ? 'rtl' : 'ltr';
  const t = BILLING[l][kind];
  const date = new Intl.DateTimeFormat(l === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'long', timeZone: p.timeZone ?? 'Asia/Jerusalem' }).format(new Date(p.dateMs));
  const lines = t.body({ planName: PLAN_NAMES[l][/** @type {'monthly'} */ (p.planId)] ?? p.planId, date, amount: p.amountText ?? '', reference: p.reference ?? '' });
  const subject = `${t.subject} | ${p.appName}`;
  const text = [...lines, p.accountUrl, '', p.appName].join('\n');
  const html = `<!doctype html><html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>`
    + `<body style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.5;color:#111;background:#fff;margin:0;padding:24px" dir="${dir}">`
    + lines.map((x) => `<p>${escapeHtml(x)}</p>`).join('')
    + `<p><a href="${escapeHtml(p.accountUrl)}" style="display:inline-block;background:#0b57d0;color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(BILLING[l].footer)}</a></p>`
    + `<p>${escapeHtml(p.appName)}</p></body></html>`;
  return { to: p.to, subject, text, html, lang: l, tag: kind };
}
