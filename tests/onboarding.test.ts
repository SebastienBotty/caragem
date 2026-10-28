import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/lib/domain.ts';
import { onboardingSteps } from '../src/lib/onboarding.ts';

test('the guided tour follows current permissions and always offers team and account settings', () => {
  const state = createSeed('tour', true);
  const [owner, mechanic] = state.users;
  const ownerSteps = onboardingSteps(state, owner);
  assert.equal(ownerSteps.length, 10);
  assert.equal(new Set(ownerSteps.map((s) => s.id)).size, ownerSteps.length);
  assert.deepEqual(
    onboardingSteps(state, mechanic).map((s) => s.id),
    ['garage', 'tasks', 'planning', 'stock', 'team', 'settings'],
  );
  mechanic.permissions = { 'garage.view': false, 'planning.view': false, 'stock.view': false };
  assert.deepEqual(
    onboardingSteps(state, mechanic).map((s) => s.id),
    ['team', 'settings'],
  );
  mechanic.permissions = { 'customers.view': true, 'documents.view': true };
  const allowed = onboardingSteps(state, mechanic).map((s) => s.id);
  assert.ok(allowed.includes('customers') && allowed.includes('documents'));
  assert.ok(!allowed.includes('arrival') && !allowed.includes('messages'));
});
