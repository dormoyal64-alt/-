// @ts-check
/**
 * Security headers (hand-written, no helmet) and CSRF defences for the JSON API:
 * state-changing requests must come from our own Origin and carry Content-Type: application/json.
 */
import { HttpError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * @param {string[]} formActionOrigins extra origins allowed as form targets (hosted payment pages)
 */
export function buildCsp(formActionOrigins = []) {
  const formAction = ["'self'", ...formActionOrigins].join(' ');
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action ${formAction}`,
    "object-src 'none'",
  ].join('; ');
}

/**
 * @param {{isProduction: boolean, formActionOrigins?: string[]}} opts
 * @returns {import('express').RequestHandler}
 */
export function securityHeaders({ isProduction, formActionOrigins = [] }) {
  const csp = buildCsp(formActionOrigins);
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(self)');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

/**
 * The origin this server is reachable at: PUBLIC_BASE_URL when configured (always in production),
 * otherwise derived from the request (development/test only).
 * @param {import('express').Request} req
 * @param {{publicBaseUrl: string|null}} config
 */
export function serverOrigin(req, config) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  return `${req.protocol}://${req.get('host')}`;
}

/** @param {import('express').Request} req */
function hasBody(req) {
  const len = req.headers['content-length'];
  if (req.headers['transfer-encoding']) return true;
  return len !== undefined && len !== '0';
}

/**
 * CSRF guard for /api. Applies to non-GET/HEAD/OPTIONS requests.
 * - Origin header must equal the server origin (missing or "null" => 403 BAD_ORIGIN).
 * - Content-Type must be application/json (403 JSON_REQUIRED). A request with no body and no
 *   Content-Type is accepted (the Origin check already covers it).
 * @param {{publicBaseUrl: string|null}} config
 * @param {{skip?: (req: import('express').Request) => boolean, allowForm?: (req: import('express').Request) => boolean}} [opts]
 *   skip: bypass entirely (webhooks, authenticated by signature); allowForm: accept urlencoded forms (mock checkout page).
 * @returns {import('express').RequestHandler}
 */
export function apiCsrfGuard(config, { skip, allowForm } = {}) {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method) || (skip && skip(req))) return next();
    const origin = req.headers.origin;
    if (!origin || origin !== serverOrigin(req, config)) {
      return next(new HttpError(403, 'BAD_ORIGIN', 'Cross-origin request rejected'));
    }
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type === 'application/json') return next();
    if (!type && !hasBody(req)) return next();
    if (type === 'application/x-www-form-urlencoded' && allowForm && allowForm(req)) return next();
    return next(new HttpError(403, 'JSON_REQUIRED', 'Content-Type must be application/json'));
  };
}
