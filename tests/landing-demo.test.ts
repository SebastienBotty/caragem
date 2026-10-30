import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, available } from '../src/lib/domain.ts';
import { createLandingDemo, landingChapters } from '../src/lib/landing-demo.ts';

test('landing follows the real client, assignment, stock and intervention workflow', () => {
  const { snapshots: s, vehicleId, customerId } = createLandingDemo();
  assert.equal(s.length, landingChapters.length);
  const vehicle = (i: number) => s[i].vehicles.find((v) => v.id === vehicleId)!;
  assert.equal(
    s[0].customers.some((c) => c.id === customerId),
    false,
  );
  assert.equal(s[1].customers.find((c) => c.id === customerId)?.name, 'Camille Martin');
  assert.equal(vehicle(1).customerId, customerId);
  assert.equal(vehicle(1).stage, 'reception');
  assert.deepEqual(vehicle(2).tasks[0].assignees, [s[2].users[2].id]);
  assert.equal(vehicle(3).stage, 'workshop');
  assert.equal(vehicle(3).tasks[0].status, 'doing');
  assert.deepEqual(
    s.map((state) => state.parts[0].stock),
    [4, 4, 4, 4, 3, 8, 8],
  );
  assert.equal(s[4].reservations[0].consumed, true);
  assert.equal(available(s[4], 'landing-filter'), 3);
  assert.equal(s[5].orders[0].received, 5);
  assert.equal(vehicle(6).stage, 'ready');
  assert.equal(vehicle(6).tasks[0].minutes, 75);
});

test('free demo actions preserve replay snapshots and separate demo sessions', () => {
  const first = createLandingDemo();
  const second = createLandingDemo();
  const final = first.snapshots[6];
  const edited = applyAction(
    final,
    { type: 'adjustStock', id: 'landing-filter', delta: -1, reason: 'Essai local' },
    final.users[0],
  );
  assert.equal(edited.parts[0].stock, 7);
  assert.equal(final.parts[0].stock, 8);
  assert.equal(second.snapshots[6].parts[0].stock, 8);
  assert.notEqual(first.vehicleId, second.vehicleId);
});
