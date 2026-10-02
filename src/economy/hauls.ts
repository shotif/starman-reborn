import type { HaulRecord } from '../app/state.ts';
import { COMMODITIES, type CommodityId } from '../content/economy/goods.ts';
import { HAULER_NAMES, HAULS } from '../content/economy/hauls.ts';
import { ECONOMY } from '../content/economy/rules.ts';
import { EVENTS } from '../content/events/rules.ts';
import { rng } from '../content/random.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, WORLD } from '../data/systems.ts';
import type { FictionalLocation, SystemId } from '../data/types.ts';
import { FLEETS } from '../world/traffic/plan.ts';
import { activeHaulLog, eventEnd, stationEventById, stationEventsBetween, systemEventAt, systemEventsBetween, type WorldEvent } from './events.ts';
import { marketTables } from './markets.ts';
import { rivalRelief } from './rivals.ts';

/**
 * Haulers on the lanes (docs/PROCGEN.md §21). The stations send each other freight as ships with
 * names, cargo and a timetable: every open station that makes goods may send a haul in each time
 * slot, to a station within reach that takes them; a shortage draws relief from the nearest
 * stations that make what it lacks, and a glut ships its surplus out to the nearest that take it.
 * A haul in a raided system's lanes may be lost, unless the player escorts it. All of it is a
 * function of the seed, the clock and the save's world log (which keeps what became of the hauls
 * the player saw, and those the player escorts); FlightSession flies the ones in the player's system.
 */

export type HaulLegKind = 'out' | 'transit' | 'in' | 'local';

/** A stretch of a haul's way inside one system: from a dock or the arrival point, to a dock or the jump beacon. */
export interface HaulLeg {
  systemId: SystemId;
  kind: HaulLegKind;
  start: number;
  end: number;
}

export interface Haul {
  /** `h.<station>.<slot>` for trade, `h.<event id>.<k>` for a shortage's relief or a glut's shipment. */
  id: string;
  kind: 'trade' | 'relief' | 'shipment';
  name: string;
  /** Catalogue ship id. */
  model: string;
  faction: 'sta' | 'frontier' | 'independent';
  from: string;
  to: string;
  commodity: CommodityId;
  qty: number;
  /** Systems on its way, its origin's first. */
  path: readonly SystemId[];
  legs: readonly HaulLeg[];
  depart: number;
  arrive: number;
  /** The shortage it relieves. */
  relief?: string;
  /** The glut (or harvest) it ships out of. */
  glut?: string;
}

/**
 * What becomes of a haul: delivered at `at`, or lost at `at` (in a raided system's lanes, or in the
 * player's sight). One waiting for the player's escort, or under it, has neither yet (`escort`,
 * delivered at Infinity).
 */
export interface HaulFate {
  delivered: boolean;
  at: number;
  lostIn?: SystemId;
  by?: 'raiders' | 'player';
  escort?: true;
}

// ---------------------------------------------------------------- places and ways

const isOpen = (l: FictionalLocation) => l.status === 'functional' && l.dockable !== false && l.stationType !== 'pirate-den';
const security = (systemId: SystemId) => WORLD.profiles.get(systemId)?.security ?? 1;

let senders: FictionalLocation[] | null = null;
/** Open stations with a market that make goods worth sending (no contraband). */
export function haulSenders(): readonly FictionalLocation[] {
  senders ??= ALL_LOCATIONS.filter((l) => isOpen(l) && made(l.id).length > 0).sort((a, b) => (a.id < b.id ? -1 : 1));
  return senders;
}

const madeCache = new Map<string, CommodityId[]>();
/** The lawful goods a station makes (none at a closed one). */
export function made(locationId: string): CommodityId[] {
  let out = madeCache.get(locationId);
  if (!out) {
    const t = marketTables().get(locationId);
    out = t ? [...t.entries.values()].filter((e) => e.role === 'produce' && COMMODITIES[e.commodity].category !== 'contraband').map((e) => e.commodity).sort() : [];
    madeCache.set(locationId, out);
  }
  return out;
}

const pathCache = new Map<SystemId, Map<SystemId, SystemId[]>>();
/**
 * The shortest ways from a system, by jumps, to every system within `HAULS.relief.maxJumps` (the
 * haulers' drives reach the frontier's long lanes). Ties go to the first lane in name order, so
 * every device finds the same way.
 */
export function waysFrom(systemId: SystemId): ReadonlyMap<SystemId, SystemId[]> {
  let ways = pathCache.get(systemId);
  if (ways) return ways;
  ways = new Map([[systemId, [systemId]]]);
  let ring = [systemId];
  for (let d = 0; d < Math.max(HAULS.maxJumps, HAULS.relief.maxJumps) && ring.length; d++) {
    const next: SystemId[] = [];
    for (const s of ring) {
      for (const n of [...(WORLD.links.get(s) ?? [])].sort()) {
        if (ways.has(n)) continue;
        ways.set(n, [...ways.get(s)!, n]);
        next.push(n);
      }
    }
    ring = next;
  }
  pathCache.set(systemId, ways);
  return ways;
}

const takerCache = new Map<string, FictionalLocation[]>();
/** Where a station's `commodity` can go: open stations within `HAULS.maxJumps` that use or trade it, nearest first. */
export function takersOf(from: FictionalLocation, commodity: CommodityId): readonly FictionalLocation[] {
  const key = `${from.id}|${commodity}`;
  let out = takerCache.get(key);
  if (!out) {
    const ways = waysFrom(from.systemId);
    const tables = marketTables();
    out = ALL_LOCATIONS.filter((l) => {
      const way = ways.get(l.systemId);
      const e = tables.get(l.id)?.entries.get(commodity);
      return l.id !== from.id && isOpen(l) && !!way && way.length - 1 <= HAULS.maxJumps && !!e && e.role !== 'produce';
    }).sort((a, b) => ways.get(a.systemId)!.length - ways.get(b.systemId)!.length || (a.id < b.id ? -1 : 1));
    takerCache.set(key, out);
  }
  return out;
}

/** Stations that make `commodity` within `jumps` of a station, nearest first. */
export function makersNear(to: FictionalLocation, commodity: CommodityId, jumps: number): FictionalLocation[] {
  const ways = waysFrom(to.systemId);
  return haulSenders()
    .filter((l) => l.id !== to.id && made(l.id).includes(commodity) && (ways.get(l.systemId)?.length ?? 99) - 1 <= jumps)
    .sort((a, b) => ways.get(a.systemId)!.length - ways.get(b.systemId)!.length || (a.id < b.id ? -1 : 1));
}

/** The legs of a way through `path`, setting off at `depart`. */
export function legsOf(path: readonly SystemId[], depart: number): HaulLeg[] {
  const L = HAULS.legs;
  if (path.length === 1) return [{ systemId: path[0]!, kind: 'local', start: depart, end: depart + L.local }];
  const legs: HaulLeg[] = [{ systemId: path[0]!, kind: 'out', start: depart, end: depart + L.dock }];
  let t = depart + L.dock;
  for (let i = 1; i < path.length; i++) {
    t += EVENTS.jumpSeconds;
    const last = i === path.length - 1;
    const length = last ? L.dock : L.transit;
    legs.push({ systemId: path[i]!, kind: last ? 'in' : 'transit', start: t, end: t + length });
    t += length;
  }
  return legs;
}

function owner(l: FictionalLocation): Haul['faction'] {
  return l.factionId === 'sta' || l.factionId === 'frontier' ? l.factionId : 'independent';
}

function ship(r: ReturnType<typeof rng>, faction: Haul['faction']): string {
  const fleet = FLEETS[faction].traders.length ? FLEETS[faction].traders : FLEETS.independent.traders;
  return r.pick(fleet);
}

function load(to: string, commodity: CommodityId): number {
  const target = marketTables().get(to)?.entries.get(commodity)?.target ?? 0;
  return Math.max(HAULS.load.min, Math.min(HAULS.load.max, Math.round(target * HAULS.load.share)));
}

const raided = (systemId: SystemId, clock: number) => systemEventAt(systemId, clock)?.kind === 'raid';

// ---------------------------------------------------------------- the timetable

const tradeCache = new Map<string, Haul | null>();
/** The haul a station sends in a time slot, if it sends one. */
export function tradeHaul(stationId: string, slot: number): Haul | null {
  const key = `${stationId}|${slot}`;
  if (tradeCache.has(key)) return tradeCache.get(key)!;
  const haul = makeTradeHaul(stationId, slot);
  if (tradeCache.size > 40_000) tradeCache.clear();
  tradeCache.set(key, haul);
  return haul;
}

function makeTradeHaul(stationId: string, slot: number): Haul | null {
  const from = getLocation(stationId);
  const goods = made(stationId);
  if (!isOpen(from) || !goods.length) return null;
  const r = rng(WORLD_SEED, 'haul', stationId, slot);
  if (r.next() >= HAULS.send.base + HAULS.send.perSecurity * security(from.systemId)) return null;
  const commodity = r.pick(goods);
  const takers = takersOf(from, commodity);
  if (!takers.length) return null;
  // Nearer stations get more of the trade.
  const ways = waysFrom(from.systemId);
  const weights = takers.map((t) => 1 / ways.get(t.systemId)!.length);
  let x = r.next() * weights.reduce((a, b) => a + b, 0);
  let to = takers[takers.length - 1]!;
  for (let i = 0; i < takers.length; i++) {
    x -= weights[i]!;
    if (x < 0) {
      to = takers[i]!;
      break;
    }
  }
  const depart = slot * HAULS.slotSeconds + Math.round(r.range(0, HAULS.slotSeconds));
  // Nobody sends a hauler out of a raided system, or into one.
  if (HAULS.avoidRaids && (raided(from.systemId, depart) || raided(to.systemId, depart))) return null;
  const path = ways.get(to.systemId)!;
  const legs = legsOf(path, depart);
  const faction = owner(from);
  return {
    id: `h.${stationId}.${slot}`,
    kind: 'trade',
    name: r.pick(HAULER_NAMES),
    model: ship(r, faction),
    faction,
    from: stationId,
    to: to.id,
    commodity,
    qty: load(to.id, commodity),
    path,
    legs,
    depart,
    arrive: legs.at(-1)!.end,
  };
}

const reliefCache = new Map<string, Haul[]>();
/** The relief a shortage draws: hauls from the nearest stations that make what it lacks (none to a raider den, or a closed dock). */
export function reliefHauls(e: WorldEvent): readonly Haul[] {
  if (e.kind !== 'shortage' || !e.locationId || !isOpen(getLocation(e.locationId))) return [];
  let out = reliefCache.get(e.id);
  if (out) return out;
  const to = getLocation(e.locationId);
  const commodity = e.goods[0]!;
  const R = HAULS.relief;
  const lacks = shortfall(e);
  out = makersNear(to, commodity, R.maxJumps)
    .slice(0, R.hauls)
    .map((from, k) => {
      const r = rng(WORLD_SEED, 'relief', e.id, k);
      const depart = e.start + Math.round(r.range(R.dispatch[0], R.dispatch[1]));
      // Back from the shortage's station, the way from the maker is the same way reversed.
      const path = [...waysFrom(to.systemId).get(from.systemId)!].reverse();
      const legs = legsOf(path, depart);
      const faction = owner(from);
      return {
        id: `h.${e.id}.${k}`,
        kind: 'relief' as const,
        name: r.pick(HAULER_NAMES),
        model: ship(r, faction),
        faction,
        from: from.id,
        to: to.id,
        commodity,
        qty: Math.max(HAULS.load.min, Math.round(lacks * R.share)),
        path,
        legs,
        depart,
        arrive: legs.at(-1)!.end,
        relief: e.id,
      };
    });
  if (reliefCache.size > 4_000) reliefCache.clear();
  reliefCache.set(e.id, out);
  return out;
}

/** How many units of its good a shortage leaves a station short of. */
export function shortfall(e: WorldEvent): number {
  if (!e.locationId) return 0;
  return e.goods.reduce((sum, c) => sum + (marketTables().get(e.locationId!)?.entries.get(c)?.target ?? 0) * Math.max(0, 1 - e.stock), 0);
}

/** Whether an event ships its surplus out (docs/PROCGEN.md §21.6): a glut, or a frontier harvest. */
export const shipsOut = (e: Pick<WorldEvent, 'kind'>): boolean => e.kind === 'glut' || e.kind === 'harvest';

/** How many units of its good (a harvest's first) a glut leaves a station with beyond its normal stock. */
export function surplus(e: WorldEvent): number {
  const good = e.goods[0];
  if (!e.locationId || !good || !shipsOut(e)) return 0;
  return (marketTables().get(e.locationId)?.entries.get(good)?.target ?? 0) * Math.max(0, e.stock - 1);
}

const shipmentCache = new Map<string, Haul[]>();
/**
 * What a glut ships out (docs/PROCGEN.md §21.6): hauls to the nearest stations within reach that use
 * or trade its good, a different one each while there are, each with a share of the surplus. One
 * that would set off after the glut was due to end is not sent.
 */
export function shipments(e: WorldEvent): readonly Haul[] {
  if (!shipsOut(e) || !e.locationId || !e.goods[0]) return [];
  let out = shipmentCache.get(e.id);
  if (out) return out;
  const from = getLocation(e.locationId);
  const commodity = e.goods[0];
  const S = HAULS.shipOut;
  const takers = takersOf(from, commodity);
  const qty = Math.max(HAULS.load.min, Math.round(surplus(e) * S.share));
  out = [];
  if (isOpen(from) && takers.length && made(from.id).includes(commodity)) {
    for (let k = 0; k < S.hauls; k++) {
      const r = rng(WORLD_SEED, 'ship-out', e.id, k);
      const depart = e.start + Math.round(r.range(S.dispatch[0], S.dispatch[1]));
      if (depart >= e.end) continue;
      const to = takers[k % takers.length]!;
      const path = waysFrom(from.systemId).get(to.systemId)!;
      const legs = legsOf(path, depart);
      const faction = owner(from);
      out.push({
        id: `h.${e.id}.${k}`,
        kind: 'shipment',
        name: r.pick(HAULER_NAMES),
        model: ship(r, faction),
        faction,
        from: from.id,
        to: to.id,
        commodity,
        qty,
        path,
        legs,
        depart,
        arrive: legs.at(-1)!.end,
        glut: e.id,
      });
    }
  }
  if (shipmentCache.size > 4_000) shipmentCache.clear();
  shipmentCache.set(e.id, out);
  return out;
}

/** The hauls a station event sends: a shortage's relief, or a glut's shipments. */
export function eventHauls(e: WorldEvent): readonly Haul[] {
  return e.kind === 'shortage' ? reliefHauls(e) : shipsOut(e) ? shipments(e) : [];
}

/** Units of its good a glut has shipped out by a moment (its cargo leaves as each sets off). */
export function shippedOut(e: WorldEvent, clock: number): number {
  let sum = 0;
  for (const h of shipments(e)) if (h.depart <= clock) sum += h.qty;
  return sum;
}

/** When a glut's shipments between them have carried off what clears it (EVENTS.react.relief of its surplus), or Infinity. */
export function shipOutEnd(e: WorldEvent): number {
  const need = surplus(e) * EVENTS.react.relief;
  let sum = 0;
  for (const h of [...shipments(e)].sort((a, b) => a.depart - b.depart)) {
    sum += h.qty;
    if (need > 0 && sum >= need - 1e-9) return h.depart;
  }
  return Infinity;
}

/** The longest a haul takes from setting off to docking (relief included). */
const LONGEST = HAULS.legs.dock * 2 + (HAULS.relief.maxJumps - 1) * HAULS.legs.transit + HAULS.relief.maxJumps * EVENTS.jumpSeconds;
/** The latest an event's hauls set off after it starts (relief or shipments). */
const EVENT_DISPATCH = Math.max(HAULS.relief.dispatch[1], HAULS.shipOut.dispatch[1]);

const sendersNear = new Map<SystemId, FictionalLocation[]>();
function sendersWithin(systemId: SystemId, jumps: number): FictionalLocation[] {
  const key = `${systemId}|${jumps}` as SystemId;
  let out = sendersNear.get(key);
  if (!out) {
    const ways = waysFrom(systemId);
    out = haulSenders().filter((l) => (ways.get(l.systemId)?.length ?? 99) - 1 <= jumps);
    sendersNear.set(key, out);
  }
  return out;
}

const marketsNear = new Map<SystemId, string[]>();
/** Stations with a market within relief reach of a system (where a shortage could send relief through it). */
function marketsWithin(systemId: SystemId): string[] {
  let out = marketsNear.get(systemId);
  if (!out) {
    const ways = waysFrom(systemId);
    out = [...marketTables().keys()].filter((l) => (ways.get(getLocation(l).systemId)?.length ?? 99) - 1 <= HAULS.relief.maxJumps);
    marketsNear.set(systemId, out);
  }
  return out;
}

/** Trade hauls with any part of their way between `from` and `to` in `systemId`. */
function tradeHaulsNear(systemId: SystemId, from: number, to: number): Haul[] {
  const out: Haul[] = [];
  const first = Math.floor((from - LONGEST) / HAULS.slotSeconds);
  const last = Math.floor(to / HAULS.slotSeconds);
  for (const s of sendersWithin(systemId, HAULS.maxJumps)) {
    for (let slot = first; slot <= last; slot++) {
      const h = tradeHaul(s.id, slot);
      if (h && h.depart <= to && h.arrive >= from && h.path.includes(systemId)) out.push(h);
    }
  }
  return out;
}

/** Every haul with any part of its way between `from` and `to` in `systemId` (trade, relief and shipments). */
function haulsNear(systemId: SystemId, from: number, to: number): Haul[] {
  const out = tradeHaulsNear(systemId, from, to);
  // Relief for shortages, and shipments out of gluts, within reach that started recently enough to be on their way.
  for (const l of marketsWithin(systemId)) {
    for (const e of stationEventsBetween(l, from - LONGEST - EVENT_DISPATCH, to)) {
      for (const h of eventHauls(e)) if (h.depart <= to && h.arrive >= from && h.path.includes(systemId)) out.push(h);
    }
  }
  return out;
}

// ---------------------------------------------------------------- what becomes of them

/** The record of a haul the player saw, if any. */
function seen(id: string): HaulRecord | undefined {
  return activeHaulLog()?.[id];
}

/**
 * What becomes of a haul: lost where the player destroyed it or saw it destroyed; lost in a raided
 * system's lanes by the raid's odds (unless the player saw it through that system); else delivered.
 */
export function haulFate(h: Haul): HaulFate {
  const rec = seen(h.id);
  if (rec?.fate === 'lost') return { delivered: false, at: rec.at, lostIn: rec.systemId, by: rec.by ?? 'raiders' };
  // Escorted by the player (docs/PROCGEN.md §21.7): in when the escort saw it docked; until then, waiting or under way with it.
  if (rec?.fate === 'arrived') return { delivered: true, at: rec.at };
  if (rec?.fate === 'escort') return { delivered: true, at: Infinity, escort: true };
  for (const leg of h.legs) {
    if (rec?.fate === 'safe' && rec.systemId === leg.systemId) continue;
    const mid = (leg.start + leg.end) / 2;
    const raid = systemEventAt(leg.systemId, mid);
    if (raid?.kind !== 'raid' || !raid.level) continue;
    if (rolledLost(h, leg.systemId, raid.level)) return { delivered: false, at: mid, lostIn: leg.systemId, by: 'raiders' };
  }
  return { delivered: true, at: h.arrive };
}

/** A haul in the player's system: which leg of its way, and how far along it (0–1). */
export interface HaulHere {
  haul: Haul;
  leg: HaulLeg;
  progress: number;
}

/**
 * The hauls flying in a system at a moment (not lost by then), relief and shipments first, for the
 * flight scene. One the player escorts flies with the player instead, never on its timetable.
 */
export function haulsIn(systemId: SystemId, clock: number): HaulHere[] {
  const out: HaulHere[] = [];
  for (const h of haulsNear(systemId, clock, clock)) {
    const leg = h.legs.find((l) => l.systemId === systemId && clock >= l.start && clock < l.end);
    if (!leg) continue;
    const fate = haulFate(h);
    if (fate.escort || (fate.at <= clock && (!fate.delivered || fate.at < h.arrive))) continue;
    out.push({ haul: h, leg, progress: (clock - leg.start) / (leg.end - leg.start) });
  }
  // Relief and shipments first (the haulers the news speaks of), then in timetable order.
  return out.sort((a, b) => Number(b.haul.kind !== 'trade') - Number(a.haul.kind !== 'trade') || (a.haul.id < b.haul.id ? -1 : 1));
}

/** The relief a shortage has had by a moment: units delivered by hauls (and rival runners, §24) that arrived. */
export function reliefDelivered(e: WorldEvent, clock: number): number {
  let sum = 0;
  for (const a of arrivals(e, true)) if (a.at <= clock) sum += a.qty;
  return sum;
}

/** Relief arriving for a shortage, soonest first: its hauls that get there, and (with `rivals`) the rival runners' cargo. */
function arrivals(e: WorldEvent, rivals: boolean): { at: number; qty: number }[] {
  const out = reliefHauls(e)
    .map((h) => ({ h, fate: haulFate(h) }))
    .filter((x) => x.fate.delivered)
    .map((x) => ({ at: x.fate.at, qty: x.h.qty }));
  if (rivals) out.push(...rivalRelief(e));
  return out.sort((a, b) => a.at - b.at);
}

function endOf(e: WorldEvent, rivals: boolean): number {
  const need = shortfall(e) * EVENTS.react.relief;
  let sum = 0;
  for (const a of arrivals(e, rivals)) {
    sum += a.qty;
    if (need > 0 && sum >= need - 1e-9) return a.at;
  }
  return Infinity;
}

/** When a shortage's relief between them brings what ends it (EVENTS.react.relief of what it lacks), or Infinity. */
export function reliefEnd(e: WorldEvent): number {
  return endOf(e, true);
}

/** When the haulers' relief alone would end a shortage (what a rival runner weighs before it races), or Infinity. */
export function haulReliefEnd(e: WorldEvent): number {
  return endOf(e, false);
}

// ---------------------------------------------------------------- news

/** A shortage's relief, or a glut's shipments, as the news tells them: each haul, and what becomes of it. */
export function reliefNews(e: WorldEvent): { haul: Haul; fate: HaulFate }[] {
  return eventHauls(e).map((haul) => ({ haul, fate: haulFate(haul) }));
}

/**
 * Hauls lost to raiders within news reach (HAULS.news) over the last while, newest first: in the
 * lanes of a raided system, or destroyed by raiders where the player saw it.
 */
export function haulsLostNear(systemId: SystemId, clock: number): { haul: Haul; fate: HaulFate; jumps: number }[] {
  const { jumps: reach, recent, max } = HAULS.news;
  const near = jumpsFrom(WORLD.links, systemId);
  const out: { haul: Haul; fate: HaulFate; jumps: number }[] = [];
  const seenIds = new Set<string>();
  for (const [s, jumps] of near) {
    if (jumps > reach) continue;
    // Raids last longer than the news remembers, so a raid at either end of the window, or between, is found.
    const raids = [clock - recent, clock - recent / 2, clock].some((t) => systemEventAt(s, t)?.kind === 'raid');
    const logged = Object.values(activeHaulLog() ?? {}).some((r) => r.fate === 'lost' && r.by === 'raiders' && r.systemId === s);
    if (!raids && !logged) continue;
    for (const haul of haulsNear(s, clock - recent, clock)) {
      if (seenIds.has(haul.id)) continue;
      const fate = haulFate(haul);
      if (fate.delivered || fate.by !== 'raiders' || fate.lostIn !== s || fate.at > clock || fate.at < clock - recent) continue;
      seenIds.add(haul.id);
      out.push({ haul, fate, jumps });
    }
  }
  return out.sort((a, b) => b.fate.at - a.fate.at).slice(0, max);
}

// ---------------------------------------------------------------- markets

const TAU = ECONOMY.recoverySeconds;
/** How far back a haul still moves a market (its effect fades with the market's recovery). */
const FELT = TAU * 3;

const fade = (since: number) => (since < 0 ? 0 : Math.exp(-since / TAU));

/** The raid's loss roll for a haul in its lanes (the same roll haulFate makes). */
function rolledLost(h: Haul, systemId: SystemId, level: 1 | 2 | 3): boolean {
  return rng(WORLD_SEED, 'haul-loss', h.id, systemId).next() < HAULS.raidLoss[level];
}

const raidLossCache = new Map<string, Map<string, Haul[]>>();
/** Trade hauls a raid's odds go against in its lanes, by where they were bound (haulFate has the last word). */
function lostToRaid(raid: WorldEvent): ReadonlyMap<string, Haul[]> {
  let out = raidLossCache.get(raid.id);
  if (!out) {
    out = new Map();
    for (const h of tradeHaulsNear(raid.systemId, raid.start, raid.end)) {
      const leg = h.legs.find((l) => l.systemId === raid.systemId)!;
      const mid = (leg.start + leg.end) / 2;
      if (mid < raid.start || mid >= raid.end || !rolledLost(h, raid.systemId, raid.level!)) continue;
      out.set(h.to, [...(out.get(h.to) ?? []), h]);
    }
    if (raidLossCache.size > 2_000) raidLossCache.clear();
    raidLossCache.set(raid.id, out);
  }
  return out;
}

const raidsCache = new Map<string, WorldEvent[]>();
/** Looked up by the hour: the raids around a system over an hour and the time before it that a lost haul is felt. */
const RAID_BUCKET = 3_600;
/** Raids within a haul's reach of a system over the time a lost haul is still felt there, around a moment (a few more). */
function raidsAround(systemId: SystemId, clock: number): WorldEvent[] {
  const bucket = Math.floor(clock / RAID_BUCKET);
  const key = `${systemId}|${bucket}`;
  let out = raidsCache.get(key);
  if (!out) {
    const to = (bucket + 1) * RAID_BUCKET;
    out = [];
    for (const [s, way] of waysFrom(systemId)) {
      if (way.length - 1 > HAULS.maxJumps) continue;
      for (const e of systemEventsBetween(s, to - RAID_BUCKET - FELT - LONGEST, to)) if (e.kind === 'raid' && e.level) out.push(e);
    }
    if (raidsCache.size > 8_000) raidsCache.clear();
    raidsCache.set(key, out);
  }
  return out;
}

/** The haul with this id: a station's trade haul (`h.<station>.<slot>`), or an event's relief or shipment (`h.<event id>.<k>`). */
export function haulById(id: string): Haul | null {
  const dot = id.lastIndexOf('.');
  const head = id.slice(2, dot);
  const n = Number(id.slice(dot + 1));
  if (!id.startsWith('h.') || !Number.isInteger(n)) return null;
  if (head.startsWith('e.')) {
    const e = stationEventById(head);
    return (e && eventHauls(e).find((h) => h.id === id)) ?? null;
  }
  return marketTables().has(head) ? tradeHaul(head, n) : null;
}

let shipIndex: Map<string, string[]> | null = null;
/**
 * The stations whose gluts can ship to a station: it is among the nearest takers of a good they
 * make (`shipments` sends to those). Worked out once, from the market tables and the lanes.
 */
function shipSources(locationId: string): readonly string[] {
  if (!shipIndex) {
    const index = new Map<string, string[]>();
    for (const from of haulSenders()) {
      for (const good of made(from.id)) {
        for (const to of takersOf(from, good).slice(0, HAULS.shipOut.hauls)) {
          const list = index.get(to.id) ?? [];
          if (!list.includes(from.id)) list.push(from.id);
          index.set(to.id, list);
        }
      }
    }
    shipIndex = index;
  }
  return shipIndex.get(locationId) ?? [];
}

const shipmentsToCache = new Map<string, Haul[]>();
/** Shipments out of gluts bound for a station that may still be felt there around a moment (looked up by the hour). */
function shipmentsTo(locationId: string, clock: number): Haul[] {
  const bucket = Math.floor(clock / RAID_BUCKET);
  const key = `${locationId}|${bucket}`;
  let out = shipmentsToCache.get(key);
  if (!out) {
    const to = (bucket + 1) * RAID_BUCKET;
    out = [];
    for (const l of shipSources(locationId)) {
      for (const e of stationEventsBetween(l, to - RAID_BUCKET - FELT - LONGEST - EVENT_DISPATCH, to)) {
        for (const h of shipments(e)) if (h.to === locationId) out.push(h);
      }
    }
    if (shipmentsToCache.size > 8_000) shipmentsToCache.clear();
    shipmentsToCache.set(key, out);
  }
  return out;
}

/**
 * Stock the hauls move at a station (docs/PROCGEN.md §21.3, §21.6), fading as its market recovers:
 * the relief that arrived for a shortage adds its cargo while it lasts; a glut's shipments take
 * theirs away as they set off while it lasts, and add it where they arrive; and a trade haul bound
 * here that was lost (in a raid's lanes, or where the player saw it destroyed) is missed. The rest
 * of the trade is the market's normal flow, already in its prices.
 */
export function haulStock(locationId: string, commodity: CommodityId, clock: number): number {
  let total = 0;
  const role = marketTables().get(locationId)?.entries.get(commodity)?.role;
  // Only what a station uses runs short (economy/events.ts), so only that draws relief; only what it makes runs over.
  if (role === 'consume' || role === 'produce') {
    for (const e of stationEventsBetween(locationId, clock - FELT - LONGEST - EVENT_DISPATCH, clock)) {
      // Once the event is over, its normal stock is back: what its hauls brought or took is part of that.
      if (e.goods[0] !== commodity || eventEnd(e) <= clock) continue;
      if (e.kind === 'shortage' && role === 'consume') {
        for (const h of reliefHauls(e)) {
          const fate = haulFate(h);
          if (fate.delivered && fate.at <= clock) total += h.qty * fade(clock - fate.at);
        }
      } else if (shipsOut(e) && role === 'produce') {
        for (const h of shipments(e)) if (h.depart <= clock) total -= h.qty * fade(clock - h.depart);
      }
    }
  }
  // A glut's surplus where it lands.
  if (role && role !== 'produce') {
    for (const h of shipmentsTo(locationId, clock)) {
      if (h.commodity !== commodity) continue;
      const fate = haulFate(h);
      if (fate.delivered && fate.at <= clock && clock - fate.at <= FELT) total += h.qty * fade(clock - fate.at);
    }
  }
  const missed = new Set<string>();
  const miss = (h: Haul | null) => {
    if (!h || h.kind !== 'trade' || h.to !== locationId || h.commodity !== commodity || h.arrive > clock || clock - h.arrive > FELT || missed.has(h.id)) return;
    if (haulFate(h).delivered) return;
    missed.add(h.id);
    total -= h.qty * fade(clock - h.arrive);
  };
  for (const raid of raidsAround(getLocation(locationId).systemId, clock)) for (const h of lostToRaid(raid).get(locationId) ?? []) miss(h);
  for (const [id, r] of Object.entries(activeHaulLog() ?? {})) if (r.fate === 'lost') miss(haulById(id));
  return total;
}

// ---------------------------------------------------------------- the world log

/**
 * Writes what became of a haul the player saw (`safe` through this system, or `lost`), or one the
 * player escorts, and forgets old records (never one still waiting for its escort). A lost haul stays lost.
 */
export function recordHaul(log: { hauls?: Record<string, HaulRecord> }, id: string, rec: HaulRecord): void {
  const all = (log.hauls ??= {});
  if (all[id]?.fate === 'lost') return;
  all[id] = rec;
  for (const [k, r] of Object.entries(all)) if (r.fate !== 'escort' && rec.at - r.at > HAULS.keepSeconds) delete all[k];
}

/** A haul whose escort was given up goes back to its timetable (docs/PROCGEN.md §21.7). */
export function releaseHaul(log: { hauls?: Record<string, HaulRecord> }, id: string): void {
  if (log.hauls?.[id]?.fate === 'escort') delete log.hauls[id];
}

// ---------------------------------------------------------------- escorts for relief (§21.7)

/** The raids a haul's way crosses, at the middle of its leg in each system, worst first. */
export function raidsOnWay(h: Haul): { systemId: SystemId; level: 1 | 2 | 3 }[] {
  const out: { systemId: SystemId; level: 1 | 2 | 3 }[] = [];
  for (const leg of h.legs) {
    const raid = systemEventAt(leg.systemId, (leg.start + leg.end) / 2);
    if (raid?.kind === 'raid' && raid.level) out.push({ systemId: leg.systemId, level: raid.level });
  }
  return out.sort((a, b) => b.level - a.level);
}

/**
 * The relief and shipments a station sends whose time on its board (from their event's start until
 * they are due to set off) overlaps `from`–`to`, with their events.
 */
export function eventHaulsFrom(locationId: string, from: number, to: number): { haul: Haul; event: WorldEvent }[] {
  if (!made(locationId).length) return [];
  const out: { haul: Haul; event: WorldEvent }[] = [];
  const on = (e: WorldEvent, h: Haul) => h.from === locationId && e.start < to && h.depart > from;
  for (const e of stationEventsBetween(locationId, from - EVENT_DISPATCH, to)) {
    if (shipsOut(e)) for (const h of shipments(e)) if (on(e, h)) out.push({ haul: h, event: e });
  }
  for (const l of marketsWithin(getLocation(locationId).systemId)) {
    for (const e of stationEventsBetween(l, from - EVENT_DISPATCH, to)) {
      if (e.kind === 'shortage') for (const h of reliefHauls(e)) if (on(e, h)) out.push({ haul: h, event: e });
    }
  }
  return out.sort((a, b) => (a.haul.id < b.haul.id ? -1 : 1));
}
