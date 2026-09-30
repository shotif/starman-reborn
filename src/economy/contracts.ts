import type { CommodityId, GameState } from '../app/state.ts';
import { shipModel } from '../content/catalog.ts';
import { ACE_NAMES, BOARD_KINDS, CONTRACTS, CURATED_BOARD_KINDS, DEN_BOARD_KINDS, FRONTIER_SURVEY_WEIGHT, RECOVERY_ITEMS, type ContractKind, type KindWeights } from '../content/contracts/rules.ts';
import { LAW } from '../content/law/rules.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { hashString, rng, type Rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { ALL_LOCATIONS, getLocation, getSystem, isFrontier, SYSTEMS, WORLD } from '../data/systems.ts';
import type { FactionId, FictionalLocation, SystemId } from '../data/types.ts';
import { findRoute } from '../galaxy/routing.ts';
import { FLEETS } from '../world/traffic/plan.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { itemsThatFit } from './cargo.ts';
import { baseThreat, priceMultiplier, stationEventAt, systemEventAt, type WorldEvent } from './events.ts';
import { FACTIONS } from './factions.ts';
import { dockAccess, lawIn, scansOnDocking, wakeFriendly } from './law.ts';
import type { JobDef } from './jobs.ts';
import { cargoCapacity } from './loadout.ts';
import { marketTables } from './markets.ts';

/**
 * Generated contracts (docs/PROCGEN.md §10). Every station with a contracts service posts a board
 * that changes with the game clock: freight hauls, parcels, supply runs, bounties on raider packs,
 * planet surveys, escorts, aces and wreck recoveries, chosen by the kind of station and pointed at
 * real places in the world. Some parcels and hauls are urgent, and some lead to a follow-up.
 * A board is a pure function of the station, its time slot and the world (world events included,
 * as they stand when the board is posted); an accepted contract is copied into the save, so it
 * never changes under the player.
 */

export const CONTRACT_PREFIX = 'c.';

export function boardEpoch(clock: number): number {
  return Math.floor(clock / CONTRACTS.epochSeconds);
}

// ---------------------------------------------------------------- world lookups (cached)

let jumpCache: Map<SystemId, Map<SystemId, number>> | null = null;
/**
 * Jumps between two systems for a contract. Boards outside the frontier never send a pilot into it
 * (that takes a long-range jump drive the pilot may not have); frontier boards send anywhere.
 */
function jumpsBetween(a: SystemId, b: SystemId): number {
  if (isFrontier(b) && !isFrontier(a)) return Infinity;
  jumpCache ??= new Map();
  let m = jumpCache.get(a);
  if (!m) {
    m = jumpsFrom(WORLD.links, a);
    jumpCache.set(a, m);
  }
  return m.get(b) ?? Infinity;
}

const feeCache = new Map<string, number>();
/** Jump fees for the cheapest route between two systems (0 in-system). */
export function routeFeeBetween(a: SystemId, b: SystemId): number {
  if (a === b) return 0;
  const key = `${a}|${b}`;
  let fee = feeCache.get(key);
  if (fee === undefined) {
    fee = findRoute(SYSTEMS, a, b)?.totalFee ?? 0;
    feeCache.set(key, fee);
  }
  return fee;
}

const security = (systemId: SystemId) => WORLD.profiles.get(systemId)?.security ?? 1;

/** Stations a pilot can dock at and do business with. */
let open: FictionalLocation[] | null = null;
function openStations(): FictionalLocation[] {
  return (open ??= ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.dockable !== false && l.services.length > 0));
}

function boardKinds(loc: FictionalLocation): KindWeights | null {
  if (loc.stationType === 'pirate-den' && loc.status === 'functional') return DEN_BOARD_KINDS;
  if (!loc.services.includes('contracts') || loc.status !== 'functional' || loc.dockable === false) return null;
  const kinds = CURATED_BOARD_KINDS[loc.id] ?? (loc.stationType && loc.stationType !== 'pirate-den' ? BOARD_KINDS[loc.stationType] : null);
  // Out in the frontier every board wants the new systems surveyed.
  return kinds && isFrontier(loc.systemId) ? { ...kinds, survey: (kinds.survey ?? 0) + FRONTIER_SURVEY_WEIGHT } : kinds;
}

const place = (loc: FictionalLocation) => `${loc.name} (${getSystem(loc.systemId).displayName})`;
const clampDifficulty = (d: number) => Math.min(3, Math.max(1, Math.round(d))) as 1 | 2 | 3;
const round5 = (x: number) => Math.round(x / 5) * 5;
/** Pay: the fees for the trip in full, plus a part that varies a little from one posting to the next. */
const pay = (r: Rng, oneWayFee: number, varying: number, fixed = 0) =>
  round5(CONTRACTS.reward.perFee * oneWayFee + fixed + varying * r.range(CONTRACTS.payVariation[0], CONTRACTS.payVariation[1]));

// ---------------------------------------------------------------- boards

const boardCache = new Map<string, JobDef[]>();

/** The contracts a station posts in a time slot (hand-made jobs are separate, in jobs.ts). */
export function boardFor(locationId: string, epoch: number): JobDef[] {
  const key = `${locationId}|${epoch}`;
  const cached = boardCache.get(key);
  if (cached) return cached;
  const loc = getLocation(locationId);
  const weights = boardKinds(loc);
  const out: JobDef[] = [];
  if (weights) {
    const r = rng(WORLD_SEED, 'contracts', locationId, epoch);
    const clock = epoch * CONTRACTS.epochSeconds;
    const b = CONTRACTS.board;
    const size = Math.min(b.max, b.base + ((loc.look?.size ?? 0.8) > b.largeAbove ? 1 : 0) + (loc.stationType && b.busy.includes(loc.stationType) ? 1 : 0));
    const kinds = Object.keys(weights) as ContractKind[];
    // No two contracts of a kind sending you to the same place on one board.
    const placed = new Set<ContractKind>(['parcel', 'freight', 'escort', 'bounty', 'ace', 'smuggle', 'piracy', 'den']);
    const same = (a: JobDef, b: JobDef) =>
      a.title === b.title || (a.contract?.kind === b.contract?.kind && placed.has(a.contract!.kind) && a.destinationLocationId === b.destinationLocationId);
    // A kind that finds nothing to offer here is not tried again on this board (a den far out in
    // lawless space has no lawful traffic to raid, but still has parcels to run).
    const barren = new Set<ContractKind>();
    for (let attempt = 0; out.length < size && attempt < size * 5; attempt++) {
      const live = kinds.filter((k) => !barren.has(k));
      if (!live.length) break;
      const kind = weightedPick(r, live, live.map((k) => weights[k] ?? 0));
      const c = makeContract(kind, loc, r, `${CONTRACT_PREFIX}${locationId}.${epoch}.${out.length}`, clock);
      if (!c) barren.add(kind);
      else if (!out.some((o) => same(o, c))) out.push(c);
    }
    // Work answering a world event, from its own stream so the rest of the board does not move.
    const e = eventContract(loc, rng(WORLD_SEED, 'contracts', 'event', locationId, epoch), `${CONTRACT_PREFIX}${locationId}.${epoch}.${out.length}`, clock);
    if (e && !out.some((o) => same(o, e))) out.push(e);
  }
  if (boardCache.size > 4_000) boardCache.clear();
  boardCache.set(key, out);
  return out;
}

/** Finds a posted contract by id (ids are `c.<station>.<time slot>.<index>`). */
export function postedContract(id: string): JobDef | null {
  if (!id.startsWith(CONTRACT_PREFIX)) return null;
  const [locationId, epochText] = id.slice(CONTRACT_PREFIX.length).split('.');
  const epoch = Number(epochText);
  if (!locationId || !Number.isInteger(epoch) || !ALL_LOCATIONS.some((l) => l.id === locationId)) return null;
  return boardFor(locationId, epoch).find((c) => c.id === id) ?? null;
}

function weightedPick<T>(r: Rng, items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r.next() * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i]!;
    if (x < 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

// ---------------------------------------------------------------- contract kinds

function makeContract(kind: ContractKind, giver: FictionalLocation, r: Rng, id: string, clock: number): JobDef | null {
  switch (kind) {
    case 'parcel':
      return parcel(giver, r, id);
    case 'freight':
      return freight(giver, r, id, clock);
    case 'supply':
      return supply(giver, r, id, clock);
    case 'bounty':
      return bounty(giver, r, id);
    case 'survey':
      return survey(giver, r, id);
    case 'escort':
      return escort(giver, r, id);
    case 'ace':
      return ace(giver, r, id);
    case 'recovery':
      return recovery(giver, r, id);
    case 'smuggle':
      return smuggle(giver, r, id, clock);
    case 'piracy':
      return piracy(giver, r, id);
    case 'den':
      return denAssault(giver, r, id);
  }
}

/**
 * Work that answers a world event: a supply run into the posting station's shortage or boom, a
 * haul out of its glut, or a bounty on a raid within reach (docs/PROCGEN.md §11).
 */
function eventContract(giver: FictionalLocation, r: Rng, id: string, clock: number): JobDef | null {
  const own = stationEventAt(giver.id, clock);
  if (own && (own.kind === 'shortage' || own.kind === 'boom')) {
    const wanted = own.goods.filter((g) => marketTables().get(giver.id)?.entries.get(g)?.role === 'consume');
    const c = wanted.length ? supply(giver, r, id, clock, { commodity: r.pick(wanted), event: own }) : null;
    if (c) return c;
  }
  if (own?.kind === 'glut') {
    const c = freight(giver, r, id, clock, { commodity: own.goods[0]!, event: own });
    if (c) return c;
  }
  const raids = SYSTEMS.map((s) => systemEventAt(s.id, clock)).filter(
    (e): e is WorldEvent => e?.kind === 'raid' && jumpsBetween(giver.systemId, e.systemId) <= CONTRACTS.maxJumps.bounty,
  );
  return raids.length ? bounty(giver, r, id, { event: r.pick(raids) }) : null;
}

/** Goods ordinary contracts carry: no small arms, no contraband (smuggling is its own kind). */
const isLegalCargo = (c: CommodityId) => c !== 'weapons' && COMMODITIES[c].category !== 'contraband';

/** The varying part of the pay, higher for work that answers an event. */
const premium = (event: WorldEvent | undefined) => (event ? CONTRACTS.eventPremium : 1);

function common(giver: FictionalLocation, id: string, difficulty: 1 | 2 | 3): Pick<JobDef, 'id' | 'giverLocationId' | 'factionId' | 'difficulty' | 'repReward' | 'requires'> {
  const faction: FactionId | null = giver.factionId ?? null;
  const gated = faction && difficulty >= CONTRACTS.gatedDifficulty;
  return {
    id,
    giverLocationId: giver.id,
    factionId: faction,
    difficulty,
    repReward: faction ? { [faction]: CONTRACTS.repReward[difficulty - 1] } : {},
    ...(gated ? { requires: { minRep: { faction, value: CONTRACTS.gateStanding } } } : {}),
  };
}

function routeNote(from: SystemId, to: SystemId): string {
  const j = jumpsBetween(from, to);
  const sec = security(to);
  const way = j === 0 ? 'In this system' : j === 1 ? 'One jump' : `${j} jumps`;
  const risk = sec < 0.35 ? 'lawless space, raider packs likely' : sec < 0.6 ? 'thinly patrolled' : 'patrolled lanes';
  return `${way}; ${risk}`;
}

function difficultyFor(from: SystemId, to: SystemId): 1 | 2 | 3 {
  return clampDifficulty(1 + (security(to) < 0.35 ? 1 : 0) + (jumpsBetween(from, to) >= 3 ? 1 : 0));
}

/** The expected trip between two systems on the game clock (autopilot, lanes, docking). */
export function expectedTrip(from: SystemId, to: SystemId): number {
  const t = CONTRACTS.urgent.trip;
  return t.depart + jumpsBetween(from, to) * t.perJump + t.arrive;
}

/** Urgent terms for a parcel or haul: a time limit from acceptance and a bonus for keeping it. */
function urgentTerms(from: SystemId, to: SystemId, reward: number): { seconds: number; bonus: number } {
  const u = CONTRACTS.urgent;
  const seconds = Math.ceil(Math.max(u.minSeconds, expectedTrip(from, to) * u.margin) / 60) * 60;
  return { seconds, bonus: round5(reward * u.bonus) };
}

/** Marks a parcel or haul urgent (title, note and terms). */
function makeUrgent(job: JobDef, from: SystemId, to: SystemId): JobDef {
  const urgent = urgentTerms(from, to, job.reward);
  return {
    ...job,
    title: `Urgent: ${job.title}`,
    difficultyNote: `${job.difficultyNote}; +${urgent.bonus} cr if there within ${urgent.seconds / 60} min of accepting`,
    contract: { ...job.contract!, urgent },
  };
}

function parcel(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  const options = openStations().filter((l) => l.id !== giver.id && jumpsBetween(giver.systemId, l.systemId) <= CONTRACTS.maxJumps.parcel);
  if (!options.length) return null;
  const dest = r.pick(options);
  const rw = CONTRACTS.reward.parcel;
  const reward = pay(r, routeFeeBetween(giver.systemId, dest.systemId), rw.base + rw.danger * (1 - security(dest.systemId)));
  const difficulty = difficultyFor(giver.systemId, dest.systemId);
  const what = r.pick(['sealed legal papers', 'a crate of spare circuit boards', 'personal letters and data chips', 'a sealed medical sample case', 'encrypted navigation updates']);
  const job: JobDef = {
    ...common(giver, id, difficulty),
    title: `Parcel to ${dest.name}`,
    briefing: `Carry ${what} to ${place(dest)}. It fits in a pocket: no cargo space needed.`,
    objectives: [{ kind: 'visit', locationId: dest.id, text: `Deliver the parcel to ${place(dest)}` }],
    reward,
    difficultyNote: routeNote(giver.systemId, dest.systemId),
    destinationLocationId: dest.id,
    contract: { kind: 'parcel' },
  };
  return r.next() < CONTRACTS.urgent.chance ? makeUrgent(job, giver.systemId, dest.systemId) : job;
}

function freight(giver: FictionalLocation, r: Rng, id: string, clock: number, opts: { commodity?: CommodityId; event?: WorldEvent } = {}): JobDef | null {
  const markets = marketTables();
  const here = markets.get(giver.id);
  if (!here) return null;
  const made = [...here.entries.values()].filter((e) => e.role === 'produce' && isLegalCargo(e.commodity)).map((e) => e.commodity);
  if (!made.length || (opts.commodity && !made.includes(opts.commodity))) return null;
  const commodity = opts.commodity ?? r.pick(made);
  const dests = openStations().filter((l) => {
    if (l.id === giver.id || jumpsBetween(giver.systemId, l.systemId) > CONTRACTS.maxJumps.freight) return false;
    const e = markets.get(l.id)?.entries.get(commodity);
    return !!e && e.role !== 'produce';
  });
  if (!dests.length) return null;
  const dest = r.pick(dests);
  const destEntry = markets.get(dest.id)!.entries.get(commodity)!;
  const good = COMMODITIES[commodity];
  const qty = Math.max(1, Math.min(Math.round(r.int(CONTRACTS.cargoUnits[0], CONTRACTS.cargoUnits[1]) / good.unitSize), Math.max(2, Math.floor(CONTRACTS.cargoValueCap.freight / good.basePrice))));
  // The deposit is a little more than the cargo fetches at its destination (events included), so selling it pays less than delivering.
  const deposit = round5(qty * destEntry.mid * (1 - destEntry.spread / 2) * 1.1 * Math.max(1, priceMultiplier(dest.id, commodity, clock)));
  const rw = CONTRACTS.reward.freight;
  const reward = pay(r, routeFeeBetween(giver.systemId, dest.systemId), (rw.base + rw.danger * (1 - security(dest.systemId)) + rw.cargoShare * qty * good.basePrice) * premium(opts.event));
  const difficulty = difficultyFor(giver.systemId, dest.systemId);
  const name = good.name.toLowerCase();
  const why = opts.event ? `${opts.event.headline}. ` : '';
  const job: JobDef = {
    ...common(giver, id, difficulty),
    title: opts.event ? `Surplus haul: ${qty} ${name} to ${dest.name}` : `Haul ${qty} ${name} to ${dest.name}`,
    briefing: `${why}${giver.name} has ${qty} ${name} (${qty * good.unitSize} hold units) bound for ${place(dest)}. We load it on acceptance against a deposit of ${deposit} cr, returned with your pay on delivery.`,
    objectives: [{ kind: 'deliver', commodity, qty, locationId: dest.id, text: `Deliver ${qty} ${name} to ${place(dest)}` }],
    reward,
    difficultyNote: routeNote(giver.systemId, dest.systemId),
    destinationLocationId: dest.id,
    contract: { kind: 'freight', cargo: { commodity, qty }, deposit, ...(opts.event ? { event: opts.event.id } : {}) },
  };
  return !opts.event && r.next() < CONTRACTS.urgent.chance ? makeUrgent(job, giver.systemId, dest.systemId) : job;
}

function supply(giver: FictionalLocation, r: Rng, id: string, clock: number, opts: { commodity?: CommodityId; event?: WorldEvent } = {}): JobDef | null {
  const markets = marketTables();
  const here = markets.get(giver.id);
  if (!here) return null;
  const wanted = [...here.entries.values()].filter((e) => e.role === 'consume' && isLegalCargo(e.commodity)).map((e) => e.commodity);
  if (!wanted.length || (opts.commodity && !wanted.includes(opts.commodity))) return null;
  const commodity = opts.commodity ?? r.pick(wanted);
  // Where to buy it: the nearest station that makes it.
  const sources = openStations()
    .map((l) => ({ l, e: markets.get(l.id)?.entries.get(commodity), j: jumpsBetween(giver.systemId, l.systemId) }))
    .filter((x) => x.e?.role === 'produce' && x.j <= CONTRACTS.maxJumps.supply && x.l.id !== giver.id)
    .sort((a, b) => a.j - b.j || routeFeeBetween(giver.systemId, a.l.systemId) - routeFeeBetween(giver.systemId, b.l.systemId));
  const source = sources[0];
  if (!source) return null;
  const good = COMMODITIES[commodity];
  // What the goods cost at the source right now (an event there moves it).
  const unit = Math.round(source.e!.mid * (1 + source.e!.spread / 2) * priceMultiplier(source.l.id, commodity, clock));
  const qty = Math.max(1, Math.min(Math.round(r.int(CONTRACTS.cargoUnits[0], Math.round(CONTRACTS.cargoUnits[1] * 0.8)) / good.unitSize), Math.max(2, Math.floor(CONTRACTS.cargoValueCap.supply / unit))));
  const rw = CONTRACTS.reward.supply;
  const markup = opts.event ? rw.urgentMarkup : rw.goodsMarkup;
  // The goods are paid back in full; the markup varies.
  const reward = pay(r, routeFeeBetween(giver.systemId, source.l.systemId), (rw.base + (markup - 1) * qty * unit) * premium(opts.event), qty * unit);
  const difficulty = clampDifficulty(1 + (source.j >= 2 ? 1 : 0) + (security(source.l.systemId) < 0.35 ? 1 : 0));
  const name = good.name.toLowerCase();
  const title = !opts.event ? `Supply run: ${qty} ${name}` : opts.event.kind === 'shortage' ? `Shortage run: ${qty} ${name}` : `Boom supplies: ${qty} ${name}`;
  return {
    ...common(giver, id, difficulty),
    title,
    briefing: `${opts.event ? `${opts.event.headline}. ` : ''}${giver.name} ${opts.event ? 'needs' : 'is short of'} ${name}. Bring ${qty} (${qty * good.unitSize} hold units). ${place(source.l)} makes them, at about ${unit} cr each.`,
    objectives: [{ kind: 'deliver', commodity, qty, locationId: giver.id, text: `Bring ${qty} ${name} to ${giver.name}` }],
    reward,
    difficultyNote: `Buy at ${source.l.name}: ${routeNote(giver.systemId, source.l.systemId).toLowerCase()}`,
    destinationLocationId: giver.id,
    briefingPrices: { locationId: source.l.id, prices: { [commodity]: { buy: unit, sell: null } } as Partial<Record<CommodityId, { buy: number; sell: null }>> },
    contract: { kind: 'supply', ...(opts.event ? { event: opts.event.id } : {}) },
  };
}

function bounty(giver: FictionalLocation, r: Rng, id: string, opts: { event?: WorldEvent } = {}): JobDef | null {
  const raid = opts.event;
  const targets = raid ? [getSystem(raid.systemId)] : SYSTEMS.filter((s) => jumpsBetween(giver.systemId, s.id) <= CONTRACTS.maxJumps.bounty && trafficFor(s.id, 'high').plan.packs);
  if (!targets.length) return null;
  const system = r.pick(targets);
  // A raid's packs are nastier than the system's usual ones.
  const packs = raid?.level ? { level: raid.level } : trafficFor(system.id, 'high').plan.packs!;
  // The pack lurks by the raider den, or preys on the approach to one of the system's stations.
  const here = ALL_LOCATIONS.filter((l) => l.systemId === system.id && l.status === 'functional');
  const den = here.find((l) => l.dockable === false);
  const open = here.filter((l) => l.dockable !== false);
  const near = den ?? (open.length ? r.pick(open) : null);
  if (!near) return null;
  const level = packs.level;
  const count = level + 1;
  const rw = CONTRACTS.reward.bounty;
  const reward = pay(r, routeFeeBetween(giver.systemId, system.id), (rw.base + rw.perRaider * count * level) * premium(raid));
  const common_ = common(giver, id, level);
  return {
    ...common_,
    repReward: { ...common_.repReward, 'hollow-wake': -3 },
    title: raid ? `Raid response: ${system.displayName}` : `Bounty: raiders near ${near.name}`,
    briefing: `${raid ? `${raid.headline}. ` : ''}A Hollow Wake pack of ${count} has been preying on ships near ${near.name} in ${system.displayName}. Find them and destroy them all. The contract pays when the last one goes down.`,
    objectives: [{ kind: 'bounty', systemId: system.id, locationId: near.id, count, level, text: `Destroy ${count} raiders near ${place(near)}` }],
    reward,
    difficultyNote: `Threat ${level} of 3; ${routeNote(giver.systemId, system.id).toLowerCase()}`,
    destinationLocationId: near.id,
    contract: { kind: 'bounty', ...(raid ? { event: raid.id } : {}) },
  };
}

function survey(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  const planets = SYSTEMS.filter((s) => jumpsBetween(giver.systemId, s.id) <= CONTRACTS.maxJumps.survey).flatMap((s) => s.confirmedBodies.map((p) => ({ p, s })));
  if (!planets.length) return null;
  const { p, s } = r.pick(planets);
  const rw = CONTRACTS.reward.survey;
  const reward = pay(r, routeFeeBetween(giver.systemId, s.id), (rw.base + rw.danger * (1 - security(s.id))) * (isFrontier(s.id) ? rw.frontier : 1));
  const difficulty = difficultyFor(giver.systemId, s.id);
  const what =
    p.status === 'confirmed'
      ? `a confirmed planet in ${s.displayName}`
      : p.status === 'candidate'
        ? `a candidate planet in ${s.displayName} that no one has confirmed; the readings could settle it`
        : `a planet in ${s.displayName} the archives disagree about; the readings could settle it`;
  return {
    ...common(giver, id, difficulty),
    title: `Survey ${p.displayName}`,
    briefing: `${giver.name} wants fresh instrument readings of ${p.displayName}, ${what}. Fly close enough for your scanner to log it.`,
    objectives: [{ kind: 'scan', bodyId: p.id, systemId: s.id, text: `Scan ${p.displayName} (${s.displayName})` }],
    reward,
    difficultyNote: routeNote(giver.systemId, s.id),
    destinationLocationId: giver.id,
    contract: { kind: 'survey' },
  };
}

/** Escorts: see a trader safely to another station in the system; raiders will try for it. */
function escort(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  const system = giver.systemId;
  const threat = baseThreat(system);
  if (threat === null && security(system) >= 0.75) return null;
  const dests = openStations().filter((l) => l.systemId === system && l.id !== giver.id);
  if (!dests.length) return null;
  const dest = r.pick(dests);
  const level = threat ?? 1;
  const owner = giver.factionId === 'sta' || giver.factionId === 'frontier' ? giver.factionId : 'independent';
  const model = r.pick(FLEETS[owner].traders.length ? FLEETS[owner].traders : FLEETS.independent.traders);
  const shipName = shipModel(model).name;
  const rw = CONTRACTS.reward.escort;
  const reward = pay(r, 0, rw.base + rw.perLevel * level);
  return {
    ...common(giver, id, level),
    title: `Escort the ${shipName} to ${dest.name}`,
    briefing: `The ${shipName} is hauling cargo to ${place(dest)} and wants a gun alongside: raiders have been watching the lane. It sets off when you launch. Stay close and see it docked; if it is lost, or you leave the system first, the contract fails.`,
    objectives: [{ kind: 'escort', systemId: system, fromLocationId: giver.id, locationId: dest.id, model, shipName, level, text: `Escort the ${shipName} to ${dest.name}` }],
    reward,
    difficultyNote: `Threat ${level} of 3; expect an ambush on the way`,
    destinationLocationId: dest.id,
    contract: { kind: 'escort' },
  };
}

/** Aces: a named raider in a better ship, with two guards, where the packs are nasty. */
function ace(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  const targets = SYSTEMS.filter((s) => jumpsBetween(giver.systemId, s.id) <= CONTRACTS.maxJumps.ace && (baseThreat(s.id) ?? 0) >= 2);
  if (!targets.length) return null;
  const system = r.pick(targets);
  const here = ALL_LOCATIONS.filter((l) => l.systemId === system.id && l.status === 'functional');
  const den = here.find((l) => l.dockable === false);
  const open = here.filter((l) => l.dockable !== false);
  const near = den ?? (open.length ? r.pick(open) : null);
  if (!near) return null;
  const name = `${r.pick(ACE_NAMES.first)} “${r.pick(ACE_NAMES.nick)}” ${r.pick(ACE_NAMES.last)}`;
  const reward = pay(r, routeFeeBetween(giver.systemId, system.id), CONTRACTS.reward.ace.base);
  const common_ = common(giver, id, 3);
  return {
    ...common_,
    repReward: { ...common_.repReward, 'hollow-wake': -5 },
    title: `Wanted: ${name}`,
    briefing: `${name} flies a Hollow Wake heavy fighter out of ${place(near)}, with two guards and a long list of kills. Bring the ace down; the guards pay the usual bounty, and whatever the ace was carrying is yours to tractor in.`,
    objectives: [{ kind: 'bounty', systemId: system.id, locationId: near.id, count: 1, level: 3, text: `Destroy ${name} near ${place(near)}`, ace: { name, model: CONTRACTS.ace.model } }],
    reward,
    difficultyNote: `An ace with two guards; ${routeNote(giver.systemId, system.id).toLowerCase()}`,
    destinationLocationId: near.id,
    contract: { kind: 'ace' },
  };
}

/**
 * A den assault (docs/PROCGEN.md §15): knock out a raider den within reach, its turrets and then
 * its reactor, with a wing of the posting faction; the Wake does not forget it.
 */
function denAssault(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  if (giver.factionId !== 'sta' && giver.factionId !== 'frontier') return null;
  const dens = ALL_LOCATIONS.filter((l) => l.stationType === 'pirate-den' && l.status === 'functional' && jumpsBetween(giver.systemId, l.systemId) <= CONTRACTS.maxJumps.den);
  if (!dens.length) return null;
  const den = r.pick(dens);
  const faction = FACTIONS[giver.factionId];
  const reward = pay(r, routeFeeBetween(giver.systemId, den.systemId), CONTRACTS.reward.den.base);
  const common_ = common(giver, id, 3);
  return {
    ...common_,
    repReward: { ...common_.repReward, 'hollow-wake': -15 },
    title: `Knock out ${den.name}`,
    briefing: `${den.name}, the raider den at ${getSystem(den.systemId).displayName}, keeps sending packs onto the lanes. Knock out its turrets, then its reactor; a ${faction.shortName} wing flies with you. A den knocked out stays dark for hours, and its system is quiet while it does.`,
    objectives: [{ kind: 'assault', systemId: den.systemId, locationId: den.id, text: `Knock out ${den.name}: its turrets, then its reactor` }],
    reward,
    difficultyNote: `A raider den, its guns and its mines; ${routeNote(giver.systemId, den.systemId).toLowerCase()}`,
    destinationLocationId: den.id,
    contract: { kind: 'den' },
  };
}

/** Recoveries: find a wreck near a station, tractor in what it carried, and bring it back. */
function recovery(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  const sites = ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.id !== giver.id && jumpsBetween(giver.systemId, l.systemId) <= CONTRACTS.maxJumps.recovery);
  if (!sites.length) return null;
  const site = r.pick(sites);
  const guard = baseThreat(site.systemId);
  const what = r.pick(RECOVERY_ITEMS);
  const rw = CONTRACTS.reward.recovery;
  const reward = pay(r, routeFeeBetween(giver.systemId, site.systemId), rw.base + rw.danger * (1 - security(site.systemId)) + rw.perGuard * (guard ?? 0));
  const difficulty = clampDifficulty(1 + (guard ? 1 : 0) + (guard === 3 || jumpsBetween(giver.systemId, site.systemId) >= 3 ? 1 : 0));
  return {
    ...common(giver, id, difficulty),
    title: `Recover a ${what.item}`,
    briefing: `${what.why.replace('{place}', place(site))}. Find the wreck, tractor the ${what.item} aboard and bring it back to ${giver.name}.${guard ? ' Raiders have been seen picking over the wreckage.' : ''}`,
    objectives: [
      { kind: 'recover', systemId: site.systemId, locationId: site.id, item: what.item, guard, text: `Recover the ${what.item} from the wreck near ${place(site)}` },
      { kind: 'visit', locationId: giver.id, text: `Bring the ${what.item} back to ${giver.name}` },
    ],
    reward,
    difficultyNote: `${guard ? `Wreck guarded, threat ${guard} of 3; ` : ''}${routeNote(giver.systemId, site.systemId).toLowerCase()}`,
    destinationLocationId: giver.id,
    contract: { kind: 'recovery' },
  };
}

/**
 * Smuggling (free ports and raider dens): contraband loaded against a deposit, for a buyer in
 * claimed space, where patrols scan cargo. Never to a dock whose customs scans every ship.
 */
function smuggle(giver: FictionalLocation, r: Rng, id: string, clock: number): JobDef | null {
  const markets = marketTables();
  const here = markets.get(giver.id);
  const made = LAW.contraband.filter((c) => here?.entries.get(c)?.role === 'produce');
  if (!made.length) return null;
  const commodity = r.pick(made);
  const dests = openStations().filter((l) => {
    if (l.id === giver.id || jumpsBetween(giver.systemId, l.systemId) > CONTRACTS.maxJumps.smuggle || !lawIn(l.systemId) || scansOnDocking(l.id)) return false;
    const e = markets.get(l.id)?.entries.get(commodity);
    return !!e && e.role !== 'produce';
  });
  if (!dests.length) return null;
  const dest = r.pick(dests);
  const e = markets.get(dest.id)!.entries.get(commodity)!;
  const good = COMMODITIES[commodity];
  const qty = r.int(6, 12);
  const deposit = round5(qty * e.mid * (1 - e.spread / 2) * 1.1 * Math.max(1, priceMultiplier(dest.id, commodity, clock)));
  const rw = CONTRACTS.reward.smuggle;
  const reward = pay(r, routeFeeBetween(giver.systemId, dest.systemId), rw.base + rw.danger * (1 - security(dest.systemId)) + rw.contrabandShare * qty * good.basePrice);
  const difficulty = clampDifficulty(2 + (security(dest.systemId) >= 0.75 || jumpsBetween(giver.systemId, dest.systemId) >= 3 ? 1 : 0));
  const law = lawIn(dest.systemId)!;
  const name = good.name.toLowerCase();
  return {
    ...common(giver, id, difficulty),
    repReward: { 'hollow-wake': CONTRACTS.outlawWake.smuggle },
    title: `Smuggle ${qty} ${name} to ${dest.name}`,
    briefing: `A buyer at ${place(dest)} is waiting for ${qty} ${name}: contraband in ${FACTIONS[law].name} space. We load it on acceptance against a deposit of ${deposit} cr. Patrols there scan cargo, and customs depots and military bases scan every ship that docks: get caught and it is confiscated, with a fine.`,
    objectives: [{ kind: 'deliver', commodity, qty, locationId: dest.id, text: `Deliver ${qty} ${name} to ${place(dest)}` }],
    reward,
    difficultyNote: `Contraband in claimed space; ${routeNote(giver.systemId, dest.systemId).toLowerCase()}`,
    destinationLocationId: dest.id,
    contract: { kind: 'smuggle', cargo: { commodity, qty }, deposit },
  };
}

/** Piracy (raider dens only): destroy haulers of a lawful faction in a system within reach. */
function piracy(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  const targets = SYSTEMS.filter((s) => jumpsBetween(giver.systemId, s.id) <= CONTRACTS.maxJumps.piracy && lawIn(s.id) && trafficFor(s.id, 'high').plan.traders > 0);
  if (!targets.length) return null;
  const system = r.pick(targets);
  const law = lawIn(system.id)!;
  const count = r.int(2, 3);
  const rw = CONTRACTS.reward.piracy;
  const reward = pay(r, routeFeeBetween(giver.systemId, system.id), rw.base + rw.perShip * count);
  const difficulty = clampDifficulty(2 + (security(system.id) >= 0.6 ? 1 : 0));
  return {
    ...common(giver, id, difficulty),
    repReward: { 'hollow-wake': CONTRACTS.outlawWake.piracy },
    title: `Hit the ${FACTIONS[law].shortName} haulers in ${system.displayName}`,
    briefing: `The Wake wants the ${FACTIONS[law].name} to feel it. Destroy ${count} of the haulers working ${system.displayName}. Every one you hit is a crime: expect fines, angry patrols and, if the fines mount up, bounty hunters.`,
    objectives: [{ kind: 'piracy', systemId: system.id, faction: law, count, text: `Destroy ${count} ${FACTIONS[law].shortName} haulers in ${system.displayName}` }],
    reward,
    difficultyNote: `A crime against the ${FACTIONS[law].shortName}; ${routeNote(giver.systemId, system.id).toLowerCase()}`,
    destinationLocationId: giver.id,
    contract: { kind: 'piracy' },
  };
}

/**
 * A follow-up to a delivered parcel or haul, offered at its destination (docs/PROCGEN.md §10.2):
 * deterministic from the contract's id, so it is the same whenever it is asked for.
 */
export function followUpFor(job: JobDef, clock: number): JobDef | null {
  const c = job.contract;
  if (!c || (c.kind !== 'parcel' && c.kind !== 'freight')) return null;
  const step = (c.chain?.step ?? 1) + 1;
  if (step > CONTRACTS.chain.maxSteps) return null;
  const r = rng(WORLD_SEED, 'chain', job.id);
  if (r.next() >= CONTRACTS.chain.chance) return null;
  const giver = getLocation(job.destinationLocationId);
  if (!boardKinds(giver)) return null;
  const id = `${CONTRACT_PREFIX}${giver.id}.f${hashString(job.id).toString(36)}`;
  const next = (r.next() < 0.5 ? freight(giver, r, id, clock) : null) ?? parcel(giver, r, id);
  if (!next) return null;
  const reward = round5(next.reward * CONTRACTS.chain.stepPay ** (step - 1));
  const urgent = next.contract?.urgent ? { ...next.contract.urgent, bonus: round5(reward * CONTRACTS.urgent.bonus) } : undefined;
  return {
    ...next,
    title: `Follow-up: ${next.title}`,
    briefing: `Word of your delivery for ${getLocation(job.giverLocationId).name} got around. ${next.briefing}`,
    reward,
    difficultyNote: urgent ? next.difficultyNote.replace(/\+\d+ cr if/, `+${urgent.bonus} cr if`) : next.difficultyNote,
    contract: { ...next.contract!, ...(urgent ? { urgent } : {}), chain: { step, parent: job.id, expires: clock + CONTRACTS.chain.offerEpochs * CONTRACTS.epochSeconds } },
  };
}

// ---------------------------------------------------------------- the board as the player sees it

/** Why a posted contract cannot be accepted right now (beyond standing), or null. */
export function contractBlock(state: GameState, job: JobDef): string | null {
  const c = job.contract;
  if (!c) return null;
  const active = Object.entries(state.jobs).filter(([id, p]) => p.status === 'active' && id.startsWith(CONTRACT_PREFIX)).length;
  if (active >= CONTRACTS.maxActive) return `You already have ${CONTRACTS.maxActive} contracts in progress`;
  if (c.cargo && itemsThatFit(state.ship.cargo, c.cargo.commodity, cargoCapacity(state.ship)) < c.cargo.qty) {
    return `Needs ${c.cargo.qty * COMMODITIES[c.cargo.commodity].unitSize} free hold units`;
  }
  if (c.deposit && state.credits < c.deposit) return `Needs ${c.deposit} cr for the deposit`;
  const o = job.objectives[0];
  if (c.kind === 'survey' && o?.kind === 'scan' && state.discoveredBodies.includes(o.bodyId)) return 'You have already scanned this planet';
  return null;
}

/** Posted contracts at a station for the player's current time slot. */
export function postedContracts(state: GameState, locationId: string): JobDef[] {
  const loc = getLocation(locationId);
  // The hand-made stations join in once the opening delivery is done.
  if (!loc.stationType && state.jobs.lifeline?.status !== 'complete') return [];
  // Dens deal only with pilots the Wake trusts; a station that only lets you in for repairs posts nothing.
  if (loc.stationType === 'pirate-den' && !wakeFriendly(state)) return [];
  if (dockAccess(state, locationId) !== 'full') return [];
  return boardFor(locationId, boardEpoch(state.clock)).filter((c) => {
    if (state.jobs[c.id]) return true;
    const o = c.objectives[0];
    return !(c.contract?.kind === 'survey' && o?.kind === 'scan' && state.discoveredBodies.includes(o.bodyId));
  });
}
