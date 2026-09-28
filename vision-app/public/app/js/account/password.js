// @ts-check
/**
 * Password strength hint (pure). This is guidance only; the server enforces its own rules.
 */

export const PASSWORD_MIN = 8;

const COMMON = ['password', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', '11111111', '00000000', 'abcd1234', 'iloveyou', 'password1'];

/**
 * @param {string} pw
 * @returns {{score: 0|1|2|3|4, key: 'empty'|'tooShort'|'weak'|'fair'|'good'|'strong'}}
 */
export function passwordStrength(pw) {
  const value = String(pw ?? '');
  if (!value) return { score: 0, key: 'empty' };
  if (value.length < PASSWORD_MIN) return { score: 0, key: 'tooShort' };
  const lower = value.toLowerCase();
  if (COMMON.includes(lower) || /^(.)\1+$/.test(value)) return { score: 1, key: 'weak' };
  const classes = [/[a-zא-ת]/, /[A-Z]/, /\d/, /[^A-Za-z0-9א-ת]/].filter((re) => re.test(value)).length;
  let score = 1;
  if (value.length >= 12) score++;
  if (classes >= 2) score++;
  if (classes >= 3 || value.length >= 16) score++;
  const s = /** @type {1|2|3|4} */ (Math.min(4, score));
  const key = s === 1 ? 'weak' : s === 2 ? 'fair' : s === 3 ? 'good' : 'strong';
  return { score: s, key };
}

/** Simple, permissive email check (the server validates properly). @param {string} email */
export function looksLikeEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email ?? '').trim());
}
