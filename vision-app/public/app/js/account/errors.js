// @ts-check
/**
 * Map API errors to user-facing message keys (see account/strings.js "err.*"). Pure.
 */

/** @type {Record<string, string>} */
const BY_CODE = {
  OFFLINE: 'err.offline',
  NETWORK: 'err.network',
  INVALID_CREDENTIALS: 'err.credentials',
  WRONG_PASSWORD: 'err.wrongPassword',
  INVALID_PASSWORD: 'err.wrongPassword',
  EMAIL_TAKEN: 'err.emailTaken',
  EMAIL_EXISTS: 'err.emailTaken',
  EMAIL_IN_USE: 'err.emailTaken',
  USER_EXISTS: 'err.emailTaken',
  WEAK_PASSWORD: 'err.weakPassword',
  PASSWORD_TOO_SHORT: 'err.weakPassword',
  PASSWORD_TOO_COMMON: 'err.commonPassword',
  PASSWORD_TOO_LONG: 'err.longPassword',
  PASSWORD_INVALID: 'err.weakPassword',
  INVALID_EMAIL: 'err.email',
  TERMS_REQUIRED: 'err.terms',
  TERMS_NOT_ACCEPTED: 'err.terms',
  RATE_LIMITED: 'err.rateLimited',
  TOO_MANY_REQUESTS: 'err.rateLimited',
  INVALID_TOKEN: 'err.token',
  TOKEN_EXPIRED: 'err.token',
  EXPIRED_TOKEN: 'err.token',
  VALIDATION_ERROR: 'err.validation',
  INVALID_INPUT: 'err.validation',
  BAD_REQUEST: 'err.validation',
  INVALID_PLAN: 'err.validation',
  INVALID_LANG: 'err.validation',
  INVALID_JSON: 'err.validation',
  BAD_CSRF: 'err.generic',
  ALREADY_SUBSCRIBED: 'err.alreadySubscribed',
  NOT_RESUMABLE: 'err.notResumable',
  NOT_RENEWABLE: 'err.notRenewable',
  CONSENT_REQUIRED: 'err.consent',
  INVALID_MODE: 'err.validation',
  REFUND_WINDOW_PASSED: 'err.refundWindow',
  BAD_ORIGIN: 'err.generic',
  JSON_REQUIRED: 'err.generic',
  PAYLOAD_TOO_LARGE: 'err.validation',
  PROVIDER_UNAVAILABLE: 'err.payment',
  PAYMENT_PROVIDER_ERROR: 'err.payment',
  PROVIDER_ERROR: 'err.payment',
  CHECKOUT_FAILED: 'err.payment',
  NOT_SUBSCRIBED: 'err.noSubscription',
  NO_SUBSCRIPTION: 'err.noSubscription',
  NO_ACTIVE_SUBSCRIPTION: 'err.noSubscription',
  UNAUTHORIZED: 'err.session',
  UNAUTHENTICATED: 'err.session',
  SERVER_ERROR: 'err.server',
  INTERNAL: 'err.server',
};

/**
 * @param {unknown} err  usually an ApiError
 * @returns {string} message key
 */
export function errorKey(err) {
  const e = /** @type {{status?: number, code?: string}} */ (err || {});
  if (e.code && BY_CODE[e.code]) return BY_CODE[e.code];
  const status = typeof e.status === 'number' ? e.status : -1;
  if (status === 0) return 'err.network';
  if (status === 401) return 'err.session';
  if (status === 409) return 'err.emailTaken';
  if (status === 429) return 'err.rateLimited';
  if (status >= 500) return 'err.server';
  if (status === 400 || status === 422) return 'err.validation';
  return 'err.generic';
}

/** Codes meaning "the password you typed is wrong" (used by delete-account, where 401 must not log out). */
export function isWrongPassword(err) {
  const e = /** @type {{status?: number, code?: string}} */ (err || {});
  return e.code === 'WRONG_PASSWORD' || e.code === 'INVALID_PASSWORD' || e.code === 'INVALID_CREDENTIALS' || e.status === 403;
}
