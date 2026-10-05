import { applyCredits, type CommodityId, type GameState, type HeardRumour, type Wingman } from '../app/state.ts';
import { ALREADY_TOLD, fill, FIRST_NAMES, GREETINGS, LAST_NAMES, NOTHING_TO_TELL, ROLE_TITLE, TELL } from '../content/people/lines.ts';
import { PEOPLE, type PersonRole, type RumourKind } from '../content/people/rules.ts';
import { hashString, rng, type Rng } from '../content/random.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import type { CharacterId } from '../content/story/types.ts';
import type { StationType } from '../content/world/types.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, getSystem, WORLD } from '../data/systems.ts';
import type { FactionId, SystemId } from '../data/types.ts';
import { COMMODITIES, COMMODITY_IDS } from './commodities.ts';
import { pilotsFor } from './combat.ts';
import { boardEpoch, postedContracts } from './contracts.ts';
import { borderNews, frontState, type FrontState } from './border.ts';
import { denDown } from './dens.ts';
import { eventsStarting } from './events.ts';
import { FACTIONS } from './factions.ts';
import { cargoCapacity } from './loadout.ts';
import { dockAccess } from './law.ts';
import { baseQuote, hasMarket } from './markets.ts';
import { arcStatus, debriefFor, storyWaiting } from './story.ts';
import { ARC_JOBS } from '../content/story/arcs.ts';
import { describeObjective } from './jobs.ts';
import { learnPrice, liveQuote } from './trade.ts';

/**
 * People in the bars (docs/PROCGEN.md §16): who sits where, and what they know. Regulars are
 * drawn per station and shift from the world seed, the same for everyone; story characters sit in
 * their own bars; pilots for hire are people too. A round of drinks buys one true thing a person
 * knows, drawn from the game's own state: a price, an event before it reaches the news, a den, an
 * ace, a wreck or a story.
 */

export type PersonFaction = FactionId | 'independent';

export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  /** Words under the name ("Freight broker", or a story character's role). */
  title: string;
  faction: PersonFaction;
  /** Seed for the portrait. */
  seed: number;
  age: 'young' | 'middle' | 'old';
  greeting: string;
  /** A pilot for hire. */
  pilot?: Wingman;
  /** A story character sitting in their own bar. */
  story?: CharacterId;
}

/** The station type a dock's bar is like (the hand-made stations map to the nearest type). */
export function barKind(locationId: string): StationType | null {
  const loc = getLocation(locationId);
  return loc.stationType ?? PEOPLE.curated[locationId] ?? null;
}

/** Job-board time slots a regular keeps their seat. */
export function shiftAt(clock: number): number {
  return Math.floor(boardEpoch(clock) / PEOPLE.shift);
}

const AGES = ['young', 'middle', 'middle', 'old'] as const;
const OUTSIDERS: readonly PersonRole[] = ['trader', 'pilot', 'fixer', 'colonist'];

/** The regulars in a bar this shift (the same for everyone). */
export function regularsAt(locationId: string, clock: number): Person[] {
  const kind = barKind(locationId);
  if (!kind) return [];
  const loc = getLocation(locationId);
  const shift = shiftAt(clock);
  const r = rng(0x9e0b1e, 'people', locationId, shift);
  const [lo, hi] = PEOPLE.count;
  const n = r.int(lo, hi);
  const home: PersonFaction = loc.factionId ?? 'independent';
  const pool = PEOPLE.regulars[kind];
  return Array.from({ length: n }, (_, i) => {
    const role = r.pick(pool);
    const faction: PersonFaction = OUTSIDERS.includes(role) && r.next() < 0.4 ? 'independent' : home;
    return {
      id: `p.${locationId}.${shift}.${i}`,
      name: `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`,
      role,
      title: r.pick(ROLE_TITLE[role]),
      faction,
      seed: r.int(1, 2 ** 31 - 2),
      age: r.pick(AGES),
      greeting: r.pick(GREETINGS[role]),
    };
  });
}

const STORY_ROLE: Record<CharacterId, PersonRole> = {
  castell: 'officer',
  kettering: 'trader',
  quist: 'colonist',
  brandt: 'colonist',
  ansari: 'scientist',
  salt: 'fixer',
  halloway: 'pilot',
  fenwick: 'colonist',
  rook: 'miner',
  ashdown: 'miner',
  oduya: 'officer',
  achterberg: 'scientist',
  penhaligon: 'miner',
};

/** Everyone in the bar: story characters at home here, the regulars and the pilots for hire. */
export function peopleAt(state: GameState, locationId: string): Person[] {
  const story = (Object.values(CHARACTERS) as (typeof CHARACTERS)[CharacterId][])
    .filter((c) => c.locationId === locationId)
    .map<Person>((c) => ({
      id: `story.${c.id}`,
      name: c.name,
      role: STORY_ROLE[c.id],
      title: c.role,
      faction: c.factionId ?? 'independent',
      seed: hashString(`story:${c.id}`),
      age: 'middle',
      greeting: '',
      story: c.id,
    }));
  const full = dockAccess(state, locationId) === 'full';
  const pilots = full
    ? pilotsFor(locationId, state.clock)
        .filter((p) => !state.crew.some((w) => w.id === p.id))
        .map<Person>((p) => {
          const r = rng(hashString(p.id), 'pilot');
          return {
            id: p.id,
            name: p.name,
            role: 'pilot',
            title: `Wingman for hire · ${p.skill === 'sharp' ? 'sharp shot' : 'steady hand'}`,
            faction: getLocation(locationId).factionId ?? 'independent',
            seed: hashString(p.id),
            age: r.pick(AGES),
            greeting: r.pick(GREETINGS.pilot),
            pilot: p,
          };
        })
    : [];
  return [...story, ...regularsAt(locationId, state.clock), ...pilots];
}

// ---------------------------------------------------------------- rumours

export interface RumourFact {
  kind: RumourKind;
  text: string;
  /** What the player learns beyond the words (a price goes into what they know), and what a full hold on it is worth. */
  price?: { locationId: string; commodity: CommodityId; value: number };
}

let reachCache: Map<SystemId, Map<SystemId, number>> | null = null;
function jumpsOf(from: SystemId): Map<SystemId, number> {
  reachCache ??= new Map();
  let m = reachCache.get(from);
  if (!m) reachCache.set(from, (m = jumpsFrom(WORLD.links, from)));
  return m;
}

/** Docks within reach of a bar, nearest first (the bar's own dock excluded). */
function docksNear(locationId: string, reach: number): { id: string; jumps: number }[] {
  const jumps = jumpsOf(getLocation(locationId).systemId);
  return ALL_LOCATIONS.filter((l) => l.id !== locationId && l.status === 'functional')
    .map((l) => ({ id: l.id, jumps: jumps.get(l.systemId) ?? 99 }))
    .filter((d) => d.jumps <= reach)
    .sort((a, b) => a.jumps - b.jumps || a.id.localeCompare(b.id));
}

const where = (locationId: string) => {
  const loc = getLocation(locationId);
  return { station: loc.name, system: getSystem(loc.systemId).displayName };
};

/** A price worth knowing near a station (a lost trader's tip, docs/PROCGEN.md §27): what a round in its bar would tell. */
export function priceTipNear(state: GameState, locationId: string, r: Rng): RumourFact | null {
  return priceFact(state, locationId, r);
}

/** A price worth a round: the best sale within reach for goods bought here, or a bargain nearby. */
function priceFact(state: GameState, locationId: string, r: Rng): RumourFact | null {
  const reach = PEOPLE.rumour.reach;
  const markets = docksNear(locationId, reach).filter((d) => hasMarket(d.id) && getLocation(d.id).dockable !== false);
  const hold = cargoCapacity(state.ship);
  const floor = PEOPLE.rumour.minTipDrinks * PEOPLE.drink;
  let best: { fact: RumourFact; value: number } | null = null;
  const here = hasMarket(locationId);
  for (const d of markets) {
    for (const c of COMMODITY_IDS) {
      const there = liveQuote(state, d.id, c);
      const unit = COMMODITIES[c].unitSize;
      const items = Math.floor(hold / unit);
      if (here && there.sell !== null) {
        const buy = liveQuote(state, locationId, c).buy;
        if (buy !== null && there.sell > buy) {
          const value = (there.sell - buy) * items;
          if (value >= floor && (!best || value > best.value)) {
            best = { value, fact: { kind: 'price', text: fill(r.pick(TELL.priceSell), { ...where(d.id), price: there.sell, good: COMMODITIES[c].name.toLowerCase() }), price: { locationId: d.id, commodity: c, value } } };
          }
        }
      }
      // A bargain: well under its usual price.
      const usual = baseQuote(d.id, c).buy;
      if (there.buy !== null && usual !== null && there.buy <= usual * 0.8) {
        const value = (usual - there.buy) * items;
        if (value >= floor && (!best || value > best.value)) {
          best = { value, fact: { kind: 'price', text: fill(r.pick(TELL.priceBuy), { ...where(d.id), price: there.buy, good: COMMODITIES[c].name.toLowerCase() }), price: { locationId: d.id, commodity: c, value } } };
        }
      }
    }
  }
  return best?.fact ?? null;
}

/** An event about to start within reach, before the news has it. */
function eventFact(state: GameState, locationId: string, r: Rng): RumourFact | null {
  const jumps = jumpsOf(getLocation(locationId).systemId);
  const soon = eventsStarting(state.clock, state.clock + PEOPLE.rumour.soon).filter((e) => (jumps.get(e.systemId) ?? 99) <= PEOPLE.rumour.reach);
  const e = soon[0];
  if (!e) return null;
  const place = e.locationId ? getLocation(e.locationId).name : getSystem(e.systemId).displayName;
  return { kind: 'event', text: fill(r.pick(TELL.event), { what: lower(e.headline), where: place }) };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The nearest raider den: its guns, or how long it has been dark. */
function denFact(state: GameState, locationId: string, r: Rng): RumourFact | null {
  const den = docksNear(locationId, PEOPLE.rumour.reach + 1).find((d) => getLocation(d.id).stationType === 'pirate-den');
  if (!den) return null;
  const loc = getLocation(den.id);
  const system = getSystem(loc.systemId).displayName;
  if (denDown(state, den.id)) {
    const hours = Math.max(1, Math.round((state.clock - state.dens[den.id]!) / 3600));
    return { kind: 'den', text: fill(r.pick(TELL.denDark), { den: loc.name, system, hours: `${hours} hour${hours > 1 ? 's' : ''}` }) };
  }
  return { kind: 'den', text: fill(r.pick(TELL.denAwake), { den: loc.name, system }) };
}

/** A front as a regular would put it. */
function frontSays(s: FrontState): string {
  const f = s.front;
  switch (s.phase) {
    case 'pushed-back':
      return `the ${FACTIONS[f.faction].shortName} has the Wake on the run`;
    case 'skirmish':
      return 'patrols and raiders are trading shots';
    case 'blockade':
      return `the Wake has the lanes into ${getSystem(f.lawSystem).displayName} shut`;
    case 'fallen':
      return `the Wake holds ${f.exposedId ? getLocation(f.exposedId).name : getSystem(f.lawSystem).displayName}`;
    case 'truce':
      return 'the truce is holding';
  }
}

/** A border front within reach (docs/PROCGEN.md §20): how it stands, and where its tide takes it next. */
function frontFact(state: GameState, locationId: string, r: Rng): RumourFact | null {
  const near = borderNews(getLocation(locationId).systemId, state.clock).find((n) => n.jumps <= PEOPLE.rumour.reach);
  if (!near) return null;
  const now = near.state;
  let text = fill(r.pick(TELL.front), { line: now.front.name, what: frontSays(now) });
  const ahead = frontState(now.front, state.clock + PEOPLE.rumour.frontAhead);
  if (!now.ending && ahead.phase !== now.phase) text += ` ${fill(r.pick(TELL.frontNext), { next: frontSays(ahead) })}`;
  return { kind: 'front', text };
}

/** A contract of a kind posted within reach: an ace hunt or a wreck to recover. */
function postedFact(state: GameState, locationId: string, r: Rng, kind: 'ace' | 'wreck'): RumourFact | null {
  for (const d of [{ id: locationId, jumps: 0 }, ...docksNear(locationId, PEOPLE.rumour.reach)]) {
    const job = postedContracts(state, d.id).find((j) => j.contract?.kind === (kind === 'ace' ? 'ace' : 'recovery') && !j.requires?.rank);
    if (!job) continue;
    const giver = getLocation(job.giverLocationId).name;
    const o = job.objectives[0];
    if (kind === 'ace' && o) {
      const systemId = 'systemId' in o ? o.systemId : 'locationId' in o ? getLocation(o.locationId).systemId : getLocation(job.giverLocationId).systemId;
      return { kind, text: fill(r.pick(TELL.ace), { system: getSystem(systemId).displayName, giver, reward: job.reward }) };
    }
    if (kind === 'wreck' && o && o.kind === 'recover') {
      return { kind, text: fill(r.pick(TELL.wreck), { site: getLocation(o.locationId).name, item: o.item, giver }) };
    }
  }
  return null;
}

/** A story mission waiting for a pilot. */
function storyFact(state: GameState, r: Rng): RumourFact | null {
  const waiting = storyWaiting(state);
  if (!waiting) return null;
  const job = waiting.job;
  const who = job.story ? CHARACTERS[job.story.speaker as CharacterId] : undefined;
  const station = getLocation(job.giverLocationId).name;
  return { kind: 'story', text: fill(r.pick(TELL.story), { station, name: who?.name ?? 'someone' }) };
}

/** What this person knows right now: the first true thing, in the order their role talks about. */
export function rumourFor(state: GameState, locationId: string, person: Person): RumourFact | null {
  if (person.story) return null;
  const order = PEOPLE.talk[person.role];
  const start = person.seed % order.length;
  const r = rng(person.seed, 'rumour', shiftAt(state.clock));
  for (let i = 0; i < order.length; i++) {
    const kind = order[(start + i) % order.length]!;
    const fact =
      kind === 'price'
        ? priceFact(state, locationId, r)
        : kind === 'event'
          ? eventFact(state, locationId, r)
          : kind === 'den'
            ? denFact(state, locationId, r)
            : kind === 'ace' || kind === 'wreck'
              ? postedFact(state, locationId, r, kind)
              : kind === 'front'
                ? frontFact(state, locationId, r)
                : storyFact(state, r);
    if (fact) return fact;
  }
  return null;
}

export type DrinkResult =
  | { ok: true; cost: number; text: string; rumour: HeardRumour | null }
  | { ok: false; cost: 0; text: string };

/** The key of what a person tells this shift (one thing a shift). */
export function rumourKey(person: Person, clock: number): string {
  return `${person.id}@${shiftAt(clock)}`;
}

/**
 * A round for the table: the person tells what they know, and the price of it goes into what the
 * player knows. Nothing worth telling costs nothing; a person tells one thing a shift.
 */
export function buyDrink(state: GameState, locationId: string, personId: string): DrinkResult {
  const person = peopleAt(state, locationId).find((p) => p.id === personId);
  if (!person || person.story) return { ok: false, cost: 0, text: 'Nobody by that name here.' };
  const key = rumourKey(person, state.clock);
  const r = rng(person.seed, 'lines', key);
  if (state.rumours.some((h) => h.key === key)) return { ok: false, cost: 0, text: r.pick(ALREADY_TOLD) };
  const fact = rumourFor(state, locationId, person);
  if (!fact) return { ok: true, cost: 0, text: r.pick(NOTHING_TO_TELL), rumour: null };
  if (state.credits < PEOPLE.drink) return { ok: false, cost: 0, text: `A round costs ${PEOPLE.drink} cr.` };
  applyCredits(state, -PEOPLE.drink, 'fee', `A round for ${person.name}`);
  if (fact.price) learnPrice(state, fact.price.locationId, fact.price.commodity, 'rumour');
  const heard: HeardRumour = { key, kind: fact.kind, text: fact.text, at: state.clock, locationId };
  state.rumours.push(heard);
  if (state.rumours.length > PEOPLE.keep) state.rumours.splice(0, state.rumours.length - PEOPLE.keep);
  return { ok: true, cost: PEOPLE.drink, text: fact.text, rumour: heard };
}

// ---------------------------------------------------------------- story characters

/**
 * What a story character says when the player sits down with them, from where their arc stands:
 * work to offer (and which job), the work in hand, what they are waiting for, or how it ended.
 */
export function storyLine(state: GameState, character: CharacterId): { text: string; jobId: string | null } {
  const mine = ARC_JOBS.filter((j) => j.story?.speaker === character || getLocation(j.giverLocationId).id === CHARACTERS[character].locationId);
  const arcId = mine[0]?.story?.arc;
  if (!arcId) return { text: 'Good to see a friendly face out here.', jobId: null };
  const status = arcStatus(state, arcId);
  const job = status.job;
  if (status.phase === 'available' && job && job.giverLocationId === CHARACTERS[character].locationId) {
    return { text: `I could use a pilot I can trust. ${job.title}: the board has the details.`, jobId: job.id };
  }
  if (status.phase === 'active' && job) {
    const o = describeObjective(state, job.id);
    return { text: o ? `You have work in hand: ${o.text.charAt(0).toLowerCase()}${o.text.slice(1)}.`.replace(/\.\.$/, '.') : 'You know what to do. I will be here.', jobId: null };
  }
  if (status.phase === 'locked') {
    return { text: status.lockReason ? `Not yet, pilot. ${status.lockReason}.`.replace(/\.\.$/, '.') : 'Not yet, pilot. Come back later.', jobId: null };
  }
  const last = job ? [...debriefFor(state, job)].reverse().find((l) => l.who === character) : undefined;
  return { text: last?.text ?? 'We did what we could. That has to be enough.', jobId: null };
}
