// @ts-check
/**
 * /api/auth/* and /api/me.
 */
import express from 'express';
import { HttpError } from '../http/errors.js';
import { enforceLimits } from '../http/rate-limit.js';
import { hashPassword, verifyPassword, dummyVerify, checkPasswordPolicy, needsRehash } from './password.js';
import { newId, newToken, sha256Hex, isTokenShape } from './tokens.js';
import { requireAuth } from './middleware.js';
import { passwordResetEmail } from '../mail/templates.js';
import { isUniqueViolation } from '../db.js';
import { DAY_MS } from '../billing/entitlement.js';

export const RESET_TTL_MS = 60 * 60 * 1000;
const MAX_LOGIN_PASSWORD = 1024;

/** @param {unknown} v @returns {string|null} normalized e-mail or null if invalid */
export function normalizeEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.normalize('NFC').trim().toLowerCase();
  if (e.length < 3 || e.length > 254) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f<>()[\]\\,;:"]/.test(e)) return null;
  if (!/^[^@]+@[^@]+\.[^@.]{2,}$/.test(e)) return null;
  const [local, domain] = e.split('@');
  if (local.length > 64 || domain.startsWith('.') || domain.includes('..') || local.startsWith('.') || local.endsWith('.')) return null;
  return e;
}

/** @param {any} user */
export const publicUser = (user) => ({ id: user.id, email: user.email, lang: user.lang, createdAt: new Date(user.created_at).toISOString() });

/** @param {unknown} body @returns {Record<string, any>} */
const obj = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? /** @type {any} */ (body) : {});

/**
 * @param {{db: import('../db.js').Db, config: import('../config.js').Config, sessions: import('./sessions.js').SessionStore,
 *   cookie: import('./middleware.js').SessionCookie, billing: import('../billing/service.js').BillingService,
 *   mailer: import('../mail/index.js').Mailer, limiters: import('../http/limits.js').Limiters,
 *   audit: import('../audit.js').Audit, now: () => number, logger: {info: Function, warn: Function, error: Function},
 *   baseUrlOf: (req: import('express').Request) => string}} deps
 */
export function authRoutes(deps) {
  const { db, config, sessions, cookie, billing, mailer, limiters, audit, now, logger, baseUrlOf } = deps;
  const router = express.Router();

  /** Issue a fresh session (rotation: any session presented with the request is destroyed). */
  function startSession(/** @type {import('express').Request} */ req, /** @type {import('express').Response} */ res, /** @type {string} */ userId) {
    sessions.destroyByToken(cookie.read(req));
    const { token } = sessions.create(userId, req.get('user-agent'));
    cookie.set(res, token);
  }

  const ip = (/** @type {import('express').Request} */ req) => req.ip || 'unknown';

  router.post('/auth/register', async (req, res) => {
    const body = obj(req.body);
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, 'INVALID_EMAIL', 'Please enter a valid e-mail address');
    const policy = checkPasswordPolicy(body.password, { email });
    if (policy) throw new HttpError(400, policy.code, policy.message);
    const lang = body.lang === undefined || body.lang === null ? 'he' : body.lang;
    if (lang !== 'he' && lang !== 'en') throw new HttpError(400, 'INVALID_LANG', 'lang must be "he" or "en"');
    if (body.acceptTerms !== true) throw new HttpError(400, 'TERMS_NOT_ACCEPTED', 'You must accept the terms of use');

    enforceLimits([[limiters.registerIp, `reg:${ip(req)}`]]);
    if (db.one('SELECT 1 AS x FROM users WHERE email = ?', email)) {
      throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this e-mail already exists');
    }
    const passwordHash = await hashPassword(body.password);
    const t = now();
    const id = newId();
    try {
      db.tx(() => {
        const emailHash = sha256Hex(email);
        const claimed = db.one('SELECT 1 AS x FROM trial_claims WHERE email_hash = ?', emailHash);
        let trialEndsAt = t;
        if (!claimed && config.trialDays > 0) {
          trialEndsAt = t + config.trialDays * DAY_MS;
          db.run('INSERT INTO trial_claims (email_hash, claimed_at) VALUES (?, ?)', emailHash, t);
        }
        db.run(`INSERT INTO users (id, email, password_hash, lang, created_at, trial_ends_at, terms_accepted_at, terms_version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, email, passwordHash, lang, t, trialEndsAt, t, config.termsVersion);
        audit(id, 'user.registered', { termsVersion: config.termsVersion, trial: Boolean(!claimed && config.trialDays > 0) });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this e-mail already exists');
      throw err;
    }
    const user = db.one('SELECT * FROM users WHERE id = ?', id);
    startSession(req, res, id);
    res.status(201).json({ user: publicUser(user), entitlement: billing.entitlementFor(user) });
  });

  router.post('/auth/login', async (req, res) => {
    const body = obj(req.body);
    const email = typeof body.email === 'string' ? body.email.normalize('NFC').trim().toLowerCase() : null;
    if (!email || email.length > 254 || typeof body.password !== 'string' || !body.password || body.password.length > MAX_LOGIN_PASSWORD) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'E-mail and password are required');
    }
    const ipEmailKey = `login:${ip(req)}:${email}`;
    enforceLimits([[limiters.loginIpEmail, ipEmailKey], [limiters.loginIp, `login:${ip(req)}`]]);
    const user = db.one('SELECT * FROM users WHERE email = ?', email);
    const ok = user ? await verifyPassword(body.password, user.password_hash) : await dummyVerify(body.password);
    if (!ok) {
      if (user) audit(user.id, 'login.failed');
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect e-mail or password');
    }
    limiters.loginIpEmail.reset(ipEmailKey);
    if (needsRehash(user.password_hash)) {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(body.password), user.id);
    }
    startSession(req, res, user.id);
    audit(user.id, 'login.succeeded');
    res.json({ user: publicUser(user), entitlement: billing.entitlementFor(user) });
  });

  router.post('/auth/logout', (req, res) => {
    sessions.destroyByToken(cookie.read(req));
    cookie.clear(res);
    res.status(204).end();
  });

  router.post('/auth/password-reset/request', (req, res) => {
    const body = obj(req.body);
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, 'INVALID_EMAIL', 'Please enter a valid e-mail address');
    enforceLimits([[limiters.resetIpEmail, `reset:${ip(req)}:${email}`], [limiters.resetIp, `reset:${ip(req)}`]]);
    const user = db.one('SELECT id, email, lang FROM users WHERE email = ?', email);
    if (user) {
      const token = newToken();
      const t = now();
      db.tx(() => {
        db.run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', user.id); // only the newest link works
        db.run('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)',
          sha256Hex(token), user.id, t, t + RESET_TTL_MS);
        audit(user.id, 'password_reset.requested');
      });
      const resetUrl = `${baseUrlOf(req)}/app/#/reset-password?token=${token}`;
      const msg = passwordResetEmail({ to: user.email, lang: user.lang, appName: config.appName, resetUrl, expiresMinutes: RESET_TTL_MS / 60_000 });
      // Not awaited: the response time must not depend on whether the account exists.
      mailer.send(msg).catch((err) => logger.error('[mail] password reset e-mail failed:', err instanceof Error ? err.message : err));
    }
    res.status(202).json({ ok: true });
  });

  router.post('/auth/password-reset/confirm', async (req, res) => {
    const body = obj(req.body);
    enforceLimits([[limiters.resetConfirmIp, `reset-confirm:${ip(req)}`]]);
    const invalid = () => new HttpError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired');
    if (!isTokenShape(body.token)) throw invalid();
    const tokenHash = sha256Hex(body.token);
    const row = db.one(`SELECT r.user_id, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
                        WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?`, tokenHash, now());
    if (!row) throw invalid();
    const policy = checkPasswordPolicy(body.password, { email: row.email });
    if (policy) throw new HttpError(400, policy.code, policy.message);
    const passwordHash = await hashPassword(body.password);
    db.tx(() => {
      const t = now();
      const claimed = db.run('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', t, tokenHash, t);
      if (Number(claimed.changes) !== 1) throw invalid(); // raced with another confirm
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, row.user_id);
      db.run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', row.user_id);
      sessions.destroyAllForUser(row.user_id); // log out everywhere
      audit(row.user_id, 'password_reset.completed');
    });
    cookie.clear(res);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (_req, res) => {
    const user = res.locals.user;
    res.json({ user: publicUser(user), entitlement: billing.entitlementFor(user) });
  });

  router.delete('/me', requireAuth, async (req, res) => {
    const user = res.locals.user;
    const body = obj(req.body);
    if (typeof body.password !== 'string' || !body.password || body.password.length > MAX_LOGIN_PASSWORD) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Password is required');
    }
    enforceLimits([[limiters.deleteUser, `delete:${user.id}`]]);
    if (!(await verifyPassword(body.password, user.password_hash))) {
      throw new HttpError(403, 'INVALID_PASSWORD', 'Incorrect password');
    }
    await billing.cancelAllForDeletion(user);
    billing.purgeUser(user.id);
    cookie.clear(res);
    res.status(204).end();
  });

  return router;
}
