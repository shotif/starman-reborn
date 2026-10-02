import { applyCredits, type GameState, type Wingman } from '../app/state.ts';
import { COMBAT } from '../content/combat/rules.ts';
import { findGear, resaleValue, shipModel } from '../content/catalog.ts';
import { DENS } from '../content/dens/rules.ts';
import { rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { FLEETS } from '../world/traffic/plan.ts';
import { getLocation, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { dockAccess, isLawful, type LawfulFaction } from './law.ts';
import { adjustReputation, FACTIONS, repairDiscount } from './factions.ts';
import { boardEpoch } from './contracts.ts';
import { sellsEquipment } from './equipment.ts';
import { fittedItem, performanceOf, shipSlots } from './loadout.ts';
import { cargoUsed } from './cargo.ts';
import { dockFaction } from './markets.ts';
import { knockOutDen } from './dens.ts';

/**
 * Combat depth in the economy (docs/PROCGEN.md §15): what a den knocked out pays, salvaged
 * equipment kept aboard until fitted or sold, decoys at the outfitter, repairs to damaged systems,
 * and wingmen for hire in the bars.
 */

// ---------------------------------------------------------------- dens

/** The lawful faction owning the system nearest a den (it pays for the den's fall). */
export function denPayer(systemId: SystemId): LawfulFaction {
  const jumps = jumpsFrom(WORLD.links, systemId);
  let best: { faction: LawfulFaction; d: number } | null = null;
  for (const [id, profile] of WORLD.profiles) {
    if (!isLawful(profile.owner)) continue;
    const d = jumps.get(id) ?? 99;
    if (!best || d < best.d) best = { faction: profile.owner as LawfulFaction, d };
  }
  return best?.faction ?? 'sta';
}

/** A den knocked out on the player's own account: it goes dark, the law pays, the Wake remembers. */
export function denBounty(state: GameState, locationId: string): { faction: LawfulFaction; paid: number; text: string } {
  knockOutDen(state, locationId);
  const loc = getLocation(locationId);
  const faction = denPayer(loc.systemId);
  applyCredits(state, DENS.bounty, 'bounty', `${loc.name} knocked out (${FACTIONS[faction].shortName})`);
  state.stats.rewards += DENS.bounty;
  adjustReputation(state.reputation, faction, DENS.bountyStanding);
  adjustReputation(state.reputation, 'hollow-wake', DENS.wakeStanding);
  return { faction, paid: DENS.bounty, text: `${loc.name} is dark. The ${FACTIONS[faction].name} pays ${DENS.bounty} cr for it.` };
}

// ---------------------------------------------------------------- the stash

/** Salvaged equipment goes into the stash; with no room, it is sold on the spot at the dealer's price. */
export function stashGear(state: GameState, gearId: string): { stored: boolean; credits: number; name: string } {
  const item = findGear(gearId);
  if (!item) return { stored: false, credits: 0, name: 'equipment' };
  if (state.stash.length < COMBAT.loot.stash) {
    state.stash.push(gearId);
    return { stored: true, credits: 0, name: item.name };
  }
  const value = resaleValue(item.price);
  applyCredits(state, value, 'loot', `Salvaged ${item.name} (sold: stash full)`);
  return { stored: false, credits: value, name: item.name };
}

export interface StashOffer {
  index: number;
  gearId: string;
  name: string;
  tier: number;
  value: number;
  /** Mounts it fits (slot id and label), and why not when it fits none. */
  slots: { id: string; replaces: string | null }[];
  blocked: string | null;
}

/** What can be done with each stashed item at this dock: fit it (where a dealer can) or sell it. */
export function stashOffers(state: GameState, locationId: string): StashOffer[] {
  const dealer = sellsEquipment(locationId) && dockAccess(state, locationId) === 'full';
  return state.stash.map((gearId, index) => {
    const item = findGear(gearId)!;
    const slots = shipSlots(state.ship)
      .filter((s) => s.type === item.slot && item.tier <= s.maxClass)
      .map((s) => ({ id: s.id, replaces: fittedItem(state.ship, s.id)?.name ?? null }));
    return {
      index,
      gearId,
      name: item.name,
      tier: item.tier,
      value: resaleValue(item.price),
      slots,
      blocked: !dealer ? 'An equipment dealer fits and buys salvage' : slots.length ? null : 'Fits no mount on this ship',
    };
  });
}

/** Fits a stashed item; what it replaces is sold to the dealer (its rounds too). */
export function fitFromStash(state: GameState, locationId: string, index: number, slotId: string): { ok: boolean; message: string } {
  const offer = stashOffers(state, locationId)[index];
  if (!offer) return { ok: false, message: 'Nothing there.' };
  if (!sellsEquipment(locationId) || dockAccess(state, locationId) !== 'full') return { ok: false, message: 'No equipment dealer here.' };
  if (!offer.slots.some((s) => s.id === slotId)) return { ok: false, message: 'It does not fit that mount.' };
  const fittings = { ...state.ship.fittings, [slotId]: offer.gearId };
  if (performanceOf({ model: state.ship.model, fittings }).cargo < cargoUsed(state.ship.cargo)) return { ok: false, message: 'Your cargo would not fit.' };
  const current = fittedItem(state.ship, slotId);
  if (current) applyCredits(state, resaleValue(current.price), 'equipment', `Sold ${current.name}`);
  state.ship.fittings[slotId] = offer.gearId;
  delete state.ship.ammo[slotId];
  state.stash.splice(index, 1);
  const perf = performanceOf(state.ship);
  state.ship.hull = Math.min(state.ship.hull, perf.hullMax);
  state.ship.shield = perf.shield?.capacity ?? 0;
  return { ok: true, message: `Fitted the ${offer.name}.` };
}

export function sellFromStash(state: GameState, locationId: string, index: number): { ok: boolean; message: string } {
  const offer = stashOffers(state, locationId)[index];
  if (!offer) return { ok: false, message: 'Nothing there.' };
  if (!sellsEquipment(locationId) || dockAccess(state, locationId) !== 'full') return { ok: false, message: 'No equipment dealer here.' };
  applyCredits(state, offer.value, 'equipment', `Sold salvaged ${offer.name}`);
  state.stash.splice(index, 1);
  return { ok: true, message: `Sold the ${offer.name} for ${offer.value} cr.` };
}

// ---------------------------------------------------------------- decoys and repairs

export function decoyOffer(state: GameState, locationId: string): { price: number; have: number; max: number; blocked: string | null } | null {
  if (!sellsEquipment(locationId)) return null;
  const have = state.ship.decoys;
  const d = COMBAT.decoys;
  return { price: d.price, have, max: d.max, blocked: have >= d.max ? 'Launcher full' : state.credits < d.price ? 'Not enough credits' : null };
}

export function buyDecoy(state: GameState, locationId: string): { ok: boolean; message: string } {
  const offer = decoyOffer(state, locationId);
  if (!offer) return { ok: false, message: 'Not sold here.' };
  if (offer.blocked) return { ok: false, message: offer.blocked };
  applyCredits(state, -offer.price, 'equipment', `Bought ${COMBAT.decoys.name.toLowerCase()}`);
  state.ship.decoys += 1;
  return { ok: true, message: 'Loaded a decoy flare.' };
}

/** What it costs to put the ship's damaged systems right at this dock (standing discounts apply). */
export function systemsQuote(state: GameState, locationId: string): number {
  const s = state.ship.systems;
  const damage = s.engines + s.guns + s.shields;
  if (damage <= 0) return 0;
  const faction = dockFaction(locationId);
  const discount = dockAccess(state, locationId) === 'emergency' ? -0.5 : faction ? repairDiscount(state.reputation[faction] ?? 0) : 0;
  return Math.max(1, Math.round(damage * COMBAT.systems.repairCost * (1 - discount)));
}

export function repairSystems(state: GameState, locationId: string): { ok: boolean; cost: number } {
  const cost = systemsQuote(state, locationId);
  if (cost <= 0 || state.credits < cost) return { ok: false, cost };
  applyCredits(state, -cost, 'repair', 'Systems repair');
  state.ship.systems = { engines: 0, guns: 0, shields: 0 };
  return { ok: true, cost };
}

// ---------------------------------------------------------------- wingmen for hire

/** Wingmen's names (fiction); an outpost's guards are drawn from them too (docs/PROCGEN.md §29). */
export const WING_FIRST = ['Ilya', 'Maren', 'Tobin', 'Esra', 'Kaito', 'Ruth', 'Anouk', 'Dario', 'Signe', 'Obi', 'Lenka', 'Farid'];
export const WING_LAST = ['Vance', 'Okoro', 'Lindqvist', 'Sato', 'Mercer', 'Adeyemi', 'Kovac', 'Reyes', 'Brandvold', 'Achebe', 'Moreau', 'Halloran'];

/** Pilots looking for work at a station in this time slot (the same for everyone). */
export function pilotsFor(locationId: string, clock: number): Wingman[] {
  const loc = getLocation(locationId);
  const count = COMBAT.wingmen.where[loc.stationType ?? ''] ?? (locationId === 'earth-port' || locationId === 'mars-depot' ? 1 : 0);
  if (!count) return [];
  const epoch = boardEpoch(clock);
  const r = rng(0x7d3a, 'wing', locationId, epoch);
  const owner = loc.factionId === 'sta' || loc.factionId === 'frontier' ? loc.factionId : 'independent';
  const fleet = FLEETS[owner].patrols.length ? FLEETS[owner].patrols : FLEETS.sta.patrols;
  return Array.from({ length: count }, (_, i) => {
    const model = r.pick(fleet);
    const tier = Math.min(2, shipModel(model).tier) as 1 | 2;
    const skill: Wingman['skill'] = r.next() < 0.35 ? 'sharp' : 'steady';
    const fee = Math.round((COMBAT.wingmen.fee[tier] * (skill === 'sharp' ? 1.25 : 1)) / 5) * 5;
    return { id: `w.${locationId}.${epoch}.${i}`, name: `${r.pick(WING_FIRST)} ${r.pick(WING_LAST)}`, model, fee, skill };
  });
}

export function hireWingman(state: GameState, locationId: string, id: string): { ok: boolean; message: string } {
  const w = pilotsFor(locationId, state.clock).find((x) => x.id === id);
  if (!w) return { ok: false, message: 'That pilot has moved on.' };
  if (state.crew.some((x) => x.id === id)) return { ok: false, message: 'Already on your wing.' };
  if (state.crew.length >= COMBAT.wingmen.max) return { ok: false, message: `Your wing is full (${COMBAT.wingmen.max}).` };
  if (dockAccess(state, locationId) !== 'full') return { ok: false, message: 'Nobody here will fly with a wanted pilot.' };
  if (state.credits < w.fee) return { ok: false, message: `Hiring costs the first jump's fee: ${w.fee} cr.` };
  applyCredits(state, -w.fee, 'fee', `Hired ${w.name}`);
  state.crew.push(w);
  return { ok: true, message: `${w.name} joins your wing for ${w.fee} cr a jump.` };
}

export function dismissWingman(state: GameState, id: string): { ok: boolean; message: string } {
  const i = state.crew.findIndex((w) => w.id === id);
  if (i < 0) return { ok: false, message: 'Not on your wing.' };
  const [w] = state.crew.splice(i, 1);
  return { ok: true, message: `${w!.name} leaves your wing.` };
}

/** Each jump pays the wing (`hops` jumps at a time); a pilot you cannot pay leaves. */
export function payCrew(state: GameState, hops = 1): { paid: number; notes: string[] } {
  const notes: string[] = [];
  let paid = 0;
  for (const w of [...state.crew]) {
    const fee = w.fee * hops;
    // An ally flies free (docs/PROCGEN.md §28).
    if (fee <= 0) continue;
    if (state.credits >= fee) {
      applyCredits(state, -fee, 'fee', `Wing fee: ${w.name}`);
      paid += fee;
    } else {
      state.crew.splice(state.crew.indexOf(w), 1);
      notes.push(`${w.name} leaves your wing: you could not pay the ${fee} cr fee.`);
    }
  }
  return { paid, notes };
}

/** A hired wingman's ship was lost: they leave the wing. */
export function wingmanLost(state: GameState, id: string): void {
  const i = state.crew.findIndex((w) => w.id === id);
  if (i >= 0) state.crew.splice(i, 1);
}
