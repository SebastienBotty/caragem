import type { Vehicle } from './domain.ts';

export function interventionTime(vehicle: Vehicle, now = Date.now()) {
  const planned = vehicle.tasks.reduce((total, task) => total + (task.estimatedMinutes ?? 0), 0);
  const spent = vehicle.tasks.reduce((total, task) => total + task.minutes, 0);
  const unestimated = vehicle.tasks.filter((task) => task.estimatedMinutes === undefined).length;
  const complete =
    vehicle.tasks.length > 0 && vehicle.tasks.every((task) => task.status === 'done');
  const blockages = [
    ...(vehicle.blockerHistory ?? []).map((blockage) => ({
      from: blockage.openedAt,
      to: Date.parse(blockage.resolvedAt),
    })),
    ...(vehicle.blockerDetails ? [{ from: vehicle.blockerDetails.openedAt, to: now }] : []),
  ];
  const blocked = blockages.reduce(
    (total, blockage) => total + Math.max(0, blockage.to - Date.parse(blockage.from)),
    0,
  );
  return {
    planned,
    spent,
    unestimated,
    delta: complete && !unestimated ? spent - planned : null,
    blocked: Math.floor(blocked / 60000),
  };
}
