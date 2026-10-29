import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { passwordHash, passwordMatches } from '../src/server/store.ts';

test('password hashes use versioned OWASP scrypt parameters and still verify legacy accounts', async () => {
  const password = 'a long password for migration';
  const hash = await passwordHash(password);
  assert.match(hash, /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(await passwordMatches(password, hash), true);
  assert.equal(await passwordMatches('incorrect', hash), false);
  const salt = 'a'.repeat(32);
  const legacy = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  assert.equal(await passwordMatches(password, legacy), true);
  assert.equal(await passwordMatches('incorrect', legacy), false);
  for (const invalid of [
    null,
    '',
    'salt:key',
    'scrypt$999999999$8$3$abc$def',
    'scrypt$32768$8$3$bad$bad',
  ])
    assert.equal(await passwordMatches(password, invalid), false);
});
