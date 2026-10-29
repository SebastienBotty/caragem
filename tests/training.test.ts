import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTraining,
  applyTrainingAction,
  matchesTrainingStep,
  type TrainingEvent,
} from '../src/lib/training.ts';
import type { Action } from '../src/lib/domain.ts';

test('training is fresh, fictitious and independent for each launch; scenarios omit obvious UI explanations', () => {
  for (const page of [
    'garage',
    'vehicles',
    'tasks',
    'planning',
    'customers',
    'estimates',
    'invoices',
    'inventory',
    'messages',
    'team',
    'settings',
  ]) {
    const first = createTraining(page),
      second = createTraining(page);
    assert.notEqual(first.state.id, second.state.id);
    assert.equal(first.state.demo, true);
    assert.equal(first.state.settings.configured, true);
    assert.ok(first.state.customers.every((c) => c.email.endsWith('.invalid')));
    assert.ok(first.steps.length >= 3);
    assert.ok(first.steps.every((step) => step.type && step.target && step.text));
    first.state.customers[0].name = 'Changed locally';
    assert.equal(second.state.customers[0].name, 'Camille Formation');
  }
});

test('a real reducer drives the complete fictitious vehicle workflow and validates stock and completion', () => {
  const exercise = createTraining('garage');
  let state = exercise.state;
  let index = 0;
  function perform(action: Action) {
    const before = JSON.stringify(state);
    const next = applyTrainingAction(state, action);
    assert.equal(JSON.stringify(state), before, 'previous snapshots remain unchanged');
    state = next;
    assert.ok(matchesTrainingStep(exercise.steps[index], action), exercise.steps[index].title);
    index++;
  }
  assert.equal(matchesTrainingStep(exercise.steps[0], { type: 'trainingInvite' }), false);
  perform({
    type: 'vehicle',
    customerId: state.customers[0].id,
    plate: 'TEST-001',
    model: 'Audi A3',
    mileage: 45000,
    issue: 'Révision',
    color: '#cf4141',
    due: new Date().toISOString(),
    priority: false,
  });
  const vehicleId = state.vehicles[0].id,
    taskId = state.vehicles[0].tasks[0].id;
  perform({ type: 'stage', id: vehicleId, stage: 'diagnosis' });
  perform({ type: 'stage', id: vehicleId, stage: 'waiting' });
  perform({ type: 'task', vehicleId, taskId, operation: 'assign', assignees: [state.users[1].id] });
  perform({ type: 'task', vehicleId, taskId, operation: 'start' });
  perform({ type: 'reserve', vehicleId, partId: state.parts[0].id, quantity: 1 });
  assert.throws(
    () => applyTrainingAction(state, { type: 'stage', id: vehicleId, stage: 'ready' }),
    /réservées/,
  );
  perform({ type: 'consume', id: state.reservations[0].id });
  perform({ type: 'task', vehicleId, taskId, operation: 'finish', minutes: 45 });
  perform({ type: 'stage', id: vehicleId, stage: 'ready' });
  perform({ type: 'stage', id: vehicleId, stage: 'returned' });
  assert.equal(index, exercise.steps.length);
  assert.equal(state.vehicles[0].stage, 'returned');
  assert.equal(state.vehicles[0].tasks[0].minutes, 45);
  assert.equal(state.parts[0].stock, 9);
});

test('team and document exercises advance on concrete operations, not unrelated actions', () => {
  const team = createTraining('team');
  const events: TrainingEvent[] = [
    { type: 'trainingInvite' },
    { type: 'trainingJoin' },
    {
      type: 'customRole',
      name: 'Chef atelier',
      baseRole: 'mechanic',
      permissions: { 'garage.view': true },
    },
    { type: 'assignRole', userId: 'colleague', roleId: 'custom' },
    { type: 'userPermissions', userId: 'colleague', permissions: { 'stock.view': true } },
  ];
  events.forEach((event, i) => assert.equal(matchesTrainingStep(team.steps[i], event), true));
  assert.equal(matchesTrainingStep(team.steps[3], events[4]), false);
  const docs = createTraining('invoices');
  assert.deepEqual(
    docs.steps.map((step) => step.type),
    ['document', 'acceptEstimate', 'convertEstimate', 'validateDocument', 'payment'],
  );
  assert.equal(
    matchesTrainingStep(docs.steps[0], {
      type: 'document',
      kind: 'invoice',
      vehicleId: 'v',
      lines: [],
      taxRate: 20,
    }),
    false,
  );
});
