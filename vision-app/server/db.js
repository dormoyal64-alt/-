// @ts-check
/**
 * SQLite persistence (node:sqlite, synchronous). WAL mode, foreign keys, versioned migrations.
 * Eye-test / vision data is NEVER stored server-side: only accounts, sessions and billing state.
 * All timestamps are INTEGER epoch milliseconds (UTC).
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Append-only list: never edit a shipped migration, add a new one. */
export const MIGRATIONS = [
  // 1: initial schema
  `
  CREATE TABLE users (
    id                TEXT PRIMARY KEY,
    email             TEXT NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,
    lang              TEXT NOT NULL DEFAULT 'he',
    created_at        INTEGER NOT NULL,
    trial_ends_at     INTEGER NOT NULL,
    terms_accepted_at INTEGER NOT NULL,
    terms_version     TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent   TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expires ON sessions(expires_at);

  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
  );
  CREATE INDEX password_resets_user ON password_resets(user_id);

  -- SHA-256 of normalized e-mails that already consumed a free trial (one trial per e-mail, ever).
  CREATE TABLE trial_claims (
    email_hash TEXT PRIMARY KEY,
    claimed_at INTEGER NOT NULL
  );

  CREATE TABLE subscriptions (
    id                       TEXT PRIMARY KEY,
    user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider                 TEXT NOT NULL,
    provider_customer_id     TEXT,
    provider_subscription_id TEXT NOT NULL,
    plan                     TEXT NOT NULL,
    status                   TEXT NOT NULL CHECK (status IN ('active','canceled','past_due','expired')),
    current_period_end       INTEGER,
    cancel_at_period_end     INTEGER NOT NULL DEFAULT 0,
    last_event_at            INTEGER,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    UNIQUE (provider, provider_subscription_id)
  );
  CREATE INDEX subscriptions_user ON subscriptions(user_id, created_at);

  CREATE TABLE checkout_sessions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     TEXT NOT NULL,
    plan         TEXT NOT NULL,
    provider_ref TEXT,
    status       TEXT NOT NULL CHECK (status IN ('pending','completed','canceled','expired')),
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX checkout_sessions_user ON checkout_sessions(user_id);
  CREATE UNIQUE INDEX checkout_sessions_ref ON checkout_sessions(provider, provider_ref);

  CREATE TABLE webhook_events (
    provider    TEXT NOT NULL,
    event_id    TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    type        TEXT NOT NULL,
    user_id     TEXT,
    payload     TEXT,
    PRIMARY KEY (provider, event_id)
  );

  -- Invoices are kept after account deletion (tax law), with user_id set to NULL.
  CREATE TABLE invoices (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
    provider            TEXT NOT NULL,
    provider_invoice_id TEXT NOT NULL,
    plan                TEXT,
    amount              INTEGER NOT NULL,
    currency            TEXT NOT NULL,
    status              TEXT NOT NULL,
    url                 TEXT,
    issued_at           INTEGER NOT NULL,
    UNIQUE (provider, provider_invoice_id)
  );
  CREATE INDEX invoices_user ON invoices(user_id, issued_at);

  CREATE TABLE audit_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      INTEGER NOT NULL,
    user_id TEXT,
    action  TEXT NOT NULL,
    detail  TEXT
  );
  CREATE INDEX audit_log_user ON audit_log(user_id);
  `,
];

/**
 * @typedef {object} Db
 * @property {DatabaseSync} raw
 * @property {(sql: string, ...params: any[]) => any} one     first row or undefined
 * @property {(sql: string, ...params: any[]) => any[]} all
 * @property {(sql: string, ...params: any[]) => {changes: number|bigint, lastInsertRowid: number|bigint}} run
 * @property {<T>(fn: () => T) => T} tx                     synchronous transaction (BEGIN IMMEDIATE)
 * @property {() => number} schemaVersion
 * @property {() => void} close
 */

/**
 * @param {string} dataDir directory for app.sqlite, or ':memory:'
 * @returns {Db}
 */
export function openDatabase(dataDir) {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    file = join(dataDir, 'app.sqlite');
  }
  const raw = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

  /** @type {Map<string, import('node:sqlite').StatementSync>} */
  const cache = new Map();
  const stmt = (/** @type {string} */ sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };

  /** @type {Db} */
  const db = {
    raw,
    one: (sql, ...params) => stmt(sql).get(...params),
    all: (sql, ...params) => stmt(sql).all(...params),
    run: (sql, ...params) => stmt(sql).run(...params),
    tx(fn) {
      if (raw.isTransaction) return fn(); // nested: join the outer transaction
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        if (raw.isTransaction) raw.exec('ROLLBACK');
        throw err;
      }
    },
    schemaVersion: () => /** @type {any} */ (raw.prepare('PRAGMA user_version').get()).user_version,
    close() {
      cache.clear();
      if (raw.isOpen) raw.close();
    },
  };

  migrate(db);
  return db;
}

/** @param {Db} db */
function migrate(db) {
  const current = db.schemaVersion();
  if (current > MIGRATIONS.length) {
    throw new Error(`Database schema version ${current} is newer than this server (${MIGRATIONS.length}); refusing to start`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.tx(() => {
      db.raw.exec(MIGRATIONS[v]);
      db.raw.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** @param {unknown} err */
export function isUniqueViolation(err) {
  const e = /** @type {any} */ (err);
  return Boolean(e && (e.errcode === 2067 || e.errcode === 1555 || /UNIQUE constraint failed/.test(String(e.message))));
}
