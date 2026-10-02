import { applyCredits, type BorderEnding, type CommodityId, type GameState } from '../app/state.ts';
import { EVENTS } from '../content/events/rules.ts';
import type { LastingMark } from '../content/story/marks.ts';
import type { StoryMeta } from '../content/story/types.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { getLocation, getSystem } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { endFront } from './border.ts';
import { stationEventAt, systemEventAt, type WorldEvent } from './events.ts';
import { adjustReputation, FACTIONS } from './factions.ts';
import { lawIn } from './law.ts';
import { reliefDelivered, shippedOut, shipsOut, shortfall, surplus } from './hauls.ts';
import { markById, marksForFront } from './marks.ts';

/**
 * The world answers the player (docs/PROCGEN.md §17): a shortage the player helps fill ends
 * sooner and pays a relief bonus; destroying raiders in a raided system breaks the raid. Both are
 * written to the save's world log, which the event engine reads (economy/events.ts useWorldLog).
 */

/**
 * A border front settled for good (docs/PROCGEN.md §20.5, §20.7): its ending holds it, and leaves
 * its lasting marks on the stations around it. Returns the marks newly left.
 */
export function settleFront(state: GameState, frontId: string, ending: BorderEnding): LastingMark[] {
  endFront(state, frontId, ending);
  return marksForFront(frontId, ending).filter((m) => leaveMark(state, m.id));
}

/** A save from before fronts left marks: the marks of the fronts already settled in it. */
export function markSettledFronts(state: GameState): void {
  for (const [frontId, log] of Object.entries(state.world.border)) {
    if (log.ending) for (const m of marksForFront(frontId, log.ending)) leaveMark(state, m.id);
  }
}

/**
 * A story's ending leaves a lasting mark on a station (docs/PROCGEN.md §14.7), once and for good.
 * Returns the mark, or null if it was already left.
 */
export function leaveMark(state: GameState, id: string): LastingMark | null {
  const mark = markById(id);
  if (!mark) return null;
  const marks = (state.world.marks ??= {});
  if (marks[id] !== undefined) return null;
  marks[id] = state.clock;
  return mark;
}

/** The lasting mark a story mission leaves when it is done: the one for the choice it follows, if it has one. */
export function storyMark(state: GameState, story: StoryMeta | undefined): string | undefined {
  const v = story?.variant;
  const pick = v ? state.story.choices[v.choiceId] : undefined;
  return (pick && v?.leaves?.[pick]) || story?.leaves;
}

export interface Answer {
  text: string;
  /** Credits paid (a relief bonus). */
  paid: number;
}

/** How many units of its goods a shortage leaves a station short of. */
export function shortageDeficit(e: WorldEvent): number {
  return shortfall(e);
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
  // What the relief hauls brought counts with what the player sold (docs/PROCGEN.md §21).
  if (deficit <= 0 || log[e.id]! + reliefDelivered(e, state.clock) < deficit * EVENTS.react.relief) return null;
  state.world.ended[e.id] = state.clock;
  const units = log[e.id]!;
  const paid = Math.round(units * COMMODITIES[commodity].basePrice * EVENTS.react.reliefBonus);
  const loc = getLocation(locationId);
  applyCredits(state, paid, 'reward', `Shortage relieved at ${loc.name}`);
  state.stats.rewards += paid;
  if (loc.factionId) adjustReputation(state.reputation, loc.factionId, EVENTS.react.standing);
  return { paid, text: `Shortage relieved: ${loc.name} is supplied again, and pays a relief bonus of ${paid} cr.` };
}

/**
 * Buying out of a glut (or a harvest) counts toward clearing it, with what its haulers have shipped
 * out (docs/PROCGEN.md §21.6); once the share the rules ask for has gone, it is over and prices are
 * back to normal. No bonus: the low prices were the reward. Returns what happened, if anything did.
 */
export function clearGlut(state: GameState, locationId: string, commodity: CommodityId, qty: number): Answer | null {
  const e = stationEventAt(locationId, state.clock);
  if (!e || !shipsOut(e) || e.goods[0] !== commodity || state.world.ended[e.id] !== undefined) return null;
  const log = state.world.relief;
  log[e.id] = (log[e.id] ?? 0) + qty;
  const extra = surplus(e);
  if (extra <= 0 || log[e.id]! + shippedOut(e, state.clock) < extra * EVENTS.react.relief) return null;
  state.world.ended[e.id] = state.clock;
  const loc = getLocation(locationId);
  return { paid: 0, text: `Glut cleared: ${loc.name} has no more ${COMMODITIES[commodity].name.toLowerCase()} than it can store, and its prices are back to normal.` };
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
