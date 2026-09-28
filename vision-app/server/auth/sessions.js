// @ts-check
/**
 * Server-side sessions. The cookie carries a random 32-byte token; only its SHA-256 is stored.
 * Sliding expiry: each use (throttled to once per 10 minutes) pushes expires_at to now + TTL.
 */
import { newId, newToken, sha256Hex, isTokenShape } from './tokens.js';

const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * @typedef {object} SessionRow
 * @property {string} id
 * @property {string} user_id
 * @property {number} created_at
 * @property {number} expires_at
 * @property {number} last_seen_at
 */

/**
 * @param {import('../db.js').Db} db
 * @param {{ttlMs: number, now: () => number}} opts
 */
export function createSessionStore(db, { ttlMs, now }) {
  return {
    ttlMs,

    /**
     * @param {string} userId
     * @param {string|undefined} userAgent
     * @returns {{token: string, id: string, expiresAt: number}}
     */
    create(userId, userAgent) {
      const token = newToken();
      const id = newId();
      const t = now();
      const expiresAt = t + ttlMs;
      db.run(
        'INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, sha256Hex(token), userId, t, expiresAt, t, userAgent ? String(userAgent).slice(0, 256) : null,
      );
      return { token, id, expiresAt };
    },

    /**
     * Resolves a cookie token to its session (and slides the expiry).
     * @param {string|undefined} token
     * @returns {{session: SessionRow, refreshed: boolean}|null}
     */
    lookup(token) {
      if (!isTokenShape(token)) return null;
      const t = now();
      /** @type {SessionRow|undefined} */
      const session = db.one('SELECT id, user_id, created_at, expires_at, last_seen_at FROM sessions WHERE token_hash = ?', sha256Hex(token));
      if (!session) return null;
      if (session.expires_at <= t) {
        db.run('DELETE FROM sessions WHERE id = ?', session.id);
        return null;
      }
      let refreshed = false;
      if (t - session.last_seen_at >= TOUCH_INTERVAL_MS) {
        session.last_seen_at = t;
        session.expires_at = t + ttlMs;
        db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', t, session.expires_at, session.id);
        refreshed = true;
      }
      return { session, refreshed };
    },

    /** @param {string|undefined} token */
    destroyByToken(token) {
      if (isTokenShape(token)) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256Hex(/** @type {string} */ (token)));
    },

    /** @param {string} userId */
    destroyAllForUser(userId) {
      db.run('DELETE FROM sessions WHERE user_id = ?', userId);
    },

    purgeExpired() {
      return db.run('DELETE FROM sessions WHERE expires_at <= ?', now()).changes;
    },
  };
}

/** @typedef {ReturnType<typeof createSessionStore>} SessionStore */
