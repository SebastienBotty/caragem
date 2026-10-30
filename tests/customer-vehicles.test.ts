import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createSeed } from '../src/lib/domain.ts';
import { customerVehicles } from '../src/lib/customer-vehicles.ts';
import { visibleState } from '../src/lib/permissions.ts';
import { Store } from '../src/server/store.ts';
import { testDatabase } from './helpers/database.ts';

const arrival = (customerId: string, plate = 'AB-123-CD') => ({
  type: 'vehicle' as const,
  customerId,
  plate,
  model: 'Audi A3',
  color: '#ab1234',
  mileage: 45000,
  issue: 'Entretien',
  due: new Date().toISOString(),
  priority: false,
});
function fixture() {
  let state = createSeed('clients', false);
  for (const name of ['Alice', 'Béatrice'])
    state = applyAction(
      state,
      {
        type: 'customer',
        name,
        email: `${name === 'Alice' ? 'alice' : 'beatrice'}@example.com`,
        phone: '',
      },
      state.users[0],
    );
  return state;
}

test('a customer retains several registered cars, deduplicated across visits with their latest details', () => {
  let state = fixture();
  const customerId = state.customers[0].id;
  state = applyAction(state, arrival(customerId), state.users[0]);
  state = applyAction(state, arrival(customerId, 'BE-456-FG'), state.users[0]);
  assert.equal(customerVehicles(state, customerId).length, 2);
  state.vehicles[0].stage = 'returned';
  const old = structuredClone(state.vehicles[0]);
  state = applyAction(
    state,
    {
      ...arrival(customerId),
      existingVehicleId: old.id,
      plate: 'FORGED',
      model: 'FORGED',
      mileage: 47000,
      color: '#112233',
    },
    state.users[0],
  );
  assert.equal(state.vehicles.at(-1)!.plate, old.plate);
  assert.equal(state.vehicles.at(-1)!.model, old.model);
  assert.equal(state.vehicles.at(-1)!.visit, 2);
  assert.deepEqual(state.vehicles[0], old, 'old intervention stays unchanged');
  const cars = customerVehicles(state, customerId);
  assert.equal(cars.length, 2);
  assert.equal(cars.find((v) => v.plate === old.plate)!.mileage, 47000);
  assert.equal(cars.find((v) => v.plate === old.plate)!.color, '#112233');
  assert.equal(customerVehicles(state, state.customers[1].id).length, 0);
  state.vehicles.at(-1)!.stage = 'returned';
  state = applyAction(
    state,
    { type: 'revisit', id: old.id, issue: 'Troisième visite', due: old.due },
    state.users[0],
  );
  assert.equal(state.vehicles.at(-1)!.visit, 3);
  assert.equal(
    state.vehicles.at(-1)!.mileage,
    47000,
    'returning from an older dossier uses the latest car details',
  );
  assert.equal(state.vehicles.at(-1)!.color, '#112233');
});

test('saved-car selection validates the customer and rejects duplicate arrivals, including plate formatting variants', () => {
  let state = fixture();
  const [alice, beatrice] = state.customers;
  state = applyAction(state, arrival(alice.id), state.users[0]);
  const car = state.vehicles[0];
  assert.throws(
    () =>
      applyAction(state, { ...arrival(beatrice.id), existingVehicleId: car.id }, state.users[0]),
    /n’appartient pas/,
  );
  assert.throws(
    () =>
      applyAction(state, { ...arrival(alice.id), existingVehicleId: 'missing' }, state.users[0]),
    /introuvable/,
  );
  assert.throws(
    () => applyAction(state, arrival(alice.id, ' ab 123 cd '), state.users[0]),
    /déjà présent/,
  );
  assert.throws(
    () => applyAction(state, { ...arrival(alice.id), existingVehicleId: car.id }, state.users[0]),
    /déjà présent/,
  );
});

test('registered car metadata remains available for arrivals without exposing forbidden intervention history', () => {
  const state = createSeed('history-access', true);
  const car = state.vehicles[0];
  car.stage = 'returned';
  const worker = state.users[1];
  worker.permissions = { 'vehicles.create': true, 'history.view': false };
  const view = visibleState(state, worker.id);
  assert.ok(!view.vehicles.some((v) => v.id === car.id));
  const saved = customerVehicles(view, car.customerId).find((v) => v.plate === car.plate)!;
  assert.ok(saved);
  assert.equal('issue' in saved, false);
  assert.equal('notes' in saved, false);
  assert.equal(saved.inGarage, false);
  assert.doesNotThrow(() =>
    applyAction(state, { ...arrival(car.customerId), existingVehicleId: saved.id }, worker),
  );
  worker.permissions = { 'garage.view': false };
  assert.deepEqual(customerVehicles(visibleState(state, worker.id)), []);
});

test('client vehicle links and new visits persist in PostgreSQL and concurrent duplicate arrivals are rejected', async () => {
  const store = new Store(testDatabase());
  try {
    const state = fixture();
    state.demo = true;
    await store.save(state);
    const session = (await store.session(
      `caragem_session=${await store.newSession(state.id, state.users[0].id)}`,
    ))!;
    const results = await Promise.allSettled([
      store.act(session, arrival(state.customers[0].id)),
      store.act(session, arrival(state.customers[0].id)),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const reloaded = await store.get(state.id);
    assert.equal(customerVehicles(reloaded, state.customers[0].id).length, 1);
    assert.equal(reloaded.vehicles[0].customerId, state.customers[0].id);
  } finally {
    await store.close();
  }
});
