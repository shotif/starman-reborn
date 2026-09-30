import type { CommodityId, GameState } from '../app/state.ts';
import { BOARD_KINDS, CONTRACTS, CURATED_BOARD_KINDS, type ContractKind, type KindWeights } from '../content/contracts/rules.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { rng, type Rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { ALL_LOCATIONS, getLocation, getSystem, SYSTEMS, WORLD } from '../data/systems.ts';
import type { FactionId, FictionalLocation, SystemId } from '../data/types.ts';
import { findRoute } from '../galaxy/routing.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { itemsThatFit } from './cargo.ts';
import { priceMultiplier, stationEventAt, systemEventAt, type WorldEvent } from './events.ts';
import type { JobDef } from './jobs.ts';
import { cargoCapacity } from './loadout.ts';
import { marketTables } from './markets.ts';

/**
 * Generated contracts (docs/PROCGEN.md §10). Every station with a contracts service posts a board
 * that changes with the game clock: freight hauls, parcels, supply runs, bounties on raider packs
 * and planet surveys, chosen by the kind of station and pointed at real places in the world.
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
function jumpsBetween(a: SystemId, b: SystemId): number {
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
function openStations(): FictionalLocation[] {
  return ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.dockable !== false && l.services.length > 0);
}

function boardKinds(loc: FictionalLocation): KindWeights | null {
  if (!loc.services.includes('contracts') || loc.status !== 'functional' || loc.dockable === false) return null;
  return CURATED_BOARD_KINDS[loc.id] ?? (loc.stationType && loc.stationType !== 'pirate-den' ? BOARD_KINDS[loc.stationType] : null);
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
    for (let attempt = 0; out.length < size && attempt < size * 5; attempt++) {
      const kind = weightedPick(r, kinds, kinds.map((k) => weights[k] ?? 0));
      const c = makeContract(kind, loc, r, `${CONTRACT_PREFIX}${locationId}.${epoch}.${out.length}`, clock);
      if (c && !out.some((o) => o.title === c.title)) out.push(c);
    }
    // Work answering a world event, from its own stream so the rest of the board does not move.
    const e = eventContract(loc, rng(WORLD_SEED, 'contracts', 'event', locationId, epoch), `${CONTRACT_PREFIX}${locationId}.${epoch}.${out.length}`, clock);
    if (e && !out.some((o) => o.title === e.title)) out.push(e);
  }
  if (boardCache.size > 400) boardCache.clear();
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

function parcel(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  const options = openStations().filter((l) => l.id !== giver.id && jumpsBetween(giver.systemId, l.systemId) <= CONTRACTS.maxJumps.parcel);
  if (!options.length) return null;
  const dest = r.pick(options);
  const rw = CONTRACTS.reward.parcel;
  const reward = pay(r, routeFeeBetween(giver.systemId, dest.systemId), rw.base + rw.danger * (1 - security(dest.systemId)));
  const difficulty = difficultyFor(giver.systemId, dest.systemId);
  const what = r.pick(['sealed legal papers', 'a crate of spare circuit boards', 'personal letters and data chips', 'a sealed medical sample case', 'encrypted navigation updates']);
  return {
    ...common(giver, id, difficulty),
    title: `Parcel to ${dest.name}`,
    briefing: `Carry ${what} to ${place(dest)}. It fits in a pocket: no cargo space needed.`,
    objectives: [{ kind: 'visit', locationId: dest.id, text: `Deliver the parcel to ${place(dest)}` }],
    reward,
    difficultyNote: routeNote(giver.systemId, dest.systemId),
    destinationLocationId: dest.id,
    contract: { kind: 'parcel' },
  };
}

function freight(giver: FictionalLocation, r: Rng, id: string, clock: number, opts: { commodity?: CommodityId; event?: WorldEvent } = {}): JobDef | null {
  const markets = marketTables();
  const here = markets.get(giver.id);
  if (!here) return null;
  const made = [...here.entries.values()].filter((e) => e.role === 'produce' && e.commodity !== 'weapons').map((e) => e.commodity);
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
  return {
    ...common(giver, id, difficulty),
    title: opts.event ? `Surplus haul: ${qty} ${name} to ${dest.name}` : `Haul ${qty} ${name} to ${dest.name}`,
    briefing: `${why}${giver.name} has ${qty} ${name} (${qty * good.unitSize} hold units) bound for ${place(dest)}. We load it on acceptance against a deposit of ${deposit} cr, returned with your pay on delivery.`,
    objectives: [{ kind: 'deliver', commodity, qty, locationId: dest.id, text: `Deliver ${qty} ${name} to ${place(dest)}` }],
    reward,
    difficultyNote: routeNote(giver.systemId, dest.systemId),
    destinationLocationId: dest.id,
    contract: { kind: 'freight', cargo: { commodity, qty }, deposit, ...(opts.event ? { event: opts.event.id } : {}) },
  };
}

function supply(giver: FictionalLocation, r: Rng, id: string, clock: number, opts: { commodity?: CommodityId; event?: WorldEvent } = {}): JobDef | null {
  const markets = marketTables();
  const here = markets.get(giver.id);
  if (!here) return null;
  const wanted = [...here.entries.values()].filter((e) => e.role === 'consume' && e.commodity !== 'weapons').map((e) => e.commodity);
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
  const reward = pay(r, routeFeeBetween(giver.systemId, s.id), rw.base + rw.danger * (1 - security(s.id)));
  const difficulty = difficultyFor(giver.systemId, s.id);
  return {
    ...common(giver, id, difficulty),
    title: `Survey ${p.displayName}`,
    briefing: `${giver.name} wants fresh instrument readings of ${p.displayName}, a confirmed planet in ${s.displayName}. Fly close enough for your scanner to log it.`,
    objectives: [{ kind: 'scan', bodyId: p.id, systemId: s.id, text: `Scan ${p.displayName} (${s.displayName})` }],
    reward,
    difficultyNote: routeNote(giver.systemId, s.id),
    destinationLocationId: giver.id,
    contract: { kind: 'survey' },
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
  return boardFor(locationId, boardEpoch(state.clock)).filter((c) => {
    if (state.jobs[c.id]) return true;
    const o = c.objectives[0];
    return !(c.contract?.kind === 'survey' && o?.kind === 'scan' && state.discoveredBodies.includes(o.bodyId));
  });
}
