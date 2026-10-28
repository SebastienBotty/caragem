import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/lib/domain.ts';
import { mechanicAssignments } from '../src/lib/layout.ts';

test('mechanics rest until work starts, appear once, and rest again after their last active task', () => {
  const state = createSeed('rest', true);
  state.vehicles.forEach((v) =>
    v.tasks.forEach((t) => {
      t.status = 'todo';
    }),
  );
  const mechanics = state.users.filter((u) => u.role === 'mechanic');
  assert.equal(mechanicAssignments(state).length, mechanics.length);
  assert.ok(mechanicAssignments(state).every((a) => a.vehicleId === null));
  const [a, b] = state.vehicles;
  a.tasks[0].assignees = [mechanics[0].id, mechanics[1].id];
  a.tasks[0].status = 'doing';
  b.tasks[0].assignees = [mechanics[0].id];
  b.tasks[0].status = 'doing';
  assert.deepEqual(
    mechanicAssignments(state).map((a) => a.vehicleId),
    [a.id, a.id, null],
  );
  a.tasks[0].status = 'done';
  assert.deepEqual(
    mechanicAssignments(state).map((a) => a.vehicleId),
    [b.id, null, null],
  );
  b.stage = 'returned';
  assert.ok(mechanicAssignments(state).every((a) => a.vehicleId === null));
});
