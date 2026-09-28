// @ts-check
/**
 * HTTP client for the JSON API in docs/ARCHITECTURE.md.
 * - Same-origin cookie auth (credentials: 'same-origin'); JSON bodies with Content-Type: application/json.
 * - Uniform errors: every failure is an ApiError {status, code, message}; status 0 = network/offline.
 * - 401 on an authenticated call triggers the configured onUnauthorized hook (the app sends the user to #/welcome).
 * No DOM access at import time, so it can be unit-tested with an injected fetch.
 */

/** @typedef {import('./entitlement.js').Entitlement} Entitlement */
/** @typedef {import('./entitlement.js').User} User */
/** @typedef {import('./entitlement.js').PlanId} PlanId */

/**
 * @typedef {Object} Plan
 * @property {PlanId} id
 * @property {number} months
 * @property {number} price          Total price for the period in integer MINOR units (agorot), VAT included.
 * @property {string} currency       ISO-4217, e.g. "ILS".
 * @property {number} pricePerMonth  minor units
 * @property {number} savingsPercent
 * @property {'auto'|'manual'} [renewal]  monthly auto-renews; 3-month and yearly are prepaid fixed terms (Israel)
 * @property {string} [provider]
 */
/** @typedef {{trialDays: number, currency: string, plans: Plan[]}} PlansResponse */
/** @typedef {{user: User, entitlement: Entitlement}} SessionResponse */
/**
 * As served by server/billing/service.js (amount in minor units; url may be null).
 * @typedef {{id: string, plan?: string|null, amount?: number, currency?: string, status?: string, url?: string|null, issuedAt?: string}} Invoice
 */

export class ApiError extends Error {
  /** @param {number} status @param {string} code @param {string} [message] */
  constructor(status, code, message) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  get isNetwork() { return this.status === 0; }
}

/**
 * @typedef {Object} ApiConfig
 * @property {typeof fetch|null} fetchImpl
 * @property {string} base
 * @property {((err: ApiError) => void)|null} onUnauthorized
 * @property {((reachable: boolean) => void)|null} onReachability
 */

/** @type {ApiConfig} */
const config = { fetchImpl: null, base: '', onUnauthorized: null, onReachability: null };

/** @param {Partial<ApiConfig>} opts */
export function configureApi(opts) {
  Object.assign(config, opts);
}

/** @param {number} status */
export function codeForStatus(status) {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'VALIDATION_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'HTTP_' + status;
}

/**
 * @param {'GET'|'POST'|'DELETE'} method
 * @param {string} path  e.g. "/api/me"
 * @param {{body?: unknown, signal?: AbortSignal, handle401?: boolean}} [opts]
 * @returns {Promise<any>}  parsed JSON, or null for empty (202/204) responses
 */
export async function apiRequest(method, path, { body, signal, handle401 = true } = {}) {
  const f = config.fetchImpl ?? globalThis.fetch;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(0, 'OFFLINE', 'offline');
  }
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  /** @type {RequestInit} */
  const init = { method, credentials: 'same-origin', headers, signal, cache: 'no-store' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let res;
  try {
    res = await f(config.base + path, init);
  } catch (err) {
    if (err && /** @type {any} */ (err).name === 'AbortError') throw err;
    config.onReachability?.(false);
    throw new ApiError(0, 'NETWORK', 'network error');
  }
  config.onReachability?.(true);
  let data = null;
  if (res.status !== 204) {
    const text = await res.text().catch(() => '');
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
  }
  if (!res.ok) {
    const code = typeof data?.error?.code === 'string' ? data.error.code : codeForStatus(res.status);
    const message = typeof data?.error?.message === 'string' ? data.error.message : res.statusText;
    const err = new ApiError(res.status, code, message);
    if (res.status === 401 && handle401) config.onUnauthorized?.(err);
    throw err;
  }
  return data;
}

/** Typed endpoint wrappers. */
export const api = {
  /** @param {AbortSignal} [signal] @returns {Promise<PlansResponse>} */
  plans: (signal) => apiRequest('GET', '/api/plans', { signal, handle401: false }),
  /** @param {AbortSignal} [signal] @returns {Promise<SessionResponse>} */
  me: (signal) => apiRequest('GET', '/api/me', { signal, handle401: false }),
  /** @param {{email: string, password: string, lang: 'he'|'en', acceptTerms: true}} body @returns {Promise<SessionResponse>} */
  register: (body) => apiRequest('POST', '/api/auth/register', { body, handle401: false }),
  /** @param {{email: string, password: string}} body @returns {Promise<SessionResponse>} */
  login: (body) => apiRequest('POST', '/api/auth/login', { body, handle401: false }),
  /** @returns {Promise<null>} */
  logout: () => apiRequest('POST', '/api/auth/logout', { handle401: false }),
  /** @param {string} email @returns {Promise<null>} */
  requestPasswordReset: (email) => apiRequest('POST', '/api/auth/password-reset/request', { body: { email }, handle401: false }),
  /** @param {string} token @param {string} password @returns {Promise<null>} */
  confirmPasswordReset: (token, password) => apiRequest('POST', '/api/auth/password-reset/confirm', { body: { token, password }, handle401: false }),
  /** Wrong password answers 401/403 here, which must not end the session. @param {string} password @returns {Promise<null>} */
  deleteAccount: (password) => apiRequest('DELETE', '/api/me', { body: { password }, handle401: false }),
  /** @param {PlanId} planId @returns {Promise<{url: string}>} */
  checkout: (planId) => apiRequest('POST', '/api/billing/checkout', { body: { planId } }),
  /**
   * One-click cancel. 'period_end' (default) keeps access until the paid period ends; 'now' ends it immediately and,
   * within 14 days of the first charge, refunds in full.
   * @param {'period_end'|'now'} [mode] @returns {Promise<{entitlement: Entitlement}>}
   */
  cancel: (mode = 'period_end') => apiRequest('POST', '/api/billing/cancel', { body: { mode } }),
  /** Explicit-consent renewal of a fixed-term plan. @param {PlanId} planId @returns {Promise<{url?: string, entitlement?: Entitlement}>} */
  renew: (planId) => apiRequest('POST', '/api/billing/renew', { body: { planId, consent: true } }),
  /** @returns {Promise<{entitlement: Entitlement}>} */
  resume: () => apiRequest('POST', '/api/billing/resume'),
  /** @param {AbortSignal} [signal] @returns {Promise<{invoices: Invoice[]}>} */
  invoices: (signal) => apiRequest('GET', '/api/billing/invoices', { signal }),
};

/**
 * Only follow checkout URLs that are https (hosted payment page) or same-origin (mock provider in dev/test).
 * @param {unknown} url @param {string} origin e.g. location.origin
 * @returns {string|null}
 */
export function safeCheckoutUrl(url, origin) {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url, origin);
    if (u.origin === origin) return u.href;
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
