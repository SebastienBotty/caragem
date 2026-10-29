import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, applyAction, actionSchema } from '../src/lib/domain.ts';
import { interventionTime } from '../src/lib/work-time.ts';
import { Store } from '../src/server/store.ts';
import { testDatabase } from './helpers/database.ts';

test('planned time never replaces recorded work; final differences require complete estimates and finished tasks', () => {
  let state = createSeed('time', true);
  const [owner, worker] = state.users;
  const vehicle = state.vehicles.find((v) => v.stage !== 'returned' && v.stage !== 'ready')!;
  vehicle.tasks = [vehicle.tasks[0]];
  const task = vehicle.tasks[0];
  task.status = 'todo';
  task.minutes = 0;
  let time = interventionTime(vehicle);
  assert.equal(time.unestimated, 1);
  assert.equal(time.delta, null);
  state = applyAction(
    state,
    { type: 'estimateTask', vehicleId: vehicle.id, taskId: task.id, minutes: 30 },
    owner,
  );
  let current = state.vehicles.find((v) => v.id === vehicle.id)!;
  assert.equal(current.tasks[0].minutes, 0);
  assert.equal(interventionTime(current).planned, 30);
  assert.equal(interventionTime(current).delta, null);
  assert.throws(
    () =>
      applyAction(
        state,
        { type: 'estimateTask', vehicleId: vehicle.id, taskId: task.id, minutes: 20 },
        worker,
      ),
    /autorisation/,
  );
  state = applyAction(
    state,
    { type: 'task', vehicleId: vehicle.id, taskId: task.id, operation: 'start' },
    owner,
  );
  state = applyAction(
    state,
    { type: 'task', vehicleId: vehicle.id, taskId: task.id, operation: 'finish', minutes: 45 },
    owner,
  );
  current = state.vehicles.find((v) => v.id === vehicle.id)!;
  assert.equal(interventionTime(current).delta, 15);
  state = applyAction(
    state,
    { type: 'estimateTask', vehicleId: vehicle.id, taskId: task.id, minutes: 0 },
    owner,
  );
  assert.equal(interventionTime(state.vehicles.find((v) => v.id === vehicle.id)!).delta, 45);
  state = applyAction(
    state,
    { type: 'estimateTask', vehicleId: vehicle.id, taskId: task.id },
    owner,
  );
  assert.equal(interventionTime(state.vehicles.find((v) => v.id === vehicle.id)!).delta, null);
  assert.throws(
    () =>
      applyAction(
        state,
        { type: 'estimateTask', vehicleId: vehicle.id, taskId: 'foreign', minutes: 5 },
        owner,
      ),
    /introuvable/,
  );
  for (const minutes of [-1, 0.5, 100001])
    assert.equal(
      actionSchema.safeParse({
        type: 'estimateTask',
        vehicleId: vehicle.id,
        taskId: task.id,
        minutes,
      }).success,
      false,
    );
});

test('creation accepts estimates while repeat visits reset them and blocked calendar time remains separate', () => {
  let state = createSeed('arrival-time', true);
  const owner = state.users[0];
  state = applyAction(
    state,
    {
      type: 'vehicle',
      customerId: state.customers[0].id,
      model: 'Audi A3',
      plate: 'TEST-TIME',
      color: '#123456',
      mileage: 100,
      issue: 'Entretien',
      due: new Date().toISOString(),
      priority: false,
      estimatedMinutes: 60,
    },
    owner,
  );
  let vehicle = state.vehicles.at(-1)!;
  assert.equal(vehicle.tasks[0].estimatedMinutes, 60);
  assert.equal('estimatedMinutes' in vehicle, false);
  state = applyAction(
    state,
    { type: 'addTask', vehicleId: vehicle.id, title: 'Contrôle', estimatedMinutes: 15 },
    owner,
  );
  vehicle = state.vehicles.at(-1)!;
  assert.equal(interventionTime(vehicle).planned, 75);
  vehicle.blockerHistory = [
    {
      kind: 'parts',
      nextAction: 'Livraison',
      openedAt: '2026-01-01T10:00:00Z',
      resolvedAt: '2026-01-01T11:00:00Z',
      text: 'Pièce',
    },
  ];
  vehicle.blockerDetails = {
    kind: 'approval',
    nextAction: 'Appeler',
    openedAt: '2026-01-01T12:00:00Z',
  };
  const time = interventionTime(vehicle, Date.parse('2026-01-01T12:30:00Z'));
  assert.equal(time.blocked, 90);
  assert.equal(time.spent, 0);
  vehicle.stage = 'returned';
  assert.throws(
    () =>
      applyAction(
        state,
        { type: 'estimateTask', vehicleId: vehicle.id, taskId: vehicle.tasks[0].id, minutes: 5 },
        owner,
      ),
    /clôtur/,
  );
  state = applyAction(
    state,
    { type: 'revisit', id: vehicle.id, issue: 'Nouvelle visite', due: new Date().toISOString() },
    owner,
  );
  assert.equal(state.vehicles.at(-1)!.tasks[0].estimatedMinutes, undefined);
  assert.equal(interventionTime(state.vehicles.at(-1)!).spent, 0);
});

test('estimates persist in PostgreSQL without changing task minutes', async () => {
  const store = new Store(testDatabase());
  try {
    const state = await store.create(true);
    const session = (await store.session(
      `carm_session=${await store.newSession(state.id, state.users[0].id)}`,
    ))!;
    const vehicle = state.vehicles.find((v) => v.stage !== 'returned' && v.stage !== 'ready')!;
    const task = vehicle.tasks[0];
    await store.act(session, {
      type: 'estimateTask',
      vehicleId: vehicle.id,
      taskId: task.id,
      minutes: 90,
    });
    const saved = (await store.get(state.id)).vehicles.find((v) => v.id === vehicle.id)!.tasks[0];
    assert.equal(saved.estimatedMinutes, 90);
    assert.equal(saved.minutes, task.minutes);
  } finally {
    await store.close();
  }
});
