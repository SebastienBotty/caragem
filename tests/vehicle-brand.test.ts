import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { brands, vehicleBrand } from '../src/lib/vehicle-brand.ts';
test('brand lookup handles accents, aliases and unknown models; all logos are local', () => {
  assert.equal(vehicleBrand('Škoda Octavia'), 'skoda');
  assert.equal(vehicleBrand(' CITROËN C3 '), 'citroen');
  assert.equal(vehicleBrand('VW Golf'), 'volkswagen');
  assert.equal(vehicleBrand('Mercedes-Benz Classe A'), 'mercedes');
  assert.equal(vehicleBrand('Audi A3'), 'audi');
  assert.equal(vehicleBrand('Auditorium'), 'unknown');
  for (const brand of [...brands, 'unknown'])
    assert.ok(existsSync(`public/brands/${brand}.svg`), brand);
});
