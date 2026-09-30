import type { BorderEnding, BorderLog, GameState } from '../app/state.ts';
import { BORDER } from '../content/border/rules.ts';
import { hashString } from '../content/random.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, getSystem, WORLD } from '../data/systems.ts';
import type { FactionId, SystemId } from '../data/types.ts';
import { activeBorderLog } from './events.ts';

/**
 * The border war (docs/PROCGEN.md §20). A front is where a lawful faction's space meets a Hollow
 * Wake den, one lane apart. Its pressure (+ the law, − the Wake) is a tide on the game clock plus
 * the player's deeds there, fading with time; The Long Border's ending holds a front for good.
 * Pressure sets the phase: the Wake pushed back, skirmishes, a blockade, a station fallen.
 */

export type LawSide = Extract<FactionId, 'sta' | 'frontier'>;

export interface Front {
  /** `<den system>~<lawful system>`. */
  id: string;
  /** "the Ross 154 – Wolf 1061 line". */
  name: string;
  lawSystem: SystemId;
  wakeSystem: SystemId;
  denId: string;
  faction: LawSide;
  /** The station that falls to the Wake when the front breaks (null: none can, the system would be left without a dock). */
  exposedId: string | null;
  /** Where the tide stands at clock 0, a fraction of a period. */
  phase0: number;
}

export type FrontPhase = 'pushed-back' | 'skirmish' | 'blockade' | 'fallen' | 'truce';

export interface FrontState {
  front: Front;
  /** −100 (the Wake) … +100 (the law). */
  pressure: number;
  tide: number;
  deeds: number;
  phase: FrontPhase;
  ending: BorderEnding | null;
}

/** Stations story characters live at never fall: the story must stay reachable. */
const HOMES = new Set(Object.values(CHARACTERS).map((c) => c.locationId));

function buildFronts(): Front[] {
  const out: Front[] = [];
  for (const den of ALL_LOCATIONS.filter((l) => l.stationType === 'pirate-den' && l.status === 'functional')) {
    for (const law of WORLD.links.get(den.systemId) ?? []) {
      const owner = WORLD.profiles.get(law)?.owner;
      if (owner !== 'sta' && owner !== 'frontier') continue;
      const open = ALL_LOCATIONS.filter((l) => l.systemId === law && l.status === 'functional' && l.dockable !== false && l.services.includes('repair'));
      // One may fall only if another dock with repairs stays open (never a dead end).
      const exposed = open.length >= 2 ? (open.filter((l) => l.stationType && !HOMES.has(l.id)).sort((a, b) => (a.id < b.id ? -1 : 1))[0] ?? null) : null;
      const id = `${den.systemId}~${law}`;
      out.push({
        id,
        name: `the ${getSystem(law).displayName} – ${getSystem(den.systemId).displayName} line`,
        lawSystem: law,
        wakeSystem: den.systemId,
        denId: den.id,
        faction: owner,
        exposedId: exposed?.id ?? null,
        phase0: (hashString(`border:${id}`) % 1000) / 1000,
      });
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export const FRONTS: readonly Front[] = buildFronts();

const byId = new Map(FRONTS.map((f) => [f.id, f]));

export function getFront(id: string): Front | undefined {
  return byId.get(id);
}

/** Fronts that run through a system (as the lawful side or the Wake's). */
export function frontsAt(systemId: SystemId): Front[] {
  return FRONTS.filter((f) => f.lawSystem === systemId || f.wakeSystem === systemId);
}

function phaseOf(front: Front, pressure: number): FrontPhase {
  const p = BORDER.phases;
  if (pressure >= p.pushedBack) return 'pushed-back';
  if (pressure > p.blockade) return 'skirmish';
  if (pressure > p.fallen || !front.exposedId) return 'blockade';
  return 'fallen';
}

/** The tide alone: how the war would go without the player. */
export function tideAt(front: Front, clock: number): number {
  return BORDER.tide.amplitude * Math.sin(2 * Math.PI * (clock / BORDER.tide.periodSeconds + front.phase0));
}

/** What the player's deeds add now, each fading since it was done. */
export function deedsAt(entry: BorderLog | undefined, clock: number): number {
  if (!entry) return 0;
  let sum = 0;
  for (const [at, amount] of entry.deeds) if (at <= clock) sum += amount * Math.exp(-(clock - at) / BORDER.fadeSeconds);
  return sum;
}

/** Where a front stands at a moment: the tide, the player's deeds, an ending if The Long Border has one. */
export function frontState(front: Front, clock: number, log: Record<string, BorderLog> | null = activeBorderLog()): FrontState {
  const entry = log?.[front.id];
  const ending = entry?.ending ?? null;
  if (ending) {
    const pressure = BORDER.ending[ending];
    return { front, pressure, tide: 0, deeds: 0, phase: ending === 'truce' ? 'truce' : phaseOf(front, pressure), ending };
  }
  const tide = tideAt(front, clock);
  const deeds = deedsAt(entry, clock);
  const pressure = Math.max(-100, Math.min(100, tide + deeds));
  return { front, pressure, tide, deeds, phase: phaseOf(front, pressure), ending: null };
}

/** The fronts through a system, as they stand. */
export function frontsHere(systemId: SystemId, clock: number): FrontState[] {
  return frontsAt(systemId).map((f) => frontState(f, clock));
}

/** Stations on a front line that can fall: generated contracts never send a pilot to one. */
export const EXPOSED: ReadonlySet<string> = new Set(FRONTS.flatMap((f) => (f.exposedId ? [f.exposedId] : [])));

/** Held by the Hollow Wake: a lawful station on a front that has fallen. */
export function occupied(locationId: string, clock: number): Front | null {
  if (!EXPOSED.has(locationId)) return null;
  for (const f of FRONTS) if (f.exposedId === locationId && frontState(f, clock).phase === 'fallen') return f;
  return null;
}

/**
 * Where war work is posted (docs/PROCGEN.md §20): the law hires while its front is contested or
 * lost (a skirmish, a blockade, a fallen station), the Wake whenever it is not at peace. A front
 * The Long Border has settled posts nothing any more.
 */
export function atWar(s: FrontState, side: 'law' | 'wake'): boolean {
  if (s.ending) return false;
  return side === 'wake' ? s.phase !== 'truce' : s.phase === 'skirmish' || s.phase === 'blockade' || s.phase === 'fallen';
}

/**
 * The player's deed at a system counts on every front through it (+ for the law, − for the Wake).
 * Returns the fronts it moved.
 */
export function recordDeed(state: GameState, systemId: SystemId, amount: number): Front[] {
  const fronts = frontsAt(systemId);
  for (const f of fronts) pushFront(state, f.id, amount);
  return fronts;
}

/** War work done for one front: its weight counts there alone. */
export function pushFront(state: GameState, frontId: string, amount: number): void {
  const entry = (state.world.border[frontId] ??= { deeds: [] });
  if (entry.ending) return;
  entry.deeds.push([state.clock, amount]);
  if (entry.deeds.length > BORDER.keep) entry.deeds.splice(0, entry.deeds.length - BORDER.keep);
}

/** The Long Border's ending holds its front for good. */
export function endFront(state: GameState, frontId: string, ending: BorderEnding): void {
  (state.world.border[frontId] ??= { deeds: [] }).ending = ending;
}

// ---------------------------------------------------------------- news

export interface BorderNews {
  state: FrontState;
  jumps: number;
  headline: string;
  detail: string;
}

const SIDE: Record<LawSide, string> = { sta: 'the Transit Authority', frontier: 'the Frontier Cooperative' };

/** How a front stands, in words. */
export function frontWords(s: FrontState): { headline: string; detail: string } {
  const f = s.front;
  const law = getSystem(f.lawSystem).displayName;
  const wake = getSystem(f.wakeSystem).displayName;
  const side = SIDE[f.faction];
  const station = f.exposedId ? getLocation(f.exposedId).name : null;
  switch (s.phase) {
    case 'truce':
      return { headline: `A truce holds on ${f.name}`, detail: `Kettering's truce: ${side} and the Hollow Wake keep to their own lanes, and traffic runs quiet between ${law} and ${wake}.` };
    case 'pushed-back':
      return s.ending
        ? { headline: `${side[0]!.toUpperCase()}${side.slice(1)} holds ${f.name}`, detail: `The Wake has been driven back from ${law}; patrols fly into ${wake} itself.` }
        : { headline: `${side[0]!.toUpperCase()}${side.slice(1)} pushes the Wake back from ${law}`, detail: `Patrols are chasing raiders into ${wake}. Lawful traffic is running freely.` };
    case 'skirmish':
      return { headline: `Skirmishes on ${f.name}`, detail: `Patrol wings and Wake raiders are fighting between ${law} and ${wake}. Both sides are hiring pilots.` };
    case 'blockade':
      return { headline: `The Hollow Wake blockades ${law}`, detail: `Raider packs sit on the lanes into ${law}; traders are scarce and ${side} is paying for pilots who break it.` };
    case 'fallen':
      return {
        headline: s.ending ? `${station} is the Wake's` : `${station} falls to the Hollow Wake`,
        detail: `Raiders hold ${station} at ${law}: lawful pilots get emergency docking only. ${s.ending ? 'The Wake keeps it.' : `${side} wants it back.`}`,
      };
  }
}

/** News of the fronts within reach of a system, nearest first. */
export function borderNews(systemId: SystemId, clock: number): BorderNews[] {
  const jumps = jumpsFrom(WORLD.links, systemId);
  const out: BorderNews[] = [];
  for (const f of FRONTS) {
    const j = Math.min(jumps.get(f.lawSystem) ?? 99, jumps.get(f.wakeSystem) ?? 99);
    if (j > BORDER.newsJumps) continue;
    const state = frontState(f, clock);
    out.push({ state, jumps: j, ...frontWords(state) });
  }
  return out.sort((a, b) => a.jumps - b.jumps || (a.state.front.id < b.state.front.id ? -1 : 1));
}
