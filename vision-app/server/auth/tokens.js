// @ts-check
import { createHash, randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, base64url (43 chars). */
export const newToken = () => randomBytes(32).toString('base64url');
export const newId = () => randomUUID();
/** @param {string} s */
export const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
/** @param {string} secret @param {string} data */
export const hmacHex = (secret, data) => createHmac('sha256', secret).update(data, 'utf8').digest('hex');

/** Constant-time comparison of two strings (false on length mismatch). */
export function safeEqual(/** @type {string} */ a, /** @type {string} */ b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Looks like a token we issued (cheap pre-check before hashing/DB lookup). */
export const isTokenShape = (/** @type {unknown} */ t) => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
