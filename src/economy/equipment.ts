import { applyCredits, type GameState, type ShipState } from '../app/state.ts';
import { gearForSale, resaleValue, shipModel, shipsForSale, shopRule, standingForGear, standingForShip } from '../content/catalog.ts';
import type { GearItem, ShipModel, ShipSlot, Tier } from '../content/types.ts';
import { cargoUsed } from './cargo.ts';
import { quartersBlock } from './crewQuarters.ts';
import { repairDiscount, standingTier, TIER_LABEL } from './factions.ts';
import { LAW } from '../content/law/rules.ts';
import { repairCut } from './folk.ts';
import { dockAccess } from './law.ts';
import { ammoName, clampShip, fittedItem, fittedLaunchers, hullMax, newShipState, performanceOf, shieldCapacity, shipSlots } from './loadout.ts';
import { dockFaction } from './markets.ts';
import { berthBlock } from './passengers.ts';
import { discounted, yardDiscount } from './ranks.ts';
import { noteShip } from './logbook.ts';

/**
 * Outfitter and shipyard: buying, replacing and selling equipment, ammunition, repair kits, hull
 * repairs and whole ships. Dealers pay back 70% of the price (docs/PROCGEN.md §4.2).
 */

export const REPAIR_COST_PER_POINT = 2;
export const REPAIR_KIT = { name: 'Nanite repair kit', price: 60, max: 3, restore: 40 };

/** Slots that can be swapped but never emptied: a ship always has a shield, an engine, a thruster and a power plant. */
export const CORE_SLOT_TYPES: ReadonlySet<ShipSlot['type']> = new Set(['shield', 'engine', 'thruster', 'power']);

export interface Result {
  ok: boolean;
  message: string;
}

function standingAt(state: GameState, locationId: string): number {
  const faction = dockFaction(locationId);
  return faction ? (state.reputation[faction] ?? 0) : 0;
}

function standingBlock(state: GameState, locationId: string, needed: number): string | null {
  if (standingAt(state, locationId) >= needed) return null;
  const tier = standingTier(needed);
  return tier === 'neutral' || tier === 'wary' || tier === 'hostile' ? `Needs standing ${needed}` : `Needs ${TIER_LABEL[tier].toLowerCase()} standing (${needed})`;
}

/** Stations whose outfitter sells equipment and ammunition (every shop sells repair kits). */
export function sellsEquipment(locationId: string): boolean {
  return (shopRule(locationId)?.makers.length ?? 0) > 0;
}

export function hasOutfitter(locationId: string): boolean {
  return !!shopRule(locationId);
}

export function hasShipyard(locationId: string): boolean {
  return (shopRule(locationId)?.shipyard.length ?? 0) > 0;
}

// ---------------------------------------------------------------- equipment

export interface GearOffer {
  item: GearItem;
  /** What it costs here: the list price, less a rank's discount at the faction's own yard (docs/PROCGEN.md §32.3). */
  price: number;
  discount: number;
  /** What the dealer pays for the item it replaces. */
  tradeIn: number;
  /** Price after trade-in (what the credits change by). */
  net: number;
  /** Why it cannot be bought now; null when it can. */
  blocked: string | null;
  fitted: boolean;
}

function slotOf(state: GameState, slotId: string): ShipSlot | undefined {
  return shipSlots(state.ship).find((s) => s.id === slotId);
}

/** Hold size after a change of fittings (to refuse changes that would spill cargo). */
function capacityWith(state: GameState, slotId: string, gearId: string | null): number {
  return performanceWith(state, slotId, gearId).cargo;
}

function performanceWith(state: GameState, slotId: string, gearId: string | null) {
  const fittings = { ...state.ship.fittings };
  if (gearId) fittings[slotId] = gearId;
  else delete fittings[slotId];
  return performanceOf({ model: state.ship.model, fittings });
}

function ammoRefund(ship: ShipState, slotId: string): number {
  const item = fittedItem(ship, slotId);
  const rounds = ship.ammo[slotId] ?? 0;
  return item?.stats.slot === 'launcher' && rounds > 0 ? resaleValue(rounds * item.stats.launcher.ammoPrice) : 0;
}

function offerFor(state: GameState, locationId: string, item: GearItem, slot: ShipSlot): GearOffer {
  const current = fittedItem(state.ship, slot.id);
  const tradeIn = current ? resaleValue(current.price) + ammoRefund(state.ship, slot.id) : 0;
  const discount = yardDiscount(state, locationId, item.maker);
  const price = discounted(item.price, discount);
  const net = price - tradeIn;
  const fitted = current?.id === item.id;
  let blocked: string | null = null;
  if (fitted) blocked = 'Fitted';
  else if (item.slot !== slot.type) blocked = 'Does not fit this mount';
  else if (item.tier > slot.maxClass) blocked = `Mount takes class ${slot.maxClass} at most`;
  else blocked = standingBlock(state, locationId, standingForGear(item.tier));
  if (!blocked && net > state.credits) blocked = 'Not enough credits';
  if (!blocked && capacityWith(state, slot.id, item.id) < cargoUsed(state.ship.cargo)) blocked = 'Your cargo would not fit';
  // Passengers aboard keep their berths (docs/PROCGEN.md §23).
  if (!blocked) blocked = berthBlock(state, performanceWith(state, slot.id, item.id).berths);
  return { item, price, discount, tradeIn, net, blocked, fitted };
}

/** Equipment on sale here that goes in this slot, cheapest class first. */
export function gearOffers(state: GameState, locationId: string, slotId: string): GearOffer[] {
  const slot = slotOf(state, slotId);
  if (!slot) return [];
  return gearForSale(locationId)
    .filter((it) => it.slot === slot.type)
    .map((it) => offerFor(state, locationId, it, slot));
}

export function gearOffer(state: GameState, locationId: string, gearId: string, slotId: string): GearOffer | null {
  const slot = slotOf(state, slotId);
  const item = gearForSale(locationId).find((it) => it.id === gearId);
  return slot && item ? offerFor(state, locationId, item, slot) : null;
}

/** Buys an item and fits it in a slot; the item it replaces (and its rounds) is sold to the dealer. */
export function buyGear(state: GameState, locationId: string, gearId: string, slotId: string): Result {
  const offer = gearOffer(state, locationId, gearId, slotId);
  if (!offer) return { ok: false, message: 'Not sold here.' };
  if (offer.blocked) return { ok: false, message: offer.blocked };
  const before = performanceOf(state.ship);
  const current = fittedItem(state.ship, slotId);
  if (current) applyCredits(state, offer.tradeIn, 'equipment', `Sold ${current.name}`);
  applyCredits(state, -offer.price, 'equipment', `Bought ${offer.item.name}`);
  state.ship.fittings[slotId] = offer.item.id;
  delete state.ship.ammo[slotId];
  refit(state, before);
  return { ok: true, message: `Fitted ${offer.item.name}.` };
}

/** What the dealer pays for the item in a slot (with its rounds); null when it cannot be sold. */
export function sellQuote(state: GameState, locationId: string, slotId: string): { item: GearItem; value: number; blocked: string | null } | null {
  const slot = slotOf(state, slotId);
  const item = fittedItem(state.ship, slotId);
  if (!slot || !item) return null;
  let blocked: string | null = null;
  if (!sellsEquipment(locationId)) blocked = 'No equipment dealer here';
  else if (CORE_SLOT_TYPES.has(slot.type)) blocked = 'Replace it instead: every ship needs one';
  else if (capacityWith(state, slotId, null) < cargoUsed(state.ship.cargo)) blocked = 'Your cargo would not fit';
  else blocked = berthBlock(state, performanceWith(state, slotId, null).berths);
  return { item, value: resaleValue(item.price) + ammoRefund(state.ship, slotId), blocked };
}

export function sellGear(state: GameState, locationId: string, slotId: string): Result {
  const quote = sellQuote(state, locationId, slotId);
  if (!quote) return { ok: false, message: 'Nothing fitted there.' };
  if (quote.blocked) return { ok: false, message: quote.blocked };
  const before = performanceOf(state.ship);
  applyCredits(state, quote.value, 'equipment', `Sold ${quote.item.name}`);
  delete state.ship.fittings[slotId];
  delete state.ship.ammo[slotId];
  refit(state, before);
  return { ok: true, message: `Sold ${quote.item.name}.` };
}

/** After a change of fittings: new armour arrives intact, a new shield charged; nothing exceeds its maximum. */
function refit(state: GameState, before: ReturnType<typeof performanceOf>): void {
  const after = performanceOf(state.ship);
  if (after.hullMax > before.hullMax) state.ship.hull += after.hullMax - before.hullMax;
  state.ship.shield = after.shield?.capacity ?? 0;
  clampShip(state.ship);
}

// ---------------------------------------------------------------- consumables

export interface ConsumableOffer {
  /** Launcher slot id, or 'repair-kit'. */
  id: string;
  name: string;
  price: number;
  have: number;
  max: number;
  blocked: string | null;
}

export function ammoOffers(state: GameState, locationId: string): ConsumableOffer[] {
  if (!sellsEquipment(locationId)) return [];
  return fittedLaunchers(state.ship).map((l) => ({
    id: l.slot.id,
    name: ammoName(l.item),
    price: l.stats.ammoPrice,
    have: l.ammo,
    max: l.stats.maxAmmo,
    blocked: l.ammo >= l.stats.maxAmmo ? 'Rack full' : state.credits < l.stats.ammoPrice ? 'Not enough credits' : null,
  }));
}

export function buyAmmo(state: GameState, locationId: string, slotId: string, qty = 1): Result {
  const offer = ammoOffers(state, locationId).find((o) => o.id === slotId);
  if (!offer) return { ok: false, message: 'Not sold here.' };
  const n = Math.min(qty, offer.max - offer.have, Math.floor(state.credits / offer.price));
  if (offer.blocked || n <= 0) return { ok: false, message: offer.blocked ?? 'Not enough credits' };
  applyCredits(state, -n * offer.price, 'equipment', `Bought ${n} ${offer.name}`);
  state.ship.ammo[slotId] = offer.have + n;
  return { ok: true, message: `Loaded ${n} ${offer.name}.` };
}

export function repairKitOffer(state: GameState, locationId: string): ConsumableOffer | null {
  if (!hasOutfitter(locationId)) return null;
  const have = state.ship.repairKits;
  return {
    id: 'repair-kit',
    name: REPAIR_KIT.name,
    price: REPAIR_KIT.price,
    have,
    max: REPAIR_KIT.max,
    blocked: have >= REPAIR_KIT.max ? 'Kit storage full' : state.credits < REPAIR_KIT.price ? 'Not enough credits' : null,
  };
}

export function buyRepairKit(state: GameState, locationId: string): Result {
  const offer = repairKitOffer(state, locationId);
  if (!offer) return { ok: false, message: 'Not sold here.' };
  if (offer.blocked) return { ok: false, message: offer.blocked };
  applyCredits(state, -offer.price, 'equipment', `Bought ${REPAIR_KIT.name}`);
  state.ship.repairKits += 1;
  return { ok: true, message: `Bought a ${REPAIR_KIT.name.toLowerCase()}.` };
}

// ---------------------------------------------------------------- hull repair

/** Cost to repair the hull fully at a dock, after standing discounts. */
export function repairQuote(state: GameState, locationId: string): { points: number; cost: number; discount: number } {
  const points = Math.max(0, Math.ceil(hullMax(state.ship) - state.ship.hull));
  const faction = dockFaction(locationId);
  // A pilot on emergency docking pays a surcharge instead of any discount (docs/PROCGEN.md §12).
  // At one of the pilot's outposts with an engineer's workshop (docs/PROCGEN.md §41.2), its cut.
  const discount = dockAccess(state, locationId) === 'emergency' ? -LAW.emergencyRepairSurcharge : faction ? repairDiscount(state.reputation[faction] ?? 0) : repairCut(state, locationId);
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
  state.ship.hull = Math.min(hullMax(state.ship), state.ship.hull + affordable);
  applyCredits(state, -cost, 'repair', `Hull repair (${affordable} pts)`);
  return { points: affordable, cost };
}

// ---------------------------------------------------------------- shipyard

/** What a shipyard pays for a ship: hull and fittings (and rounds) at the resale rate, less outstanding repairs. */
export function shipTradeIn(ship: ShipState): number {
  const model = shipModel(ship.model);
  let value = resaleValue(model.hullPrice);
  for (const slot of model.slots) {
    const item = fittedItem(ship, slot.id);
    if (item) value += resaleValue(item.price) + ammoRefund(ship, slot.id);
  }
  const damage = Math.max(0, Math.ceil(hullMax(ship) - ship.hull));
  return Math.max(0, value - damage * REPAIR_COST_PER_POINT);
}

/** What the shipyard pays for the ship you fly. */
export function tradeInValue(state: GameState): number {
  return shipTradeIn(state.ship);
}

/** Why the shipyard here will not sell this model to the player (their standing), or null. */
export function shipStandingBlock(state: GameState, locationId: string, model: ShipModel): string | null {
  return standingBlock(state, locationId, standingForShip(model.tier as Tier));
}

export interface ShipOffer {
  model: ShipModel;
  /** What it costs here, less a rank's discount at the faction's own yard (docs/PROCGEN.md §32.3). */
  price: number;
  discount: number;
  tradeIn: number;
  net: number;
  blocked: string | null;
  current: boolean;
}

export function shipOffers(state: GameState, locationId: string): ShipOffer[] {
  const tradeIn = tradeInValue(state);
  return shipsForSale(locationId).map((model) => {
    const discount = yardDiscount(state, locationId, model.maker);
    const price = discounted(model.price, discount);
    const net = price - tradeIn;
    const current = model.id === state.ship.model;
    let blocked: string | null = current ? 'Your current ship' : shipStandingBlock(state, locationId, model);
    if (!blocked && net > state.credits) blocked = 'Not enough credits';
    if (!blocked && performanceOf({ model: model.id, fittings: model.stock }).cargo < cargoUsed(state.ship.cargo)) blocked = 'Sell cargo first: the hold is smaller';
    if (!blocked) blocked = berthBlock(state, performanceOf({ model: model.id, fittings: model.stock }).berths);
    if (!blocked) blocked = quartersBlock(state, model.id);
    return { model, price, discount, tradeIn, net, blocked, current };
  });
}

/** Trades in the current ship and fittings for a new one with its stock loadout. Cargo and repair kits move across. */
export function buyShip(state: GameState, locationId: string, modelId: string): Result {
  const offer = shipOffers(state, locationId).find((o) => o.model.id === modelId);
  if (!offer) return { ok: false, message: 'Not sold here.' };
  if (offer.blocked) return { ok: false, message: offer.blocked };
  const old = shipModel(state.ship.model);
  applyCredits(state, offer.tradeIn, 'equipment', `Traded in ${old.name}`);
  applyCredits(state, -offer.price, 'equipment', `Bought ${offer.model.name}`);
  const fresh = newShipState(offer.model.id);
  state.ship.model = fresh.model;
  state.ship.fittings = fresh.fittings;
  state.ship.ammo = fresh.ammo;
  state.ship.hull = fresh.hull;
  state.ship.shield = fresh.shield;
  state.ship.systems = fresh.systems;
  noteShip(state, fresh.model, 'traded', locationId);
  return { ok: true, message: `The ${offer.model.name} is yours.` };
}

/** Shield back to full (docking, rescue). */
export function rechargeShield(state: GameState): void {
  state.ship.shield = shieldCapacity(state.ship);
}
