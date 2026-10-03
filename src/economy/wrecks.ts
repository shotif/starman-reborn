import { applyCredits, type GameState, type MysteryRecord, type SiteRecord, type WreckLog } from '../app/state.ts';
import { COMMODITIES, type CommodityId } from '../content/economy/goods.ts';
import { rng, type Rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import type { StationType } from '../content/world/types.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { DERELICT_LOGS, KIND_WORDS, MYSTERY_LINES, SITE_FICTION, SITE_NOTES, SITE_RADIO, WRECK_LOGS, WRECK_NAMES } from '../content/wrecks/lines.ts';
import { MYSTERIES, MYSTERY_IDS, type MysteryEnd, type MysteryId } from '../content/wrecks/mysteries.ts';
import { WRECKS, type PodWhat, type SiteKind } from '../content/wrecks/rules.ts';
import { CREW } from '../content/crew/rules.ts';
import { ALL_LOCATIONS, componentsOf, getLocation, getSystem, isInventedSystem, WORLD } from '../data/systems.ts';
import type { FictionalLocation, SystemId } from '../data/types.ts';
import { FLEETS } from '../world/traffic/plan.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { addCargo, itemsThatFit } from './cargo.ts';
import { crewDeed } from './crewDeeds.ts';
import { adjustReputation } from './factions.ts';
import { advanceJobs, failJob, type JobDef, type JobEvent } from './jobs.ts';
import { laneBand, laneOfferById, type LaneOffer } from './lanes.ts';
import { isLawful, lawIn } from './law.ts';
import { cargoCapacity } from './loadout.ts';
import { clockWords } from './rivalStories.ts';

/**
 * Wrecks to fly to (docs/PROCGEN.md §31; rules in src/content/wrecks/rules.ts): sites a lane hail or
 * a scan marks in flight, what each holds, the jobs that steer the pilot to them, what comes of
 * scanning a log, tractoring a pod, reaching a ship or boarding a hulk, the dangers by them, and the
 * short mysteries a log may lead into. Everything about a site is worked out from its id (the world's
 * seed, its system, its slot); the save keeps only what the pilot did (`world.wrecks`).
 */

const W = WRECKS;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
const round5 = (x: number) => Math.round(x / 5) * 5;
const between = (r: Rng, [lo, hi]: readonly [number, number]) => lo + Math.floor(r.next() * (hi - lo + 1));

// ---------------------------------------------------------------- ids

export type SiteFrom = 'lane' | 'scan' | 'mystery';
export type SiteRef = { from: 'lane'; offerId: string; systemId: SystemId; slot: number } | { from: 'scan'; systemId: SystemId; slot: number } | { from: 'mystery'; mystery: MysteryId; step: 1 };

/** A site id's parts: `lane.<system>.<slot>`, `scan.<system>.<slot>` or `mys.<mystery>.1`; null if it is none of them. */
export function siteRef(id: string): SiteRef | null {
  const [head, ...rest] = id.split('.');
  if (head === 'mys') {
    const [m, step] = rest;
    return MYSTERY_IDS.includes(m as MysteryId) && step === '1' && rest.length === 2 ? { from: 'mystery', mystery: m as MysteryId, step: 1 } : null;
  }
  if (head !== 'lane' && head !== 'scan') return null;
  const tail = rest.join('.');
  const dot = tail.lastIndexOf('.');
  const systemId = tail.slice(0, dot) as SystemId;
  const slot = Number(tail.slice(dot + 1));
  if (dot <= 0 || !Number.isInteger(slot) || slot < 0 || !WORLD.profiles.has(systemId)) return null;
  return head === 'lane' ? { from: 'lane', offerId: tail, systemId, slot } : { from: 'scan', systemId, slot };
}

export const siteTargetId = (id: string) => `site:${id}`;

/** The job that steers the pilot to a site. */
export function siteJobId(id: string): string {
  const ref = siteRef(id);
  if (!ref) return '';
  return ref.from === 'lane' ? `c.lane.${ref.offerId}` : ref.from === 'scan' ? `site.${id}` : `mys.${ref.mystery}`;
}

// ---------------------------------------------------------------- what a site holds

export interface SitePod {
  index: number;
  what: PodWhat;
  credits?: number;
  cargo?: { commodity: CommodityId; qty: number };
  /** Needed for the site to be done (a strongbox wreck's salvage pods are extras). */
  required: boolean;
}

export interface SiteSpec {
  id: string;
  systemId: SystemId;
  kind: SiteKind;
  from: SiteFrom;
  /** The ship's name (a hull's, a pod's), and the person aboard a ship or pod, if any. */
  ship: string;
  person?: string;
  /** The hull drawn (a catalogue ship), and how much larger (a derelict). Pods have none. */
  model: string | null;
  scale: number;
  /** The real body it drifts near (a scene planet's or star's id), and its name. */
  body: string | null;
  bodyName: string | null;
  pods: SitePod[];
  /** Raiders picking it over (seen, holding their spot), at this threat. */
  guard: 1 | 2 | 3 | null;
  /** Raiders lying dark by it, at this threat, and how many. */
  dark: 1 | 2 | 3 | null;
  darkCount: number;
  /** A decoy: nothing to gain. */
  bait: boolean;
  /** A derelict's credits aboard, and whether a data core is too. */
  salvage: number;
  dataCore: boolean;
  /** Which log line. */
  log: number;
  /** The lead roll (0–1): a lead or not is decided with the save. */
  lead: number;
}

const packLevel = (systemId: SystemId): 1 | 2 | 3 => trafficFor(systemId, 'high').plan.packs?.level ?? (laneBand(systemId) === 'lawless' ? 2 : 1);

/** The real bodies a site may drift near in a system: its confirmed planets, or else its primary star. */
export function siteBodies(systemId: SystemId): { id: string; name: string }[] {
  const planets = getSystem(systemId).confirmedBodies.map((b) => ({ id: b.id, name: b.displayName }));
  if (planets.length) return planets;
  const star = componentsOf(systemId).find((c) => c.role === 'primary') ?? componentsOf(systemId)[0];
  return star ? [{ id: star.id, name: star.name }] : [];
}

/** How many jumps a system is from Sol. */
const fromSol = (systemId: SystemId) => jumpsFrom(WORLD.links, 'sol').get(systemId) ?? 99;

/** Whether a derelict may drift in a system: two jumps or more from Sol, never at Pyre, with a body to drift near. */
export function derelictsMayBe(systemId: SystemId): boolean {
  return systemId !== 'sol' && !isInventedSystem(systemId) && fromSol(systemId) >= W.kinds.derelict.minJumps && siteBodies(systemId).length > 0;
}

function wreckPods(r: Rng): SitePod[] {
  const K = W.kinds.wreck;
  const n = between(r, K.pods);
  const pods: SitePod[] = Array.from({ length: n }, (_, index) => ({ index, what: 'salvage' as const, credits: round5(between(r, K.value)), required: true }));
  if (r.next() < K.cargo) pods.push({ index: n, what: 'cargo', cargo: { commodity: r.pick(K.goods), qty: between(r, K.cargoQty) }, required: true });
  return pods;
}

function hullOf(r: Rng, kind: SiteKind): { model: string | null; scale: number } {
  if (kind === 'pod') return { model: null, scale: 1 };
  if (kind === 'derelict') {
    const [lo, hi] = W.kinds.derelict.scale;
    return { model: r.pick(W.kinds.derelict.hulls), scale: lo + r.next() * (hi - lo) };
  }
  return { model: r.pick(FLEETS.independent.traders), scale: 1 };
}

function base(id: string, systemId: SystemId, kind: SiteKind, from: SiteFrom, r: Rng): SiteSpec {
  return { id, systemId, kind, from, ship: r.pick(WRECK_NAMES), model: null, scale: 1, body: null, bodyName: null, pods: [], guard: null, dark: null, darkCount: 0, bait: false, salvage: 0, dataCore: false, log: 0, lead: 0 };
}

/** Fills in a wreck's or derelict's hull, contents, log and lead from its rng. */
function fillHull(s: SiteSpec, r: Rng): void {
  Object.assign(s, hullOf(r, s.kind));
  const D = W.kinds.derelict;
  if (s.kind === 'wreck') s.pods = wreckPods(r);
  if (s.kind === 'derelict') {
    s.salvage = round5(between(r, D.salvage));
    s.dataCore = r.next() < D.dataCore;
    const bodies = siteBodies(s.systemId);
    const b = bodies.length ? r.pick(bodies) : null;
    s.body = b?.id ?? null;
    s.bodyName = b?.name ?? null;
  }
  s.log = r.int(0, (s.kind === 'derelict' ? DERELICT_LOGS : WRECK_LOGS).length - 1);
  s.lead = r.next();
}

/** A lane hail's site: the encounter's own ship, person, trap and threat; the rest from the site's rng. */
function laneSite(id: string, o: LaneOffer): SiteSpec | null {
  const kind: SiteKind | null = o.kind === 'mayday' ? 'ship' : o.kind === 'lifepod' || o.kind === 'cargo' ? 'pod' : o.kind === 'wreck' ? 'wreck' : o.kind === 'derelict' ? 'derelict' : null;
  if (!kind) return null;
  const r = rng(WORLD_SEED, 'site', id);
  const s = base(id, o.systemId, kind, 'lane', r);
  s.ship = o.ship;
  s.person = o.name;
  const level = o.level ?? packLevel(o.systemId);
  const [dLo, dHi] = W.danger.darkSize;
  if (o.kind === 'mayday') {
    s.model = r.pick(FLEETS.independent.traders);
    s.bait = o.trap;
  } else if (o.kind === 'lifepod') {
    s.pods = [{ index: 0, what: 'lifepod', required: true }];
  } else if (o.kind === 'cargo') {
    const n = between(r, W.kinds.pod.cargoPods);
    const qty = o.qty ?? 0;
    s.pods = Array.from({ length: n }, (_, index) => ({ index, what: 'cargo' as const, cargo: { commodity: o.good!, qty: Math.floor(qty / n) + (index < qty % n ? 1 : 0) }, required: true })).filter((p) => p.cargo.qty > 0);
    s.bait = o.trap;
  } else {
    fillHull(s, r);
    if (o.kind === 'derelict' && o.body) {
      s.body = o.body;
      s.bodyName = siteBodies(o.systemId).find((b) => b.id === o.body)?.name ?? s.bodyName;
    }
    if (o.kind === 'wreck' && o.trap) s.guard = level;
  }
  // Bait, and a derelict's hidden raiders, lie dark by the site.
  if (s.bait || (o.kind === 'derelict' && o.trap)) {
    s.dark = level;
    s.darkCount = between(r, [dLo, dHi]);
  }
  return s;
}

/** The find a scan slot holds in a system, if any (docs/PROCGEN.md §31.3): a wreck, or a derelict where they may be. */
export function scanFind(systemId: SystemId, slot: number): SiteSpec | null {
  if (systemId === 'sol' || isInventedSystem(systemId) || !WORLD.profiles.has(systemId)) return null;
  const r = rng(WORLD_SEED, 'site-scan', systemId, slot);
  const band = laneBand(systemId);
  if (r.next() >= W.scan.chance[band]) return null;
  const kind: SiteKind = derelictsMayBe(systemId) && r.next() < W.scan.derelict ? 'derelict' : 'wreck';
  const id = `scan.${systemId}.${slot}`;
  const s = base(id, systemId, kind, 'scan', r);
  fillHull(s, r);
  if (kind === 'wreck' && !s.body) {
    // A scan's wreck lies near the body scanned for it.
    const bodies = siteBodies(systemId);
    const b = bodies.length ? r.pick(bodies) : null;
    s.body = b?.id ?? null;
    s.bodyName = b?.name ?? null;
  }
  const level = packLevel(systemId);
  if (kind === 'wreck' && r.next() < W.danger.guard[band]) s.guard = level;
  if (kind === 'derelict' && r.next() < W.danger.dark[band]) {
    s.dark = level;
    s.darkCount = between(r, W.danger.darkSize);
  }
  return s;
}

/** A mystery's find, from the place its trail leads (worked out from the site that began it). */
function mysterySite(id: string, m: MysteryId, from: string): SiteSpec | null {
  const places = mysteryPlaces(m, from);
  if (!places) return null;
  const rule = MYSTERIES[m];
  const r = rng(WORLD_SEED, 'site', id, from);
  const s = base(id, places.find, rule.find.kind, 'mystery', r);
  s.ship = places.ship;
  if (rule.find.kind === 'pod') {
    s.pods = [{ index: 0, what: rule.find.item ?? 'recorder', required: true }];
  } else {
    fillHull(s, r);
    s.dark = null;
    s.darkCount = 0;
    if (m === 'silence') {
      s.ship = places.sister!;
      s.body = places.body ?? s.body;
      s.bodyName = places.bodyName ?? s.bodyName;
    }
    if (m === 'strongbox') {
      // The raiders' prize, and a pod or two of what else they left.
      const extras = between(r, [1, 2]);
      s.pods = [
        { index: 0, what: 'strongbox', required: true },
        ...Array.from({ length: extras }, (_, i) => ({ index: i + 1, what: 'salvage' as const, credits: round5(between(r, W.kinds.wreck.value)), required: false })),
      ];
      s.guard = Math.max(1, packLevel(places.find)) as 1 | 2 | 3;
    }
  }
  return s;
}

/**
 * Everything about a site, from its id (and, for a mystery's find, the save's record of how the
 * mystery began). Null when the id names nothing.
 */
export function siteSpec(id: string, state?: GameState): SiteSpec | null {
  const ref = siteRef(id);
  if (!ref) return null;
  if (ref.from === 'lane') {
    const o = laneOfferById(ref.offerId);
    return o ? laneSite(id, o) : null;
  }
  if (ref.from === 'scan') return scanFind(ref.systemId, ref.slot);
  const from = state?.world.wrecks?.mysteries?.[ref.mystery]?.from;
  return from ? mysterySite(id, ref.mystery, from) : null;
}

// ---------------------------------------------------------------- the save's record

export function wreckLog(state: GameState): WreckLog {
  return (state.world.wrecks ??= { sites: {} });
}

export const siteRecord = (state: GameState, id: string): SiteRecord | undefined => state.world.wrecks?.sites[id];

/** Sites marked and not yet ended. */
export function openSites(state: GameState): [string, SiteRecord][] {
  return Object.entries(state.world.wrecks?.sites ?? {}).filter(([, s]) => !s.ended);
}

/** Why the pilot cannot mark another site now, or null. */
export function siteBlock(state: GameState): string | null {
  return openSites(state).length >= W.maxOpen ? `You have ${W.maxOpen} sites marked already` : null;
}

/** When a site closes (its window), on the game clock. */
export function siteUntil(state: GameState, id: string): number {
  const rec = siteRecord(state, id);
  const ref = siteRef(id);
  if (!rec || !ref) return 0;
  if (ref.from === 'mystery') return (state.world.wrecks?.mysteries?.[ref.mystery]?.stepAt ?? rec.at) + W.open.step;
  return rec.at + (ref.from === 'lane' ? W.open.lane : W.open.scan);
}

function mark(state: GameState, s: SiteSpec): SiteRecord {
  const rec: SiteRecord = { at: state.clock, systemId: s.systemId, kind: s.kind };
  wreckLog(state).sites[s.id] = rec;
  return rec;
}

const shipWords = (s: SiteSpec) => (s.kind === 'pod' && s.pods[0]?.what === 'lifepod' ? `lifepod of the ${s.ship}` : s.ship);

/** The objective a site's job steers by. */
function siteObjective(s: SiteSpec): JobDef['objectives'][number] {
  const where = getSystem(s.systemId).displayName;
  const text =
    s.kind === 'ship'
      ? `Fly alongside the ${s.ship} in ${where}`
      : s.kind === 'pod'
        ? s.pods[0]?.what === 'lifepod'
          ? `Tractor in the lifepod of the ${s.ship} in ${where}`
          : s.pods[0]?.what === 'recorder'
            ? `Tractor in the lifeboat recorder of the ${s.ship} in ${where}`
            : `Tractor in the pods adrift near the ${s.ship} in ${where}`
        : s.kind === 'wreck'
          ? `Salvage the wreck of the ${s.ship} in ${where}: scan its log, tractor in its pods`
          : `Board the ${s.ship}${s.bodyName ? ` near ${s.bodyName}` : ''} in ${where}`;
  return { kind: 'site', systemId: s.systemId, siteId: s.id, text };
}

/**
 * Marks a lane hail's site (docs/PROCGEN.md §31.2) and its job: a ship in distress to fly alongside
 * (paying the mayday's reward when reached), a lifepod to tractor in before its passage, cargo adrift
 * to tractor in (then deliver it, if returned), a wreck to salvage or a derelict to board.
 */
export function markLaneSite(state: GameState, o: LaneOffer): { siteId: string; jobId: string } | null {
  const id = `lane.${o.id}`;
  const s = siteSpec(id, state);
  if (!s) return null;
  mark(state, s);
  const jobId = siteJobId(id);
  const dest = o.stationId ? getLocation(o.stationId) : null;
  const objective = siteObjective(s);
  const existing = state.contracts[jobId];
  if (existing) {
    // A passage or a return already written by the lanes: the site comes first.
    existing.objectives = [objective, ...existing.objectives];
  } else {
    const owner = isLawful(o.owner ?? null) ? o.owner! : null;
    const job: JobDef = {
      id: jobId,
      title: s.kind === 'ship' ? `Help the ${s.ship}` : s.kind === 'wreck' ? `The wreck of the ${s.ship}` : s.kind === 'derelict' ? `The derelict ${s.ship}` : `Cargo adrift near the ${s.ship}`,
      giverLocationId: dest?.id ?? openStation(o.systemId)?.id ?? 'earth-port',
      factionId: null,
      briefing: `${fill(SITE_NOTES.marked, { ship: shipWords(s), until: clockWords(siteUntil(state, id)) })} ${SITE_FICTION}`,
      objectives: [objective],
      reward: s.kind === 'ship' ? (o.credits ?? 0) : 0,
      repReward: s.kind === 'ship' && owner ? { [owner]: 2 } : {},
      difficulty: (o.level ?? 1) as 1 | 2 | 3,
      difficultyNote: 'Marked in flight',
      destinationLocationId: dest?.id ?? openStation(o.systemId)?.id ?? 'earth-port',
      contract: { kind: s.kind === 'ship' ? 'rescue' : 'recovery', lane: o.id },
    };
    state.contracts[jobId] = job;
    state.jobs[jobId] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
  }
  return { siteId: id, jobId };
}

const openStation = (systemId: SystemId): FictionalLocation | undefined =>
  ALL_LOCATIONS.filter((l) => l.systemId === systemId && l.status === 'functional' && l.dockable !== false && l.stationType !== 'pirate-den').sort((a, b) => a.id.localeCompare(b.id))[0];

// ---------------------------------------------------------------- scans

/** The scan slot a clock falls in. */
export const scanSlot = (clock: number) => Math.floor(clock / W.scan.slotSeconds);

/**
 * A manual scan of a planet, star or belt may pick up a faint return (docs/PROCGEN.md §31.3): the
 * slot's find, once, after the opening delivery, never in Sol or at Pyre. Marks it and its job.
 */
export function findOnScan(state: GameState, systemId: SystemId): { siteId: string; text: string } | null {
  if (state.jobs.lifeline?.status !== 'complete' || siteBlock(state)) return null;
  const slot = scanSlot(state.clock);
  const s = scanFind(systemId, slot);
  if (!s || siteRecord(state, s.id)) return null;
  mark(state, s);
  const jobId = siteJobId(s.id);
  state.contracts[jobId] = {
    id: jobId,
    title: s.kind === 'wreck' ? `The wreck of the ${s.ship}` : `The derelict ${s.ship}`,
    giverLocationId: openStation(systemId)?.id ?? 'earth-port',
    factionId: null,
    briefing: `${fill(SITE_NOTES.found, { body: s.bodyName ?? 'a body here', kind: KIND_WORDS[s.kind] })} ${SITE_FICTION}`,
    objectives: [siteObjective(s)],
    reward: 0,
    repReward: {},
    difficulty: (s.guard ?? s.dark ?? 1) as 1 | 2 | 3,
    difficultyNote: 'Found by a scan',
    destinationLocationId: openStation(systemId)?.id ?? 'earth-port',
    contract: { kind: 'recovery' },
  };
  state.jobs[jobId] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
  return { siteId: s.id, text: fill(SITE_NOTES.found, { body: s.bodyName ?? 'a body here', kind: KIND_WORDS[s.kind] }) };
}

// ---------------------------------------------------------------- the flight's view

/** What the flight scene needs of a site: its spec, and what the pilot has done there. */
export type SiteSetup = SiteSpec & { taken: number[]; read: boolean; boarded: boolean; sprung: boolean; cleared: boolean; reached: boolean };

export function siteSetup(state: GameState, id: string): SiteSetup | null {
  const s = siteSpec(id, state);
  const rec = siteRecord(state, id);
  if (!s || !rec || rec.ended) return null;
  // Raiders lying dark stay dark for a pilot the Wake trusts: the flight scene decides as it springs them.
  return { ...s, taken: rec.taken ?? [], read: !!rec.read, boarded: !!rec.boarded, sprung: !!rec.sprung, cleared: !!rec.cleared, reached: !!rec.reached };
}

/** The open sites in a system, as the flight scene needs them. */
export function sitesIn(state: GameState, systemId: SystemId): SiteSetup[] {
  return openSites(state)
    .filter(([, r]) => r.systemId === systemId)
    .map(([id]) => siteSetup(state, id))
    .filter((x): x is SiteSetup => !!x);
}

// ---------------------------------------------------------------- what the pilot does there

export interface SiteCard {
  /** The site it was read at. */
  site: string;
  title: string;
  /** What the log says or what was found. */
  text: string;
  found?: string;
  /** A lead to follow (the mystery's title and lead), or the strongbox's choice. */
  lead?: { mystery: MysteryId; title: string; text: string };
  choose?: { text: string };
}

export interface SiteOutcome {
  notes: { text: string; tone: 'good' | 'bad' | 'info' }[];
  jobs: JobEvent[];
  card?: SiteCard;
  /** A line on the radio. */
  comm?: { speaker: string; text: string };
}

const none = (): SiteOutcome => ({ notes: [], jobs: [] });

/** Whether the pilot has done all there is to do at a site. */
function siteDone(s: SiteSpec, rec: SiteRecord): boolean {
  const podsDone = s.pods.filter((p) => p.required).every((p) => rec.taken?.includes(p.index));
  if (s.kind === 'ship') return !!rec.reached;
  if (s.kind === 'pod') return podsDone;
  // A trail's wreck is done with its prize aboard; any other with its log read too.
  if (s.kind === 'wreck') return podsDone && (!!rec.read || s.from === 'mystery');
  return !!rec.boarded;
}

/** Ends a site done if it is, advancing its job (and a mystery's step). */
function checkDone(state: GameState, s: SiteSpec, rec: SiteRecord, out: SiteOutcome): void {
  if (rec.ended || !siteDone(s, rec)) return;
  rec.ended = { at: state.clock, how: 'done' };
  const ref = siteRef(s.id);
  if (ref?.from === 'mystery') {
    const m = state.world.wrecks?.mysteries?.[ref.mystery];
    if (m && !m.ended) {
      m.step = 1;
      m.stepAt = state.clock;
    }
  }
  if (s.kind === 'wreck' || s.kind === 'derelict') out.notes.push({ text: fill(SITE_NOTES.done, { ship: s.ship }), tone: 'good' });
  out.jobs.push(...advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId }));
}

/** A pod tractored in: what it held (credits, cargo, a survivor, a recorder, a strongbox). */
export function takeSitePod(state: GameState, id: string, index: number): SiteOutcome {
  const s = siteSpec(id, state);
  const rec = siteRecord(state, id);
  const pod = s?.pods.find((p) => p.index === index);
  // A site done may still have a pod or two it did not need (a strongbox wreck's salvage).
  if (!s || !rec || (rec.ended && rec.ended.how !== 'done') || !pod || rec.taken?.includes(index)) return none();
  const out = none();
  (rec.taken ??= []).push(index);
  if (pod.credits) {
    applyCredits(state, pod.credits, 'loot', `Salvage from the ${s.ship}`);
    out.notes.push({ text: fill(SITE_NOTES.salvaged, { ship: s.ship, what: `+${pod.credits} cr` }), tone: 'good' });
  }
  if (pod.cargo) {
    addCargo(state.ship.cargo, pod.cargo.commodity, pod.cargo.qty, cargoCapacity(state.ship));
    out.notes.push({ text: fill(SITE_NOTES.salvaged, { ship: s.ship, what: `${pod.cargo.qty} ${COMMODITIES[pod.cargo.commodity].name.toLowerCase()}` }), tone: 'good' });
  }
  if (pod.what === 'lifepod') {
    crewDeed(state, CREW.siteDeeds['lifepod.taken']);
    out.notes.push({ text: `${s.person ?? 'The survivor'} is aboard.`, tone: 'good' });
  }
  const ref = siteRef(id);
  if (ref?.from === 'mystery' && (pod.what === 'recorder' || pod.what === 'strongbox')) {
    const places = mysteryPlaces(ref.mystery, state.world.wrecks!.mysteries![ref.mystery]!.from)!;
    const L = MYSTERY_LINES[ref.mystery];
    const v = mysteryValues(places);
    out.card = { site: id, title: fill(L.title, v), text: fill(L.found, v) };
    if (ref.mystery === 'strongbox') out.card.choose = { text: fill(L.choose ?? '', v) };
  }
  checkDone(state, s, rec, out);
  return out;
}

/** A hull's log read by a scan: its last entries, and perhaps a lead. A scan from beyond the spring range shows raiders lying dark. */
export function readSite(state: GameState, id: string): SiteOutcome {
  const s = siteSpec(id, state);
  const rec = siteRecord(state, id);
  if (!s || !rec || rec.ended || rec.read || (s.kind !== 'wreck' && s.kind !== 'derelict')) return none();
  const out = none();
  rec.read = true;
  if (s.kind === 'wreck') {
    out.card = { site: id, title: `The log of the ${s.ship}`, text: WRECK_LOGS[s.log]! };
    const lead = leadAt(state, id);
    if (lead) out.card.lead = lead;
    countRead(state);
  }
  checkDone(state, s, rec, out);
  return out;
}

/** Alongside a ship in distress: its drive comes back, and the mayday pays (through its job). */
export function reachSite(state: GameState, id: string): SiteOutcome {
  const s = siteSpec(id, state);
  const rec = siteRecord(state, id);
  if (!s || !rec || rec.ended || s.kind !== 'ship' || s.bait) return none();
  const out = none();
  rec.reached = true;
  out.notes.push({ text: fill(SITE_NOTES.reached, { ship: s.ship }), tone: 'good' });
  out.comm = { speaker: s.ship, text: SITE_RADIO.reached };
  checkDone(state, s, rec, out);
  return out;
}

/** A derelict boarded: credits aboard, a data core if there is room, its log, and perhaps a lead. */
export function boardSite(state: GameState, id: string): SiteOutcome {
  const s = siteSpec(id, state);
  const rec = siteRecord(state, id);
  if (!s || !rec || rec.ended || rec.boarded || s.kind !== 'derelict') return none();
  const out = none();
  rec.boarded = true;
  const found: string[] = [];
  if (s.salvage > 0) {
    applyCredits(state, s.salvage, 'loot', `Salvage aboard the ${s.ship}`);
    found.push(`${s.salvage} cr of salvage`);
  }
  if (s.dataCore) {
    if (itemsThatFit(state.ship.cargo, 'data-cores', cargoCapacity(state.ship)) >= 1) {
      addCargo(state.ship.cargo, 'data-cores', 1, cargoCapacity(state.ship));
      found.push('a data core');
    } else out.notes.push({ text: SITE_NOTES.full, tone: 'info' });
  }
  const what = found.length ? found.join(' and ') : 'nothing worth taking';
  out.notes.push({ text: fill(SITE_NOTES.boarded, { ship: s.ship, what }), tone: 'good' });
  const ref = siteRef(id);
  if (ref?.from === 'mystery') {
    const places = mysteryPlaces(ref.mystery, state.world.wrecks!.mysteries![ref.mystery]!.from)!;
    const L = MYSTERY_LINES[ref.mystery];
    out.card = { site: id, title: fill(L.title, mysteryValues(places)), text: DERELICT_LOGS[s.log]!, found: fill(L.found, mysteryValues(places)) };
  } else {
    out.card = { site: id, title: `Aboard the ${s.ship}`, text: DERELICT_LOGS[s.log]!, found: `You find ${what}.` };
    const lead = leadAt(state, id);
    if (lead) out.card.lead = lead;
  }
  countRead(state);
  checkDone(state, s, rec, out);
  return out;
}

/**
 * Raiders lying dark come out (near it, or shown by a scan from further out); for a pilot the Wake
 * trusts they only wave them by. A decoy's job fails either way: there is nothing there to gain.
 */
export function springSite(state: GameState, id: string, how: 'near' | 'scan', friend = false): SiteOutcome {
  const s = siteSpec(id, state);
  const rec = siteRecord(state, id);
  if (!s || !rec || rec.ended || rec.sprung) return none();
  const out = none();
  rec.sprung = true;
  if (friend) out.comm = { speaker: 'Hollow Wake', text: SITE_RADIO.friend };
  else {
    out.notes.push({ text: fill(how === 'scan' ? SITE_NOTES.revealed : SITE_NOTES.sprung, { ship: s.ship }), tone: 'bad' });
    if (s.bait) out.comm = { speaker: 'Hollow Wake', text: SITE_RADIO.sprung };
  }
  if (s.bait) {
    rec.ended = { at: state.clock, how: 'bait' };
    out.notes.push({ text: fill(SITE_NOTES.bait, { ship: s.ship }), tone: 'bad' });
    const ev = failJob(state, siteJobId(id), `the ${s.ship} was bait`);
    if (ev) out.jobs.push(ev);
  }
  return out;
}

/** Coming near a wreck or a derelict: its beacon on the radio. */
export function nearSite(state: GameState, id: string): SiteOutcome {
  const s = siteSpec(id, state);
  const out = none();
  if (s?.kind === 'wreck') out.comm = { speaker: 'Wreck beacon', text: fill(SITE_RADIO.wreck, { ship: s.ship }) };
  if (s?.kind === 'derelict') out.comm = { speaker: 'Old beacon', text: fill(SITE_RADIO.derelict, { ship: s.ship }) };
  return out;
}

/** A scan of a site: a wreck's log read the first time; anything else, what the scan showed. */
export function scanSite(state: GameState, id: string, revealed: boolean): SiteOutcome {
  const s = siteSpec(id, state);
  const rec = siteRecord(state, id);
  if (!s || !rec || rec.ended) return none();
  if (s.kind === 'wreck' && !rec.read) return readSite(state, id);
  const out = none();
  if (!revealed && s.kind !== 'wreck') out.notes.push({ text: fill(SITE_NOTES.clear, { ship: s.ship }), tone: 'info' });
  return out;
}

/** The raiders picking a wreck over all downed: they do not come back. */
export function clearSite(state: GameState, id: string): SiteOutcome {
  const rec = siteRecord(state, id);
  if (rec && !rec.ended) rec.cleared = true;
  return none();
}

/** A ship in distress destroyed before it was reached. */
export function loseSite(state: GameState, id: string): SiteOutcome {
  const s = siteSpec(id, state);
  const rec = siteRecord(state, id);
  if (!s || !rec || rec.ended) return none();
  rec.ended = { at: state.clock, how: 'lost' };
  const out = none();
  const ev = failJob(state, siteJobId(id), `the ${s.ship} was destroyed`);
  if (ev) out.jobs.push(ev);
  return out;
}

// ---------------------------------------------------------------- settling

/**
 * Sites and mystery steps whose window has passed are gone (never while the pilot flies in their
 * system: they wait for the flight); a site whose job was dropped is dropped. Their jobs fail.
 */
export function settleSites(state: GameState, flyingIn: SystemId | null): SiteOutcome {
  const out = none();
  const log = state.world.wrecks;
  if (!log) return out;
  for (const [id, rec] of openSites(state)) {
    // A trail's find goes with its trail (below).
    if (id.startsWith('mys.')) continue;
    const job = state.jobs[siteJobId(id)];
    if (job && job.status !== 'active' && job.status !== 'complete') {
      rec.ended = { at: state.clock, how: 'dropped' };
      continue;
    }
    if (rec.systemId === flyingIn || state.clock <= siteUntil(state, id)) continue;
    rec.ended = { at: state.clock, how: 'lapsed' };
    const s = siteSpec(id, state);
    const ship = s?.ship ?? 'ship';
    out.notes.push({ text: fill(SITE_NOTES.lapsed[rec.kind], { ship }), tone: 'info' });
    if (s?.kind === 'ship' || s?.pods[0]?.what === 'lifepod') crewDeed(state, CREW.siteDeeds[`${s.kind === 'ship' ? 'ship' : 'lifepod'}.lapsed`]);
    const ev = failJob(state, siteJobId(id), 'it is gone');
    if (ev) out.jobs.push(ev);
  }
  for (const m of MYSTERY_IDS) {
    const rec = log.mysteries?.[m];
    if (!rec || rec.ended) continue;
    const job = state.jobs[`mys.${m}`];
    const find = log.sites[`mys.${m}.1`];
    if (job?.status === 'complete') {
      rec.ended = { at: state.clock, how: 'solved' };
      continue;
    }
    if (job && job.status !== 'active') {
      rec.ended = { at: state.clock, how: 'dropped' };
      if (find && !find.ended) find.ended = { at: state.clock, how: 'dropped' };
      continue;
    }
    const places = mysteryPlaces(m, rec.from);
    const here = rec.step === 0 ? places?.find : places ? getLocation(places.end).systemId : null;
    if (here === flyingIn || state.clock <= rec.stepAt + W.open.step) continue;
    rec.ended = { at: state.clock, how: 'cold' };
    if (find && !find.ended) find.ended = { at: state.clock, how: 'lapsed' };
    out.notes.push({ text: fill(MYSTERY_LINES[m].cold, places ? mysteryValues(places) : {}), tone: 'info' });
    const ev = failJob(state, `mys.${m}`, 'its trail went cold');
    if (ev) out.jobs.push(ev);
  }
  return out;
}

/** Keeps the open sites, and the newest finished ones within the rules. */
export function tidySites(state: GameState): void {
  const log = state.world.wrecks;
  if (!log) return;
  const finished = Object.entries(log.sites)
    .filter(([, s]) => s.ended)
    .sort((a, b) => b[1].ended!.at - a[1].ended!.at);
  const keep = new Set(finished.filter(([, s]) => state.clock - s.ended!.at <= W.keep.seconds).slice(0, W.keep.sites).map(([id]) => id));
  for (const [id, s] of Object.entries(log.sites)) {
    // A mystery's find stays while its mystery is remembered.
    if (!s.ended || keep.has(id) || id.startsWith('mys.')) continue;
    delete log.sites[id];
    // A scan's job goes with it (a lane's is tidied with the other contracts).
    const jobId = siteJobId(id);
    if (id.startsWith('scan.') && state.jobs[jobId]?.status !== 'active') {
      delete state.jobs[jobId];
      delete state.contracts[jobId];
    }
  }
}

// ---------------------------------------------------------------- the mysteries

/** The mystery under way, if any. */
export function mysteryUnderWay(state: GameState): MysteryId | null {
  const ms = state.world.wrecks?.mysteries ?? {};
  return MYSTERY_IDS.find((m) => ms[m] && !ms[m]!.ended) ?? null;
}

export interface MysteryPlaces {
  from: string;
  start: SystemId;
  /** The find's system; the ending's station (and a fence's, for the strongbox). */
  find: SystemId;
  end: string;
  fence?: string;
  /** The starting site's ship; the sister hull; the body the sister drifts near. */
  ship: string;
  sister?: string;
  body?: string;
  bodyName?: string;
}

const kindOf = (l: FictionalLocation): StationType | null => l.stationType ?? null;

/** The nearest open station of an ending's kinds within its reach of a system, ties broken by the rng. */
function nearestEnd(end: MysteryEnd, systemId: SystemId, r: Rng, allowDen: boolean): FictionalLocation | null {
  const jumps = jumpsFrom(WORLD.links, systemId);
  const ok = ALL_LOCATIONS.filter((l) => {
    const t = kindOf(l);
    if (l.status !== 'functional' || l.dockable === false || (jumps.get(l.systemId) ?? 99) > end.jumps) return false;
    if (t === 'pirate-den') return allowDen && !!end.den;
    return !!t && end.types.includes(t);
  });
  if (!ok.length) return null;
  const tie = new Map(ok.map((l) => [l.id, r.next()]));
  return ok.sort((a, b) => jumps.get(a.systemId)! - jumps.get(b.systemId)! || tie.get(a.id)! - tie.get(b.id)! || a.id.localeCompare(b.id))[0]!;
}

/**
 * Where a mystery's trail leads from the site that began it (docs/PROCGEN.md §31.6): the find in a
 * system the rule's jumps on (never the start, Sol or Pyre), and the ending at the nearest station of
 * its kinds within reach of the find. Null when the trail has nowhere to go from there.
 */
export function mysteryPlaces(id: MysteryId, from: string): MysteryPlaces | null {
  const ref = siteRef(from);
  if (!ref || ref.from === 'mystery') return null;
  const start = ref.systemId;
  const rule = MYSTERIES[id];
  const r = rng(WORLD_SEED, 'mystery', id, from);
  const jumps = jumpsFrom(WORLD.links, start);
  const [lo, hi] = rule.find.jumps;
  const candidates = [...jumps.entries()]
    .filter(([sys, j]) => j >= lo && j <= hi && sys !== 'sol' && !isInventedSystem(sys) && WORLD.profiles.has(sys))
    .map(([sys]) => sys)
    .filter((sys) => {
      if (rule.find.kind === 'derelict') return derelictsMayBe(sys);
      if (rule.find.below !== undefined) return (WORLD.profiles.get(sys)?.security ?? 1) < rule.find.below;
      return ALL_LOCATIONS.some((l) => l.systemId === sys && l.status === 'functional' && l.stationType && l.stationType !== 'pirate-den');
    })
    .sort();
  if (!candidates.length) return null;
  const find = r.pick(candidates);
  const end = nearestEnd(rule.end, find, r, false);
  if (!end) return null;
  if (id === 'strongbox' && !isLawful(end.factionId ?? null)) return null;
  const out: MysteryPlaces = { from, start, find, end: end.id, ship: siteSpecShip(from) };
  if (rule.fence) {
    const fence = nearestEnd({ ...rule.fence, den: false }, find, r, false);
    if (!fence) return null;
    out.fence = fence.id;
  }
  if (id === 'silence') {
    out.sister = r.pick(WRECK_NAMES.filter((n) => n !== out.ship));
    const bodies = siteBodies(find);
    const b = bodies.length ? r.pick(bodies) : null;
    if (!b) return null;
    out.body = b.id;
    out.bodyName = b.name;
  }
  return out;
}

/** The ship of the site a trail began at (from its id alone). */
function siteSpecShip(from: string): string {
  const ref = siteRef(from);
  if (ref?.from === 'lane') return laneOfferById(ref.offerId)?.ship ?? 'Patient Grey';
  if (ref?.from === 'scan') return scanFind(ref.systemId, ref.slot)?.ship ?? 'Patient Grey';
  return 'Patient Grey';
}

/** A trail's words' fields. */
export function mysteryValues(p: MysteryPlaces): Record<string, string> {
  return {
    ship: p.ship,
    sister: p.sister ?? '',
    body: p.bodyName ?? '',
    system: getSystem(p.find).displayName,
    station: getLocation(p.end).name,
    fence: p.fence ? getLocation(p.fence).name : '',
  };
}

/** Counts a log read (the first always holds a lead, if one can be had). */
function countRead(state: GameState): void {
  const log = wreckLog(state);
  log.read = (log.read ?? 0) + 1;
}

/**
 * Whether a log just read holds a lead (docs/PROCGEN.md §31.6): none while a mystery is under way;
 * otherwise a mystery never begun whose trail can start here, the first log ever read always, after
 * that one in so many.
 */
export function leadAt(state: GameState, siteId: string): SiteCard['lead'] | null {
  if (mysteryUnderWay(state)) return null;
  const s = siteSpec(siteId, state);
  if (!s || s.from === 'mystery') return null;
  const begun = state.world.wrecks?.mysteries ?? {};
  const candidates = MYSTERY_IDS.filter((m) => !begun[m] && MYSTERIES[m].from.includes(s.kind) && mysteryPlaces(m, siteId));
  if (!candidates.length) return null;
  const first = (state.world.wrecks?.read ?? 0) === 0;
  if (!first && s.lead >= W.leads.chance) return null;
  const m = first ? candidates[0]! : rng(WORLD_SEED, 'lead', siteId).pick(candidates);
  const v = mysteryValues(mysteryPlaces(m, siteId)!);
  return { mystery: m, title: fill(MYSTERY_LINES[m].title, v), text: fill(MYSTERY_LINES[m].lead, v) };
}

/** Follows a lead: the mystery begins, its find is marked, and a job steers the pilot along the trail. */
export function followLead(state: GameState, siteId: string, m: MysteryId): { ok: boolean; message: string; jobId?: string } {
  if (mysteryUnderWay(state) || state.world.wrecks?.mysteries?.[m]) return { ok: false, message: 'You are on another trail already.' };
  const places = mysteryPlaces(m, siteId);
  if (!places) return { ok: false, message: 'The trail leads nowhere.' };
  const log = wreckLog(state);
  const rec: MysteryRecord = { from: siteId, began: state.clock, step: 0, stepAt: state.clock };
  (log.mysteries ??= {})[m] = rec;
  const findId = `mys.${m}.1`;
  const s = siteSpec(findId, state)!;
  log.sites[findId] = { at: state.clock, systemId: s.systemId, kind: s.kind };
  const v = mysteryValues(places);
  const L = MYSTERY_LINES[m];
  const rule = MYSTERIES[m];
  const end = getLocation(places.end);
  const jobId = `mys.${m}`;
  state.contracts[jobId] = {
    id: jobId,
    title: fill(L.title, v),
    giverLocationId: end.id,
    factionId: null,
    briefing: `${fill(L.lead, v)} ${SITE_FICTION}`,
    objectives: [
      { kind: 'site', systemId: s.systemId, siteId: findId, text: fill(L.find, v) },
      { kind: 'visit', locationId: end.id, text: fill(L.end, v) },
    ],
    reward: rule.end.pay,
    repReward: isLawful(end.factionId ?? null) && rule.end.standing ? { [end.factionId!]: rule.end.standing } : {},
    difficulty: m === 'strongbox' ? 2 : 1,
    difficultyNote: 'A trail from a wreck',
    destinationLocationId: end.id,
    contract: { kind: rule.end.contract },
  };
  state.jobs[jobId] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
  return { ok: true, message: `Taken on: ${fill(L.title, v)}.`, jobId };
}

/** The strongbox's ending (the owner's choice): its insurers, or a fence for more and the Wake's thanks. */
export function chooseEnding(state: GameState, choice: 'insurer' | 'fence'): { ok: boolean; message: string } {
  const rec = state.world.wrecks?.mysteries?.strongbox;
  const job = state.contracts['mys.strongbox'];
  if (!rec || rec.ended || !job) return { ok: false, message: 'There is no strongbox to take anywhere.' };
  const places = mysteryPlaces('strongbox', rec.from);
  if (!places) return { ok: false, message: 'There is no strongbox to take anywhere.' };
  rec.choice = choice;
  const L = MYSTERY_LINES.strongbox;
  const v = mysteryValues(places);
  const rule = MYSTERIES.strongbox;
  if (choice === 'fence' && places.fence && rule.fence) {
    const fence = getLocation(places.fence);
    job.objectives = [job.objectives[0]!, { kind: 'visit', locationId: fence.id, text: fill(L.fence ?? '', v) }];
    job.reward = rule.fence.pay;
    job.repReward = { 'hollow-wake': rule.fence.wake ?? 0 };
    job.destinationLocationId = fence.id;
    job.contract = { kind: rule.fence.contract };
    return { ok: true, message: `You will take it to ${fence.name}.` };
  }
  return { ok: true, message: `You will return it to ${getLocation(places.end).name}.` };
}

/** The journal's view: the mystery under way (or the last), with what the pilot has found so far. */
export function mysteryStatus(state: GameState): { id: MysteryId; title: string; step: string; ended?: string } | null {
  const ms = state.world.wrecks?.mysteries ?? {};
  const m = mysteryUnderWay(state) ?? MYSTERY_IDS.filter((x) => ms[x]).sort((a, b) => ms[b]!.began - ms[a]!.began)[0];
  if (!m) return null;
  const rec = ms[m]!;
  const places = mysteryPlaces(m, rec.from);
  const v = places ? mysteryValues(places) : {};
  const L = MYSTERY_LINES[m];
  const step = rec.step === 0 ? fill(L.find, v) : fill(rec.choice === 'fence' ? (L.fence ?? L.end) : L.end, v);
  return { id: m, title: fill(L.title, v), step, ...(rec.ended ? { ended: rec.ended.how === 'solved' ? fill(L.solved, v) : fill(L.cold, v) } : {}) };
}

/** A call to the salvors, or a report: standing with the system's law. */
export function reportSite(state: GameState, o: LaneOffer): void {
  const owner = isLawful(lawIn(o.systemId)) ? lawIn(o.systemId) : null;
  if (owner) adjustReputation(state.reputation, owner, 1);
}
