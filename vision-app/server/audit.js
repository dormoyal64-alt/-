// @ts-check
/**
 * Append-only audit trail of security/billing-relevant actions. Never put e-mails, passwords,
 * tokens, card data or eye-test data in `detail`. On account deletion user_id is set to NULL.
 * @param {import('./db.js').Db} db
 * @param {() => number} now
 */
export function createAudit(db, now) {
  /**
   * @param {string|null} userId
   * @param {string} action   e.g. "user.registered", "subscription.canceled"
   * @param {Record<string, unknown>} [detail]
   */
  return function audit(userId, action, detail) {
    db.run('INSERT INTO audit_log (ts, user_id, action, detail) VALUES (?, ?, ?, ?)',
      now(), userId, action, detail ? JSON.stringify(detail) : null);
  };
}

/** @typedef {ReturnType<typeof createAudit>} Audit */
