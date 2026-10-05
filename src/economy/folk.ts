import type { CommodityId, FolkAsk, FolkRecord, FolkWorkDone, GameState, OutpostRecord } from '../app/state.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { ASK_LINES, DONE_LINES, FOLK, FOLK_FIRST, FOLK_LAST, FOLK_RELATIONS, FOLK_SAYS, LAPSE_LINES, SPIRIT_LINES, type AskKind, type FolkTrade, type SpiritBand } from '../content/outposts/folk.ts';
import { outpostId, outpostSite } from '../content/outposts/sites.ts';
import { fill } from '../content/people/lines.ts';
import { hashString, rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, findBelt, getLocation, getSystem, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { cargoCount, removeCargo } from './cargo.ts';
import type { Result } from './equipment.ts';
import { marketTables } from './markets.ts';

/**
 * People at your outposts (docs/PROCGEN.md §41; rules and words in src/content/outposts/folk.ts):
 * who lives at each of the pilot's outposts (drawn, never kept), the asks they make and what each
 * leaves for good, and the outpost's spirit. Asks are made and lapse with the fleet's settling
 * (economy/fleet.ts settleFleet), in time order with the income, so an outpost settles the same
 * however often the game is closed; they are done while the pilot is docked there.
 */

const HOUR = 3_600;

export interface FolkPerson {
  /** 0 is the quartermaster; residents follow in the order they came. */
  slot: number;
  trade: FolkTrade;
  name: string;
  /** Seed for the portrait. */
  seed: number;
  age: 'young' | 'middle' | 'old';
}

/** A line said by one of the people. */
export interface FolkLine {
  slot: number;
  name: string;
  trade: FolkTrade;
  text: string;
}

/** An ask made or lapsed, for the Fleet window's reports. */
export interface FolkNews {
  at: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

const clamp = (x: number) => Math.min(100, Math.max(0, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const goodName = (c: CommodityId) => COMMODITIES[c].name.toLowerCase();

// ---------------------------------------------------------------- who lives there

/** How many people live at the outpost now, by the stages done (none while it is built). */
export function peopleCount(o: OutpostRecord): number {
  return o.stage > 0 ? FOLK.people[Math.min(o.stage, FOLK.people.length) - 1]! : 0;
}

/** The goods its market trades, and those it makes. */
function marketOf(o: OutpostRecord): { traded: Set<CommodityId>; made: CommodityId[] } {
  const entries = [...(marketTables().get(outpostId(o.site))?.entries.values() ?? [])];
  return { traded: new Set(entries.map((e) => e.commodity)), made: entries.filter((e) => e.role === 'produce').map((e) => e.commodity).sort() };
}

/**
 * The good a trade's work would be on at this outpost: undefined for a work on no good, null when
 * it needs a good the outpost's market does not trade (the trade is then never drawn there).
 */
export function workGood(seed: number, o: OutpostRecord, trade: FolkTrade): CommodityId | undefined | null {
  const w = FOLK.trades[trade].work;
  if (w.kind !== 'market') return undefined;
  const m = marketOf(o);
  if ('goods' in w && w.goods) return w.goods.find((g) => m.traded.has(g)) ?? null;
  const grower: readonly CommodityId[] = FOLK.trades.grower.work.goods;
  const made = m.made.filter((g) => !grower.includes(g));
  return made.length ? rng(seed, 'folk-desk', o.site, o.founded).pick(made) : null;
}

/** The residents' trades, in the order they come: drawn without repeats, likelier where they fit. */
export function residentTrades(seed: number, o: OutpostRecord): FolkTrade[] {
  const r = rng(seed, 'folk-trades', o.site, o.founded);
  const pool: FolkTrade[] = FOLK.residents.filter((t) => workGood(seed, o, t) !== null);
  const out: FolkTrade[] = [];
  while (out.length < FOLK.people[FOLK.people.length - 1]! - 1 && pool.length) {
    const weights = pool.map((t) => ((FOLK.trades[t].likes as readonly string[]).includes(o.kind) ? FOLK.likeWeight : 1));
    let x = r.next() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < pool.length - 1 && x >= weights[i]!) x -= weights[i++]!;
    out.push(pool.splice(i, 1)[0]!);
  }
  return out;
}

/** The people at the outpost now: the quartermaster, then the residents who have come. */
export function folkPeople(state: GameState, o: OutpostRecord): FolkPerson[] {
  const trades: FolkTrade[] = ['quartermaster', ...residentTrades(state.seed, o)];
  const used = new Set<string>();
  return trades.slice(0, peopleCount(o)).map((trade, slot) => {
    const r = rng(state.seed, 'folk', o.site, o.founded, slot);
    let name = `${r.pick(FOLK_FIRST)} ${r.pick(FOLK_LAST)}`;
    while (used.has(name)) name = `${r.pick(FOLK_FIRST)} ${r.pick(FOLK_LAST)}`;
    used.add(name);
    return { slot, trade, name, seed: r.int(0, 999_999), age: r.pick(['young', 'middle', 'old'] as const) };
  });
}

function personOf(state: GameState, o: OutpostRecord, slot: number): FolkPerson {
  return folkPeople(state, o).find((p) => p.slot === slot) ?? folkPeople(state, { ...o, stage: 3 }).find((p) => p.slot === slot)!;
}

/** The people's record, begun when its people first come (an outpost opening, or first settled in an older save). */
export function ensureFolk(o: OutpostRecord, at: number): FolkRecord | undefined {
  if (o.stage <= 0) return undefined;
  o.folk ??= { start: at, spirit: FOLK.spirit.start, since: at, visited: at, steps: [0, 0, 0, 0], asked: 0, works: [], told: at, band: bandOf(FOLK.spirit.start) };
  return o.folk;
}

// ---------------------------------------------------------------- spirit (§41.3)

export function bandOf(spirit: number): SpiritBand {
  return spirit < FOLK.spirit.bands.low ? 'low' : spirit >= FOLK.spirit.bands.glad ? 'glad' : 'steady';
}

const hasWork = (f: FolkRecord, trade: FolkTrade) => f.works.some((w) => w.trade === trade);

/** How far the spirit falls between `a` and `b` for the pilot being away (from the last visit, after the first day). */
function fallen(f: FolkRecord, a: number, b: number): number {
  const A = FOLK.spirit.away;
  const from = f.visited + A.grace;
  const rate = (A.by / A.step) * (hasWork(f, 'medic') ? FOLK.trades.medic.work.drift : 1);
  return rate * (Math.max(0, b - from) - Math.max(0, a - from));
}

/** The outpost's spirit at a time (from when it was last changed: what has happened since is settled in order). */
export function spiritAt(o: OutpostRecord, t: number): number {
  const f = o.folk;
  if (!f) return FOLK.spirit.start;
  return t <= f.since ? f.spirit : clamp(f.spirit - fallen(f, f.since, t));
}

/** Changes the spirit at a time (never before it was last changed). */
function fold(o: OutpostRecord, t: number, delta: number): void {
  const f = o.folk!;
  const at = Math.max(t, f.since);
  f.spirit = round2(clamp(spiritAt(o, at) + delta));
  f.since = at;
}

/** What the spirit does to the hour's income (1 at 50). */
export function spiritFactor(spirit: number): number {
  const [lo, hi] = FOLK.spirit.income;
  return lo + ((hi - lo) * spirit) / 100;
}

/** What the people's asks done do to the income, for good: each first ask, and the quartermaster's stores. */
export function worksIncome(o: OutpostRecord): number {
  const f = o.folk;
  if (!f) return 1;
  const firsts = f.steps.filter((s) => s >= 1).length * FOLK.firstIncome;
  const works = f.works.reduce((sum, w) => {
    const work = FOLK.trades[w.trade].work;
    return sum + (work.kind === 'income' ? work.income : 0);
  }, 0);
  return 1 + firsts + works;
}

/** Everything the people do to the hour's income at a time (1 without people). */
export function folkFactor(o: OutpostRecord, t: number): number {
  return o.folk ? spiritFactor(spiritAt(o, t)) * worksIncome(o) : 1;
}

/** The pilot is there (docked, or launching): the time away ends, the falling already done stays. */
export function visitFolk(o: OutpostRecord, now: number): void {
  if (!o.folk) return;
  fold(o, now, 0);
  o.folk.visited = Math.max(o.folk.visited, now);
}

/** A raid met at the outpost (docs/PROCGEN.md §29) moves its spirit. */
export function raidFolk(o: OutpostRecord, at: number, result: 'held' | 'lost'): void {
  if (o.folk) fold(o, at, result === 'held' ? FOLK.spirit.held : FOLK.spirit.lost);
}

// ---------------------------------------------------------------- what the works do

/** The outpost's own (one of the pilot's) whose station this is. */
function outpostHere(state: GameState, locationId: string | null | undefined): OutpostRecord | undefined {
  return locationId ? (state.world.outposts ?? []).find((o) => outpostId(o.site) === locationId) : undefined;
}

/** What the engineer's workshop takes off hull repairs at a station (0 elsewhere). */
export function repairCut(state: GameState, locationId: string): number {
  const f = outpostHere(state, locationId)?.folk;
  return f && hasWork(f, 'engineer') ? FOLK.trades.engineer.work.cut : 0;
}

/** A work's price and stock multipliers on a good at an outpost (the grower's green bay, the broker's desk), if any. */
export function folkMarket(o: OutpostRecord, commodity: CommodityId): { price: number; stock: number } | null {
  const w = o.folk?.works.find((x) => x.good === commodity);
  const work = w ? FOLK.trades[w.trade].work : null;
  return work?.kind === 'market' ? { price: work.price, stock: work.stock } : null;
}

// ---------------------------------------------------------------- asks (§41.2)

/** When the outpost's next ask comes (null with one open, or no people). */
export function nextAskAt(seed: number, o: OutpostRecord): number | null {
  const f = o.folk;
  if (!f || f.ask || o.stage <= 0) return null;
  if (!f.ended) return f.start + FOLK.asks.first;
  const [lo, hi] = FOLK.asks.gap;
  return f.ended.at + rng(seed, 'folk-gap', o.site, o.founded, f.asked).int(lo, hi);
}

/**
 * Who asks next: the one with the fewest asks done (after a lapse, someone else as few if there is
 * one; the quartermaster before residents), or the quartermaster's supplies once all is told.
 */
function asker(state: GameState, o: OutpostRecord): { person: FolkPerson; story: boolean } {
  const f = o.folk!;
  const people = folkPeople(state, o);
  const lapsed = f.ended?.how === 'lapsed' ? f.ended.slot : -1;
  const open = people
    .filter((p) => (f.steps[p.slot] ?? 0) < FOLK.asks.story)
    .sort((a, b) => (f.steps[a.slot] ?? 0) - (f.steps[b.slot] ?? 0) || Number(a.slot === lapsed) - Number(b.slot === lapsed) || a.slot - b.slot);
  return open.length ? { person: open[0]!, story: true } : { person: people[0]!, story: false };
}

const madeNear = new Map<string, boolean>();

/** Whether a good is made at a station within `asks.jumps` of a system. */
function madeWithin(systemId: SystemId, good: CommodityId): boolean {
  const key = `${systemId}|${good}`;
  let v = madeNear.get(key);
  if (v === undefined) {
    const jumps = jumpsFrom(WORLD.links, systemId);
    v = [...marketTables().entries()].some(([id, t]) => t.entries.get(good)?.role === 'produce' && (jumps.get(getLocation(id).systemId) ?? 99) <= FOLK.asks.jumps);
    madeNear.set(key, v);
  }
  return v;
}

/** The goods a goods ask may want there: of the list, made within reach, never restricted or contraband. */
export function askGoods(systemId: SystemId, list: readonly CommodityId[]): CommodityId[] {
  return list.filter((g) => COMMODITIES[g].category !== 'restricted' && COMMODITIES[g].category !== 'contraband' && madeWithin(systemId, g));
}

const stationsNear = new Map<SystemId, string[]>();

/** Where one fetched may wait: real open stations one or two jumps off, never a den. */
export function fetchStations(systemId: SystemId): string[] {
  let out = stationsNear.get(systemId);
  if (!out) {
    const jumps = jumpsFrom(WORLD.links, systemId);
    const [lo, hi] = FOLK.asks.fetch;
    out = ALL_LOCATIONS.filter((l) => {
      const j = jumps.get(l.systemId) ?? 99;
      return j >= lo && j <= hi && l.status === 'functional' && l.dockable !== false && l.stationType !== 'pirate-den';
    })
      .map((l) => l.id)
      .sort();
    stationsNear.set(systemId, out);
  }
  return out;
}

const bodiesIn = new Map<SystemId, { id: string; name: string }[]>();

/** What a scan ask may name: the stars, planets and belts drawn in the outpost's system (a belt once, by its record). */
export function scanBodies(systemId: SystemId): { id: string; name: string }[] {
  let out = bodiesIn.get(systemId);
  if (!out) {
    const def = sceneDefFor(systemId);
    const belts = [...new Set(def.belts.map((b) => b.beltId))].flatMap((id) => {
      const belt = findBelt(id);
      return belt ? [{ id, name: belt.name }] : [];
    });
    out = [...def.stars.map((x) => ({ id: x.id, name: x.name })), ...def.planets.map((p) => ({ id: p.id, name: p.name })), ...belts];
    bodiesIn.set(systemId, out);
  }
  return out;
}

function systemOf(o: OutpostRecord): SystemId | null {
  return outpostSite(o.site)?.systemId ?? null;
}

/** Draws an ask, of the asker's kinds (the first drawn, then the others if it cannot be made there). */
function drawAsk(state: GameState, o: OutpostRecord, at: number): FolkAsk | null {
  const f = o.folk!;
  const systemId = systemOf(o);
  if (!systemId) return null;
  const r = rng(state.seed, 'folk-ask', o.site, o.founded, f.asked);
  const { person, story } = asker(state, o);
  const t = FOLK.trades[person.trade];
  const kinds: readonly AskKind[] = story ? r.shuffle(t.asks) : ['goods'];
  for (const kind of kinds) {
    const base = { n: f.asked, slot: person.slot, kind, story, made: at, until: at + FOLK.asks.lasts };
    if (kind === 'goods') {
      const goods = askGoods(systemId, story ? t.goods : FOLK.trades.quartermaster.goods);
      if (!goods.length) continue;
      const good = r.pick(goods);
      const qty = Math.min(FOLK.asks.qty[1], Math.max(FOLK.asks.qty[0], Math.round(r.int(FOLK.asks.value[0], FOLK.asks.value[1]) / COMMODITIES[good].basePrice)));
      return { ...base, good, qty };
    }
    if (kind === 'fetch') {
      const stations = fetchStations(systemId);
      if (!stations.length) continue;
      const relation = r.pick(FOLK_RELATIONS);
      const family = relation === 'sister' || relation === 'brother' || relation === 'cousin';
      const first = r.pick(FOLK_FIRST.filter((n) => !person.name.startsWith(`${n} `)));
      const last = family ? person.name.split(' ').slice(1).join(' ') : r.pick(FOLK_LAST);
      return { ...base, who: `${first} ${last}`, relation, stationId: r.pick(stations) };
    }
    const bodies = scanBodies(systemId);
    if (!bodies.length) continue;
    return { ...base, bodyId: r.pick(bodies).id };
  }
  return null;
}

/**
 * Makes and lapses the outpost's asks due by `upTo`, in time order (an ask lapsing lowers the
 * spirit at its time). What happened, for the Fleet window's reports.
 */
export function advanceFolk(state: GameState, o: OutpostRecord, upTo: number): FolkNews[] {
  const f = o.folk;
  if (!f || o.stage <= 0) return [];
  const out: FolkNews[] = [];
  for (let guard = 0; guard < 200; guard++) {
    if (f.ask) {
      if (f.ask.until > upTo) break;
      const ask = f.ask;
      fold(o, ask.until, FOLK.spirit.lapsed);
      f.ended = { at: ask.until, how: 'lapsed', slot: ask.slot };
      delete f.ask;
      out.push({ at: ask.until, text: fill(FOLK_SAYS.lapsed, { outpost: o.name, name: personOf(state, o, ask.slot).name, ask: askShort(ask) }), tone: 'bad' });
      continue;
    }
    const next = nextAskAt(state.seed, o);
    if (next === null || next > upTo) break;
    const ask = drawAsk(state, o, next);
    f.asked += 1;
    if (!ask) {
      f.ended = { at: next, how: 'none', slot: 0 };
      continue;
    }
    f.ask = ask;
    out.push({ at: next, text: fill(FOLK_SAYS.asked, { outpost: o.name, name: personOf(state, o, ask.slot).name, ask: askShort(ask) }), tone: 'info' });
  }
  return out;
}

/** An ask done: the spirit lifted, the asker's story on a step (and their work built at its end). What they say. */
export function completeAsk(state: GameState, o: OutpostRecord, at: number): { line: FolkLine; work?: FolkWorkDone } {
  const f = o.folk!;
  const ask = f.ask!;
  const p = personOf(state, o, ask.slot);
  fold(o, at, ask.story ? FOLK.spirit.done : FOLK.spirit.supplies);
  let work: FolkWorkDone | undefined;
  let text: string = DONE_LINES.supplies;
  if (ask.story) {
    const step = (f.steps[ask.slot] ?? 0) + 1;
    f.steps[ask.slot] = step;
    text = DONE_LINES[p.trade][step >= FOLK.asks.story ? 'work' : 'first'];
    if (step >= FOLK.asks.story) {
      const good = workGood(state.seed, o, p.trade);
      work = { slot: p.slot, trade: p.trade, at, ...(good ? { good } : {}) };
      f.works.push(work);
    }
  }
  f.ended = { at, how: 'done', slot: ask.slot };
  delete f.ask;
  return { line: { slot: p.slot, name: p.name, trade: p.trade, text }, ...(work ? { work } : {}) };
}

/** Hands over a goods ask's goods from the hold, docked at the outpost. */
export function handOverAsk(state: GameState): Result & { line?: FolkLine; work?: FolkWorkDone } {
  const o = outpostHere(state, state.location.dockedAt);
  const ask = o?.folk?.ask;
  if (!o || !ask || ask.until <= state.clock) return { ok: false, message: 'Nobody here is asking for anything just now.' };
  if (ask.kind !== 'goods' || !ask.good || !ask.qty) return { ok: false, message: 'That ask is not for goods.' };
  if (cargoCount(state.ship.cargo, ask.good) < ask.qty) return { ok: false, message: `You carry fewer than ${ask.qty} ${goodName(ask.good)}.` };
  removeCargo(state.ship.cargo, ask.good, ask.qty);
  const done = completeAsk(state, o, state.clock);
  return { ok: true, message: `Handed over ${ask.qty} ${goodName(ask.good)}.`, ...done };
}

/**
 * Docking: anyone waiting there for a fetch ask comes aboard; at one of the pilot's outposts the
 * time away ends, a fetch or scan ask is done, and whoever has something to say says it (at most
 * `greet.max` lines). Call after settling the fleet.
 */
export function dockFolk(state: GameState, locationId: string): { toasts: string[]; outpost?: OutpostRecord; lines: FolkLine[]; work?: FolkWorkDone } {
  const toasts: string[] = [];
  for (const x of state.world.outposts ?? []) {
    const ask = x.folk?.ask;
    if (ask?.kind === 'fetch' && ask.stationId === locationId && !ask.aboard) {
      ask.aboard = true;
      toasts.push(fill(FOLK_SAYS.aboard, { who: ask.who!, outpost: x.name }));
    }
  }
  const o = outpostHere(state, locationId);
  const f = o?.folk;
  if (!o || !f) return { toasts, lines: [] };
  const now = state.clock;
  visitFolk(o, now);
  // In order: an ask lapsed since, an ask done there and then, a new ask; then the spirit.
  const lines: FolkLine[] = [];
  let work: FolkWorkDone | undefined;
  if (f.ended?.how === 'lapsed' && f.ended.at > f.told) {
    const p = personOf(state, o, f.ended.slot);
    lines.push({ slot: p.slot, name: p.name, trade: p.trade, text: LAPSE_LINES[hashString(`${o.site}|${f.ended.at}`) % LAPSE_LINES.length]! });
  }
  const ask = f.ask;
  if (ask && ask.until > now && ((ask.kind === 'fetch' && ask.aboard) || (ask.kind === 'scan' && ask.scanned))) {
    const done = completeAsk(state, o, now);
    lines.push(done.line);
    work = done.work;
  } else if (ask && ask.made > f.told) lines.push(askLine(state, o, ask));
  const band = bandOf(spiritAt(o, now));
  if (band !== f.band) {
    const p = personOf(state, o, 0);
    lines.push({ slot: 0, name: p.name, trade: p.trade, text: spiritLine(o, 0, band) });
  }
  f.told = now;
  f.band = band;
  return { toasts, outpost: o, lines: lines.slice(0, FOLK.greet.max), ...(work ? { work } : {}) };
}

/** Launching from one of the pilot's outposts ends the time away too. */
export function leaveFolk(state: GameState, locationId: string): void {
  const o = outpostHere(state, locationId);
  if (o) visitFolk(o, state.clock);
}

/** A body scanned in flight: a scan ask for it, in this system, is ready to tell at its outpost. Toasts. */
export function scanFolk(state: GameState, bodyId: string): string[] {
  const out: string[] = [];
  for (const o of state.world.outposts ?? []) {
    const ask = o.folk?.ask;
    if (ask?.kind === 'scan' && ask.bodyId === bodyId && !ask.scanned && systemOf(o) === state.location.systemId) {
      ask.scanned = true;
      out.push(fill(FOLK_SAYS.scanned, { body: bodyName(o, bodyId), name: personOf(state, o, ask.slot).name, outpost: o.name }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- in words

function bodyName(o: OutpostRecord, bodyId: string): string {
  const systemId = systemOf(o);
  return (systemId && scanBodies(systemId).find((b) => b.id === bodyId)?.name) || bodyId;
}

function stationWords(id: string): { station: string; system: string } {
  const l = getLocation(id);
  return { station: l.name, system: getSystem(l.systemId).displayName };
}

/** An ask in short: "8 medical supplies", "bring Edda Carrow from Halcyon Ring", "a close scan of Mars". */
export function askShort(ask: FolkAsk, o?: OutpostRecord): string {
  if (ask.kind === 'goods') return `${ask.qty} ${goodName(ask.good!)}`;
  if (ask.kind === 'fetch') return `bring ${ask.who} from ${stationWords(ask.stationId!).station}`;
  return `a close scan of ${o ? bodyName(o, ask.bodyId!) : ask.bodyId}`;
}

/** What the asker says of their ask. */
export function askLine(state: GameState, o: OutpostRecord, ask: FolkAsk): FolkLine {
  const p = personOf(state, o, ask.slot);
  const step = o.folk?.steps[ask.slot] ?? 0;
  const lines = ASK_LINES[p.trade][ask.kind];
  const template = !ask.story || !lines ? ASK_LINES.supplies : step >= 1 ? lines.work : lines.first;
  const where = ask.stationId ? stationWords(ask.stationId) : { station: '', system: '' };
  const text = fill(template, { good: ask.good ? goodName(ask.good) : '', who: ask.who ?? '', relation: ask.relation ?? '', ...where, body: ask.bodyId ? bodyName(o, ask.bodyId) : '', outpost: o.name });
  return { slot: p.slot, name: p.name, trade: p.trade, text };
}

/** Where an ask stands, in a line for the Outpost window. */
export function askNeeds(state: GameState, o: OutpostRecord, ask: FolkAsk): string {
  const left = Math.max(1, Math.round((ask.until - state.clock) / HOUR));
  const time = `${left} h left`;
  if (ask.kind === 'goods') return `Wants ${ask.qty} ${goodName(ask.good!)}: you carry ${cargoCount(state.ship.cargo, ask.good!)}. ${time}.`;
  if (ask.kind === 'fetch') {
    const w = stationWords(ask.stationId!);
    return ask.aboard ? `${ask.who} is aboard: dock here to bring them home. ${time}.` : `${ask.who} waits at ${w.station}, ${w.system}: dock there to bring them aboard. ${time}.`;
  }
  return ask.scanned ? `${bodyName(o, ask.bodyId!)} is scanned: dock here to tell them. ${time}.` : `Scan ${bodyName(o, ask.bodyId!)} in this system, from close by. ${time}.`;
}

/** What a person says just now, by the spirit's band. */
export function spiritLine(o: OutpostRecord, slot: number, band: SpiritBand): string {
  const lines = SPIRIT_LINES[band];
  return lines[hashString(`${o.site}|${o.founded}|${slot}`) % lines.length]!;
}
