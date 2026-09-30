import type { CommodityId, WorldLog } from '../app/state.ts';
import { BOOMS, EVENTS, GLUT_CAUSES, SHORTAGE_CAUSES, STRIKE_CAUSES, type EventKind, type StationEventKind, type SystemEventKind } from '../content/events/rules.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { CURATED_MARKETS, ECONOMY } from '../content/economy/rules.ts';
import { hashString, rng, type Rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { ALL_LOCATIONS, getLocation, getSystem, SYSTEMS, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { trafficPlan } from '../world/traffic/plan.ts';
import { FACTIONS } from './factions.ts';
import { marketTables } from './markets.ts';

/**
 * World events (docs/PROCGEN.md §11): shortages, gluts, booms and strikes at stations, raids and
 * security sweeps in systems. Like the markets, they are a pure function of the world seed and the
 * game clock: each station and system has one time window after another, and each window holds at
 * most one event, drawn from its own random stream. Nothing runs in the background and nothing
 * needs saving; every device sees the same events at the same clock.
 */

export interface WorldEvent {
  /** `e.<station or system>.<window>`. */
  id: string;
  kind: EventKind;
  systemId: SystemId;
  /** Where a station event happens (null for system events). */
  locationId: string | null;
  /** Game-clock seconds. */
  start: number;
  end: number;
  /** Goods concerned (station events). */
  goods: readonly CommodityId[];
  /** Multipliers on the price and on the normal stock of those goods. */
  price: number;
  stock: number;
  /** Raids: the raider threat level while it lasts. */
  level: 1 | 2 | 3 | null;
  headline: string;
  detail: string;
}

const NEUTRAL = { price: 1, stock: 1 } as const;

// ---------------------------------------------------------------- where events can happen

/** Sol's stations keep their designed opening prices; elsewhere the opening goods keep theirs. */
const NO_EVENT_SYSTEMS = new Set<SystemId>(['sol']);

let jumpsFromSol: Map<SystemId, number> | null = null;
function solJumps(systemId: SystemId): number {
  jumpsFromSol ??= jumpsFrom(WORLD.links, 'sol');
  return jumpsFromSol.get(systemId) ?? 99;
}

/** Stations whose markets can have events. */
export function eventStations(): string[] {
  return [...marketTables().keys()].filter((id) => !NO_EVENT_SYSTEMS.has(getLocation(id).systemId) && getLocation(id).dockable !== false);
}

function eligibleGoods(locationId: string, roles: readonly string[]): CommodityId[] {
  const table = marketTables().get(locationId);
  if (!table) return [];
  const fixed = new Set(Object.keys(CURATED_MARKETS[locationId]?.anchors ?? {}));
  return [...table.entries.values()]
    .filter((e) => roles.includes(e.role) && e.commodity !== 'weapons' && COMMODITIES[e.commodity].category !== 'contraband' && !fixed.has(e.commodity))
    .map((e) => e.commodity);
}

/** The raider threat a system has without events (null: no packs), from the traffic rules. */
export function baseThreat(systemId: SystemId): 1 | 2 | 3 | null {
  const profile = WORLD.profiles.get(systemId);
  const here = ALL_LOCATIONS.filter((l) => l.systemId === systemId && l.status === 'functional');
  const plan = trafficPlan({
    security: profile?.security ?? 1,
    owner: profile?.owner ?? null,
    openStations: here.filter((l) => l.dockable !== false && l.services.length > 0).length,
    hasDen: here.some((l) => l.dockable === false),
    jumpsFromSol: solJumps(systemId),
  });
  return plan.packs?.level ?? null;
}

function raidEligible(systemId: SystemId): boolean {
  const security = WORLD.profiles.get(systemId)?.security ?? 1;
  return security < EVENTS.raidBelowSecurity && solJumps(systemId) >= 1 && !NO_EVENT_SYSTEMS.has(systemId);
}

function sweepEligible(systemId: SystemId): boolean {
  const owner = WORLD.profiles.get(systemId)?.owner ?? null;
  return (owner === 'sta' || owner === 'frontier') && baseThreat(systemId) !== null;
}

// ---------------------------------------------------------------- one window

const cache = new Map<string, WorldEvent | null>();
function cached(key: string, make: () => WorldEvent | null): WorldEvent | null {
  if (cache.has(key)) return cache.get(key)!;
  const e = make();
  if (cache.size > 4_000) cache.clear();
  cache.set(key, e);
  return e;
}

function pickKind<K extends string>(r: Rng, odds: Record<K, number>): K | null {
  let x = r.next();
  for (const [k, p] of Object.entries(odds) as [K, number][]) {
    if (x < p) return k;
    x -= p;
  }
  return null;
}

/**
 * Each station's and system's windows are shifted by their own phase, so the neighbourhood never
 * goes quiet all at once at a window boundary.
 */
export function windowPhase(key: string, window: number): number {
  return (hashString(`events|${key}`) % (window / 60)) * 60;
}

function windowIndex(key: string, window: number, clock: number): number {
  return Math.floor((clock + windowPhase(key, window)) / window);
}

/** Start and end inside the window, on whole minutes. */
function timing(r: Rng, key: string, window: number, index: number, duration: readonly [number, number]): { start: number; end: number } {
  const length = Math.round(r.range(duration[0], duration[1]) / 60) * 60;
  const start = index * window - windowPhase(key, window) + Math.round(r.range(0, window - length) / 60) * 60;
  return { start, end: start + length };
}

/** How much the price moves at the event's normal stock, all effects together (for the news text). */
function priceChange(price: number, stock: number): number {
  const [lo, hi] = ECONOMY.stockClamp;
  const scarcity = Math.min(hi, Math.max(lo, (1 / stock) ** ECONOMY.elasticity));
  return price * scarcity;
}

const goodName = (c: CommodityId) => COMMODITIES[c].name.toLowerCase();
function listGoods(goods: readonly CommodityId[]): string {
  const names = goods.map(goodName);
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function stationEventIn(locationId: string, index: number): WorldEvent | null {
  return cached(`s|${locationId}|${index}`, () => {
    if (NO_EVENT_SYSTEMS.has(getLocation(locationId).systemId)) return null;
    const r = rng(WORLD_SEED, 'events', locationId, index);
    const kind = pickKind<StationEventKind>(r, EVENTS.stationOdds);
    if (!kind) return null;
    const loc = getLocation(locationId);
    const fx = EVENTS.effects[kind];
    let goods: CommodityId[];
    let boom: (typeof BOOMS)[number] | null = null;
    if (kind === 'shortage') goods = eligibleGoods(locationId, ['consume']);
    else if (kind === 'glut') goods = eligibleGoods(locationId, ['produce']);
    else if (kind === 'strike') goods = eligibleGoods(locationId, ['produce']);
    else {
      const wanted = new Set(eligibleGoods(locationId, ['consume', 'trade']));
      const fits = BOOMS.filter((b) => b.goods.some((g) => wanted.has(g)));
      if (!fits.length) return null;
      boom = r.pick(fits);
      goods = boom.goods.filter((g) => wanted.has(g));
    }
    if (!goods.length) return null;
    if (kind === 'shortage' || kind === 'glut') goods = [r.pick(goods)];
    else goods = goods.slice(0, 3);
    const { start, end } = timing(r, locationId, EVENTS.stationWindow, index, EVENTS.stationDuration);
    const price = Math.round(r.range(fx.price[0], fx.price[1]) * 100) / 100;
    const change = Math.round((priceChange(price, fx.stock) - 1) * 100);
    const place = loc.name;
    let headline: string;
    let detail: string;
    switch (kind) {
      case 'shortage': {
        const g = goods[0]!;
        headline = `${place} short of ${goodName(g)}`;
        detail = `${r.pick(SHORTAGE_CAUSES[COMMODITIES[g].category])} has left ${place} short of ${goodName(g)}: it pays up to ${change}% more than usual.`;
        break;
      }
      case 'glut': {
        const g = goods[0]!;
        headline = `${place} overflowing with ${goodName(g)}`;
        detail = `${r.pick(GLUT_CAUSES)} leaves ${place} with more ${goodName(g)} than it can store: prices are down by up to ${-change}%.`;
        break;
      }
      case 'boom':
        headline = `${boom!.name} at ${place}`;
        detail = `${boom!.why.replace('{place}', place)}: ${listGoods(goods)} ${goods.length > 1 ? 'fetch' : 'fetches'} up to ${change}% more.`;
        break;
      case 'strike':
        headline = `Strike at ${place}`;
        detail = `Workers at ${place} have walked out ${r.pick(STRIKE_CAUSES)}: ${listGoods(goods)} ${goods.length > 1 ? 'are scarce and cost' : 'is scarce and costs'} up to ${change}% more.`;
        break;
    }
    return { id: `e.${locationId}.${index}`, kind, systemId: loc.systemId, locationId, start, end, goods, price, stock: fx.stock, level: null, headline, detail: capital(detail) };
  });
}

function systemEventIn(systemId: SystemId, index: number): WorldEvent | null {
  return cached(`y|${systemId}|${index}`, () => {
    const r = rng(WORLD_SEED, 'events', 'system', systemId, index);
    const kind = pickKind<SystemEventKind>(r, EVENTS.systemOdds);
    if (!kind || (kind === 'raid' && !raidEligible(systemId)) || (kind === 'sweep' && !sweepEligible(systemId))) return null;
    const { start, end } = timing(r, systemId, EVENTS.systemWindow, index, EVENTS.systemDuration);
    const name = getSystem(systemId).displayName;
    if (kind === 'raid') {
      const level = Math.min(3, (baseThreat(systemId) ?? 0) + 1) as 1 | 2 | 3;
      return {
        id: `e.${systemId}.${index}`,
        kind,
        systemId,
        locationId: null,
        start,
        end,
        goods: [],
        ...NEUTRAL,
        level,
        headline: `Raiders swarm ${name}`,
        detail: `Hollow Wake packs are out in force in ${name}: raider threat ${level} of 3, and fewer traders dare the lanes.`,
      };
    }
    const owner = WORLD.profiles.get(systemId)?.owner;
    const who = owner === 'sta' || owner === 'frontier' ? FACTIONS[owner].shortName : 'Local';
    return {
      id: `e.${systemId}.${index}`,
      kind,
      systemId,
      locationId: null,
      start,
      end,
      goods: [],
      ...NEUTRAL,
      level: null,
      headline: `Security sweep in ${name}`,
      detail: `${who} patrols have driven the raider packs out of ${name} for now.`,
    };
  });
}

// ---------------------------------------------------------------- the player's mark (docs/PROCGEN.md §17)

/**
 * Events stay a pure function of the clock, except that the player can end one early (relieving a
 * shortage, breaking a raid). The game points this at the save's world log; tests may too.
 */
let worldLog: Pick<WorldLog, 'ended'> | null = null;

export function useWorldLog(log: Pick<WorldLog, 'ended'> | null): void {
  worldLog = log;
}

/** When an event really ends: its scheduled end, or earlier if the player ended it. */
export function eventEnd(e: WorldEvent): number {
  const early = worldLog?.ended[e.id];
  return early !== undefined ? Math.min(e.end, early) : e.end;
}

/** Whether the player ended this event early. */
export function endedEarly(e: WorldEvent): boolean {
  return worldLog?.ended[e.id] !== undefined;
}

// ---------------------------------------------------------------- queries

const within = (e: WorldEvent | null, clock: number): e is WorldEvent => !!e && clock >= e.start && clock < eventEnd(e);

/** The event at a station right now, if any. */
export function stationEventAt(locationId: string, clock: number): WorldEvent | null {
  const e = stationEventIn(locationId, windowIndex(locationId, EVENTS.stationWindow, clock));
  return within(e, clock) ? e : null;
}

/** The raid or sweep in a system right now, if any. */
export function systemEventAt(systemId: SystemId, clock: number): WorldEvent | null {
  const e = systemEventIn(systemId, windowIndex(systemId, EVENTS.systemWindow, clock));
  return within(e, clock) ? e : null;
}

/** Every event under way at a moment, stations first. */
export function eventsAt(clock: number): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (const id of eventStations()) {
    const e = stationEventAt(id, clock);
    if (e) out.push(e);
  }
  for (const s of SYSTEMS) {
    const e = systemEventAt(s.id, clock);
    if (e) out.push(e);
  }
  return out;
}

/** Events under way, or over within `recent` seconds, that started by `clock`. */
export function eventsSince(clock: number, recent: number): WorldEvent[] {
  const out: WorldEvent[] = [];
  const keep = (e: WorldEvent | null) => {
    if (e && e.start <= clock && eventEnd(e) > clock - recent) out.push(e);
  };
  for (const id of eventStations()) {
    const w = windowIndex(id, EVENTS.stationWindow, clock);
    keep(stationEventIn(id, w - 1));
    keep(stationEventIn(id, w));
  }
  for (const s of SYSTEMS) {
    const w = windowIndex(s.id, EVENTS.systemWindow, clock);
    keep(systemEventIn(s.id, w - 1));
    keep(systemEventIn(s.id, w));
  }
  return out;
}

/** Events that start after `from` and by `to` (what the bars hear before the news does). */
export function eventsStarting(from: number, to: number): WorldEvent[] {
  const out: WorldEvent[] = [];
  const keep = (e: WorldEvent | null) => {
    if (e && e.start > from && e.start <= to) out.push(e);
  };
  for (const id of eventStations()) {
    const w = windowIndex(id, EVENTS.stationWindow, from);
    keep(stationEventIn(id, w));
    keep(stationEventIn(id, w + 1));
  }
  for (const s of SYSTEMS) {
    const w = windowIndex(s.id, EVENTS.systemWindow, from);
    keep(systemEventIn(s.id, w));
    keep(systemEventIn(s.id, w + 1));
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface NewsItem {
  event: WorldEvent;
  jumps: number;
  active: boolean;
  /** The player ended it early (a shortage relieved, a raid broken). */
  endedEarly: boolean;
}

/** News at a system: events within reach (EVENTS.newsJumps), under way or recently over, nearest first. */
export function newsAt(systemId: SystemId, clock: number): NewsItem[] {
  const jumps = jumpsFrom(WORLD.links, systemId);
  return eventsSince(clock, EVENTS.newsRecent)
    .map((event) => ({ event, jumps: jumps.get(event.systemId) ?? 99, active: clock < eventEnd(event), endedEarly: endedEarly(event) }))
    .filter((n) => n.jumps <= EVENTS.newsJumps)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.jumps - b.jumps || b.event.start - a.event.start);
}

/** Price and normal-stock multipliers on one good at a station right now (1 and 1 without an event). */
export function marketEffect(locationId: string, commodity: CommodityId, clock: number): { price: number; stock: number } {
  const e = stationEventAt(locationId, clock);
  return e && e.goods.includes(commodity) ? { price: e.price, stock: e.stock } : NEUTRAL;
}

/** How an event moves a good's price at a station right now, all effects together (1 without one). */
export function priceMultiplier(locationId: string, commodity: CommodityId, clock: number): number {
  const fx = marketEffect(locationId, commodity, clock);
  return fx === NEUTRAL ? 1 : priceChange(fx.price, fx.stock);
}

/** The combined price change of an event on its goods (price × scarcity at its normal stock). */
export function eventPriceChange(e: WorldEvent): number {
  return priceChange(e.price, e.stock);
}

/** Minutes, for news text. */
export function minutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}
