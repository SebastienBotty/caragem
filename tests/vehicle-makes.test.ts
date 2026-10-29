import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vehicleMakes } from '../src/lib/vehicle-makes.ts';

test('vehicle makes are unique, alphabetically sorted and include European-market and legacy brands', () => {
  assert.equal(new Set(vehicleMakes).size, vehicleMakes.length);
  assert.deepEqual(
    vehicleMakes,
    [...vehicleMakes].sort((a, b) => a.localeCompare(b, 'fr')),
  );
  for (const make of [
    'Alfa Romeo',
    'BYD',
    'Citroën',
    'Cupra',
    'Dacia',
    'DS Automobiles',
    'Jaecoo',
    'KGM',
    'Land Rover',
    'Leapmotor',
    'Lynk & Co',
    'Mercedes-Benz',
    'MG',
    'Opel',
    'Peugeot',
    'Renault',
    'Saab',
    'Škoda',
    'Volkswagen',
    'XPeng',
    'Zeekr',
  ])
    assert.ok(vehicleMakes.includes(make), make);
  assert.ok(vehicleMakes.every((make) => make.length <= 49));
});
