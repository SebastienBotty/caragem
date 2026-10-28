import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { createSeed } from '../src/lib/domain.ts';
import {
  garageLayout,
  garageSite,
  garageCamera,
  slotPosition,
  vehicleRoute,
  circulationWidth,
} from '../src/lib/layout.ts';

test('every zone and the site perimeter retain a full circulation lane', () => {
  for (const modules of [1, 4, 10, 'mixed'] as const) {
    const state = createSeed('access', false);
    for (const [index, key] of Object.keys(state.settings.modules).entries())
      state.settings.modules[key] = modules === 'mixed' ? [10, 1, 7, 3, 1][index] : modules;
    const zones = garageLayout(state);
    const site = garageSite(zones);
    for (const a of zones) {
      assert.ok(a.x - a.width / 2 - site.minX >= circulationWidth - 0.001);
      assert.ok(site.maxX - a.x - a.width / 2 >= circulationWidth - 0.001);
      assert.ok(a.z - a.depth / 2 - site.minZ >= circulationWidth - 0.001);
      assert.ok(site.maxZ - a.z - a.depth / 2 >= circulationWidth - 0.001);
      for (const b of zones.filter((b) => b !== a)) {
        const gapX = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
        const gapZ = Math.abs(a.z - b.z) - (a.depth + b.depth) / 2;
        assert.ok(Math.max(gapX, gapZ) >= circulationWidth - 0.001, `${a.id}/${b.id} need a lane`);
      }
    }
  }
});

test('routes reach rear rows through aisles without crossing other bays, buildings or the perimeter', () => {
  for (const modules of [1, 4, 10, 'mixed'] as const) {
    const state = createSeed('routes', false);
    for (const [index, key] of Object.keys(state.settings.modules).entries())
      state.settings.modules[key] = modules === 'mixed' ? [10, 1, 7, 3, 1][index] : modules;
    const zones = garageLayout(state);
    const site = garageSite(zones);
    const slots = zones.flatMap((zone) =>
      Array.from({ length: zone.slots }, (_, i) => ({
        zone,
        position: slotPosition(zone, i),
      })),
    );
    const destinations = zones.flatMap((zone) => {
      const bays = slots.filter((slot) => slot.zone === zone);
      return [bays[0], bays.at(-1)!];
    });
    const intersects = (
      a: number[],
      b: number[],
      rect: { x: number; z: number; width: number; depth: number },
    ) =>
      Math.max(a[0], b[0]) + 2.1 > rect.x - rect.width / 2 &&
      Math.min(a[0], b[0]) - 2.1 < rect.x + rect.width / 2 &&
      Math.max(a[2], b[2]) + 2.1 > rect.z - rect.depth / 2 &&
      Math.min(a[2], b[2]) - 2.1 < rect.z + rect.depth / 2;
    for (const from of slots) {
      for (const to of destinations.filter((slot) => slot !== from)) {
        const route = [from.position, ...vehicleRoute(from.position, to.position, zones)];
        assert.deepEqual(route.at(-1), to.position);
        for (let i = 1; i < route.length; i++) {
          const a = route[i - 1],
            b = route[i];
          assert.ok(a[0] === b[0] || a[2] === b[2], 'route follows perpendicular aisles');
          for (const p of [a, b]) {
            assert.ok(p[0] - 2.1 >= site.minX && p[0] + 2.1 <= site.maxX);
            assert.ok(p[2] - 2.1 >= site.minZ && p[2] + 2.1 <= site.maxZ);
          }
          for (const zone of zones.filter((z) => z !== from.zone && z !== to.zone))
            assert.ok(!intersects(a, b, zone), `route crosses ${zone.id}`);
          for (const building of [site.service, site.lounge])
            assert.ok(!intersects(a, b, building), 'route crosses a building');
          for (const parked of slots.filter((s) => s !== from && s !== to))
            assert.ok(
              !intersects(a, b, {
                x: parked.position[0],
                z: parked.position[2],
                width: 1.9,
                depth: 3.6,
              }),
              'route crosses an occupied bay',
            );
        }
      }
    }
  }
});

test('overflow expands zones without overlap, and every vehicle fits its slot', () => {
  const state = createSeed('layout', true);
  for (let i = 0; i < 90; i++)
    state.vehicles.push({
      ...structuredClone(state.vehicles[0]),
      id: `overflow-${i}`,
      stage: 'workshop',
    });
  const zones = garageLayout(state);
  for (const zone of zones) {
    assert.ok(zone.slots >= state.vehicles.filter((v) => v.stage === zone.id).length);
    for (let i = 0; i < zone.slots; i++) {
      const [x, , z] = slotPosition(zone, i);
      assert.ok(Math.abs(x - zone.x) + 1.4 <= zone.width / 2);
      assert.ok(Math.abs(z - zone.z) + 2.2 <= zone.depth / 2);
    }
    assert.ok(Math.abs(zone.z) - zone.depth / 2 >= 3.5, 'central circulation lane remains free');
  }
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i];
      const b = zones[j];
      assert.ok(
        Math.abs(a.x - b.x) >= (a.width + b.width) / 2 ||
          Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2,
      );
    }
});

test('work bays sit behind the circulation lane; service rooms and entrance stay clear of cars', () => {
  for (const modules of [1, 4, 10]) {
    const state = createSeed('site', true);
    for (const key of Object.keys(state.settings.modules)) state.settings.modules[key] = modules;
    const zones = garageLayout(state);
    const site = garageSite(zones);
    const room = site.service;
    assert.ok(zones.find((z) => z.id === 'workshop')!.z < 0);
    assert.ok(zones.find((z) => z.id === 'ready')!.z > 0);
    assert.ok(room.x - room.width / 2 > site.minX && room.x + room.width / 2 < site.maxX);
    assert.ok(room.z + room.depth / 2 < site.maxZ);
    for (const z of zones)
      assert.ok(
        Math.abs(room.x - z.x) > (room.width + z.width) / 2 ||
          Math.abs(room.z - z.z) > (room.depth + z.depth) / 2,
      );
    for (const z of zones.filter((z) => z.z > 0))
      assert.ok(Math.abs(site.entryX - z.x) >= z.width / 2 + 3.4);
    const lounge = site.lounge;
    assert.ok(lounge.x - lounge.width / 2 > site.minX);
    assert.ok(lounge.z + lounge.depth / 2 < site.maxZ);
    for (const other of [...zones, room])
      assert.ok(
        Math.abs(lounge.x - other.x) > (lounge.width + other.width) / 2 ||
          Math.abs(lounge.z - other.z) > (lounge.depth + other.depth) / 2,
      );
    assert.ok(lounge.z - lounge.depth / 2 > 3.5);
  }
});

test('overview includes the whole site on a wide screen and a portrait phone', () => {
  const zones = garageLayout(createSeed('camera', true));
  const site = garageSite(zones);
  for (const aspect of [0.75, 1.5, 2.8]) {
    const frame = garageCamera(zones, 'all', aspect);
    const camera = new PerspectiveCamera(39, aspect, 0.1, 2000);
    camera.position.set(...frame.position);
    camera.lookAt(...frame.target);
    camera.updateMatrixWorld();
    for (const x of [site.minX - 1.5, site.maxX + 1.5])
      for (const z of [site.minZ - 1.5, site.maxZ + 1.5])
        for (const y of [-0.9, 5]) {
          const p = new Vector3(x, y, z).project(camera);
          assert.ok(
            Math.abs(p.x) < 1 && Math.abs(p.y) < 1,
            `site corner clipped at aspect ${aspect}`,
          );
        }
  }
});
