// @ts-check
import { parseCookies } from '../http/cookies.js';
import { HttpError } from '../http/errors.js';

/**
 * Session cookie: `__Host-sid` (Secure, Path=/, HttpOnly, SameSite=Lax) in production, `sid` otherwise.
 * @param {{isProduction: boolean, sessionTtlDays: number}} config
 */
export function sessionCookie(config) {
  const name = config.isProduction ? '__Host-sid' : 'sid';
  /** @type {import('express').CookieOptions} */
  const base = { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/' };
  return {
    name,
    /** @param {import('express').Response} res @param {string} token */
    set(res, token) {
      res.cookie(name, token, { ...base, maxAge: config.sessionTtlDays * 86_400_000 });
    },
    /** @param {import('express').Response} res */
    clear(res) {
      res.clearCookie(name, base);
    },
    /** @param {import('express').Request} req */
    read(req) {
      return parseCookies(req.headers.cookie)[name];
    },
  };
}

/** @typedef {ReturnType<typeof sessionCookie>} SessionCookie */

/**
 * Resolves the session cookie into `res.locals.user` / `res.locals.session`.
 * @param {{sessions: import('./sessions.js').SessionStore, db: import('../db.js').Db, cookie: SessionCookie}} deps
 * @returns {import('express').RequestHandler}
 */
export function loadSession({ sessions, db, cookie }) {
  return (req, res, next) => {
    const token = cookie.read(req);
    if (token) {
      const found = sessions.lookup(token);
      if (found) {
        const user = db.one('SELECT * FROM users WHERE id = ?', found.session.user_id);
        if (user) {
          res.locals.user = user;
          res.locals.session = found.session;
          res.locals.sessionToken = token;
          if (found.refreshed) cookie.set(res, token); // slide the browser-side expiry too
        }
      }
    }
    next();
  };
}

/**
 * @param {import('express').Request} _req @param {import('express').Response} res @param {import('express').NextFunction} next
 */
export function requireAuth(_req, res, next) {
  if (!res.locals.user) next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in'));
  else next();
}
