import type { GameState, RivalStanding, RivalStory } from '../app/state.ts';
import { COMMODITIES, type CommodityId } from '../content/economy/goods.ts';
import { ECONOMY } from '../content/economy/rules.ts';
import { PEOPLE } from '../content/people/rules.ts';
import { rng } from '../content/random.ts';
import { AMENDS, GREET, NEWS, RADIO, REFUSE, ROUND, TIP, type RivalTier } from '../content/rivals/lines.ts';
import { STORY_NEWS, type StoryNewsKind } from '../content/rivals/storyLines.ts';
import { RIVALS, ROSTER, type RivalDef } from '../content/rivals/rules.ts';
import { RIVAL_STORY } from '../content/rivals/stories.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, getSystem, WORLD } from '../data/systems.ts';
import type { FictionalLocation, SystemId } from '../data/types.ts';
import { boardEpoch, boardFor } from './contracts.ts';
import { activeRivalLog, endedAt, endedKey, eventEnd, stationEventsBetween, worldLogKey, type WorldEvent } from './events.ts';
import { standingTier } from './factions.ts';
import { haulReliefEnd, legsOf, makersNear, shortfall, type HaulLeg } from './hauls.ts';
import type { JobDef } from './jobs.ts';
import { marketTables } from './markets.ts';

/**
 * Rival pilots (docs/PROCGEN.md §24). Each of the six has a career of turns on the game clock: a rest
 * in a bar, then a run to the next station. Traders carry the best cargo between two stations of
 * their patch; bounty hunters take a bounty off a board in their patch and fly to the pack; runners
 * race relief to a shortage that began in their patch. Every turn is a function of the seed, the
 * clock and the save's world log (rivals the player knocked out, claims bought back, shortages the
 * player ended): nothing runs in the background. FlightSession flies the runs in the player's system;
 * the bars, the boards, the News and the markets feel the rest.
 */

// ---------------------------------------------------------------- the roster and its patches

export function rivalById(id: string): RivalDef | undefined {
  return ROSTER.find((r) => r.id === id);
}

/** A rival's name as the game says it: Mara “Quickstep” Venn. */
export function rivalName(r: RivalDef): string {
  return `${r.first} “${r.nick}” ${r.last}`;
}

const isOpen = (l: FictionalLocation) => l.status === 'functional' && l.dockable !== false && l.stationType !== 'pirate-den';
const security = (systemId: SystemId) => WORLD.profiles.get(systemId)?.security ?? 1;

const patchCache = new Map<string, FictionalLocation[]>();
/** The open stations with a market a rival works: within RIVALS.patch.jumps of home, never in the systems it avoids. */
export function patchOf(r: RivalDef): readonly FictionalLocation[] {
  let out = patchCache.get(r.id);
  if (!out) {
    const near = jumpsFrom(WORLD.links, getLocation(r.home).systemId);
    const tables = marketTables();
    out = ALL_LOCATIONS.filter((l) => isOpen(l) && tables.has(l.id) && (near.get(l.systemId) ?? 99) <= RIVALS.patch.jumps && !RIVALS.patch.avoid.includes(l.systemId)).sort((a, b) => (a.id < b.id ? -1 : 1));
    patchCache.set(r.id, out);
  }
  return out;
}

const wayCache = new Map<string, SystemId[]>();
/** The shortest way between two systems, by jumps (ties to the first lane in name order), both ends included. */
export function wayBetween(a: SystemId, b: SystemId): SystemId[] {
  const key = `${a}|${b}`;
  let way = wayCache.get(key);
  if (way) return way;
  const back = new Map<SystemId, SystemId | null>([[a, null]]);
  let ring = [a];
  while (ring.length && !back.has(b)) {
    const next: SystemId[] = [];
    for (const s of ring) {
      for (const n of [...(WORLD.links.get(s) ?? [])].sort()) {
        if (back.has(n)) continue;
        back.set(n, s);
        next.push(n);
      }
    }
    ring = next;
  }
  way = [];
  for (let s: SystemId | null | undefined = b; s; s = back.get(s)) way.unshift(s);
  if (way[0] !== a) way = [a];
  wayCache.set(key, way);
  return way;
}

// ---------------------------------------------------------------- turns

const T = RIVALS.turnSeconds;
export const turnStart = (n: number) => RIVALS.from + n * T;
export const turnOf = (clock: number) => Math.floor((clock - RIVALS.from) / T);

/** A stretch of a run inside one system, with the stations it flies between. */
export interface RivalLeg extends HaulLeg {
  from: string;
  to: string;
}

export interface RivalRun {
  /** `r.<rival>.<turn>`. */
  id: string;
  rival: RivalDef;
  turn: number;
  kind: 'trade' | 'hunt' | 'race' | 'ferry';
  from: string;
  to: string;
  /** Where a runner loads its relief, on the way (the nearest maker). */
  via?: string;
  commodity?: CommodityId;
  qty: number;
  legs: readonly RivalLeg[];
  depart: number;
  /** When it loads its cargo (a race: at the maker; otherwise as it sets off). */
  loaded: number;
  arrive: number;
  /** The bounty a hunter took off a board, and when. */
  claim?: { contract: JobDef; giver: string; at: number };
  /** The shortage a runner races to. */
  shortage?: WorldEvent;
  /** Lost on the way at this moment: destroyed by the player, or adrift after a drive failure (docs/PROCGEN.md §28). */
  lostAt?: number;
}

interface Plan {
  rest: number;
  pick: string;
  load: number;
}

const planCache = new Map<string, Plan>();
/** A turn as it would go in any save: the rest before setting off, the station a trader picks, its load. */
function planOf(r: RivalDef, n: number): Plan {
  const key = `${r.id}|${n}`;
  let plan = planCache.get(key);
  if (!plan) {
    const g = rng(WORLD_SEED, 'rival', r.id, n);
    const patch = patchOf(r);
    plan = { rest: Math.round(g.range(RIVALS.rest[0], RIVALS.rest[1])), pick: patch.length ? g.pick(patch).id : r.home, load: Math.round(g.range(RIVALS.trade.load[0], RIVALS.trade.load[1])) };
    if (planCache.size > 20_000) planCache.clear();
    planCache.set(key, plan);
  }
  return plan;
}

/** The station a hunter flies to for a bounty: by the pack, or the nearest open dock in its system, or home to the board. */
function huntStation(c: JobDef): string {
  const o = c.objectives[0];
  if (o?.kind !== 'bounty') return c.giverLocationId;
  const near = getLocation(o.locationId);
  if (isOpen(near)) return near.id;
  return ALL_LOCATIONS.find((l) => l.systemId === o.systemId && isOpen(l))?.id ?? c.giverLocationId;
}

/** The bounty or ace a hunter takes off a board of its patch as it sets off on turn `n`, if one is posted. */
export function claimFor(r: RivalDef, n: number): RivalRun['claim'] | null {
  if (r.style !== 'hunter' || n < 0) return null;
  const at = turnStart(n) + planOf(r, n).rest;
  const epoch = boardEpoch(at);
  const home = jumpsFrom(WORLD.links, getLocation(r.home).systemId);
  const offers: { contract: JobDef; giver: string }[] = [];
  for (const l of patchOf(r)) {
    for (const c of boardFor(l.id, epoch)) {
      const o = c.objectives[0];
      if ((c.contract?.kind !== 'bounty' && c.contract?.kind !== 'ace') || o?.kind !== 'bounty') continue;
      if ((home.get(o.systemId) ?? 99) > RIVALS.hunt.reach) continue;
      offers.push({ contract: c, giver: l.id });
    }
  }
  if (!offers.length) return null;
  const pick = rng(WORLD_SEED, 'rival-claim', r.id, n).pick(offers);
  return { ...pick, at };
}

/**
 * The shortage a runner races to on turn `n`: one that began at a station of its patch in the turn
 * before, still on when it would set off (not ended by the player, and not yet relieved by the
 * haulers), with a maker within reach of it. The earliest, if several.
 */
const raceCache = new Map<string, { shortage: WorldEvent; maker: FictionalLocation } | null>();
export function raceFor(r: RivalDef, n: number): { shortage: WorldEvent; maker: FictionalLocation } | null {
  if (r.style !== 'runner' || n < 0) return null;
  const key = `${r.id}|${n}|${worldLogKey()}|${endedKey()}`;
  if (raceCache.has(key)) return raceCache.get(key)!;
  const race = makeRace(r, n);
  if (raceCache.size > 20_000) raceCache.clear();
  raceCache.set(key, race);
  return race;
}

function makeRace(r: RivalDef, n: number): { shortage: WorldEvent; maker: FictionalLocation } | null {
  const s = turnStart(n);
  const depart = s + planOf(r, n).rest;
  let best: { shortage: WorldEvent; maker: FictionalLocation } | null = null;
  for (const l of patchOf(r)) {
    for (const e of stationEventsBetween(l.id, s - T, s)) {
      if (e.kind !== 'shortage' || e.locationId !== l.id || e.start < Math.max(RIVALS.from, s - T) || e.start >= s) continue;
      if (e.end <= depart || (endedAt(e) ?? Infinity) <= s || haulReliefEnd(e) <= s) continue;
      const maker = makersNear(l, e.goods[0]!, RIVALS.race.makerJumps).find((m) => m.id !== l.id);
      if (!maker) continue;
      if (!best || e.start < best.shortage.start || (e.start === best.shortage.start && e.id < best.shortage.id)) best = { shortage: e, maker };
    }
  }
  return best;
}

/** The rival's latest knock-out, if the player has destroyed its ship. */
function downOf(r: RivalDef): { at: number; systemId: SystemId } | undefined {
  return activeRivalLog()?.down[r.id];
}

/** Whether turn `n` is spent refitting at home after a knock-out (the turn it struck in, and those in its shadow). */
function refitting(r: RivalDef, n: number): boolean {
  const d = downOf(r);
  return !!d && turnStart(n + 1) > d.at && turnStart(n) < d.at + RIVALS.downSeconds;
}

/** Where turn `n` takes a rival (whatever happens on the way). */
function aimOf(r: RivalDef, n: number): string {
  const claim = claimFor(r, n);
  if (claim) return huntStation(claim.contract);
  const race = raceFor(r, n);
  if (race) return race.shortage.locationId!;
  return planOf(r, n).pick;
}

/** When turn `n` of a rival's career sets off (its rest in the bar over). */
export function departOf(r: RivalDef, n: number): number {
  return turnStart(n) + planOf(r, n).rest;
}

/**
 * The station a rival is at when turn `n` is over: where the turn took it, or home, refitting, or
 * where a story's hold that ended in the turn left it (docs/PROCGEN.md §28).
 */
export function destOf(r: RivalDef, n: number): string {
  if (n < 0 || refitting(r, n)) return r.home;
  const ended = lastHoldEnding(r, departOf(r, n), departOf(r, n + 1));
  if (ended) return ended.resume ?? r.home;
  const held = heldAt(r, departOf(r, n));
  if (held) return held.resume ?? r.home;
  return aimOf(r, n);
}

/**
 * The best lawful cargo from one station to another: a good the first sells (it makes or trades it)
 * and the second takes, with the widest gap between their normal prices, if any pays.
 */
export function bestCargo(from: string, to: string): CommodityId | null {
  const tables = marketTables();
  const there = tables.get(to)?.entries;
  const here = tables.get(from)?.entries;
  if (!there || !here) return null;
  let best: CommodityId | null = null;
  let gap = 0;
  for (const buy of [...here.values()].sort((a, b) => (a.commodity < b.commodity ? -1 : 1))) {
    const c = buy.commodity;
    const sell = there.get(c);
    if (buy.role === 'consume' || !sell || sell.role === 'produce' || COMMODITIES[c].category === 'contraband') continue;
    const g = sell.mid - buy.mid;
    if (g > gap) {
      gap = g;
      best = c;
    }
  }
  return best;
}

function stretch(from: string, to: string, depart: number): RivalLeg[] {
  return legsOf(wayBetween(getLocation(from).systemId, getLocation(to).systemId), depart).map((l) => ({ ...l, from, to }));
}

function logStamp(r: RivalDef): string {
  const d = downOf(r);
  return `${worldLogKey()}|${d ? d.at : ''}|${holdStamp(r)}`;
}

const runCache = new Map<string, RivalRun | null>();
/** A rival's run on turn `n`, or null when it stays where it is (refitting, or its pick is where it already is). */
export function runOf(r: RivalDef, n: number): RivalRun | null {
  if (n < 0) return null;
  // A race depends on which shortages the player ended, so its key carries the turn's state of them.
  const race = raceFor(r, n);
  const key = `${r.id}|${n}|${logStamp(r)}|${race?.shortage.id ?? ''}`;
  if (runCache.has(key)) return runCache.get(key)!;
  const run = makeRun(r, n, race);
  if (runCache.size > 20_000) runCache.clear();
  runCache.set(key, run);
  return run;
}

function makeRun(r: RivalDef, n: number, race: ReturnType<typeof raceFor>): RivalRun | null {
  const d = downOf(r);
  const s = turnStart(n);
  if (d && s >= d.at && s < d.at + RIVALS.downSeconds) return null;
  const plan = planOf(r, n);
  const depart = s + plan.rest;
  // A run that would set off while a story holds the rival never sets off (docs/PROCGEN.md §28).
  if (heldAt(r, depart)) return null;
  const from = destOf(r, n - 1);
  const claim = claimFor(r, n);
  let run: Omit<RivalRun, 'arrive' | 'lostAt'>;
  if (claim) {
    const to = huntStation(claim.contract);
    if (to === from) return null;
    run = { id: `r.${r.id}.${n}`, rival: r, turn: n, kind: 'hunt', from, to, qty: 0, legs: stretch(from, to, depart), depart, loaded: depart, claim };
  } else if (race) {
    const to = race.shortage.locationId!;
    const via = race.maker.id;
    const first = via === from ? [] : stretch(from, via, depart);
    const loaded = (first.at(-1)?.end ?? depart) + RIVALS.race.loadSeconds;
    const qty = Math.max(1, Math.round(shortfall(race.shortage) * RIVALS.race.share));
    run = { id: `r.${r.id}.${n}`, rival: r, turn: n, kind: 'race', from, to, via, commodity: race.shortage.goods[0], qty, legs: [...first, ...stretch(via, to, loaded)], depart, loaded, shortage: race.shortage };
  } else {
    const to = plan.pick;
    if (to === from) return null;
    // A hunter without a bounty looks for one, flying light; traders and runners carry what pays.
    const commodity = r.style === 'hunter' ? null : bestCargo(from, to);
    run = { id: `r.${r.id}.${n}`, rival: r, turn: n, kind: commodity ? 'trade' : 'ferry', from, to, ...(commodity ? { commodity } : {}), qty: commodity ? plan.load : 0, legs: stretch(from, to, depart), depart, loaded: depart };
  }
  const arrive = run.legs.at(-1)!.end;
  // Lost on the way: destroyed by the player, or adrift when a story's hold begins on the way (a drive failure).
  const cut = holdsOf(r).find((h) => h.from > depart && h.from < arrive)?.from;
  const lost = Math.min(d && d.at >= depart && d.at < arrive ? d.at : Infinity, cut ?? Infinity);
  return { ...run, arrive, ...(lost < Infinity ? { lostAt: lost } : {}) };
}

// ---------------------------------------------------------------- stories' holds (docs/PROCGEN.md §28)

/** What a story holds a rival to, off their career. */
export type HoldKind = 'escort' | 'adrift' | 'wing' | 'waiting' | 'duel';

export interface RivalHold {
  kind: HoldKind;
  from: number;
  /** When it ends (Infinity while nothing has ended it yet). */
  to: number;
  /** The station it leaves them at (null: not known yet). */
  resume: string | null;
  /** Where they are meanwhile, when that is a system: adrift, or at the duel's beacon. */
  systemId?: SystemId;
}

/** A rival's story in the save the game points at. */
export function storyOf(r: RivalDef): RivalStory | undefined {
  return activeRivalLog()?.stories?.[r.id];
}

/** The first turn of a career that starts at or after a moment. */
export const turnFrom = (t: number) => Math.max(0, Math.ceil((t - RIVALS.from) / T));

const duelCache = new Map<string, SystemId>();
/** Where a rival calls the player out to: the lawless system nearest their home (by jumps, then by name). */
export function duelSystem(r: RivalDef): SystemId {
  let sys = duelCache.get(r.id);
  if (!sys) {
    const home = getLocation(r.home).systemId;
    const near = [...jumpsFrom(WORLD.links, home).entries()].filter(([s]) => s !== 'sol' && security(s) < RIVALS.hostile.lawless);
    sys = near.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? home;
    duelCache.set(r.id, sys);
  }
  return sys;
}

/** When a feud's opening is over: spent, or its window run out. */
export function openingOver(r: RivalDef, s: RivalStory): number {
  const E = RIVAL_STORY.enemy;
  return s.spent ?? s.began + (RIVAL_STORY.paths[r.id]?.opening === 'ambush' ? E.ambush.seconds : E.tipoff.seconds);
}

/** When a feud's duel is posted: as it was, or the first turn at least `postedAfter` the opening is over, once they are back in a ship. */
export function duelPostedAt(r: RivalDef, s: RivalStory): number {
  if (s.duel) return s.duel.posted;
  const d = downOf(r);
  const from = Math.max(openingOver(r, s) + RIVAL_STORY.enemy.duel.postedAfter, d ? d.at + RIVALS.downSeconds : 0);
  return departOf(r, turnFrom(from));
}

const NO_HOLDS: readonly RivalHold[] = [];
const holdCache = new Map<string, readonly RivalHold[]>();

/** The story and knock-out a rival's holds are worked out from, as text (for caches). */
function holdStamp(r: RivalDef): string {
  const story = storyOf(r);
  return story ? `${JSON.stringify(story)}|${downOf(r)?.at ?? ''}` : '';
}

/**
 * The holds a rival's story puts on their career, in order, worked out from the story and the rules:
 * waiting for the player to fly escort, adrift after a drive failure, on the player's wing, lying in
 * wait with hired guns, at the duel's beacon. A knock-out ends a hold, and sends them home.
 */
export function holdsOf(r: RivalDef): readonly RivalHold[] {
  const story = storyOf(r);
  if (!story) return NO_HOLDS;
  const key = `${r.id}|${holdStamp(r)}`;
  let holds = holdCache.get(key);
  if (!holds) {
    holds = makeHolds(r, story);
    if (holdCache.size > 2_000) holdCache.clear();
    holdCache.set(key, holds);
  }
  return holds;
}

function makeHolds(r: RivalDef, s: RivalStory): RivalHold[] {
  const F = RIVAL_STORY.friend;
  const E = RIVAL_STORY.enemy;
  const out: RivalHold[] = [];
  if (s.path === 'friend') {
    const deed = s.deed;
    if (deed?.kind === 'escort') out.push({ kind: 'escort', from: deed.at, to: deed.end ?? deed.at + F.escort.wait, resume: deed.resume ?? deed.from ?? r.home });
    else if (deed?.kind === 'rescue') out.push({ kind: 'adrift', from: deed.at, to: deed.end ?? deed.at + F.rescue.giveUp, resume: deed.resume ?? r.home, ...(deed.systemId ? { systemId: deed.systemId } : {}) });
    for (const w of s.wings ?? []) out.push({ kind: 'wing', from: w.at, to: w.end ?? Infinity, resume: w.resume ?? null });
  } else {
    const end = s.ended?.at ?? Infinity;
    if (RIVAL_STORY.paths[r.id]?.opening === 'ambush' && s.began < end) out.push({ kind: 'waiting', from: s.began, to: Math.min(openingOver(r, s), end), resume: r.home });
    const posted = duelPostedAt(r, s);
    if (posted < end) out.push({ kind: 'duel', from: posted, to: Math.min(posted + E.duel.open, end), resume: r.home, systemId: duelSystem(r) });
  }
  // A knock-out ends a hold: they are home, refitting.
  const d = downOf(r);
  for (const h of out) {
    if (d && d.at >= h.from && d.at < h.to) {
      h.to = d.at;
      h.resume = r.home;
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** The hold a rival's story has them in at a moment, if any. */
export function heldAt(r: RivalDef, t: number): RivalHold | undefined {
  return holdsOf(r).find((h) => t >= h.from && t < h.to);
}

/** The hold that ended last in (a, b], if any. */
function lastHoldEnding(r: RivalDef, a: number, b: number): RivalHold | undefined {
  let last: RivalHold | undefined;
  for (const h of holdsOf(r)) if (h.to > a && h.to <= b && (!last || h.to >= last.to)) last = h;
  return last;
}

// ---------------------------------------------------------------- where they are

export type RivalWhere =
  | { kind: 'docked'; locationId: string }
  | { kind: 'flying'; run: RivalRun; leg: RivalLeg; progress: number }
  | { kind: 'jumping'; run: RivalRun }
  | { kind: 'down'; until: number }
  | { kind: 'held'; hold: RivalHold };

/**
 * Where a rival is at a moment: docked (resting in the bar, or done for the turn), flying a leg, in a
 * jump, refitting, or held by their story (docs/PROCGEN.md §28).
 */
export function rivalWhere(r: RivalDef, clock: number): RivalWhere {
  const d = downOf(r);
  if (d && clock >= d.at && clock < d.at + RIVALS.downSeconds) return { kind: 'down', until: d.at + RIVALS.downSeconds };
  const n = turnOf(clock);
  if (n < 0) return { kind: 'docked', locationId: r.home };
  const hold = heldAt(r, clock);
  if (hold) return { kind: 'held', hold };
  const run = runOf(r, n);
  if (run && clock >= run.depart && clock < Math.min(run.arrive, run.lostAt ?? Infinity)) {
    const leg = run.legs.find((l) => clock >= l.start && clock < l.end);
    if (leg) return { kind: 'flying', run, leg, progress: (clock - leg.start) / (leg.end - leg.start) };
    // Loading at the maker counts as docked there.
    if (run.via && clock < run.loaded && (run.via === run.from || run.legs.some((l) => l.to === run.via && l.end <= clock))) return { kind: 'docked', locationId: run.via };
    return { kind: 'jumping', run };
  }
  // Docked: where this turn's run took them, or the turn before left them, unless a hold has ended since.
  const arrived = run && run.lostAt === undefined && clock >= run.arrive;
  const ended = lastHoldEnding(r, arrived ? run.arrive : departOf(r, n), clock);
  if (ended) return { kind: 'docked', locationId: ended.resume ?? r.home };
  return { kind: 'docked', locationId: arrived ? run.to : destOf(r, n - 1) };
}

/** The rivals docked at a station now (sitting in its bar). */
export function rivalsDockedAt(locationId: string, clock: number): RivalDef[] {
  return ROSTER.filter((r) => {
    const w = rivalWhere(r, clock);
    return w.kind === 'docked' && w.locationId === locationId;
  });
}

/** The run a docked rival flies next: this turn's, if it has not set off, or the next turn's. */
export function nextRun(r: RivalDef, clock: number): RivalRun | null {
  const n = turnOf(clock);
  const now = runOf(r, n);
  if (now && clock < now.depart) return now;
  return runOf(r, n + 1);
}

/** A rival flying a leg in the player's system, for the flight scene. */
export interface RivalHere {
  rival: RivalDef;
  run: RivalRun;
  leg: RivalLeg;
  progress: number;
  /** Out for the player: hostile, in a lawless system. */
  hostile: boolean;
}

export function rivalsIn(state: GameState, systemId: SystemId, clock: number): RivalHere[] {
  const out: RivalHere[] = [];
  for (const r of ROSTER) {
    const w = rivalWhere(r, clock);
    if (w.kind !== 'flying' || w.leg.systemId !== systemId) continue;
    out.push({ rival: r, run: w.run, leg: w.leg, progress: w.progress, hostile: rivalTier(state, r.id) === 'hostile' && security(systemId) < RIVALS.hostile.lawless });
  }
  return out;
}

// ---------------------------------------------------------------- what a run carries

/** A run in words: "running electronics to Deimos Depot". */
export function doing(run: RivalRun): string {
  const to = getLocation(run.to).name;
  const good = run.commodity ? COMMODITIES[run.commodity].name.toLowerCase() : '';
  switch (run.kind) {
    case 'trade':
      return `running ${good} to ${to}`;
    case 'race':
      return `taking ${good} to the shortage at ${to}`;
    case 'hunt':
      return `hunting ${huntTarget(run.claim!.contract)}`;
    default:
      return `flying to ${to}`;
  }
}

/** Who a hunter is after: the ace by name, or the pack by where it preys. */
export function huntTarget(c: JobDef): string {
  const o = c.objectives[0];
  if (o?.kind !== 'bounty') return c.title;
  if (o.ace) return o.ace.name;
  return `the raiders near ${getLocation(o.locationId).name}`;
}

/** A line for a flight target: "Rival · Trader · 24 electronics for Deimos Depot". */
export function rivalSubtitle(run: RivalRun, where: (locationId: string) => string): string {
  const what =
    run.kind === 'trade' || run.kind === 'race'
      ? `${run.qty} ${COMMODITIES[run.commodity!].name.toLowerCase()} for ${where(run.to)}${run.kind === 'race' ? '’s shortage' : ''}`
      : run.kind === 'hunt'
        ? `hunting ${huntTarget(run.claim!.contract)}`
        : `bound for ${where(run.to)}`;
  return `Rival · ${run.rival.shipName} · ${what}`;
}

// ---------------------------------------------------------------- markets (docs/PROCGEN.md §24.3)

const TAU = ECONOMY.recoverySeconds;
const FELT = TAU * 3;
const fade = (since: number) => (since < 0 ? 0 : Math.exp(-since / TAU));

let zone: Map<string, RivalDef[]> | null = null;
/** The trading rivals that may buy or sell at each station: their patch and the makers a runner loads at. */
function zoneOf(locationId: string): readonly RivalDef[] {
  if (!zone) {
    zone = new Map();
    for (const r of ROSTER) {
      if (r.style === 'hunter') continue;
      const near = jumpsFrom(WORLD.links, getLocation(r.home).systemId);
      const reach = RIVALS.patch.jumps + (r.style === 'runner' ? RIVALS.race.makerJumps : 0);
      for (const l of ALL_LOCATIONS) if ((near.get(l.systemId) ?? 99) <= reach) zone.set(l.id, [...(zone.get(l.id) ?? []), r]);
    }
  }
  return zone.get(locationId) ?? [];
}

/**
 * Stock the rivals' runs move at a station, fading as its market recovers: a trader's or runner's
 * cargo leaves where it loads and arrives where it sells (hunters carry none). A runner sells into its shortage only while
 * it lasts (beaten to it, it sells nothing); a run destroyed on the way sells nothing.
 */
export function rivalStock(locationId: string, commodity: CommodityId, clock: number): number {
  const rivals = zoneOf(locationId);
  if (!rivals.length || turnOf(clock) < 0) return 0;
  let total = 0;
  for (const r of rivals) {
    for (let n = Math.max(0, turnOf(clock - FELT) - 1); n <= turnOf(clock); n++) {
      const run = runOf(r, n);
      if (!run || run.commodity !== commodity) continue;
      const lost = run.lostAt ?? Infinity;
      if ((run.via ?? run.from) === locationId && run.loaded <= clock && lost > run.loaded) total -= run.qty * fade(clock - run.loaded);
      if (run.to === locationId && run.arrive <= clock && lost > run.arrive) {
        if (run.shortage && (eventEnd(run.shortage) <= clock || !raceCounts(run))) continue;
        total += run.qty * fade(clock - run.arrive);
      }
    }
  }
  return total;
}

/** Whether a race's cargo got there while its shortage was still on (the haulers and the player may have ended it). */
function raceCounts(run: RivalRun): boolean {
  const e = run.shortage!;
  return run.lostAt === undefined && Math.min(e.end, endedAt(e) ?? Infinity, haulReliefEnd(e)) > run.arrive;
}

/** The runners' relief for a shortage: what arrived while it was on, and when (for the relief that ends it). */
export function rivalRelief(e: WorldEvent): { at: number; qty: number }[] {
  if (e.kind !== 'shortage' || !e.locationId || e.start < RIVALS.from) return [];
  const sys = getLocation(e.locationId).systemId;
  const out: { at: number; qty: number }[] = [];
  for (const r of ROSTER) {
    if (r.style !== 'runner' || !patchOf(r).some((l) => l.systemId === sys)) continue;
    const run = runOf(r, turnOf(e.start) + 1);
    if (run?.shortage?.id === e.id && raceCounts(run)) out.push({ at: run.arrive, qty: run.qty });
  }
  return out;
}

// ---------------------------------------------------------------- claims on the boards (§24.4)

export interface Claim {
  contract: JobDef;
  rival: RivalDef;
  at: number;
  /** What buying it back costs the player now. */
  price: number;
}

/** The claims hunters took off a station's board in its current posting, not bought back and not the player's. */
export function claimsAt(state: GameState, locationId: string): Claim[] {
  const epoch = boardEpoch(state.clock);
  const bought = activeRivalLog()?.bought ?? {};
  const out: Claim[] = [];
  for (const r of ROSTER) {
    if (r.style !== 'hunter') continue;
    for (const n of [turnOf(state.clock) - 1, turnOf(state.clock)]) {
      // A hunter knocked out, or held by their story, lets its claim go.
      if (refitting(r, n) || heldAt(r, departOf(r, n))) continue;
      const c = claimFor(r, n);
      if (!c || c.giver !== locationId || c.at > state.clock || boardEpoch(c.at) !== epoch) continue;
      if (bought[c.contract.id] !== undefined || state.jobs[c.contract.id]) continue;
      out.push({ contract: c.contract, rival: r, at: c.at, price: claimPrice(state, r, c.contract) });
    }
  }
  return out;
}

function claimPrice(state: GameState, r: RivalDef, c: JobDef): number {
  // An ally hands the claim over for nothing (docs/PROCGEN.md §28).
  if (isAlly(state, r)) return 0;
  const share = RIVALS.hunt.claim * (isFriendly(state, r.id) ? RIVALS.friendly.claim : 1);
  return Math.max(1, Math.round(c.reward * share));
}

/** Contract ids hunters hold on a board now (the board leaves them out). */
export function takenIds(state: GameState, locationId: string): Set<string> {
  return new Set(claimsAt(state, locationId).map((c) => c.contract.id));
}

/** Buys a hunter's claim back: the contract is on the board again for the player. */
export function buyClaim(state: GameState, locationId: string, contractId: string): { ok: boolean; message: string } {
  const claim = claimsAt(state, locationId).find((c) => c.contract.id === contractId);
  if (!claim) return { ok: false, message: 'Nobody holds that claim any more.' };
  if (rivalTier(state, claim.rival.id) === 'hostile') return { ok: false, message: `${rivalName(claim.rival)} will not sell to you.` };
  if (state.credits < claim.price) return { ok: false, message: `You need ${claim.price} cr.` };
  state.credits -= claim.price;
  ((state.world.rivals ??= { down: {}, bought: {} }).bought)[contractId] = state.clock;
  forgetOldClaims(state);
  if (!claim.price) return { ok: true, message: `${rivalName(claim.rival)} hands you the claim, as a friend. The job is yours to take.` };
  shift(state, claim.rival.id, RIVALS.standing.outbid);
  return { ok: true, message: `You bought the claim from ${rivalName(claim.rival)} for ${claim.price} cr. The job is yours to take.` };
}

function forgetOldClaims(state: GameState): void {
  const bought = state.world.rivals?.bought;
  if (!bought) return;
  for (const [id, at] of Object.entries(bought)) if (state.clock - at > 3 * T) delete bought[id];
}

// ---------------------------------------------------------------- standing (§24.5)

function rec(state: GameState, id: string): RivalStanding {
  return ((state.rivals ??= {})[id] ??= { standing: 0 });
}

export function standingWith(state: GameState, id: string): number {
  return state.rivals?.[id]?.standing ?? 0;
}

/** Moves standing with a rival; one made hostile by it gets a feud, or ends a friend's story (docs/PROCGEN.md §28). */
export function shift(state: GameState, id: string, delta: number): void {
  const s = rec(state, id);
  const was = rivalTier(state, id);
  s.standing = Math.max(-100, Math.min(100, s.standing + delta));
  if (was !== 'hostile' && rivalTier(state, id) === 'hostile') turnedHostile(state, id);
}

/** The player has met a rival (in a bar, or in flight): the first time is remembered (docs/PROCGEN.md §28). */
export function metRival(state: GameState, id: string): void {
  rec(state, id).met ??= state.clock;
}

/** The stories of the save, made when first needed. */
export function storiesOf(state: GameState): Record<string, RivalStory> {
  return ((state.world.rivals ??= { down: {}, bought: {} }).stories ??= {});
}

/**
 * A rival made hostile (docs/PROCGEN.md §28): a friend's story ends there, and an ally on the wing
 * leaves it. With no story yet, a feud: its opening comes at the first turn of their career at least
 * `after` from now, `sinceMet` after the player met them, and once they are back in a ship.
 */
function turnedHostile(state: GameState, id: string): void {
  const r = rivalById(id);
  if (!r) return;
  const stories = storiesOf(state);
  const story = stories[id];
  if (story) {
    if (story.path !== 'friend') return;
    if (!story.ended) story.ended = { at: state.clock, how: 'fell-out' };
    const wing = story.wings?.at(-1);
    if (wing && wing.end === undefined) {
      wing.end = state.clock;
      wing.resume = r.home;
    }
    state.crew = state.crew.filter((w) => w.ally !== id);
    return;
  }
  const E = RIVAL_STORY.enemy;
  const met = state.rivals?.[id]?.met ?? state.clock;
  const d = state.world.rivals?.down[id];
  const back = d && d.at + RIVALS.downSeconds > state.clock ? d.at + RIVALS.downSeconds : 0;
  stories[id] = { path: 'enemy', began: departOf(r, turnFrom(Math.max(state.clock + E.after, met + E.sinceMet, back))) };
}

/** A friend whose deed is done, standing high enough to fly on the player's wing (docs/PROCGEN.md §28). */
export function isAlly(state: GameState, r: RivalDef): boolean {
  const story = state.world.rivals?.stories?.[r.id];
  return story?.path === 'friend' && !!story.deed?.done && standingWith(state, r.id) >= RIVAL_STORY.friend.ally.standing;
}

/** How high rounds bought for a rival take standing: a friend whose deed is done, up to an ally's. */
function roundCap(state: GameState, r: RivalDef): number {
  const story = state.world.rivals?.stories?.[r.id];
  return story?.path === 'friend' && story.deed?.done ? RIVAL_STORY.friend.ally.standing : RIVALS.standing.roundsUpTo;
}

export function rivalTier(state: GameState, id: string): RivalTier {
  const t = standingTier(standingWith(state, id));
  return t === 'trusted' ? 'friendly' : t;
}

const isFriendly = (state: GameState, id: string) => rivalTier(state, id) === 'friendly';

function pick<T>(list: readonly T[], key: string): T {
  return rng(WORLD_SEED, 'rival-line', key).pick(list);
}

/** What a rival says on being sat with in a bar: by standing, and (friendly) what it does next. */
export function rivalGreeting(state: GameState, r: RivalDef): { text: string; tip: string | null } {
  const tier = rivalTier(state, r.id);
  const text = pick(GREET[r.voice][tier], `${r.id}|${tier}|${turnOf(state.clock)}`);
  const next = tier === 'friendly' ? nextRun(r, state.clock) : null;
  const tip = next ? pick(TIP[r.voice], `${r.id}|tip|${next.id}`).replace('{doing}', doing(next)) : null;
  return { text, tip: tip ? tip.charAt(0).toUpperCase() + tip.slice(1) : null };
}

/** The bar's shift now (rounds are once a shift, as rumours are). */
const barShift = (clock: number) => Math.floor(boardEpoch(clock) / PEOPLE.shift);

/** Whether a round can be bought for a rival now, or why not. */
export function roundBlock(state: GameState, r: RivalDef): string | null {
  if (rivalTier(state, r.id) === 'hostile') return `${r.first} won’t drink with you.`;
  if (state.rivals?.[r.id]?.round === barShift(state.clock)) return 'You bought a round already this shift.';
  if (state.credits < PEOPLE.drink) return `A round costs ${PEOPLE.drink} cr.`;
  return null;
}

/** Buys a rival a round: standing (once a shift, up to RIVALS.standing.roundsUpTo), and a line. */
export function buyRivalRound(state: GameState, r: RivalDef): { ok: boolean; message: string; line?: string } {
  if (rivalTier(state, r.id) === 'hostile') return { ok: false, message: roundBlock(state, r)!, line: pick(REFUSE[r.voice], r.id) };
  const block = roundBlock(state, r);
  if (block) return { ok: false, message: block };
  state.credits -= PEOPLE.drink;
  const s = rec(state, r.id);
  s.round = barShift(state.clock);
  s.met ??= state.clock;
  const cap = roundCap(state, r);
  if (s.standing < cap) s.standing = Math.min(cap, s.standing + RIVALS.standing.round);
  return { ok: true, message: `You bought ${r.first} a round.`, line: pick(ROUND[r.voice], `${r.id}|${s.round}`) };
}

/** Makes amends with a hostile rival: credits, and standing up to RIVALS.standing.amendsTo. */
export function makeAmends(state: GameState, r: RivalDef): { ok: boolean; message: string; line?: string } {
  if (rivalTier(state, r.id) !== 'hostile') return { ok: false, message: `${r.first} has nothing against you.` };
  const price = RIVALS.standing.amends;
  if (state.credits < price) return { ok: false, message: `Amends cost ${price} cr.` };
  state.credits -= price;
  rec(state, r.id).standing = RIVALS.standing.amendsTo;
  // Amends end a feud (docs/PROCGEN.md §28).
  const story = state.world.rivals?.stories?.[r.id];
  if (story?.path === 'enemy' && !story.ended) story.ended = { at: state.clock, how: 'amends' };
  return { ok: true, message: `You made amends with ${r.first} for ${price} cr.`, line: pick(AMENDS[r.voice], r.id) };
}

/** The player's shot at a rival: standing, once a flight (`flight` keys it), and what it says. */
export function rivalShot(state: GameState, r: RivalDef, flight: number): string | null {
  const s = rec(state, r.id);
  if (s.shot === flight) return null;
  s.shot = flight;
  shift(state, r.id, RIVALS.standing.shot);
  return pick(RADIO[r.voice].shot, `${r.id}|${flight}`);
}

/** A rival's ship destroyed where the player saw it (by raiders, say): out of the game for a while, its run lost. */
export function rivalKnockedOut(state: GameState, r: RivalDef, systemId: SystemId): void {
  (state.world.rivals ??= { down: {}, bought: {} }).down[r.id] = { at: state.clock, systemId };
}

/** A rival's ship destroyed by the player: knocked out, and it thinks much less of the player. */
export function rivalDestroyed(state: GameState, r: RivalDef, systemId: SystemId): string {
  rivalKnockedOut(state, r, systemId);
  shift(state, r.id, RIVALS.standing.destroyed);
  return pick(RADIO[r.voice].down, `${r.id}|${state.clock}`);
}

/** What a rival says over the radio when the player meets it in flight. */
export function rivalHello(state: GameState, r: RivalDef, hostile: boolean): string {
  const tier = rivalTier(state, r.id);
  const pool = hostile ? RADIO[r.voice].threat : tier === 'friendly' ? RADIO[r.voice].friend : RADIO[r.voice].hello;
  return pick(pool, `${r.id}|hello|${turnOf(state.clock)}`);
}

// ---------------------------------------------------------------- the News (§24.6)

export interface RivalNews {
  rival: RivalDef;
  text: string;
  /** When it happened (or set off, for a run still going). */
  at: number;
  jumps: number;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

/** What the rivals did within news reach of a system lately, newest first. */
export function rivalNews(systemId: SystemId, clock: number): RivalNews[] {
  if (turnOf(clock) < 0) return [];
  const near = jumpsFrom(WORLD.links, systemId);
  const reach = (locationId: string) => near.get(getLocation(locationId).systemId) ?? 99;
  const out: RivalNews[] = [];
  const since = clock - RIVALS.news.recent;
  for (const r of ROSTER) {
    const name = rivalName(r);
    const d = downOf(r);
    if (d && d.at <= clock && d.at >= since && (near.get(d.systemId) ?? 99) <= RIVALS.news.jumps) {
      out.push({ rival: r, at: d.at, jumps: near.get(d.systemId)!, text: fill(pick(NEWS.down, `${r.id}|${d.at}`), { rival: name, ship: r.shipName, system: getSystem(d.systemId).displayName, home: getLocation(r.home).name }) });
    }
    for (let n = Math.max(0, turnOf(since) - 1); n <= turnOf(clock); n++) {
      const run = runOf(r, n);
      if (!run || run.lostAt !== undefined) continue;
      const values = { rival: name, good: run.commodity ? COMMODITIES[run.commodity].name.toLowerCase() : '', from: getLocation(run.from).name, to: getLocation(run.to).name };
      if (run.kind === 'hunt') {
        const c = run.claim!;
        if (c.at <= clock && c.at >= since && reach(c.giver) <= RIVALS.news.jumps) {
          out.push({ rival: r, at: c.at, jumps: reach(c.giver), text: fill(pick(NEWS.hunt, run.id), { rival: name, target: huntTarget(c.contract), where: getLocation(c.giver).name }) });
        }
      } else if (run.kind === 'race') {
        if (run.depart > clock || reach(run.to) > RIVALS.news.jumps) continue;
        const over = run.arrive <= clock;
        if (over && run.arrive < since) continue;
        const pool = !over ? NEWS.race : raceCounts(run) ? NEWS.raced : NEWS.beaten;
        out.push({ rival: r, at: over ? run.arrive : run.depart, jumps: reach(run.to), text: fill(pick(pool, run.id), values) });
      } else if (run.kind === 'trade') {
        if (run.depart > clock || Math.min(reach(run.to), reach(run.from)) > RIVALS.news.jumps) continue;
        const over = run.arrive <= clock;
        if (over && run.arrive < since) continue;
        out.push({ rival: r, at: over ? run.arrive : run.depart, jumps: Math.min(reach(run.to), reach(run.from)), text: fill(pick(over ? NEWS.trade : NEWS.tradeOn, run.id), values) });
      }
    }
  }
  out.push(...storyNews(clock, near));
  return out.sort((a, b) => b.at - a.at || a.rival.id.localeCompare(b.rival.id));
}

/**
 * The News of rivals' stories (docs/PROCGEN.md §28): a rescue or a tow after a drive failure, a duel
 * called (while it is open), and how it went, within news reach of where it happened, lately.
 */
function storyNews(clock: number, near: Map<SystemId, number>): RivalNews[] {
  const out: RivalNews[] = [];
  const stories = activeRivalLog()?.stories;
  if (!stories) return out;
  const since = clock - RIVALS.news.recent;
  for (const r of ROSTER) {
    const s = stories[r.id];
    if (!s) continue;
    const add = (kind: StoryNewsKind, at: number, systemId: SystemId, open = false) => {
      const jumps = near.get(systemId) ?? 99;
      if (at > clock || (!open && at < since) || jumps > RIVALS.news.jumps) return;
      out.push({ rival: r, at, jumps, text: fill(pick(STORY_NEWS[kind], `${r.id}|${kind}|${at}`), { rival: rivalName(r), ship: r.shipName, system: getSystem(systemId).displayName }) });
    };
    const deed = s.deed;
    if (s.path === 'friend' && deed?.kind === 'rescue' && deed.systemId && deed.end !== undefined) {
      if (deed.done) add('rescued', deed.end, deed.systemId);
      else if (s.ended?.how === 'towed') add('towed', deed.end, deed.systemId);
    }
    if (s.path === 'enemy' && s.duel) {
      const sys = duelSystem(r);
      const how = s.ended?.how;
      if (!s.ended) add('challenge', s.duel.posted, sys, clock < s.duel.posted + RIVAL_STORY.enemy.duel.open);
      else if (how === 'won') add('rivalLost', s.ended.at, sys);
      else if (how === 'lost' || how === 'forfeit') add('rivalWon', s.ended.at, sys);
      else if (how === 'no-show') add('noShow', s.ended.at, sys);
    }
  }
  return out;
}
