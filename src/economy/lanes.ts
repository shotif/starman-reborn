import type { GameState, LaneRecord } from '../app/state.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { COMMODITIES, type CommodityId } from '../content/economy/goods.ts';
import { LANE_LINES, LANE_FICTION } from '../content/lanes/lines.ts';
import { ADRIFT_GOODS, LANE_KINDS, LANE_SHIPS, LANES, type LaneKind } from '../content/lanes/rules.ts';
import { LAW } from '../content/law/rules.ts';
import { PASSENGERS } from '../content/passengers/rules.ts';
import { FIRST_NAMES, LAST_NAMES } from '../content/people/lines.ts';
import { rng, type Rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { ALL_LOCATIONS, getLocation, getSystem, isInventedSystem, WORLD } from '../data/systems.ts';
import type { FictionalLocation, SystemId } from '../data/types.ts';
import { tourSights } from '../world/sightseeing.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { addCargo, cargoCount, itemsThatFit, removeCargo } from './cargo.ts';
import { routeFeeBetween } from './contracts.ts';
import { adjustReputation, FACTIONS } from './factions.ts';
import { haulsLostNear } from './hauls.ts';
import type { JobDef } from './jobs.ts';
import { contrabandIn, customsScan, isLawful, lawIn, wakeFriendly, witness, type LawfulFaction } from './law.ts';
import { cargoCapacity } from './loadout.ts';
import { berths } from './passengers.ts';
import { priceTipNear } from './people.ts';
import { applyCredits } from '../app/state.ts';
import { learnPrice } from './trade.ts';

/**
 * Lane encounters (docs/PROCGEN.md §27): a mayday, a lifepod, a Wake toll gate, a customs
 * checkpoint, a stranded scientist, cargo adrift or a lost trader, met in flight. Each system's time
 * is cut into slots; a slot holds one encounter or none, its kind fitting the system as it stood when
 * the slot began, and everything about it (who, what, whether it is a trap) drawn from the world's
 * seed, so a loaded game meets the same. A pilot meets one at most so often, never in Sol, and only
 * when flying quietly (the flight's business); answering is a choice on a card; the card names the
 * risk, never whether this one is a trap.
 */

export interface LaneOffer {
  /** `<system>.<slot>`: the slot's own id. */
  id: string;
  systemId: SystemId;
  slot: number;
  /** When the slot begins. */
  start: number;
  kind: LaneKind;
  /** Bait (a mayday, cargo) or a sting (a bribe), decided with the slot. */
  trap: boolean;
  ship: string;
  name: string;
  /** The station it concerns: the survivor's or scientist's destination, or the cargo's owner. */
  stationId?: string;
  /** The threat of the system's raider packs (a toll, an ambush). */
  level?: 1 | 2 | 3;
  /** The law of the system (customs; the call for a lifepod). */
  owner?: LawfulFaction | null;
  /** Pay: a mayday's reward, a fix's price, the helium-3's price, the cargo's return. */
  credits?: number;
  toll?: number;
  fare?: number;
  good?: CommodityId;
  qty?: number;
  sight?: string;
}

export interface LaneChoice {
  id: string;
  label: string;
  /** What it does, in short (never whether it is a trap). */
  effects: string;
  /** Why this pilot cannot choose it now, or null. */
  lock: string | null;
}

export interface LaneOutcome {
  text: string;
  tone: 'good' | 'bad' | 'info';
  /** Raiders to drop out of the dark around the ship now (their threat level). */
  ambush?: 1 | 2 | 3;
  /** The Wake's pass: its packs here let the ship be until it docks, jumps or fires on them. */
  pass?: true;
  /** A job taken on (a passage, or cargo to return). */
  jobId?: string;
}

const SLOT = LANES.slotSeconds;
export const laneSlot = (clock: number) => Math.floor(clock / SLOT);

type Band = 'secure' | 'patrolled' | 'lawless';

/** A system's security band. */
export function laneBand(systemId: SystemId): Band {
  const security = WORLD.profiles.get(systemId)?.security ?? 1;
  return security >= LANES.bands.secure ? 'secure' : security < LANES.bands.lawless ? 'lawless' : 'patrolled';
}

const openStations = (systemId: SystemId): FictionalLocation[] =>
  ALL_LOCATIONS.filter((l) => l.systemId === systemId && l.status === 'functional' && l.dockable !== false && l.stationType !== 'pirate-den' && l.services.length > 0);

const packsIn = (systemId: SystemId) => trafficFor(systemId, 'high').plan.packs;

/** The research stations within the scientist's reach of a system, nearest first. */
function institutesNear(systemId: SystemId): FictionalLocation[] {
  const jumps = jumpsFrom(WORLD.links, systemId);
  return ALL_LOCATIONS.filter((l) => l.stationType === 'research-station' && l.status === 'functional' && l.dockable !== false && (jumps.get(l.systemId) ?? Infinity) <= LANES.kinds.scientist.maxJumps).sort(
    (a, b) => jumps.get(a.systemId)! - jumps.get(b.systemId)! || a.id.localeCompare(b.id),
  );
}

/** A hauler raiders destroyed in this system lately, before the slot began (a lifepod's ship). */
function lostHaulHere(systemId: SystemId, start: number): string | null {
  const lost = haulsLostNear(systemId, start).filter((x) => x.jumps === 0 && x.fate.at >= start - LANES.kinds.lifepod.within && x.fate.at <= start);
  return lost[0]?.haul.name ?? null;
}

/** Whether a kind can happen in a system as it stood when a slot began. */
function fits(kind: LaneKind, systemId: SystemId, start: number): boolean {
  switch (kind) {
    case 'mayday':
    case 'trader':
      return openStations(systemId).length > 0;
    case 'lifepod':
      return openStations(systemId).length > 0 && lostHaulHere(systemId, start) !== null;
    case 'toll':
      return laneBand(systemId) === 'lawless' && !!packsIn(systemId);
    case 'customs': {
      const owner = lawIn(systemId);
      return isLawful(owner) && (WORLD.profiles.get(systemId)?.security ?? 0) >= LAW.scans.security;
    }
    case 'scientist':
      return tourSights().some((s) => s.systemId === systemId) && institutesNear(systemId).length > 0;
    case 'cargo':
      return openStations(systemId).length > 0;
  }
}

const pickName = (r: Rng) => `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`;
const round5 = (x: number) => Math.round(x / 5) * 5;
const between = (r: Rng, [lo, hi]: readonly [number, number]) => lo + Math.floor(r.next() * (hi - lo + 1));

/**
 * The encounter a slot holds in a system, or null: none in Sol or at Pyre, by the system's chance,
 * its kind fitting the system as it stood when the slot began, everything about it from the seed.
 */
export function laneEncounter(systemId: SystemId, slot: number): LaneOffer | null {
  if (systemId === 'sol' || isInventedSystem(systemId)) return null;
  const r = rng(WORLD_SEED, 'lane', systemId, slot);
  const band = laneBand(systemId);
  if (r.next() >= LANES.chance[band]) return null;
  const start = slot * SLOT;
  const kinds = LANE_KINDS.filter((k) => fits(k, systemId, start));
  if (!kinds.length) return null;
  const total = kinds.reduce((a, k) => a + LANES.kinds[k].weight, 0);
  let x = r.next() * total;
  const kind = kinds.find((k) => (x -= LANES.kinds[k].weight) < 0) ?? kinds[kinds.length - 1]!;
  const offer: LaneOffer = { id: `${systemId}.${slot}`, systemId, slot, start, kind, trap: false, ship: r.pick(LANE_SHIPS), name: pickName(r) };
  const stations = openStations(systemId);
  const K = LANES.kinds;
  switch (kind) {
    case 'mayday':
      offer.trap = r.next() < K.mayday.bait[band];
      offer.credits = round5(between(r, K.mayday.reward));
      offer.level = packsIn(systemId)?.level ?? (band === 'lawless' ? 2 : 1);
      offer.owner = lawIn(systemId) as LawfulFaction | null;
      break;
    case 'lifepod':
      offer.ship = lostHaulHere(systemId, start)!;
      offer.stationId = stations[0]!.id;
      offer.fare = round5(between(r, K.lifepod.fare));
      offer.owner = isLawful(lawIn(systemId)) ? (lawIn(systemId) as LawfulFaction) : null;
      break;
    case 'toll': {
      const level = packsIn(systemId)!.level;
      offer.level = level;
      offer.toll = K.toll.toll[level];
      break;
    }
    case 'customs':
      offer.owner = lawIn(systemId) as LawfulFaction;
      offer.trap = r.next() < K.customs.sting;
      break;
    case 'scientist': {
      const sight = r.pick(tourSights().filter((s) => s.systemId === systemId));
      const to = institutesNear(systemId)[0]!;
      const jumps = jumpsFrom(WORLD.links, systemId).get(to.systemId) ?? 0;
      const P = PASSENGERS.passage.reward;
      offer.sight = sight.name;
      offer.stationId = to.id;
      offer.fare = round5((P.base + P.perJump * jumps + P.perPassenger) * K.scientist.fare + CONTRACTS.reward.perFee * routeFeeBetween(systemId, to.systemId));
      offer.credits = round5(K.scientist.fuel.price * COMMODITIES[K.scientist.fuel.commodity].basePrice);
      offer.owner = isLawful(lawIn(systemId)) ? (lawIn(systemId) as LawfulFaction) : null;
      break;
    }
    case 'cargo': {
      offer.trap = r.next() < K.cargo.bait[band];
      offer.good = r.pick(ADRIFT_GOODS);
      offer.qty = between(r, K.cargo.qty);
      offer.stationId = r.pick(stations).id;
      offer.credits = round5(K.cargo.returnShare * offer.qty * COMMODITIES[offer.good].basePrice);
      offer.level = packsIn(systemId)?.level ?? (band === 'lawless' ? 2 : 1);
      break;
    }
    case 'trader':
      offer.credits = K.trader.fix;
      offer.stationId = stations[0]!.id;
      break;
  }
  return offer;
}

/** The lane records of the active save, or none. */
const recordsOf = (state: GameState): Record<string, LaneRecord> => state.world.lanes ?? {};

/**
 * The encounter a pilot meets in a system now, if any: once the opening is done, at most one a slot
 * and one a cooldown, and only what fits the pilot too (a customs patrol hails a hold with contraband
 * in it; the Wake does not toll a pilot it trusts). The first one a pilot ever meets is never a trap,
 * a toll or a customs patrol.
 */
export function laneOfferFor(state: GameState, systemId: SystemId, clock = state.clock): LaneOffer | null {
  if (state.jobs.lifeline?.status !== 'complete') return null;
  const offer = laneEncounter(systemId, laneSlot(clock));
  if (!offer) return null;
  const records = Object.values(recordsOf(state));
  if (recordsOf(state)[offer.id]) return null;
  if (records.some((x) => clock - x.at < LANES.cooldown)) return null;
  if (!records.length && (offer.trap || offer.kind === 'toll' || offer.kind === 'customs')) return null;
  if (offer.kind === 'customs' && !contrabandIn(state.ship.cargo).length) return null;
  if (offer.kind === 'toll' && wakeFriendly(state)) return null;
  return offer;
}

/** Writes the encounter into the save as it hails, so it is met once. */
export function stageLane(state: GameState, offer: LaneOffer): void {
  const lanes = (state.world.lanes ??= {});
  lanes[offer.id] = { at: state.clock, kind: offer.kind, systemId: offer.systemId };
  tidyLanes(state);
}

/** Keeps the records the rules say (the newest, none older than the rules allow). */
export function tidyLanes(state: GameState): void {
  const lanes = state.world.lanes;
  if (!lanes) return;
  const keep = Object.entries(lanes)
    .filter(([, x]) => state.clock - x.at <= LANES.keep.seconds)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, LANES.keep.records);
  state.world.lanes = Object.fromEntries(keep);
}

// ---------------------------------------------------------------- words

/** The fields of an encounter's lines. */
function fields(state: GameState, o: LaneOffer): Record<string, string> {
  const K = LANES.kinds;
  const station = o.stationId ? getLocation(o.stationId) : null;
  const fine = customsFine(state, o);
  const odds = o.kind === 'customs' ? K.customs.sting : o.kind === 'mayday' ? K.mayday.bait[laneBand(o.systemId)] : o.kind === 'cargo' ? K.cargo.bait[laneBand(o.systemId)] : 0;
  return {
    ship: o.ship,
    name: o.name,
    station: station?.name ?? '',
    system: getSystem(o.systemId).displayName,
    owner: o.owner ? FACTIONS[o.owner].name : 'nearest station',
    credits: `${(o.credits ?? 0).toLocaleString('en-GB')} cr`,
    toll: `${(o.toll ?? 0).toLocaleString('en-GB')} cr`,
    fare: `${(o.fare ?? 0).toLocaleString('en-GB')} cr`,
    good: o.good ? COMMODITIES[o.good].name.toLowerCase() : '',
    qty: String(o.qty ?? 0),
    fine: `${fine.declare.toLocaleString('en-GB')} cr`,
    bribe: `${fine.bribe.toLocaleString('en-GB')} cr`,
    sight: o.sight ?? '',
    odds: oddsText(odds),
  };
}

/** Odds in words: "about one in four". */
export function oddsText(p: number): string {
  if (p <= 0) return 'never';
  if (p >= 1) return 'always';
  const n = Math.round(1 / p);
  const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return n <= 1 ? 'about every other time' : n === 2 ? 'about one in two' : `about one in ${words[n - 1] ?? n}`;
}

export function fillLane(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

/** What a customs patrol would fine the contraband aboard: in full, declared (a share), and the bribe asked. */
function customsFine(state: GameState, o: LaneOffer): { full: number; declare: number; bribe: number } {
  if (o.kind !== 'customs') return { full: 0, declare: 0, bribe: 0 };
  const value = contrabandIn(state.ship.cargo).reduce((a, c) => a + c.qty * COMMODITIES[c.commodity].basePrice, 0);
  const full = Math.round(value * LAW.crimes.contraband.fineFactor);
  return { full, declare: Math.round(full * LANES.kinds.customs.declare), bribe: Math.round(full * LANES.kinds.customs.bribe) };
}

/** An encounter's words: its speaker, the hail, the scene, the risk (when there is one here) and the fiction line. */
export function laneWords(state: GameState, o: LaneOffer): { speaker: string; hail: string; scene: string; risk: string | null; fiction: string } {
  const lines = LANE_LINES[o.kind];
  const values = fields(state, o);
  const risky = o.kind === 'toll' || o.kind === 'customs' || ((o.kind === 'mayday' || o.kind === 'cargo') && values.odds !== 'never');
  return { speaker: lines.speaker, hail: fillLane(lines.hail, values), scene: fillLane(lines.scene, values), risk: risky && lines.risk ? fillLane(lines.risk, values) : null, fiction: LANE_FICTION };
}

// ---------------------------------------------------------------- choices

const freeHold = (state: GameState, good: CommodityId) => itemsThatFit(state.ship.cargo, good, cargoCapacity(state.ship));

/** The choices on an encounter's card, what each does, and why one is closed to this pilot now. */
export function laneChoices(state: GameState, o: LaneOffer): LaneChoice[] {
  const lines = LANE_LINES[o.kind].options;
  const v = fields(state, o);
  const K = LANES.kinds;
  const station = o.stationId ? getLocation(o.stationId).name : '';
  const owner = o.owner ? FACTIONS[o.owner].shortName : null;
  const noBerth = berths(state).free < 1 ? 'No free berth: fit a passenger cabin' : null;
  const choice = (id: string, effects: string, lock: string | null = null): LaneChoice => ({ id, label: lines[id]!.label, effects, lock });
  switch (o.kind) {
    case 'mayday':
      return [choice('help', `${v.credits} if they are who they say`), choice('pass', 'Nothing')];
    case 'lifepod':
      return [choice('aboard', `A berth to ${station}; ${v.fare} there`, noBerth), choice('call', owner ? `${owner} standing +${K.lifepod.standing}` : 'Nothing'), choice('leave', 'Nothing')];
    case 'toll':
      return [choice('pay', `−${v.toll}; the pack lets you be here`, state.credits < (o.toll ?? 0) ? `You have ${state.credits.toLocaleString('en-GB')} cr` : null), choice('refuse', 'The pack attacks')];
    case 'customs':
      return [
        choice('declare', `Contraband taken; ${v.fine} fine`),
        choice('bribe', `−${v.bribe}; they look away`, state.credits < customsFine(state, o).bribe ? `You have ${state.credits.toLocaleString('en-GB')} cr` : null),
        choice('dump', `Contraband dumped; ${owner} standing ${K.customs.dumpStanding}`),
      ];
    case 'scientist': {
      const fuel = K.scientist.fuel.commodity;
      return [
        choice('berth', `A berth to ${station}; ${v.fare} there, and a data core`, noBerth),
        choice('fuel', `−1 ${COMMODITIES[fuel].name.toLowerCase()}; +${v.credits}`, cargoCount(state.ship.cargo, fuel) < 1 ? `No ${COMMODITIES[fuel].name.toLowerCase()} aboard` : null),
        choice('tow', owner ? `${owner} standing +${K.scientist.standing}` : 'Nothing'),
      ];
    }
    case 'cargo': {
      const full = o.good && freeHold(state, o.good) < (o.qty ?? 0) ? 'Not enough room in the hold' : null;
      return [choice('return', `${v.qty} ${v.good} aboard; ${v.credits} at ${station}`, full), choice('keep', `${v.qty} ${v.good} aboard, yours`, full), choice('leave', 'Nothing')];
    }
    case 'trader':
      return [choice('charts', 'A price they know'), choice('sell', `+${v.credits}`), choice('ignore', 'Nothing')];
  }
}

// ---------------------------------------------------------------- outcomes

function record(state: GameState, o: LaneOffer, pick: string): void {
  const lanes = (state.world.lanes ??= {});
  lanes[o.id] = { ...(lanes[o.id] ?? { at: state.clock, kind: o.kind, systemId: o.systemId }), pick };
}

/** A passage for someone picked up in flight (a lifepod's survivor, a stranded scientist), taken on at once. */
function takePassage(state: GameState, o: LaneOffer, title: string, briefing: string): string {
  const dest = getLocation(o.stationId!);
  const id = `c.lane.${o.id}`;
  const job: JobDef = {
    id,
    title,
    giverLocationId: dest.id,
    factionId: dest.factionId ?? null,
    briefing,
    objectives: [{ kind: 'visit', locationId: dest.id, text: `Take ${o.name} to ${dest.name} (${getSystem(dest.systemId).displayName})` }],
    reward: o.fare ?? 0,
    repReward: {},
    difficulty: 1,
    difficultyNote: 'Picked up in flight',
    destinationLocationId: dest.id,
    contract: { kind: 'passage', party: [o.name], lane: o.id },
  };
  state.contracts[id] = job;
  state.jobs[id] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
  return id;
}

/** Cargo found adrift, to be returned to its owner for a share of its worth, taken on at once. */
function takeReturn(state: GameState, o: LaneOffer): string {
  const dest = getLocation(o.stationId!);
  const id = `c.lane.${o.id}`;
  const good = COMMODITIES[o.good!].name.toLowerCase();
  const job: JobDef = {
    id,
    title: `Return the ${good}`,
    giverLocationId: dest.id,
    factionId: dest.factionId ?? null,
    briefing: `${o.qty} units of ${good} lost by a hauler bound for ${dest.name}, found adrift and picked up in flight. Its owners pay for its return.`,
    objectives: [{ kind: 'deliver', commodity: o.good!, qty: o.qty!, locationId: dest.id, text: `Deliver ${o.qty} ${good} to ${dest.name}` }],
    reward: o.credits ?? 0,
    repReward: {},
    difficulty: 1,
    difficultyNote: 'Picked up in flight',
    destinationLocationId: dest.id,
    contract: { kind: 'freight', cargo: { commodity: o.good!, qty: o.qty! }, lane: o.id },
  };
  state.contracts[id] = job;
  state.jobs[id] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
  return id;
}

/**
 * The pilot's answer: what it does to the save (credits, cargo, standing, fines, a job taken on), what
 * the flight must do (raiders out of the dark, the Wake's pass), and what is said. A choice closed to
 * the pilot does nothing.
 */
export function answerLane(state: GameState, o: LaneOffer, optionId: string): LaneOutcome | null {
  const choice = laneChoices(state, o).find((c) => c.id === optionId);
  if (!choice || choice.lock) return null;
  const lines = LANE_LINES[o.kind].options[optionId]!;
  const v = fields(state, o);
  const say = (text: string, tone: LaneOutcome['tone'], more: Omit<LaneOutcome, 'text' | 'tone'> = {}): LaneOutcome => {
    record(state, o, optionId);
    return { text: fillLane(text, v), tone, ...more };
  };
  const K = LANES.kinds;
  switch (`${o.kind}.${optionId}`) {
    case 'mayday.help':
      if (o.trap) return say(lines.trap!, 'bad', { ambush: o.level ?? 1 });
      applyCredits(state, o.credits ?? 0, 'reward', `Helped the ${o.ship}`);
      if (o.owner) adjustReputation(state.reputation, o.owner, K.mayday.standing);
      return say(lines.outcome, 'good');
    case 'lifepod.aboard': {
      const jobId = takePassage(state, o, `A survivor of the ${o.ship}`, `${o.name}, who crewed the ${o.ship} until raiders destroyed it, was picked up from a lifepod in flight and wants to reach ${getLocation(o.stationId!).name}.`);
      return say(lines.outcome, 'good', { jobId });
    }
    case 'lifepod.call':
    case 'scientist.tow':
      if (o.owner) adjustReputation(state.reputation, o.owner, o.kind === 'lifepod' ? K.lifepod.standing : K.scientist.standing);
      return say(lines.outcome, 'info');
    case 'toll.pay':
      applyCredits(state, -(o.toll ?? 0), 'fee', 'Hollow Wake toll');
      return say(lines.outcome, 'info', { pass: true });
    case 'toll.refuse':
      return say(lines.outcome, 'bad', { ambush: o.level ?? 1 });
    case 'customs.declare': {
      const fine = customsFine(state, o).declare;
      for (const c of contrabandIn(state.ship.cargo)) removeCargo(state.ship.cargo, c.commodity, c.qty);
      if (o.owner && fine > 0) witness(state, o.owner, fine, o.systemId);
      return say(lines.outcome, 'info');
    }
    case 'customs.bribe': {
      const { bribe } = customsFine(state, o);
      applyCredits(state, -bribe, 'fee', 'A bribe to a customs officer');
      if (!o.trap) return say(lines.outcome, 'good');
      for (const c of contrabandIn(state.ship.cargo)) removeCargo(state.ship.cargo, c.commodity, c.qty);
      if (o.owner) {
        witness(state, o.owner, K.customs.stingFine, o.systemId);
        adjustReputation(state.reputation, o.owner, K.customs.stingStanding);
      }
      return say(lines.trap!, 'bad', {});
    }
    case 'customs.dump':
      for (const c of contrabandIn(state.ship.cargo)) removeCargo(state.ship.cargo, c.commodity, c.qty);
      if (o.owner) adjustReputation(state.reputation, o.owner, K.customs.dumpStanding);
      return say(lines.outcome, 'info');
    case 'scientist.berth': {
      const jobId = takePassage(state, o, `A scientist from ${o.sight}`, `${o.name} came out to study ${o.sight} and their shuttle failed. Picked up in flight, they want to reach ${getLocation(o.stationId!).name}.`);
      const gift = K.scientist.gift;
      if (itemsThatFit(state.ship.cargo, gift.commodity, cargoCapacity(state.ship)) >= gift.qty) addCargo(state.ship.cargo, gift.commodity, gift.qty);
      return say(lines.outcome, 'good', { jobId });
    }
    case 'scientist.fuel':
      removeCargo(state.ship.cargo, K.scientist.fuel.commodity, 1);
      applyCredits(state, o.credits ?? 0, 'sell', `Helium-3 for ${o.name}`);
      return say(lines.outcome, 'good');
    case 'cargo.return':
    case 'cargo.keep': {
      if (o.trap) return say(lines.trap!, 'bad', { ambush: o.level ?? 1 });
      addCargo(state.ship.cargo, o.good!, o.qty!);
      const jobId = optionId === 'return' ? takeReturn(state, o) : undefined;
      return say(lines.outcome, 'good', jobId ? { jobId } : {});
    }
    case 'trader.charts': {
      const at = o.stationId!;
      const tip = priceTipNear(state, at, rng(WORLD_SEED, 'lane-tip', o.id));
      if (tip?.price) {
        learnPrice(state, tip.price.locationId, tip.price.commodity, 'rumour');
        state.rumours.push({ key: `lane:${o.id}`, kind: 'price', text: tip.text, at: state.clock, locationId: at });
        return say(`${lines.outcome} ${tip.text}`, 'good');
      }
      return say(`${lines.outcome} Nothing worth the telling, as it turns out.`, 'info');
    }
    case 'trader.sell':
      applyCredits(state, o.credits ?? 0, 'sell', `A fix for the ${o.ship}`);
      return say(lines.outcome, 'good');
    default:
      return say(lines.outcome, 'info');
  }
}

/** The hail lapsed unanswered: the Wake attacks, a customs patrol scans; anything else just goes. */
export function lapseLane(state: GameState, o: LaneOffer): LaneOutcome {
  record(state, o, 'lapsed');
  const v = fields(state, o);
  const text = fillLane(LANE_LINES[o.kind].lapse, v);
  if (o.kind === 'toll') return { text, tone: 'bad', ambush: o.level ?? 1 };
  if (o.kind === 'customs' && o.owner) {
    const scan = customsScan(state, o.owner);
    return { text: `${text} ${scan.text}`, tone: scan.found.length ? 'bad' : 'info' };
  }
  return { text, tone: 'info' };
}

/** A save's lane record for an encounter, if met. */
export function laneRecord(state: GameState, offerId: string): LaneRecord | undefined {
  return state.world.lanes?.[offerId];
}

/** The offer behind a record (to show it again), from the world's seed. */
export function laneOfferById(offerId: string): LaneOffer | null {
  const dot = offerId.lastIndexOf('.');
  const systemId = offerId.slice(0, dot) as SystemId;
  const slot = Number(offerId.slice(dot + 1));
  if (!Number.isInteger(slot) || !getSystem(systemId)) return null;
  return laneEncounter(systemId, slot);
}
