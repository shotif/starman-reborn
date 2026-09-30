import { applyCredits, type CommodityId, type GameState } from '../app/state.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { LAW, type CrimeKind } from '../content/law/rules.ts';
import { getLocation, WORLD } from '../data/systems.ts';
import type { FactionId, SystemId } from '../data/types.ts';
import { cargoCount, removeCargo } from './cargo.ts';
import { adjustReputation, FACTIONS, standingTier } from './factions.ts';

/**
 * The law (docs/PROCGEN.md §12). The Transit Authority and the Frontier Cooperative fine crimes
 * against them; while a pilot owes a fine (or is Hostile), their patrols attack on sight and their
 * stations only take the pilot in for emergency repairs. Paying every fine at one of their
 * stations is a pardon. The Hollow Wake keeps no books: it remembers who hurt the law and who hurt
 * its crews, and opens its dens to pilots it trusts.
 */

export type LawfulFaction = 'sta' | 'frontier';
export const LAWFUL: readonly LawfulFaction[] = ['sta', 'frontier'];

export const isLawful = (f: FactionId | 'independent' | null | undefined): f is LawfulFaction => f === 'sta' || f === 'frontier';

/** Who enforces the law in a system: its owner, when that is a lawful faction. */
export function lawIn(systemId: SystemId): LawfulFaction | null {
  const owner = WORLD.profiles.get(systemId)?.owner ?? null;
  return isLawful(owner) ? owner : null;
}

export function fineOwed(state: GameState, faction: FactionId): number {
  return state.law.fines[faction] ?? 0;
}

export function totalFines(state: GameState): number {
  return LAWFUL.reduce((sum, f) => sum + fineOwed(state, f), 0);
}

/** A faction's patrols attack the pilot on sight: fines owed, or Hostile standing. */
export function huntedBy(state: GameState, faction: FactionId | 'independent' | null | undefined): boolean {
  if (!isLawful(faction)) return false;
  return fineOwed(state, faction) > 0 || standingTier(state.reputation[faction] ?? 0) === 'hostile';
}

export function wakeFriendly(state: GameState): boolean {
  return (state.reputation['hollow-wake'] ?? 0) >= LAW.wakeFriendly;
}

export interface CrimeOutcome {
  faction: LawfulFaction | null;
  fine: number;
  standing: number;
  text: string;
}

/**
 * A crime against a lawful ship (of `against`, or of the system's law when it is independent):
 * a fine and lost standing with that faction, and for a kill, a little respect from the Wake. In
 * unclaimed space an independent's loss goes unpunished.
 */
export function commitCrime(state: GameState, kind: Exclude<CrimeKind, 'contraband'>, against: FactionId | 'independent' | null, systemId: SystemId): CrimeOutcome {
  const faction = isLawful(against) ? against : lawIn(systemId);
  const rule = LAW.crimes[kind];
  if ('wake' in rule) adjustReputation(state.reputation, 'hollow-wake', rule.wake);
  if (!faction) return { faction: null, fine: 0, standing: 0, text: 'No law out here to see it.' };
  state.law.fines[faction] = fineOwed(state, faction) + rule.fine;
  const standing = adjustReputation(state.reputation, faction, rule.standing);
  const what = kind === 'attack' ? 'Attacking a lawful ship' : kind === 'destroy' ? 'Destroying a lawful ship' : 'Evading a cargo scan';
  return { faction, fine: rule.fine, standing, text: `${what}: the ${FACTIONS[faction].name} fines you ${rule.fine} cr.` };
}

/** Contraband in a hold. */
export function contrabandIn(cargo: GameState['ship']['cargo']): { commodity: CommodityId; qty: number }[] {
  return LAW.contraband.map((commodity) => ({ commodity, qty: cargoCount(cargo, commodity) })).filter((c) => c.qty > 0);
}

/** A cargo scan by `faction`: contraband is confiscated and fined; returns what was found (empty when clean). */
export function customsScan(state: GameState, faction: LawfulFaction): { found: { commodity: CommodityId; qty: number }[]; fine: number; text: string } {
  const found = contrabandIn(state.ship.cargo);
  if (!found.length) return { found, fine: 0, text: `${FACTIONS[faction].shortName} cargo scan: clean. Fly safe.` };
  let value = 0;
  for (const c of found) {
    removeCargo(state.ship.cargo, c.commodity, c.qty);
    value += c.qty * COMMODITIES[c.commodity].basePrice;
  }
  const fine = Math.round(value * LAW.crimes.contraband.fineFactor);
  state.law.fines[faction] = fineOwed(state, faction) + fine;
  adjustReputation(state.reputation, faction, LAW.crimes.contraband.standing);
  const list = found.map((c) => `${c.qty} ${COMMODITIES[c.commodity].name.toLowerCase()}`).join(', ');
  return { found, fine, text: `${FACTIONS[faction].shortName} customs confiscated ${list} and fined you ${fine} cr.` };
}

/** What a pardon costs a hunted pilot: every fine owed, and so much per point of standing below the floor (0: nothing to pardon). */
export function pardonCost(state: GameState, faction: LawfulFaction): number {
  if (!huntedBy(state, faction)) return 0;
  const gap = Math.max(0, LAW.pardonFloor - (state.reputation[faction] ?? 0));
  return fineOwed(state, faction) + gap * LAW.pardonPerStanding;
}

/** A pardon: pays every fine owed to a faction and lifts standing to at least Wary. */
export function payFines(state: GameState, faction: LawfulFaction): { ok: boolean; message: string } {
  const cost = pardonCost(state, faction);
  if (cost <= 0) return { ok: false, message: 'You owe nothing.' };
  if (state.credits < cost) return { ok: false, message: `A pardon costs ${cost} cr; you have ${state.credits} cr.` };
  applyCredits(state, -cost, 'fee', `Pardon from the ${FACTIONS[faction].name}`);
  delete state.law.fines[faction];
  const before = state.reputation[faction] ?? 0;
  if (before < LAW.pardonFloor) adjustReputation(state.reputation, faction, LAW.pardonFloor - before);
  return { ok: true, message: `Pardoned: the ${FACTIONS[faction].name} has cleared your record.` };
}

/**
 * How a station receives the pilot: `full` service, `emergency` docking (repairs at a surcharge and
 * the customs desk, nothing else) for pilots a lawful owner hunts, or `refused` (raider dens, unless
 * the Wake trusts you).
 */
export function dockAccess(state: GameState, locationId: string): 'full' | 'emergency' | 'refused' {
  const loc = getLocation(locationId);
  if (loc.stationType === 'pirate-den') return wakeFriendly(state) ? 'full' : 'refused';
  if (loc.dockable === false) return 'refused';
  return huntedBy(state, loc.factionId) ? 'emergency' : 'full';
}

/** Customs at this dock scans every ship that docks (customs depots and military bases of a lawful owner). */
export function scansOnDocking(locationId: string): LawfulFaction | null {
  const loc = getLocation(locationId);
  const type = loc.stationType;
  return type && (LAW.scans.docks as readonly string[]).includes(type) && isLawful(loc.factionId) ? (loc.factionId as LawfulFaction) : null;
}

/** Patrols of this system scan cargo (claimed space at or above the scan security). */
export function patrolsScanIn(systemId: SystemId): LawfulFaction | null {
  const law = lawIn(systemId);
  return law && (WORLD.profiles.get(systemId)?.security ?? 0) >= LAW.scans.security ? law : null;
}

/** Bounty hunters come for this pilot in this system (big fines, secure space). */
export function huntersIn(state: GameState, systemId: SystemId): boolean {
  return totalFines(state) >= LAW.hunters.fines && (WORLD.profiles.get(systemId)?.security ?? 0) >= LAW.hunters.security;
}
