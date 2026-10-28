import type { GarageState, Vehicle } from './domain.ts';

export type CustomerVehicle = Pick<
  Vehicle,
  'id' | 'customerId' | 'plate' | 'model' | 'color' | 'mileage'
> & { inGarage: boolean };
export const plateKey = (plate: string) => plate.trim().toUpperCase().replace(/[\s-]/g, '');

export function customerVehicles(state: GarageState, customerId?: string): CustomerVehicle[] {
  if (state.savedVehicles)
    return state.savedVehicles.filter((v) => !customerId || v.customerId === customerId);
  const latest = new Map<string, Vehicle>();
  const active = new Set<string>();
  for (const vehicle of state.vehicles) {
    if (customerId && vehicle.customerId !== customerId) continue;
    const key = `${vehicle.customerId}:${plateKey(vehicle.plate)}`;
    const previous = latest.get(key);
    if (!previous || vehicle.visit >= previous.visit) latest.set(key, vehicle);
    if (vehicle.stage !== 'returned') active.add(key);
  }
  return [...latest].map(([key, v]) => ({
    id: v.id,
    customerId: v.customerId,
    plate: v.plate,
    model: v.model,
    color: v.color,
    mileage: v.mileage,
    inGarage: active.has(key),
  }));
}
