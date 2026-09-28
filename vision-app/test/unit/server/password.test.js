import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, checkPasswordPolicy, needsRehash, dummyVerify, SCRYPT_PARAMS } from '../../../server/auth/password.js';

test('hash format stores scrypt parameters and a 16-byte salt / 64-byte key', async () => {
  const h = await hashPassword('Correct-Horse-9');
  const [alg, N, r, p, salt, key] = h.split('$');
  assert.equal(alg, 'scrypt');
  assert.deepEqual([Number(N), Number(r), Number(p)], [2 ** 15, 8, 1]);
  assert.equal(Buffer.from(salt, 'base64url').length, 16);
  assert.equal(Buffer.from(key, 'base64url').length, 64);
  assert.equal(SCRYPT_PARAMS.N, 32768);
});

test('verify accepts the right password and rejects wrong ones', async () => {
  const h = await hashPassword('Correct-Horse-9');
  assert.equal(await verifyPassword('Correct-Horse-9', h), true);
  assert.equal(await verifyPassword('correct-horse-9', h), false);
  assert.equal(await verifyPassword('', h), false);
});

test('same password hashes differently (random salt)', async () => {
  const [a, b] = await Promise.all([hashPassword('same-password-1'), hashPassword('same-password-1')]);
  assert.notEqual(a, b);
});

test('unicode normalisation: composed and decomposed Hebrew/accents verify alike', async () => {
  const composed = 'café-שלום-123';
  const decomposed = 'café-שלום-123';
  const h = await hashPassword(composed);
  assert.equal(await verifyPassword(decomposed, h), true);
});

test('malformed or hostile hashes verify false without throwing', async () => {
  for (const bad of ['', 'plain', 'scrypt$1$8$1$aa$bb', 'scrypt$33554432$8$1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA', 'bcrypt$x$y$z$w$v', null]) {
    assert.equal(await verifyPassword('x', bad), false);
  }
});

test('needsRehash flags weaker parameters', async () => {
  const weak = await hashPassword('Correct-Horse-9', { N: 1024 });
  assert.equal(await verifyPassword('Correct-Horse-9', weak), true);
  assert.equal(needsRehash(weak), true);
  assert.equal(needsRehash(await hashPassword('Correct-Horse-9')), false);
});

test('dummyVerify always false', async () => {
  assert.equal(await dummyVerify('anything'), false);
});

test('password policy', () => {
  assert.equal(checkPasswordPolicy('short1!')?.code, 'PASSWORD_TOO_SHORT');
  assert.equal(checkPasswordPolicy('x'.repeat(7) + 'y'), null);
  assert.equal(checkPasswordPolicy('a'.repeat(129))?.code, 'PASSWORD_TOO_LONG');
  assert.equal(checkPasswordPolicy('b'.repeat(128) + 'c')?.code, 'PASSWORD_TOO_LONG');
  assert.equal(checkPasswordPolicy('aaaaaaaaaa')?.code, 'PASSWORD_TOO_COMMON');
  assert.equal(checkPasswordPolicy('Password1')?.code, 'PASSWORD_TOO_COMMON');
  assert.equal(checkPasswordPolicy('12345678')?.code, 'PASSWORD_TOO_COMMON');
  assert.equal(checkPasswordPolicy('danacohen', { email: 'danacohen@example.com' })?.code, 'PASSWORD_TOO_COMMON');
  assert.equal(checkPasswordPolicy(undefined)?.code, 'PASSWORD_INVALID');
  assert.equal(checkPasswordPolicy(12345678)?.code, 'PASSWORD_INVALID');
  assert.equal(checkPasswordPolicy('Correct-Horse-9'), null);
  // counts code points, not UTF-16 units: 8 emoji is 8 characters
  assert.equal(checkPasswordPolicy('😀😁😂🤣😃😄😅😆'), null);
  assert.equal(checkPasswordPolicy('😀😁😂🤣')?.code, 'PASSWORD_TOO_SHORT');
});
