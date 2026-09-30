import type { ShipState } from '../app/state.ts';
import { COMBAT } from '../content/combat/rules.ts';
import { findGear, getCatalog, shipModel } from '../content/catalog.ts';
import { shipPerformance, type ShipPerformance } from '../content/loadout.ts';
import type { GearItem, GunStats, LauncherKind, LauncherStats, ShipSlot } from '../content/types.ts';

/**
 * The player's ship as fitted: derived stats and fitted items, from the catalogue model and the
 * fittings in the save. Everything here is read-only; purchases live in equipment.ts.
 */

const cache = new Map<string, ShipPerformance>();

/** Flight, combat and hold stats for a model and its fittings (cached per loadout). */
export function performanceOf(ship: Pick<ShipState, 'model' | 'fittings'>): ShipPerformance {
  const key = `${ship.model}|${Object.keys(ship.fittings)
    .sort()
    .map((slot) => `${slot}=${ship.fittings[slot]}`)
    .join(',')}`;
  let perf = cache.get(key);
  if (!perf) {
    perf = shipPerformance(shipModel(ship.model), ship.fittings, getCatalog().gearById);
    if (cache.size > 64) cache.clear();
    cache.set(key, perf);
  }
  return perf;
}

export const cargoCapacity = (ship: ShipState): number => performanceOf(ship).cargo;
export const hullMax = (ship: ShipState): number => performanceOf(ship).hullMax;
export const shieldCapacity = (ship: ShipState): number => performanceOf(ship).shield?.capacity ?? 0;

export function fittedItem(ship: Pick<ShipState, 'fittings'>, slotId: string): GearItem | undefined {
  const id = ship.fittings[slotId];
  return id ? findGear(id) : undefined;
}

export function shipSlots(ship: Pick<ShipState, 'model'>): readonly ShipSlot[] {
  return shipModel(ship.model).slots;
}

export interface FittedGun {
  slot: ShipSlot;
  item: GearItem;
  stats: GunStats;
}

export interface FittedLauncher {
  slot: ShipSlot;
  item: GearItem;
  stats: LauncherStats;
  ammo: number;
}

export function fittedGuns(ship: ShipState): FittedGun[] {
  const out: FittedGun[] = [];
  for (const slot of shipSlots(ship)) {
    const item = fittedItem(ship, slot.id);
    if (slot.type === 'gun' && item?.stats.slot === 'gun') out.push({ slot, item, stats: item.stats.gun });
  }
  return out;
}

export function fittedLaunchers(ship: ShipState): FittedLauncher[] {
  const out: FittedLauncher[] = [];
  for (const slot of shipSlots(ship)) {
    const item = fittedItem(ship, slot.id);
    if (slot.type === 'launcher' && item?.stats.slot === 'launcher') {
      out.push({ slot, item, stats: item.stats.launcher, ammo: ship.ammo[slot.id] ?? 0 });
    }
  }
  return out;
}

/** The launcher the fire key uses: the first one with rounds left, else the first one. */
export function activeLauncher(ship: ShipState): FittedLauncher | null {
  const all = fittedLaunchers(ship);
  return all.find((l) => l.ammo > 0) ?? all[0] ?? null;
}

const ROUNDS: Record<LauncherKind, [string, string]> = {
  rocket: ['rocket', 'rockets'],
  seeker: ['seeker', 'seekers'],
  torpedo: ['torpedo', 'torpedoes'],
};

/** "Merlin Mk I seekers" */
export function ammoName(item: GearItem, count = 2): string {
  const kind = item.stats.slot === 'launcher' ? item.stats.launcher.kind : 'seeker';
  return `${item.short} ${ROUNDS[kind][count === 1 ? 0 : 1]}`;
}

/** "Seekers" / "Torpedoes" for compact labels. */
export function roundsLabel(kind: LauncherKind): string {
  const word = ROUNDS[kind][1];
  return word[0]!.toUpperCase() + word.slice(1);
}

/** "2× Kestrel Mk I", or "Kestrel Mk I + Eclipse Mk II" for a mixed battery. */
export function gunSummary(ship: ShipState): string {
  const counts = new Map<string, { item: GearItem; n: number }>();
  for (const g of fittedGuns(ship)) {
    const entry = counts.get(g.item.id);
    if (entry) entry.n += 1;
    else counts.set(g.item.id, { item: g.item, n: 1 });
  }
  if (!counts.size) return 'No guns';
  return [...counts.values()].map(({ item, n }) => (n > 1 ? `${n}× ${item.short}` : item.short)).join(' + ');
}

/** A fresh ship from the yard: stock fittings, full hull and shield, launchers loaded. */
export function newShipState(modelId: string): ShipState {
  const model = shipModel(modelId);
  const ship: ShipState = {
    model: modelId,
    fittings: { ...model.stock },
    hull: 0,
    shield: 0,
    ammo: {},
    repairKits: 0,
    decoys: COMBAT.decoys.starting,
    systems: { engines: 0, guns: 0, shields: 0 },
    cargo: {},
  };
  const perf = performanceOf(ship);
  ship.hull = perf.hullMax;
  ship.shield = perf.shield?.capacity ?? 0;
  for (const l of fittedLaunchers(ship)) ship.ammo[l.slot.id] = l.stats.maxAmmo;
  return ship;
}

/** Keeps hull, shield and ammo inside what the current fittings allow. */
export function clampShip(ship: ShipState): void {
  const perf = performanceOf(ship);
  ship.hull = Math.min(ship.hull, perf.hullMax);
  ship.shield = Math.min(ship.shield, perf.shield?.capacity ?? 0);
  const launchers = new Map(fittedLaunchers(ship).map((l) => [l.slot.id, l]));
  for (const slotId of Object.keys(ship.ammo)) {
    const l = launchers.get(slotId);
    if (!l) delete ship.ammo[slotId];
    else ship.ammo[slotId] = Math.max(0, Math.min(l.stats.maxAmmo, Math.floor(ship.ammo[slotId] ?? 0)));
  }
}
