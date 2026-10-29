import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authAttemptAllowed } from '../src/server/auth-rate-limit.ts';

test('sensitive-operation limits expire and use separate keys', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  for (let i = 0; i < 10; i++) assert.equal(authAttemptAllowed('reauth:test', 10), true);
  assert.equal(authAttemptAllowed('reauth:test', 10), false);
  assert.equal(authAttemptAllowed('reauth:other', 10), true);
  t.mock.timers.tick(15 * 60000);
  assert.equal(authAttemptAllowed('reauth:test', 10), true);
});
