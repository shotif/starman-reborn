import { applyCredits, type CommodityId, type GameState } from '../app/state.ts';
import { EVENTS } from '../content/events/rules.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { getLocation, getSystem } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { stationEventAt, systemEventAt, type WorldEvent } from './events.ts';
import { adjustReputation, FACTIONS } from './factions.ts';
import { lawIn } from './law.ts';
import { marketEntry } from './markets.ts';

/**
 * The world answers the player (docs/PROCGEN.md §17): a shortage the player helps fill ends
 * sooner and pays a relief bonus; destroying raiders in a raided system breaks the raid. Both are
 * written to the save's world log, which the event engine reads (economy/events.ts useWorldLog).
 */

export interface Answer {
  text: string;
  /** Credits paid (a relief bonus). */
  paid: number;
}

/** How many units of its goods a shortage leaves a station short of. */
export function shortageDeficit(e: WorldEvent): number {
  if (!e.locationId) return 0;
  return e.goods.reduce((sum, c) => sum + (marketEntry(e.locationId!, c)?.target ?? 0) * Math.max(0, 1 - e.stock), 0);
}

/**
 * A sale into a shortage counts toward its relief; once the player has sold the share the rules
 * ask for, the shortage ends and the station pays the relief bonus. Returns what happened, if
 * anything did.
 */
export function relieveShortage(state: GameState, locationId: string, commodity: CommodityId, qty: number): Answer | null {
  const e = stationEventAt(locationId, state.clock);
  if (!e || e.kind !== 'shortage' || !e.goods.includes(commodity) || state.world.ended[e.id] !== undefined) return null;
  const log = state.world.relief;
  log[e.id] = (log[e.id] ?? 0) + qty;
  const deficit = shortageDeficit(e);
  if (deficit <= 0 || log[e.id]! < deficit * EVENTS.react.relief) return null;
  state.world.ended[e.id] = state.clock;
  const units = log[e.id]!;
  const paid = Math.round(units * COMMODITIES[commodity].basePrice * EVENTS.react.reliefBonus);
  const loc = getLocation(locationId);
  applyCredits(state, paid, 'reward', `Shortage relieved at ${loc.name}`);
  state.stats.rewards += paid;
  if (loc.factionId) adjustReputation(state.reputation, loc.factionId, EVENTS.react.standing);
  return { paid, text: `Shortage relieved: ${loc.name} is supplied again, and pays a relief bonus of ${paid} cr.` };
}

/** Raiders destroyed during a raid count toward breaking it. */
export function raidKill(state: GameState, systemId: SystemId): Answer | null {
  const e = systemEventAt(systemId, state.clock);
  if (!e || e.kind !== 'raid' || state.world.ended[e.id] !== undefined) return null;
  const kills = (state.world.raidKills[e.id] = (state.world.raidKills[e.id] ?? 0) + 1);
  if (kills < EVENTS.react.raidKills + (e.level ?? 1)) return null;
  state.world.ended[e.id] = state.clock;
  const law = lawIn(systemId);
  if (law) adjustReputation(state.reputation, law, EVENTS.react.standing);
  return { paid: 0, text: `The raid on ${getSystem(systemId).displayName} is broken.${law ? ` The ${FACTIONS[law].name} takes note.` : ''}` };
}

/** Forgets what no longer matters (keeps the save small): endings over a day old, and old tallies. */
export function tidyWorldLog(state: GameState): void {
  const w = state.world;
  for (const [id, t] of Object.entries(w.ended)) if (state.clock - t > 86_400) delete w.ended[id];
  for (const map of [w.relief, w.raidKills]) {
    const keys = Object.keys(map);
    for (const id of keys.slice(0, Math.max(0, keys.length - 40))) delete map[id];
  }
}
