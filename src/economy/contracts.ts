import type { CommodityId, GameState } from '../app/state.ts';
import { shipModel } from '../content/catalog.ts';
import { ACE_NAMES, BOARD_KINDS, CONTRACTS, CONVOY_NAMES, CURATED_BOARD_KINDS, DEN_BOARD_KINDS, FRONTIER_SURVEY_WEIGHT, RECOVERY_ITEMS, WAR_BOARD_WEIGHT, type ContractKind, type KindWeights } from '../content/contracts/rules.ts';
import { BORDER } from '../content/border/rules.ts';
import { LAW } from '../content/law/rules.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { beltGoods } from '../content/mining/rules.ts';
import { PASSENGERS } from '../content/passengers/rules.ts';
import type { Sight } from '../content/passengers/sights.ts';
import { FIRST_NAMES, LAST_NAMES } from '../content/people/lines.ts';
import { hashString, rng, type Rng } from '../content/random.ts';
import type { LastingMark } from '../content/story/marks.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { ALL_LOCATIONS, BELTS, getLocation, getSystem, isFrontier, PYRE_LOCATIONS, saveLocationsKey, SYSTEMS, WORLD } from '../data/systems.ts';
import type { FactionId, FictionalLocation, SystemId } from '../data/types.ts';
import { findRoute } from '../galaxy/routing.ts';
import { FLEETS } from '../world/traffic/plan.ts';
import { inViewFromStation, tourSights } from '../world/sightseeing.ts';
import { takenIds } from './rivals.ts';
import { farStar, fillSky, skyOffers } from './stellar.ts';
import { OBSERVE_LINES } from '../content/stellar/lines.ts';
import { DOOMED } from '../content/stellar/doomed.ts';
import { EDGE_JOBS } from '../content/stellar/doomedLines.ts';
import { fillPyreJob, pyreOffers, pyreRefugeId, PYRE_HOLE_ID } from './doomed.ts';
import { STELLAR } from '../content/stellar/rules.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { atWar, decisiveOpen, EXPOSED, FRONTS, frontState, momentum, occupied, settledKey, type FrontState } from './border.ts';
import { itemsThatFit } from './cargo.ts';
import { activeEdge, activeSkyFrom, baseThreat, marksAt, marksKey, priceMultiplier, stationEventAt, systemEventAt, worldLogKey, type WorldEvent } from './events.ts';
import { FACTIONS } from './factions.ts';
import { dockAccess, lawIn, scansOnDocking, wakeFriendly } from './law.ts';
import type { JobDef } from './jobs.ts';
import { cargoCapacity } from './loadout.ts';
import { eventHaulsFrom, raidsOnWay } from './hauls.ts';
import { berths } from './passengers.ts';
import { marketTables } from './markets.ts';

/**
 * Generated contracts (docs/PROCGEN.md §10). Every station with a contracts service posts a board
 * that changes with the game clock: freight hauls, parcels, supply runs, bounties on raider packs,
 * planet surveys, escorts, aces and wreck recoveries, chosen by the kind of station and pointed at
 * real places in the world, and war work while a border front nearby is fighting. Some parcels and
 * hauls are urgent, and some lead to a follow-up. A board is a pure function of the station, its
 * time slot and the world (world events and the border war included, as they stand when the board
 * is posted); an accepted contract is copied into the save, so it never changes under the player.
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

/**
 * Something to fear in a system: raider packs, or thin security. Escorts are posted only to such
 * places, and raiders wait at its jump beacon for escorted ships arriving through it.
 */
export function escortDanger(systemId: SystemId): boolean {
  return baseThreat(systemId) !== null || security(systemId) < CONTRACTS.escort.secureAbove;
}

/**
 * Stations a pilot can dock at and do business with, as contract destinations: never a station on a
 * border front that can fall to the Wake (docs/PROCGEN.md §20), where a delivery could not be made.
 */
let open: FictionalLocation[] | null = null;
function openStations(): FictionalLocation[] {
  return (open ??= ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.dockable !== false && l.services.length > 0 && !EXPOSED.has(l.id)));
}

/** What a station's board posts, whatever the time (the border war adds to it while a front fights). */
function standingKinds(loc: FictionalLocation): KindWeights | null {
  let kinds: KindWeights | null;
  if (loc.stationType === 'pirate-den') kinds = loc.status === 'functional' ? DEN_BOARD_KINDS : null;
  else if (!loc.services.includes('contracts') || loc.status !== 'functional' || loc.dockable === false) kinds = null;
  else kinds = CURATED_BOARD_KINDS[loc.id] ?? (loc.stationType ? BOARD_KINDS[loc.stationType] : null);
  if (!kinds) return null;
  // Out in the frontier every board wants the new systems surveyed.
  return isFrontier(loc.systemId) && loc.stationType !== 'pirate-den' ? { ...kinds, survey: (kinds.survey ?? 0) + FRONTIER_SURVEY_WEIGHT } : kinds;
}

function boardKinds(loc: FictionalLocation, clock: number): KindWeights | null {
  const kinds = standingKinds(loc);
  if (!kinds) return null;
  // War work joins while a front within reach is fighting; other boards stay exactly as they were.
  const war = loc.stationType ? WAR_BOARD_WEIGHT[loc.stationType] : undefined;
  return war && warFronts(loc, clock).length ? { ...kinds, war } : kinds;
}

/** Stations that post mining claims (mining outposts, refineries and the Eridani Mining Hub). */
export function postsClaims(loc: FictionalLocation): boolean {
  return (standingKinds(loc)?.claim ?? 0) > 0;
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
  // The border war, its settled fronts and lasting marks are the save's own, so boards are kept per save.
  const key = `${locationId}|${epoch}|${worldLogKey()}|${marksKey()}|${settledKey()}|${saveLocationsKey()}|${activeSkyFrom() ?? ''}|${activeEdge() ?? ''}`;
  const cached = boardCache.get(key);
  if (cached) return cached;
  const loc = getLocation(locationId);
  const clock = epoch * CONTRACTS.epochSeconds;
  // Pyre's stations post only Pyre's own work (docs/PROCGEN.md §26.5).
  if (PYRE_LOCATIONS.some((l) => l.id === locationId)) {
    const own = pyreContracts(loc, epoch);
    boardCache.set(key, own);
    return own;
  }
  // A station the Wake holds posts nothing (docs/PROCGEN.md §20).
  const weights = occupied(locationId, clock) ? null : boardKinds(loc, clock);
  const out: JobDef[] = [];
  if (weights) {
    const r = rng(WORLD_SEED, 'contracts', locationId, epoch);
    const b = CONTRACTS.board;
    const size = Math.min(b.max, b.base + ((loc.look?.size ?? 0.8) > b.largeAbove ? 1 : 0) + (loc.stationType && b.busy.includes(loc.stationType) ? 1 : 0));
    const kinds = Object.keys(weights) as ContractKind[];
    // No two contracts of a kind sending you to the same place on one board.
    const placed = new Set<ContractKind>(['parcel', 'freight', 'escort', 'bounty', 'ace', 'smuggle', 'piracy', 'den', 'war']);
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
    // These come and go within a time slot (a front settled, a mark left), so their ids are their
    // own: a contract that appears never takes the id of one that went, which a pilot may hold.
    // A side's decisive operation on a front, once the player has earned it (docs/PROCGEN.md §20.7).
    const d = decisive(loc, rng(WORLD_SEED, 'contracts', 'decisive', locationId, epoch), `${CONTRACT_PREFIX}${locationId}.${epoch}.decisive`, clock);
    if (d) out.push(d);
    // Observations of a dying far star, at research stations (docs/PROCGEN.md §25).
    out.push(...skyContracts(loc, epoch));
    // Pyre's work, once its warning has come (docs/PROCGEN.md §26.5).
    out.push(...pyreContracts(loc, epoch));
    // Escorts for this station's relief and shipments bound through raided lanes (docs/PROCGEN.md §21.7).
    out.push(...reliefEscorts(loc, epoch));
    // Standing runs a lasting mark left here (docs/PROCGEN.md §14.7), each from its own stream.
    for (const mark of marksAt(locationId)) {
      if (!mark.run) continue;
      const id = `${CONTRACT_PREFIX}${locationId}.${epoch}.run-${mark.id.replace(/\./g, '-')}`;
      const run = freight(loc, rng(WORLD_SEED, 'contracts', 'mark', mark.id, epoch), id, clock, { run: mark.run });
      if (run) out.push(run);
    }
  }
  if (boardCache.size > 4_000) boardCache.clear();
  boardCache.set(key, out);
  return out;
}

/** Finds a posted contract by id (ids are `c.<station>.<time slot>.<index>`, or `.decisive` / `.run-<mark>` for those that come and go within a slot). */
export function postedContract(id: string): JobDef | null {
  if (!id.startsWith(CONTRACT_PREFIX)) return null;
  const [locationId, epochText] = id.slice(CONTRACT_PREFIX.length).split('.');
  const epoch = Number(epochText);
  if (!locationId || !Number.isInteger(epoch) || !(ALL_LOCATIONS.some((l) => l.id === locationId) || PYRE_LOCATIONS.some((l) => l.id === locationId))) return null;
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
    case 'claim':
      return claim(giver, r, id);
    case 'war':
      return war(giver, r, id, clock);
    case 'rescue':
      // Only ever posted as work answering a drive failure (eventContract).
      return null;
    case 'passage':
      return passage(giver, r, id);
    case 'tour':
      return tour(giver, r, id);
    case 'observe':
      // Only ever posted while a far star dies (skyContracts).
      return null;
  }
}

/**
 * Observation work at a research station while a far star dies (docs/PROCGEN.md §25), fiction:
 * watch Betelgeuse's first light and peak, or its fading; measure its distance by parallax; watch
 * Antares go out. Each from its own id, as they come and go within a time slot.
 */
function skyContracts(giver: FictionalLocation, epoch: number): JobDef[] {
  if (giver.stationType !== 'research-station') return [];
  const start = epoch * CONTRACTS.epochSeconds;
  return skyOffers(start, start + CONTRACTS.epochSeconds).map((o) => {
    const star = farStar(o.star)!;
    const lines = OBSERVE_LINES[o.kind];
    const text =
      o.kind === 'parallax'
        ? `Observe ${star.name} from two systems at least ${o.baselineLy} ly apart`
        : `Observe ${star.name} from open space`;
    return {
      ...common(giver, `${CONTRACT_PREFIX}${giver.id}.${epoch}.sky-${o.kind}`, o.kind === 'parallax' ? 2 : 1),
      title: fillSky(lines.title, star),
      briefing: fillSky(lines.briefing, star),
      objectives: [
        { kind: 'observe', star: o.star, from: o.from, to: o.to, ...(o.baselineLy ? { baselineLy: o.baselineLy } : {}), text },
        { kind: 'visit', locationId: giver.id, text: `Bring the readings back to ${giver.name}` },
      ],
      reward: STELLAR.observe.reward[o.kind],
      difficultyNote: o.kind === 'parallax' ? `Two systems ${o.baselineLy} ly apart, before ${star.name} fades` : 'Any system, from open space, while the window is open',
      destinationLocationId: giver.id,
      contract: { kind: 'observe' },
    };
  });
}

/**
 * Pyre's work (docs/PROCGEN.md §26.5), fiction like the star: its last record wanted at every
 * research station, its observers carried out of its observatory, its first light seen twice and its
 * black hole read for the research stations near it, and the hole read for its remnant station. Each
 * on the board from the moment it is posted until it lapses, within the time slot; ids their own.
 */
function pyreContracts(giver: FictionalLocation, epoch: number): JobDef[] {
  const start = epoch * CONTRACTS.epochSeconds;
  const J = DOOMED.jobs;
  return pyreOffers(giver.id, start, start + CONTRACTS.epochSeconds).map((o): JobDef => {
    const id = `${CONTRACT_PREFIX}${giver.id}.${epoch}.pyre-${o.kind}`;
    const lines = EDGE_JOBS[o.kind];
    const timing = { posted: o.posted, until: o.until };
    if (o.kind === 'evacuate') {
      const names = party(rng(WORLD_SEED, 'contracts', 'pyre-evacuate', activeEdge() ?? 0), J.evacuate.party);
      const refuge = getLocation(pyreRefugeId());
      const fill = (t: string) => fillPyreJob(t, { giver: giver.name, refuge: refuge.name, party: partyName(names) });
      return {
        ...common(giver, id, 2),
        title: fill(lines.title),
        briefing: `${fill(lines.briefing)} ${BERTHS_NOTE}`,
        objectives: [{ kind: 'visit', locationId: refuge.id, text: fill(lines.objective) }],
        reward: J.evacuate.reward,
        difficultyNote: `One lane, before ${DOOMED.star.name} collapses`,
        destinationLocationId: refuge.id,
        contract: { kind: 'passage', party: names, ...timing },
      };
    }
    const fill = (t: string) => fillPyreJob(t, { giver: giver.name });
    const star = o.kind === 'hole' ? PYRE_HOLE_ID : DOOMED.star.id;
    const twice = o.kind === 'twice' ? { firstLight: J.twice.firstLight, aheadLy: J.twice.aheadLy } : {};
    return {
      ...common(giver, id, o.kind === 'record' ? 1 : 2),
      title: fill(lines.title),
      briefing: fill(lines.briefing),
      objectives: [
        { kind: 'observe', star, from: o.from, to: o.to, ...twice, text: fill(lines.objective) },
        { kind: 'visit', locationId: giver.id, text: `Bring the readings back to ${giver.name}` },
      ],
      reward: J[o.kind].reward,
      difficultyNote: o.kind === 'record' ? 'Any system, from open space, before it explodes' : o.kind === 'twice' ? 'Two systems, timed to its light' : `${DOOMED.star.name}, beyond the lane from ${getSystem(DOOMED.star.anchor).displayName}`,
      destinationLocationId: giver.id,
      contract: { kind: 'observe', ...timing },
    };
  });
}

/**
 * Escorts for relief and shipments bound through raided lanes (docs/PROCGEN.md §21.7): a haul this
 * station sends for a shortage, or out of its own glut, whose way crosses a raid, on its board from
 * when its event begins until the haul is due to set off. Taken on, the haul waits for the pilot
 * and flies with them; its ids are its own, as it comes and goes within a time slot.
 */
function reliefEscorts(giver: FictionalLocation, epoch: number): JobDef[] {
  if (!giver.services.includes('contracts')) return [];
  const start = epoch * CONTRACTS.epochSeconds;
  return eventHaulsFrom(giver.id, start, start + CONTRACTS.epochSeconds).flatMap(({ haul: h, event }) => {
    const raids = raidsOnWay(h);
    const jumps = h.path.length - 1;
    // A board outside the frontier never sends a pilot into it (docs/PROCGEN.md §11): the haulers' drives reach it, a young pilot's do not.
    if (!raids.length || jumps > CONTRACTS.maxJumps.escort || (!isFrontier(giver.systemId) && h.path.some(isFrontier))) return [];
    const level = raids[0]!.level;
    const dest = getLocation(h.to);
    const r = rng(WORLD_SEED, 'contracts', 'relief-escort', h.id);
    const rw = CONTRACTS.reward.escort;
    const reward = pay(r, routeFeeBetween(giver.systemId, dest.systemId), (rw.base + rw.perLevel * level + rw.perJump * jumps) * CONTRACTS.eventPremium);
    const through = [...new Set(raids.map((x) => getSystem(x.systemId).displayName))];
    const where = through.length > 1 ? `${through.slice(0, -1).join(', ')} and ${through.at(-1)}` : through[0]!;
    const cargo = `${h.qty} ${COMMODITIES[h.commodity].name.toLowerCase()}`;
    const what =
      h.kind === 'shipment'
        ? `The ${h.name} is shipping ${cargo} out of ${giver.name}’s glut to ${place(dest)}`
        : `The ${h.name} is taking ${cargo} to ${place(dest)}, which is short of it`;
    const ec = CONTRACTS.escort;
    const how =
      jumps === 0
        ? 'It sets off when you launch: stay close and see it docked.'
        : `It sets off when you launch and keeps with you; jump when it is within ${ec.keepUpM / 1000} km and it jumps with you.`;
    return [
      {
        ...common(giver, `${CONTRACT_PREFIX}${giver.id}.${epoch}.escort-${h.id.replace(/\./g, '-')}`, clampDifficulty(level + (jumps >= 2 ? 1 : 0))),
        title: `Escort the ${h.name} to ${dest.name}`,
        briefing: `${what}, and raiders swarm ${where} on its way. It waits for an escort until it is due to set off, then goes alone. ${how} If it is lost, the contract fails, and its cargo with it.`,
        objectives: [
          {
            kind: 'escort',
            systemId: dest.systemId,
            fromLocationId: giver.id,
            locationId: dest.id,
            model: h.model,
            shipName: h.name,
            level,
            haul: h.id,
            text: `Escort the ${h.name} to ${dest.name}${jumps ? ` (${getSystem(dest.systemId).displayName})` : ''}`,
          },
        ],
        reward,
        difficultyNote: `Raiders swarm ${where}: threat ${level} of 3${jumps ? `; ${routeNote(giver.systemId, dest.systemId).toLowerCase()}` : ''}`,
        destinationLocationId: dest.id,
        contract: { kind: 'escort', event: event.id, haul: h.id, until: h.depart },
      },
    ];
  });
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
  if (own?.kind === 'glut' || own?.kind === 'harvest') {
    const c = freight(giver, r, id, clock, { commodity: own.goods[0]!, event: own });
    if (c) return c;
  }
  // A frontier research post's survey season wants its planet surveyed.
  if (own?.kind === 'survey') {
    const c = survey(giver, r, id, { event: own });
    if (c) return c;
  }
  // A frontier hauler stranded within reach wants parts flown out.
  const stranded = SYSTEMS.map((s) => systemEventAt(s.id, clock)).filter(
    (e): e is WorldEvent => e?.kind === 'stranded' && jumpsBetween(giver.systemId, e.systemId) <= CONTRACTS.maxJumps.rescue,
  );
  if (stranded.length) {
    const c = rescue(giver, r, id, r.pick(stranded));
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

function freight(
  giver: FictionalLocation,
  r: Rng,
  id: string,
  clock: number,
  opts: { commodity?: CommodityId; event?: WorldEvent; run?: NonNullable<LastingMark['run']> } = {},
): JobDef | null {
  const markets = marketTables();
  const here = markets.get(giver.id);
  if (!here) return null;
  const made = [...here.entries.values()].filter((e) => e.role === 'produce' && isLegalCargo(e.commodity)).map((e) => e.commodity);
  const wanted = opts.run?.commodity ?? opts.commodity;
  if (!made.length || (wanted && !made.includes(wanted))) return null;
  const commodity = wanted ?? r.pick(made);
  // A mark's run always goes to the same place.
  const dests = openStations().filter((l) => {
    if (l.id === giver.id || jumpsBetween(giver.systemId, l.systemId) > CONTRACTS.maxJumps.freight) return false;
    if (opts.run && l.id !== opts.run.to) return false;
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
  const reward = pay(
    r,
    routeFeeBetween(giver.systemId, dest.systemId),
    (rw.base + rw.danger * (1 - security(dest.systemId)) + rw.cargoShare * qty * good.basePrice) * premium(opts.event) * (opts.run?.premium ?? 1),
  );
  const difficulty = difficultyFor(giver.systemId, dest.systemId);
  const name = good.name.toLowerCase();
  const why = opts.run ? `${opts.run.why} ` : opts.event ? `${opts.event.headline}. ` : '';
  const job: JobDef = {
    ...common(giver, id, difficulty),
    title: opts.run
      ? `${opts.run.title}: ${qty} ${name} to ${dest.name}`
      : opts.event
        ? `${opts.event.kind === 'harvest' ? 'Harvest' : 'Surplus'} haul: ${qty} ${name} to ${dest.name}`
        : `Haul ${qty} ${name} to ${dest.name}`,
    briefing: `${why}${giver.name} has ${qty} ${name} (${qty * good.unitSize} hold units) bound for ${place(dest)}. We load it on acceptance against a deposit of ${deposit} cr, returned with your pay on delivery.`,
    objectives: [{ kind: 'deliver', commodity, qty, locationId: dest.id, text: `Deliver ${qty} ${name} to ${place(dest)}` }],
    reward,
    difficultyNote: routeNote(giver.systemId, dest.systemId),
    destinationLocationId: dest.id,
    contract: { kind: 'freight', cargo: { commodity, qty }, deposit, ...(opts.event ? { event: opts.event.id } : {}) },
  };
  return !opts.event && !opts.run && r.next() < CONTRACTS.urgent.chance ? makeUrgent(job, giver.systemId, dest.systemId) : job;
}

function supply(giver: FictionalLocation, r: Rng, id: string, clock: number, opts: { commodity?: CommodityId; event?: WorldEvent } = {}): JobDef | null {
  // A station on a front line could fall before the goods arrive, and then take no delivery.
  if (EXPOSED.has(giver.id)) return null;
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

function survey(giver: FictionalLocation, r: Rng, id: string, opts: { event?: WorldEvent } = {}): JobDef | null {
  const studied = opts.event?.bodyId;
  const planets = SYSTEMS.filter((s) => jumpsBetween(giver.systemId, s.id) <= CONTRACTS.maxJumps.survey)
    .flatMap((s) => s.confirmedBodies.map((p) => ({ p, s })))
    .filter(({ p }) => !studied || p.id === studied);
  if (!planets.length) return null;
  const { p, s } = r.pick(planets);
  const rw = CONTRACTS.reward.survey;
  const reward = pay(r, routeFeeBetween(giver.systemId, s.id), (rw.base + rw.danger * (1 - security(s.id))) * (isFrontier(s.id) ? rw.frontier : 1) * premium(opts.event));
  const difficulty = difficultyFor(giver.systemId, s.id);
  const what =
    p.status === 'confirmed'
      ? `a confirmed planet in ${s.displayName}`
      : p.status === 'candidate'
        ? `a candidate planet in ${s.displayName} that no archive has confirmed; the readings go in the station’s log, and only the archives can settle it`
        : `a planet in ${s.displayName} the archives disagree about; the readings go in the station’s log, and only the archives can settle it`;
  return {
    ...common(giver, id, difficulty),
    title: opts.event ? `Survey season: ${p.displayName}` : `Survey ${p.displayName}`,
    briefing: `${opts.event ? `${opts.event.headline}. ` : ''}${giver.name} wants fresh instrument readings of ${p.displayName}, ${what}. Fly close enough for your scanner to log it.`,
    objectives: [{ kind: 'scan', bodyId: p.id, systemId: s.id, text: `Scan ${p.displayName} (${s.displayName})` }],
    reward,
    difficultyNote: routeNote(giver.systemId, s.id),
    destinationLocationId: giver.id,
    contract: { kind: 'survey', ...(opts.event ? { event: opts.event.id } : {}) },
  };
}

/**
 * Escorts: see a trader safely to another station, in this system or up to two jumps away, where
 * there is something to fear; across jumps it keeps with the player and jumps with them, and some
 * go as a convoy of three (docs/PROCGEN.md §10.2).
 */
function escort(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  const reach = (l: FictionalLocation) => jumpsBetween(giver.systemId, l.systemId);
  const dests = openStations().filter((l) => l.id !== giver.id && escortDanger(l.systemId) && reach(l) <= CONTRACTS.maxJumps.escort);
  const local = dests.filter((l) => l.systemId === giver.systemId);
  const away = dests.filter((l) => l.systemId !== giver.systemId);
  if (!dests.length) return null;
  const pool = (r.next() < CONTRACTS.escort.acrossChance && away.length) || !local.length ? away : local;
  const dest = r.pick(pool);
  const jumps = reach(dest);
  const level = baseThreat(dest.systemId) ?? 1;
  const owner = giver.factionId === 'sta' || giver.factionId === 'frontier' ? giver.factionId : 'independent';
  const model = r.pick(FLEETS[owner].traders.length ? FLEETS[owner].traders : FLEETS.independent.traders);
  const hull = shipModel(model).name;
  const ec = CONTRACTS.escort;
  const convoy = jumps > 0 && r.next() < ec.convoyChance ? { names: r.shuffle([...CONVOY_NAMES]).slice(0, ec.convoy.ships), need: ec.convoy.need, waves: level >= 3 ? 2 : 1 } : null;
  const shipName = convoy ? `convoy from ${giver.name}` : hull;
  const rw = CONTRACTS.reward.escort;
  const reward = pay(r, routeFeeBetween(giver.systemId, dest.systemId), (rw.base + rw.perLevel * level + rw.perJump * jumps) * (convoy ? rw.convoy : 1));
  const difficulty = clampDifficulty(level + (jumps >= 2 ? 1 : 0));
  const what = convoy ? `the convoy to ${dest.name}` : `the ${shipName} to ${dest.name}`;
  const away_ = jumps === 1 ? 'one jump away' : `${jumps} jumps away`;
  const briefing = jumps === 0
    ? `The ${shipName} is hauling cargo to ${place(dest)} and wants a gun alongside: raiders have been watching the lane. It sets off when you launch. Stay close and see it docked; if it is lost, or you leave the system first, the contract fails.`
    : `${convoy ? `Three ${hull}s of ${giver.name} are hauling together` : `The ${shipName} is hauling cargo`} to ${place(dest)}, ${away_}, and ${convoy ? 'want' : 'wants'} a gun alongside: raiders have been watching the lanes. ${convoy ? 'They set off' : 'It sets off'} when you launch and ${convoy ? 'keep' : 'keeps'} with you; jump when ${convoy ? 'they are' : 'it is'} within ${ec.keepUpM / 1000} km and ${convoy ? 'they jump' : 'it jumps'} with you. Expect raiders waiting at the beacon.${convoy ? ` ${convoy.need} of the ${convoy.names.length} must arrive.` : ' If it is lost, the contract fails.'}`;
  return {
    ...common(giver, id, difficulty),
    title: `Escort ${what}`,
    briefing,
    objectives: [
      {
        kind: 'escort',
        systemId: dest.systemId,
        fromLocationId: giver.id,
        locationId: dest.id,
        model,
        shipName,
        level,
        text: `Escort ${what}${jumps ? ` (${getSystem(dest.systemId).displayName})` : ''}`,
        ...(convoy ? { convoy } : {}),
      },
    ],
    reward,
    difficultyNote: jumps === 0 ? `Threat ${level} of 3; expect an ambush on the way` : `Threat ${level} of 3; ${routeNote(giver.systemId, dest.systemId).toLowerCase()}; raiders wait at the beacon`,
    destinationLocationId: dest.id,
    contract: { kind: 'escort' },
  };
}

/**
 * Rescues (docs/PROCGEN.md §11): ship components for a frontier hauler stranded by a drive failure
 * within reach, loaded on acceptance against a deposit and handed over alongside it, where
 * scavengers of the system's threat may be watching it.
 */
function rescue(giver: FictionalLocation, r: Rng, id: string, event: WorldEvent): JobDef | null {
  if (!event.ship) return null;
  const rc = CONTRACTS.rescue;
  const good = COMMODITIES[rc.commodity];
  const qty = r.int(rc.qty[0], rc.qty[1]);
  if (qty * good.unitSize > CONTRACTS.cargoUnits[1]) return null;
  const system = getSystem(event.systemId);
  const guard = baseThreat(event.systemId);
  const deposit = round5(qty * good.basePrice * 1.1);
  const rw = CONTRACTS.reward.rescue;
  const reward = pay(r, routeFeeBetween(giver.systemId, event.systemId), (rw.base + rw.danger * (1 - security(event.systemId)) + rw.perGuard * (guard ?? 0)) * premium(event));
  const difficulty = clampDifficulty(difficultyFor(giver.systemId, event.systemId) + (guard && guard >= 2 ? 1 : 0));
  const model = r.pick(FLEETS.independent.traders);
  const name = good.name.toLowerCase();
  return {
    ...common(giver, id, difficulty),
    title: `Rescue: the ${event.ship}`,
    briefing: `${event.headline}. ${giver.name} has ${qty} ${name} for the ${event.ship}, a colony hauler adrift in ${system.displayName} far from any dock. We load them on acceptance against a deposit of ${deposit} cr, returned with your pay. Fly out, come alongside and hand them over.${guard ? ' Scavengers have been seen nearby.' : ''}`,
    objectives: [{ kind: 'rescue', systemId: event.systemId, shipName: event.ship, model, commodity: rc.commodity, qty, guard, text: `Bring ${qty} ${name} to the ${event.ship} (${system.displayName})` }],
    reward,
    difficultyNote: `${routeNote(giver.systemId, event.systemId)}${guard ? `; scavengers, threat ${guard} of 3` : ''}`,
    destinationLocationId: giver.id,
    contract: { kind: 'rescue', cargo: { commodity: rc.commodity, qty }, deposit, event: event.id },
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

/**
 * Mining claims (docs/PROCGEN.md §19): a mining outpost or refinery holds a claim in a cited belt
 * within reach and pays for a load mined there: mine it with a mining laser, then bring it in. The
 * pay beats anything the load could fetch in a market (it is the claim's ore, not the pilot's).
 */
function claim(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  // The load comes back here: a station on a front line could fall before it arrives (docs/PROCGEN.md §20).
  if (EXPOSED.has(giver.id)) return null;
  const belts = BELTS.filter((b) => jumpsBetween(giver.systemId, b.systemId) <= CONTRACTS.maxJumps.claim);
  if (!belts.length) return null;
  const belt = r.pick(belts);
  const commodity = r.pick(beltGoods(belt.kind));
  const good = COMMODITIES[commodity];
  const qty = Math.max(1, Math.floor(r.int(CONTRACTS.claim.holdUnits[0], CONTRACTS.claim.holdUnits[1]) / good.unitSize));
  const rw = CONTRACTS.reward.claim;
  const reward = pay(r, routeFeeBetween(giver.systemId, belt.systemId), rw.base + rw.danger * (1 - security(belt.systemId)), rw.goodsMarkup * qty * good.basePrice);
  const difficulty = difficultyFor(giver.systemId, belt.systemId);
  const name = good.name.toLowerCase();
  const where = `the ${belt.name} (${getSystem(belt.systemId).displayName})`;
  return {
    ...common(giver, id, difficulty),
    title: `Claim: ${qty} ${name} from the ${belt.name}`,
    briefing: `${giver.name} holds a mining claim in ${where}. Mine ${qty} ${name} there (${qty * good.unitSize} hold units) and bring the load here: a mining laser cuts it, and a prospecting scanner gets more from each rock. Outfitters sell both.`,
    objectives: [
      { kind: 'mine', systemId: belt.systemId, beltId: belt.id, commodity, qty, text: `Mine ${qty} ${name} in ${where}` },
      { kind: 'deliver', commodity, qty, locationId: giver.id, text: `Deliver ${qty} ${name} to ${giver.name}` },
    ],
    reward,
    difficultyNote: `Needs a mining laser; ${routeNote(giver.systemId, belt.systemId).toLowerCase()}`,
    destinationLocationId: giver.id,
    contract: { kind: 'claim' },
  };
}

// ---------------------------------------------------------------- passengers and sightseers (docs/PROCGEN.md §23)

/** A party of passengers (fiction): `n` different names. */
function party(r: Rng, [lo, hi]: readonly [number, number]): string[] {
  const n = lo + Math.floor(r.next() * (hi - lo + 1));
  const names = new Set<string>();
  while (names.size < n) names.add(`${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`);
  return [...names];
}

/** A party as the board says it: "Ada Moss", "Ada Moss and Jon Hale", "Ada Moss and two others". */
export function partyName(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'Nobody';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${['two', 'three', 'four', 'five'][names.length - 3] ?? names.length - 1} others`;
}

const wants = (names: readonly string[]) => (names.length === 1 ? 'wants' : 'want');

const BERTHS_NOTE = 'A berth each in a passenger cabin (an outfitter fits one in a utility slot); every hit your hull takes with them aboard comes off the fare.';

/** Passage: a party to another open station within reach, paid by the distance and the heads. */
function passage(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  const options = openStations().filter((l) => l.id !== giver.id && jumpsBetween(giver.systemId, l.systemId) <= CONTRACTS.maxJumps.passage);
  if (!options.length) return null;
  const dest = r.pick(options);
  const names = party(r, PASSENGERS.passage.party);
  const rw = PASSENGERS.passage.reward;
  const reward = pay(r, routeFeeBetween(giver.systemId, dest.systemId), rw.base + rw.perJump * jumpsBetween(giver.systemId, dest.systemId) + rw.perPassenger * names.length);
  return {
    ...common(giver, id, difficultyFor(giver.systemId, dest.systemId)),
    title: `Passage to ${dest.name}`,
    briefing: `${partyName(names)} ${wants(names)} passage to ${place(dest)}. ${BERTHS_NOTE}`,
    objectives: [{ kind: 'visit', locationId: dest.id, text: `Take ${partyName(names)} to ${place(dest)}` }],
    reward,
    difficultyNote: routeNote(giver.systemId, dest.systemId),
    destinationLocationId: dest.id,
    contract: { kind: 'passage', party: names },
  };
}

const SIGHT_WORD: Record<Sight['kind'], string> = {
  planet: 'a world round another star',
  giant: 'a giant world round another star',
  'white-dwarf': 'a white dwarf, the core of a star that died',
  'brown-dwarf': 'a brown dwarf, too small to shine as a star does',
  belt: 'a belt of rock and dust round its star',
};

/** Sightseers: a party to see a sight of the real sky within reach, then home again, paid by its interest. */
function tour(giver: FictionalLocation, r: Rng, id: string): JobDef | null {
  const sights = tourSights().filter((s) => jumpsBetween(giver.systemId, s.systemId) <= CONTRACTS.maxJumps.tour && !inViewFromStation(s, giver.id));
  if (!sights.length) return null;
  const sight = r.pick(sights);
  const names = party(r, PASSENGERS.tour.party);
  const rw = PASSENGERS.tour.reward;
  const varying = (rw.base + rw.perJump * jumpsBetween(giver.systemId, sight.systemId) + rw.perPassenger * names.length) * PASSENGERS.interest[sight.kind];
  const system = getSystem(sight.systemId).displayName;
  return {
    ...common(giver, id, difficultyFor(giver.systemId, sight.systemId)),
    title: `Sightseers to ${sight.name}`,
    briefing: `${partyName(names)} ${wants(names)} to see ${sight.name}, ${SIGHT_WORD[sight.kind]} in ${system}, with their own eyes. Fly close enough for a good look, then bring them back to ${giver.name}. ${BERTHS_NOTE}`,
    objectives: [
      { kind: 'sight', sightId: sight.id, systemId: sight.systemId, targetId: sight.targetId, text: `Show ${sight.name} (${system}) to ${partyName(names)}` },
      { kind: 'visit', locationId: giver.id, text: `Bring ${partyName(names)} back to ${giver.name}` },
    ],
    reward: pay(r, routeFeeBetween(giver.systemId, sight.systemId), varying),
    difficultyNote: routeNote(giver.systemId, sight.systemId),
    destinationLocationId: giver.id,
    contract: { kind: 'tour', party: names },
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

// ---------------------------------------------------------------- the border war (docs/PROCGEN.md §20)

/** Fronts within reach of a board that are fighting, for its side: the law's own fronts, or any front for a den. */
function warFronts(giver: FictionalLocation, clock: number): FrontState[] {
  const wake = giver.stationType === 'pirate-den';
  if (!wake && giver.factionId !== 'sta' && giver.factionId !== 'frontier') return [];
  const out: FrontState[] = [];
  for (const f of FRONTS) {
    if ((!wake && f.faction !== giver.factionId) || jumpsBetween(giver.systemId, f.lawSystem) > CONTRACTS.maxJumps.war) continue;
    const s = frontState(f, clock);
    if (atWar(s, wake ? 'wake' : 'law')) out.push(s);
  }
  return out;
}

/**
 * War work on a front within reach while it fights. The law pays for the Wake's pack on its lanes
 * broken (at a fallen station, its guns, to take it back); a den pays for the front faction's
 * haulers hit. Done, it pushes the front the poster's way (economy/jobs.ts).
 */
function war(giver: FictionalLocation, r: Rng, id: string, clock: number): JobDef | null {
  const fronts = warFronts(giver, clock);
  if (!fronts.length) return null;
  const s = r.pick(fronts);
  const f = s.front;
  const rw = CONTRACTS.reward.war;
  const law = getSystem(f.lawSystem).displayName;
  const side = FACTIONS[f.faction];
  const fee = routeFeeBetween(giver.systemId, f.lawSystem);
  const station = f.exposedId ? getLocation(f.exposedId) : null;
  if (giver.stationType === 'pirate-den') {
    const count = r.int(2, 3);
    const words: Record<Exclude<FrontState['phase'], 'truce'>, [string, string]> = {
      'pushed-back': [`Take back the lanes to ${law}`, `The ${side.shortName} has pushed us back from ${law}. Hit ${count} of its haulers there and the lanes are ours again.`],
      skirmish: [`Tip the fight at ${law}`, `Patrols and our crews are trading shots on ${f.name}. Hit ${count} ${side.shortName} haulers at ${law} and the fight tips our way.`],
      blockade: [`Tighten the blockade of ${law}`, `Our packs sit on the lanes into ${law}. Hit ${count} of the ${side.shortName} haulers that slip through, and nothing will.`],
      fallen: [`Starve ${law}`, `We hold ${station?.name ?? 'the station'}. Keep it: hit ${count} ${side.shortName} haulers at ${law} before they can supply a counterattack.`],
    };
    const [title, why] = words[s.phase as Exclude<FrontState['phase'], 'truce'>];
    return {
      ...common(giver, id, clampDifficulty(2 + (security(f.lawSystem) >= 0.6 ? 1 : 0))),
      repReward: { 'hollow-wake': CONTRACTS.outlawWake.war },
      title,
      briefing: `${why} Every one is a crime: expect fines and angry patrols. Done, it pushes ${f.name} the Wake’s way.`,
      objectives: [{ kind: 'piracy', systemId: f.lawSystem, faction: f.faction, count, text: `Destroy ${count} ${side.shortName} haulers in ${law}` }],
      reward: pay(r, fee, rw.base + rw.perShip * count),
      difficultyNote: `The border war, for the Wake; ${routeNote(giver.systemId, f.lawSystem).toLowerCase()}`,
      destinationLocationId: giver.id,
      contract: { kind: 'war', front: f.id, side: 'wake' },
    };
  }
  const fallen = s.phase === 'fallen' && !!station;
  const level: 2 | 3 = s.phase === 'skirmish' ? 2 : 3;
  const count = level + (fallen ? 2 : 1);
  const here = openStationsIn(f.lawSystem);
  const near = fallen ? station! : (station ?? (here.length ? r.pick(here) : null));
  if (!near) return null;
  const title = fallen ? `Retake ${station!.name}` : s.phase === 'blockade' ? `Break the blockade of ${law}` : `Hold the line at ${law}`;
  const why = fallen
    ? `The Hollow Wake holds ${station!.name}. Destroy the ${count} raiders guarding it and the ${side.shortName} can take it back.`
    : s.phase === 'blockade'
      ? `Raider packs sit on the lanes into ${law}. Break the pack of ${count} off ${near.name} and the traders can run again.`
      : `Patrol wings and Wake raiders are fighting over ${law}. A pack of ${count} is pressing on ${near.name}: destroy it.`;
  const common_ = common(giver, id, level);
  return {
    ...common_,
    repReward: { ...common_.repReward, 'hollow-wake': -4 },
    title,
    briefing: `${why} Done, it pushes ${f.name} the ${side.shortName}’s way.`,
    objectives: [{ kind: 'bounty', systemId: f.lawSystem, locationId: near.id, count, level, text: `Destroy ${count} raiders near ${place(near)}` }],
    reward: pay(r, fee, (rw.base + rw.perRaider * count * level) * (fallen ? rw.fallen : 1)),
    difficultyNote: `The border war, threat ${level} of 3; ${routeNote(giver.systemId, f.lawSystem).toLowerCase()}`,
    destinationLocationId: near.id,
    contract: { kind: 'war', front: f.id, side: 'law' },
  };
}

/** Open stations in a system, the front-line ones included (a bounty is flown near one, not docked at). */
/**
 * A side's decisive operation on a front (docs/PROCGEN.md §20.7), once the player's own deeds there
 * have come to the campaign's momentum its way. The front's faction asks, at its stations within
 * reach of the lawful system, for the den across the line knocked out, a wing of its own flying
 * with the pilot; the den asks a pilot it trusts to hold it against the faction's last sweep. Done,
 * either settles the front for good, that side's way.
 */
function decisive(giver: FictionalLocation, r: Rng, id: string, clock: number): JobDef | null {
  const c = BORDER.campaign;
  const den = giver.stationType === 'pirate-den';
  const open = FRONTS.filter((f) =>
    den
      ? f.denId === giver.id && decisiveOpen(f, 'wake', clock)
      : giver.factionId === f.faction && jumpsBetween(giver.systemId, f.lawSystem) <= c.law.maxJumps && decisiveOpen(f, 'law', clock),
  );
  if (!open.length) return null;
  // The front the player has done most for.
  const f = open.reduce((a, b) => (Math.abs(momentum(b, clock)) > Math.abs(momentum(a, clock)) ? b : a));
  const target = getLocation(f.denId);
  const side = FACTIONS[f.faction];
  const law = getSystem(f.lawSystem).displayName;
  const wake = getSystem(f.wakeSystem).displayName;
  if (den) {
    const count = c.wake.sweep;
    return {
      ...common(giver, id, 3),
      repReward: { 'hollow-wake': c.wake.wakeStanding },
      title: `Hold ${target.name}: the last sweep`,
      briefing: `You have hurt the ${side.shortName} on ${f.name}, and it is throwing its last sweep at ${target.name} to end the fight. Destroy ${count} of its ships and the lanes into ${law} are the Wake’s for good. Every ship is a crime: expect fines.`,
      objectives: [{ kind: 'defend', systemId: f.wakeSystem, locationId: target.id, count, faction: f.faction, text: `Destroy ${count} ships of the ${side.shortName} sweep at ${target.name} (${wake})` }],
      reward: pay(r, 0, c.wake.pay),
      difficultyNote: `The decisive fight for ${f.name}, for the Wake`,
      destinationLocationId: target.id,
      contract: { kind: 'war', front: f.id, side: 'wake', decisive: true },
    };
  }
  const common_ = common(giver, id, 3);
  return {
    ...common_,
    repReward: { ...common_.repReward, 'hollow-wake': c.law.wakeStanding },
    title: `End it at ${target.name}`,
    briefing: `Your work on ${f.name} has the Hollow Wake reeling. Knock out ${target.name}, the den across the line at ${wake}: its turrets, then its reactor, with a ${side.shortName} wing at your side. Then ${law} is safe for good.`,
    objectives: [{ kind: 'assault', systemId: f.wakeSystem, locationId: target.id, text: `Knock out ${target.name}: its turrets, then its reactor` }],
    reward: pay(r, routeFeeBetween(giver.systemId, f.wakeSystem), c.law.pay),
    difficultyNote: `The decisive fight for ${f.name}; ${routeNote(giver.systemId, f.wakeSystem).toLowerCase()}`,
    destinationLocationId: target.id,
    contract: { kind: 'war', front: f.id, side: 'law', decisive: true },
  };
}

function openStationsIn(systemId: SystemId): FictionalLocation[] {
  return ALL_LOCATIONS.filter((l) => l.systemId === systemId && l.status === 'functional' && l.dockable !== false);
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
  if (!boardKinds(giver, clock)) return null;
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
  if (c.party && !state.jobs[job.id] && berths(state).free < c.party.length) {
    const { free } = berths(state);
    return `Needs ${c.party.length} free passenger berth${c.party.length === 1 ? '' : 's'} (you have ${free}): fit a passenger cabin`;
  }
  if (c.decisive && c.front && state.world.border[c.front]?.ending && !state.jobs[job.id]) return 'That front is settled';
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
  // Bounties a rival hunter took off this board are gone from it, unless the player bought the claim back (§24.4).
  const taken = takenIds(state, locationId);
  return boardFor(locationId, boardEpoch(state.clock)).filter((c) => {
    if (state.jobs[c.id]) return true;
    if (taken.has(c.id)) return false;
    // Work that comes and goes within a time slot shows only from when it is posted until it lapses:
    // an escort for a haul until it sets off alone (docs/PROCGEN.md §21.7), Pyre's work (§26.5).
    if (state.clock < (c.contract?.posted ?? -Infinity) || state.clock >= (c.contract?.until ?? Infinity)) return false;
    // An escort for a haul goes once it has an escort.
    const haul = c.contract?.haul;
    if (haul && state.world.hauls?.[haul]) return false;
    const o = c.objectives[0];
    return !(c.contract?.kind === 'survey' && o?.kind === 'scan' && state.discoveredBodies.includes(o.bodyId));
  });
}
