// @ts-check
/**
 * Pure hash-route helpers (no DOM): parsing, building and matching `#/path?query` URLs.
 */

/**
 * @typedef {Object} ParsedRoute
 * @property {string} path                    Normalised, lower-case, leading slash, no trailing slash ("/" for empty).
 * @property {string[]} segments
 * @property {Record<string, string>} query
 */

/** @param {string} s */
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Parse a location hash such as "#/viewer/photo?x=1".
 * @param {string|null|undefined} hash
 * @returns {ParsedRoute}
 */
export function parseHash(hash) {
  let raw = String(hash ?? '');
  if (raw.startsWith('#')) raw = raw.slice(1);
  const qi = raw.indexOf('?');
  const pathPart = qi >= 0 ? raw.slice(0, qi) : raw;
  const queryPart = qi >= 0 ? raw.slice(qi + 1) : '';
  const segments = pathPart.split('/').filter(Boolean).map((seg) => safeDecode(seg).toLowerCase());
  /** @type {Record<string, string>} */
  const query = {};
  for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;
  return { path: '/' + segments.join('/'), segments, query };
}

/**
 * Build a hash string (with the leading "#").
 * @param {string} path
 * @param {Record<string, string|number|boolean|null|undefined>} [query]
 */
export function buildHash(path, query) {
  const clean = '/' + String(path || '/').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === false) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return '#' + clean + (qs ? '?' + qs : '');
}

/**
 * @template {{path: string}} R
 * @param {readonly R[]} routes
 * @param {string} path
 * @returns {R|null}
 */
export function matchRoute(routes, path) {
  return routes.find((r) => r.path === path) ?? null;
}

/**
 * Only allow in-app return targets (prevents open redirects through ?returnTo=).
 * @param {unknown} value
 * @returns {string|null} a safe "/path?query" or null
 */
export function sanitizeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  if (/[\s\\]|:/.test(value.split('?')[0])) return null;
  return value.length > 300 ? null : value;
}
