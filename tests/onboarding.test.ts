import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/lib/domain.ts';
import { onboardingSteps, onboardingRoute } from '../src/lib/onboarding.ts';

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

test('each screen change is preceded by its real navigation button, without a redundant step on the same screen', () => {
  const state = createSeed('tour-route', true);
  const route = onboardingRoute(state, state.users[0], 'garage');
  let page = 'garage';
  for (let i = 0; i < route.length; i++) {
    const step = route[i];
    if (step.navigation) {
      assert.notEqual(step.page, page);
      assert.equal(step.target, `[data-tour-nav="${step.page}"]`);
      assert.equal(route[i + 1].page, step.page);
      assert.equal(route[i + 1].navigation, '');
    } else {
      if (step.page !== page) assert.equal(route[i - 1].navigation.length > 0, true);
      page = step.page;
    }
  }
  assert.equal(route.filter((s) => s.navigation).length, 8);
  assert.equal(route.filter((s) => s.id === 'arrival-navigation').length, 0);
  const mechanic = state.users[1];
  const employeeRoute = onboardingRoute(state, mechanic, 'tasks');
  assert.equal(employeeRoute[0].id, 'garage-navigation');
  assert.ok(employeeRoute.every((s) => !['customers', 'estimates', 'messages'].includes(s.page)));
});
