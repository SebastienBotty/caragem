import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/lib/domain.ts';
import { garagePlacement } from '../src/lib/layout.ts';

test('only the transferred vehicle moves; freed slots are reused without compacting or shrinking', () => {
  const state = createSeed('placement', true);
  let placement = garagePlacement(state);
  for (const target of ['ready', 'waiting', 'workshop', 'returned'] as const) {
    const v = state.vehicles.find((v) => v.stage === 'workshop' || v.stage === 'ready')!;
    const before = placement;
    v.stage = target;
    placement = garagePlacement(state, before);
    for (const other of state.vehicles.filter(
      (other) => other.id !== v.id && other.stage !== 'returned',
    )) {
      assert.deepEqual(placement.positions.get(other.id), before.positions.get(other.id));
    }
    if (target === 'returned') assert.equal(placement.positions.has(v.id), false);
  }
});

test('overflow extends a zone without moving its cars or neighboring zones; holes and reorder stay stable', () => {
  const state = createSeed('overflow-placement', true);
  let placement = garagePlacement(state);
  const original = placement;
  for (let i = 0; i < 20; i++) {
    state.vehicles.push({
      ...structuredClone(state.vehicles[0]),
      id: `extra-${i}`,
      stage: 'workshop',
    });
    placement = garagePlacement(state, placement);
    for (const [id, position] of original.positions)
      assert.deepEqual(placement.positions.get(id), position);
  }
  const departing = state.vehicles.find((v) => v.stage === 'workshop')!;
  const slot = placement.slots.get(departing.id)!;
  departing.stage = 'returned';
  placement = garagePlacement(state, placement);
  const newcomer = { ...structuredClone(departing), id: 'newcomer', stage: 'workshop' as const };
  state.vehicles.unshift(newcomer);
  const next = garagePlacement(state, placement);
  assert.deepEqual(next.slots.get(newcomer.id), slot);
  for (const [id, position] of placement.positions)
    assert.deepEqual(next.positions.get(id), position);
  state.vehicles.reverse();
  const reordered = garagePlacement(state, next);
  assert.deepEqual(reordered.positions, next.positions);
  assert.equal(
    new Set([...next.positions.values()].map((p) => p.join(','))).size,
    next.positions.size,
  );
});
