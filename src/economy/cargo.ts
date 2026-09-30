import type { Cargo, CommodityId } from '../app/state.ts';
import { COMMODITIES, COMMODITY_IDS } from './commodities.ts';

/** Hold of the starting courier, in units. A ship's real hold comes from its model and cargo pods (cargoCapacity in loadout.ts). */
export const CARGO_CAPACITY = 20;

export function cargoUsed(cargo: Cargo): number {
  let used = 0;
  for (const id of COMMODITY_IDS) used += (cargo[id] ?? 0) * COMMODITIES[id].unitSize;
  return used;
}

export function cargoFree(cargo: Cargo, capacity = CARGO_CAPACITY): number {
  return Math.max(0, capacity - cargoUsed(cargo));
}

/** How many items of a commodity fit in the remaining space. */
export function itemsThatFit(cargo: Cargo, commodity: CommodityId, capacity = CARGO_CAPACITY): number {
  return Math.floor(cargoFree(cargo, capacity) / COMMODITIES[commodity].unitSize);
}

export function cargoCount(cargo: Cargo, commodity: CommodityId): number {
  return cargo[commodity] ?? 0;
}

/** Adds items; throws if it would overflow the hold or quantity is not a positive integer. */
export function addCargo(cargo: Cargo, commodity: CommodityId, qty: number, capacity = CARGO_CAPACITY): void {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError(`quantity must be a positive integer, got ${qty}`);
  if (qty > itemsThatFit(cargo, commodity, capacity)) throw new RangeError('not enough cargo space');
  cargo[commodity] = cargoCount(cargo, commodity) + qty;
}

/** Removes items; throws if the hold does not contain that many. */
export function removeCargo(cargo: Cargo, commodity: CommodityId, qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError(`quantity must be a positive integer, got ${qty}`);
  const have = cargoCount(cargo, commodity);
  if (qty > have) throw new RangeError('not enough cargo to remove');
  if (have === qty) delete cargo[commodity];
  else cargo[commodity] = have - qty;
}
