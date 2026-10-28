import { capacity, stages, type GarageState, type Stage } from './domain.ts';
export type ZoneLayout = {
  id: Stage;
  x: number;
  z: number;
  width: number;
  depth: number;
  slots: number;
  columns: number;
  rows: number;
};
export function garageLayout(s: GarageState): ZoneLayout[] {
  const order: Stage[] = ['waiting', 'diagnosis', 'workshop', 'reception', 'ready'];
  const dimensions = [...stages]
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((stage) => {
      const planned = capacity(stage.id, s.settings.modules[stage.id]);
      const actual = s.vehicles.filter((v) => v.stage === stage.id).length;
      const slots = Math.max(planned, actual);
      const columns = Math.min(stage.id === 'workshop' ? 6 : 4, Math.max(2, slots));
      const rows = Math.ceil(slots / columns);
      return {
        id: stage.id,
        columns,
        rows,
        slots,
        width: columns * 3.7 + 2,
        depth: rows * 5.8 + 3.2,
      };
    });
  const topWidth = dimensions.slice(0, 3).reduce((a, d) => a + d.width, 0) + 4;
  const bottomWidth = dimensions.slice(3).reduce((a, d) => a + d.width, 0) + 7;
  let topX = -topWidth / 2;
  let bottomX = -bottomWidth / 2;
  return dimensions.map((d, i) => {
    if (i < 3) {
      const x = topX + d.width / 2;
      topX += d.width + 2;
      return { ...d, x, z: -3.6 - d.depth / 2 };
    }
    const x = bottomX + d.width / 2;
    bottomX += d.width + 7;
    const serviceFront = 3.6 + dimensions[3].depth + 9;
    return {
      ...d,
      x,
      z:
        d.id === 'ready'
          ? Math.max(3.6 + d.depth / 2, serviceFront - d.depth / 2)
          : 3.6 + d.depth / 2,
    };
  });
}
export function slotPosition(zone: ZoneLayout, i: number): [number, number, number] {
  return [
    zone.x - ((zone.columns - 1) * 3.7) / 2 + (i % zone.columns) * 3.7,
    0.15,
    zone.z - ((zone.rows - 1) * 5.8) / 2 + Math.floor(i / zone.columns) * 5.8,
  ];
}

export function garageSite(zones: ZoneLayout[]) {
  const arrival = zones.find((z) => z.id === 'reception')!;
  const ready = zones.find((z) => z.id === 'ready')!;
  const front = arrival.z + arrival.depth / 2;
  const lounge = { x: arrival.x - arrival.width / 2 - 6, z: front + 5, width: 10, depth: 8 };
  return {
    minX: Math.min(lounge.x - lounge.width / 2, ...zones.map((z) => z.x - z.width / 2)) - 2,
    maxX: Math.max(...zones.map((z) => z.x + z.width / 2)) + 2,
    minZ: Math.min(...zones.map((z) => z.z - z.depth / 2)) - 2,
    maxZ: Math.max(front + 11, ...zones.map((z) => z.z + z.depth / 2 + 2)),
    service: { x: arrival.x, z: front + 5, width: arrival.width, depth: 8 },
    lounge,
    entryX: (arrival.x + arrival.width / 2 + ready.x - ready.width / 2) / 2,
  };
}

export function garageCamera(zones: ZoneLayout[], focus: string, aspect: number) {
  const site = garageSite(zones);
  const zone = focus === 'lounge' ? site.lounge : zones.find((z) => z.id === focus);
  const width = zone ? zone.width + 3 : site.maxX - site.minX + 3;
  const depth = zone ? zone.depth + 3 : site.maxZ - site.minZ + 3;
  const target: [number, number, number] = [
    zone?.x ?? (site.minX + site.maxX) / 2,
    1.8,
    zone?.z ?? (site.minZ + site.maxZ) / 2,
  ];
  const length = Math.hypot(0.7, 0.95, 0.8);
  const dx = 0.7 / length,
    dy = 0.95 / length,
    dz = 0.8 / length;
  const horizontal = Math.hypot(dx, dz);
  const rx = dz / horizontal,
    rz = -dx / horizontal;
  const ux = dy * rz,
    uy = horizontal,
    uz = -dy * rx;
  const tangent = Math.tan((39 * Math.PI) / 360);
  let distance = 0;
  // Fit all eight corners, including the near foreground, into the camera frustum.
  for (const x of [-width / 2, width / 2])
    for (const y of [-2.8, 3.7])
      for (const z of [-depth / 2, depth / 2]) {
        const near = x * dx + y * dy + z * dz;
        distance = Math.max(
          distance,
          near + Math.abs(x * rx + z * rz) / (tangent * Math.max(aspect, 0.2)),
          near + Math.abs(x * ux + y * uy + z * uz) / tangent,
        );
      }
  distance *= 1.08;
  const position: [number, number, number] = [
    target[0] + dx * distance,
    target[1] + dy * distance,
    target[2] + dz * distance,
  ];
  return { target, position };
}

export function mechanicAssignments(state: GarageState) {
  return state.users
    .filter((user) => user.role === 'mechanic')
    .map((user) => ({
      user,
      vehicleId:
        state.vehicles.find(
          (v) =>
            v.stage !== 'returned' &&
            v.tasks.some((t) => t.status === 'doing' && t.assignees.includes(user.id)),
        )?.id ?? null,
    }));
}
