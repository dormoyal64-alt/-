// @ts-check
/**
 * Password hashing with scrypt (node:crypto) and the password policy.
 * Hash format: `scrypt$<N>$<r>$<p>$<salt b64url>$<key b64url>` so parameters can be raised later.
 */
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { COMMON_PASSWORDS } from './common-passwords.js';

export const SCRYPT_PARAMS = Object.freeze({ N: 2 ** 15, r: 8, p: 1, keyLen: 64, saltLen: 16 });
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
const MAX_N = 2 ** 20;

/** scrypt needs 128*N*r bytes; allow 2x headroom. */
const maxmemFor = (/** @type {number} */ N, /** @type {number} */ r) => 256 * N * r;

/**
 * @param {string} password @param {Buffer} salt @param {number} N @param {number} r @param {number} p @param {number} keyLen
 * @returns {Promise<Buffer>}
 */
function scryptAsync(password, salt, N, r, p, keyLen) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, { N, r, p, maxmem: maxmemFor(N, r) }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Unicode-normalise so the same password typed on different keyboards hashes identically. */
const normalize = (/** @type {string} */ pw) => pw.normalize('NFKC');

/**
 * @param {string} password
 * @param {Partial<typeof SCRYPT_PARAMS>} [params] (tests may lower N for speed)
 * @returns {Promise<string>}
 */
export async function hashPassword(password, params = {}) {
  const { N, r, p, keyLen, saltLen } = { ...SCRYPT_PARAMS, ...params };
  const salt = randomBytes(saltLen);
  const key = await scryptAsync(normalize(password), salt, N, r, p, keyLen);
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * @param {string} stored
 * @returns {{N: number, r: number, p: number, salt: Buffer, key: Buffer}|null}
 */
function parseHash(stored) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (!Number.isInteger(N) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) return null;
  const salt = Buffer.from(parts[4], 'base64url');
  const key = Buffer.from(parts[5], 'base64url');
  if (salt.length < 8 || key.length < 16 || key.length > 128) return null;
  return { N, r, p, salt, key };
}

/**
 * Timing-safe verification. Malformed hashes verify as false (never throw).
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed || typeof password !== 'string') return false;
  const { N, r, p, salt, key } = parsed;
  const candidate = await scryptAsync(normalize(password), salt, N, r, p, key.length);
  return timingSafeEqual(candidate, key);
}

/** True when the stored hash uses weaker parameters than the current ones. */
export function needsRehash(/** @type {string} */ stored) {
  const parsed = parseHash(stored);
  return !parsed || parsed.N < SCRYPT_PARAMS.N || parsed.r < SCRYPT_PARAMS.r || parsed.key.length < SCRYPT_PARAMS.keyLen;
}

/** @type {Promise<string>|null} */
let dummyHash = null;
/**
 * Burns the same scrypt cost as a real verification. Used when the e-mail is unknown so login
 * timing does not reveal whether an account exists.
 * @param {string} password
 */
export async function dummyVerify(password) {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(typeof password === 'string' ? password : '', await dummyHash);
  return false;
}

/**
 * @param {unknown} password
 * @param {{email?: string}} [ctx]
 * @returns {null|{code: 'PASSWORD_TOO_SHORT'|'PASSWORD_TOO_LONG'|'PASSWORD_TOO_COMMON'|'PASSWORD_INVALID', message: string}}
 */
export function checkPasswordPolicy(password, ctx = {}) {
  if (typeof password !== 'string') return { code: 'PASSWORD_INVALID', message: 'Password is required' };
  const pw = normalize(password);
  const chars = [...pw];
  if (chars.length < PASSWORD_MIN) return { code: 'PASSWORD_TOO_SHORT', message: `Password must be at least ${PASSWORD_MIN} characters` };
  if (chars.length > PASSWORD_MAX) return { code: 'PASSWORD_TOO_LONG', message: `Password must be at most ${PASSWORD_MAX} characters` };
  if (chars.every((c) => c === chars[0])) return { code: 'PASSWORD_TOO_COMMON', message: 'Password is too easy to guess' };
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return { code: 'PASSWORD_TOO_COMMON', message: 'Password is too common' };
  const email = ctx.email ? ctx.email.toLowerCase() : '';
  if (email && (lower === email || lower === email.split('@')[0])) {
    return { code: 'PASSWORD_TOO_COMMON', message: 'Password must not be your e-mail address' };
  }
  return null;
}
