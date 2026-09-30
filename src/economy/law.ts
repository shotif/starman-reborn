import { applyCredits, type CommodityId, type CrimeRecord, type GameState } from '../app/state.ts';
import { jumpsFrom } from '../content/world/network.ts';
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

// ---------------------------------------------------------------- witnesses (docs/PROCGEN.md §17)

let jumpCache: Map<SystemId, Map<SystemId, number>> | null = null;
function jumpsBetween(a: SystemId, b: SystemId): number {
  jumpCache ??= new Map();
  let m = jumpCache.get(a);
  if (!m) jumpCache.set(a, (m = jumpsFrom(WORLD.links, a)));
  return m.get(b) ?? 99;
}

/** Whether news of a crime has reached a system: one jump every `LAW.witness.perJump` seconds. */
export function crimeKnownAt(state: GameState, c: CrimeRecord, systemId: SystemId): boolean {
  return state.clock - c.at >= jumpsBetween(c.systemId, systemId) * LAW.witness.perJump;
}

/** What a faction knows the pilot owes in a system (where the player is, by default). */
export function fineOwed(state: GameState, faction: FactionId, systemId: SystemId = state.location.systemId): number {
  let owed = state.law.fines[faction] ?? 0;
  for (const c of state.law.pending) if (c.faction === faction && crimeKnownAt(state, c, systemId)) owed += c.amount;
  return owed;
}

/** Everything on a faction's books, known everywhere yet or not (what a pardon settles). */
export function fineOnRecord(state: GameState, faction: FactionId): number {
  return (state.law.fines[faction] ?? 0) + state.law.pending.filter((c) => c.faction === faction).reduce((sum, c) => sum + c.amount, 0);
}

export function totalFines(state: GameState, systemId: SystemId = state.location.systemId): number {
  return LAWFUL.reduce((sum, f) => sum + fineOwed(state, f, systemId), 0);
}

/** Crimes whose news has not reached the player's system yet (they are wanted elsewhere). */
export function finesTravelling(state: GameState): number {
  return LAWFUL.reduce((sum, f) => sum + fineOnRecord(state, f) - fineOwed(state, f), 0);
}

/** Records a fine where the crime was seen; the news spreads from there. */
function witness(state: GameState, faction: LawfulFaction, amount: number, systemId: SystemId): void {
  state.law.pending.push({ faction, amount, systemId, at: state.clock });
  state.law.lastCrimeAt[faction] = state.clock;
}

/**
 * Brings the books up to date: news that has reached every system goes on the record, and fines
 * lapse after a long enough quiet spell (never for a Hostile pilot). Returns what lapsed.
 */
export function settleLaw(state: GameState): string[] {
  const notes: string[] = [];
  const spread = (c: CrimeRecord) => Math.max(...jumpsFrom(WORLD.links, c.systemId).values()) * LAW.witness.perJump;
  state.law.pending = state.law.pending.filter((c) => {
    if (state.clock - c.at < spread(c)) return true;
    state.law.fines[c.faction] = (state.law.fines[c.faction] ?? 0) + c.amount;
    return false;
  });
  for (const f of LAWFUL) {
    const owed = fineOnRecord(state, f);
    if (owed <= 0 || standingTier(state.reputation[f] ?? 0) === 'hostile') continue;
    if (state.clock - (state.law.lastCrimeAt[f] ?? 0) < LAW.lapse) continue;
    delete state.law.fines[f];
    state.law.pending = state.law.pending.filter((c) => c.faction !== f);
    notes.push(`Your fines with the ${FACTIONS[f].name} have lapsed: ${owed} cr forgotten after a quiet spell.`);
  }
  return notes;
}

/** A faction's patrols attack the pilot on sight: fines they know of, or Hostile standing. */
export function huntedBy(state: GameState, faction: FactionId | 'independent' | null | undefined, systemId: SystemId = state.location.systemId): boolean {
  if (!isLawful(faction)) return false;
  return fineOwed(state, faction, systemId) > 0 || standingTier(state.reputation[faction] ?? 0) === 'hostile';
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
  witness(state, faction, rule.fine, systemId);
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
  witness(state, faction, fine, state.location.systemId);
  adjustReputation(state.reputation, faction, LAW.crimes.contraband.standing);
  const list = found.map((c) => `${c.qty} ${COMMODITIES[c.commodity].name.toLowerCase()}`).join(', ');
  return { found, fine, text: `${FACTIONS[faction].shortName} customs confiscated ${list} and fined you ${fine} cr.` };
}

/** What a pardon costs a hunted pilot: every fine owed, and so much per point of standing below the floor (0: nothing to pardon). */
export function pardonCost(state: GameState, faction: LawfulFaction): number {
  if (!huntedBy(state, faction) && fineOnRecord(state, faction) <= 0) return 0;
  const gap = Math.max(0, LAW.pardonFloor - (state.reputation[faction] ?? 0));
  return fineOnRecord(state, faction) + gap * LAW.pardonPerStanding;
}

/** A pardon: pays every fine owed to a faction and lifts standing to at least Wary. */
export function payFines(state: GameState, faction: LawfulFaction): { ok: boolean; message: string } {
  const cost = pardonCost(state, faction);
  if (cost <= 0) return { ok: false, message: 'You owe nothing.' };
  if (state.credits < cost) return { ok: false, message: `A pardon costs ${cost} cr; you have ${state.credits} cr.` };
  applyCredits(state, -cost, 'fee', `Pardon from the ${FACTIONS[faction].name}`);
  delete state.law.fines[faction];
  state.law.pending = state.law.pending.filter((c) => c.faction !== faction);
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
  return huntedBy(state, loc.factionId, loc.systemId) ? 'emergency' : 'full';
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
  return totalFines(state, systemId) >= LAW.hunters.fines && (WORLD.profiles.get(systemId)?.security ?? 0) >= LAW.hunters.security;
}
