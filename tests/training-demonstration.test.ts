import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrainingDemonstration } from '../src/lib/training-demonstration.ts';
import { available, totals } from '../src/lib/domain.ts';

test('all guided scenarios show completed steps without user input and keep independent snapshots', () => {
  for (const page of [
    'garage',
    'vehicles',
    'tasks',
    'customers',
    'planning',
    'estimates',
    'invoices',
    'inventory',
    'messages',
    'team',
    'settings',
  ]) {
    const tour = createTrainingDemonstration(page);
    assert.ok(tour.scenes.length >= 3);
    for (const scene of tour.scenes) {
      assert.ok(scene.step.text, `${page}: ${scene.step.type}`);
      assert.doesNotMatch(scene.step.text, /cliquez|saisissez|enregistrez|cochez|ouvrez|exercice/i);
      assert.ok(scene.state.demo);
      if (scene.vehicleId) assert.ok(scene.state.vehicles.some((v) => v.id === scene.vehicleId));
      if (scene.documentId) assert.ok(scene.state.documents.some((d) => d.id === scene.documentId));
    }
    const before = JSON.stringify(tour.scenes[0]);
    tour.scenes.at(-1)!.state.settings.name = 'Changed';
    assert.equal(
      JSON.stringify(tour.scenes[0]),
      before,
      'backwards navigation restores the original snapshot',
    );
    assert.notEqual(tour.scenes[0].state.id, createTrainingDemonstration(page).scenes[0].state.id);
  }
});

test('demonstrations preserve business rules, balances, linked customers, invitations and permissions', () => {
  const vehicle = createTrainingDemonstration('garage').scenes;
  assert.equal(vehicle[0].state.vehicles[0].stage, 'reception');
  const reserved = vehicle.find((s) => s.step.type === 'reserve')!.state;
  assert.equal(reserved.parts[0].stock, 10);
  assert.equal(available(reserved, reserved.parts[0].id), 9);
  const done = vehicle.at(-1)!.state;
  assert.equal(done.vehicles[0].stage, 'returned');
  assert.equal(done.vehicles[0].tasks[0].minutes, 45);
  assert.equal(done.vehicles[0].tasks[0].estimatedMinutes, 45);
  assert.equal(done.parts[0].stock, 9);
  const customers = createTrainingDemonstration('customers').scenes;
  assert.equal(customers[1].state.vehicles[0].customerId, customers[0].state.customers.at(-1)!.id);
  const planning = createTrainingDemonstration('planning').scenes;
  assert.equal(planning[0].state.vehicles.length, 0);
  assert.equal(planning[1].state.vehicles[0].stage, 'reception');
  const documents = createTrainingDemonstration('invoices').scenes;
  const invoice = documents.at(-1)!.state.documents.at(-1)!;
  assert.equal(invoice.kind, 'invoice');
  assert.ok(invoice.validated);
  assert.equal(invoice.paid, totals(invoice.lines, invoice.taxRate).gross);
  assert.equal(documents[0].state.documents.length, 1);
  const inventory = createTrainingDemonstration('inventory').scenes;
  assert.equal(inventory[2].state.parts.at(-1)!.stock, 8);
  assert.equal(inventory.at(-1)!.state.parts.at(-1)!.stock, 7);
  assert.equal(
    createTrainingDemonstration('messages').scenes.at(-1)!.state.mails[0].status,
    'sent',
  );
  const team = createTrainingDemonstration('team').scenes;
  assert.ok(team[0].invitation);
  assert.equal(team[1].invitation, null);
  assert.equal(team[0].state.users.length, 2);
  const colleague = team.at(-1)!.state.users.at(-1)!;
  assert.ok(colleague.customRoleId);
  assert.equal(colleague.permissions?.['stock.view'], true);
});
