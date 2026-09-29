import { applyCredits, type GameState, type GunId, type ShieldId } from '../app/state.ts';
import { dockFaction } from './markets.ts';
import { repairDiscount } from './factions.ts';

/** Ship equipment (fiction). Numbers drive the flight/combat simulation. */
export interface ShieldSpec {
  id: ShieldId;
  name: string;
  capacity: number;
  /** Shield points per second once regeneration starts. */
  regenPerSecond: number;
  /** Seconds without damage before regeneration starts. */
  regenDelay: number;
  price: number;
}

export interface GunSpec {
  id: GunId;
  name: string;
  damage: number;
  shotsPerSecond: number;
  projectileSpeed: number;
  range: number;
  energyPerShot: number;
  price: number;
}

export const SHIELDS: Record<ShieldId, ShieldSpec> = {
  'shield-mk1': { id: 'shield-mk1', name: 'Aegis Mk I shield', capacity: 60, regenPerSecond: 6, regenDelay: 3, price: 0 },
  'shield-mk2': { id: 'shield-mk2', name: 'Aegis Mk II shield', capacity: 110, regenPerSecond: 8, regenDelay: 2.6, price: 450 },
};

export const GUNS: Record<GunId, GunSpec> = {
  'pulse-mk1': {
    id: 'pulse-mk1',
    name: 'Kestrel pulse cannon',
    damage: 9,
    shotsPerSecond: 5.5,
    projectileSpeed: 760,
    range: 950,
    energyPerShot: 5,
    price: 0,
  },
  'pulse-mk2': {
    id: 'pulse-mk2',
    name: 'Kestrel Mk II pulse cannon',
    damage: 13,
    shotsPerSecond: 5.5,
    projectileSpeed: 820,
    range: 1000,
    energyPerShot: 5.5,
    price: 420,
  },
};

export const HULL_MAX = 100;
export const ENERGY_MAX = 100;
export const REPAIR_COST_PER_POINT = 2;

export const MISSILE = { name: 'Wasp micro-missile', price: 35, max: 6, damage: 55, speed: 280, turnRate: 2.6, lifetime: 9 };
export const REPAIR_KIT = { name: 'Nanite repair kit', price: 60, max: 3, restore: 40 };

export type ShopItemId = ShieldId | GunId | 'missile' | 'repair-kit';

const SHOP: Record<string, ShopItemId[]> = {
  'earth-port': ['missile', 'repair-kit'],
  'mars-depot': ['shield-mk2', 'pulse-mk2', 'missile', 'repair-kit'],
  'meridian-outpost': ['missile', 'repair-kit'],
  'barnard-relay': ['repair-kit'],
  'sirius-platform': ['pulse-mk2', 'missile', 'repair-kit'],
  'eridani-hub': ['shield-mk2', 'missile', 'repair-kit'],
};

export function shopItems(locationId: string): ShopItemId[] {
  return SHOP[locationId] ?? [];
}

export interface ShopEntry {
  id: ShopItemId;
  name: string;
  price: number;
  /** Why it cannot be bought now, or null when it can. */
  blocked: string | null;
  owned: boolean;
  detail: string;
}

export function describeShopItem(state: GameState, id: ShopItemId): ShopEntry {
  const ship = state.ship;
  if (id === 'missile') {
    const full = ship.missiles >= MISSILE.max;
    return {
      id,
      name: MISSILE.name,
      price: MISSILE.price,
      owned: false,
      blocked: full ? 'Missile rack full' : state.credits < MISSILE.price ? 'Not enough credits' : null,
      detail: `Homing, ${MISSILE.damage} damage. Carrying ${ship.missiles}/${MISSILE.max}.`,
    };
  }
  if (id === 'repair-kit') {
    const full = ship.repairKits >= REPAIR_KIT.max;
    return {
      id,
      name: REPAIR_KIT.name,
      price: REPAIR_KIT.price,
      owned: false,
      blocked: full ? 'Kit storage full' : state.credits < REPAIR_KIT.price ? 'Not enough credits' : null,
      detail: `Restores ${REPAIR_KIT.restore} hull in flight. Carrying ${ship.repairKits}/${REPAIR_KIT.max}.`,
    };
  }
  if (id in SHIELDS) {
    const spec = SHIELDS[id as ShieldId];
    const owned = ship.shieldGenerator === spec.id;
    return {
      id,
      name: spec.name,
      price: spec.price,
      owned,
      blocked: owned ? 'Installed' : state.credits < spec.price ? 'Not enough credits' : null,
      detail: `Shield capacity ${spec.capacity} (now ${SHIELDS[ship.shieldGenerator].capacity}), regenerates ${spec.regenPerSecond}/s.`,
    };
  }
  const spec = GUNS[id as GunId];
  const owned = ship.gun === spec.id;
  return {
    id,
    name: spec.name,
    price: spec.price,
    owned,
    blocked: owned ? 'Installed' : state.credits < spec.price ? 'Not enough credits' : null,
    detail: `Damage ${spec.damage} per bolt (now ${GUNS[ship.gun].damage}), ${spec.shotsPerSecond} shots/s.`,
  };
}

export function buyShopItem(state: GameState, locationId: string, id: ShopItemId): { ok: boolean; message: string } {
  if (!shopItems(locationId).includes(id)) return { ok: false, message: 'Not sold here.' };
  const entry = describeShopItem(state, id);
  if (entry.blocked) return { ok: false, message: entry.blocked };
  applyCredits(state, -entry.price, 'equipment', `Bought ${entry.name}`);
  if (id === 'missile') state.ship.missiles += 1;
  else if (id === 'repair-kit') state.ship.repairKits += 1;
  else if (id in SHIELDS) {
    state.ship.shieldGenerator = id as ShieldId;
    state.ship.shield = SHIELDS[id as ShieldId].capacity;
  } else state.ship.gun = id as GunId;
  return { ok: true, message: `Installed ${entry.name}.` };
}

/** Cost to repair the hull fully at a dock, after standing discounts. */
export function repairQuote(state: GameState, locationId: string): { points: number; cost: number; discount: number } {
  const points = Math.max(0, Math.ceil(HULL_MAX - state.ship.hull));
  const faction = dockFaction(locationId);
  const discount = faction ? repairDiscount(state.reputation[faction] ?? 0) : 0;
  const cost = Math.round(points * REPAIR_COST_PER_POINT * (1 - discount));
  return { points, cost, discount };
}

/** Repairs as much hull as the player can afford. Returns points repaired and cost. */
export function repairHull(state: GameState, locationId: string): { points: number; cost: number } {
  const q = repairQuote(state, locationId);
  if (q.points === 0) return { points: 0, cost: 0 };
  const perPoint = q.cost / q.points;
  const affordable = perPoint > 0 ? Math.min(q.points, Math.floor(state.credits / perPoint)) : q.points;
  if (affordable <= 0) return { points: 0, cost: 0 };
  const cost = Math.round(affordable * perPoint);
  state.ship.hull = Math.min(HULL_MAX, state.ship.hull + affordable);
  applyCredits(state, -cost, 'repair', `Hull repair (${affordable} pts)`);
  return { points: affordable, cost };
}
