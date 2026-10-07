import { applyCredits, type CommodityId, type GameState, type PriceQuote } from '../app/state.ts';
import { CONTRACTS, type ContractKind } from '../content/contracts/rules.ts';
import { CREW } from '../content/crew/rules.ts';
import { DENS } from '../content/dens/rules.ts';
import { ACE_COMBAT_RANK, RATINGS } from '../content/progress/rules.ts';
import { ARC_JOBS, CHARACTERS } from '../content/story/arcs.ts';
import type { StoryMeta, StoryOption } from '../content/story/types.ts';
import { getLocation, getSystem } from '../data/systems.ts';
import type { FactionId, SystemId } from '../data/types.ts';
import { addCargo, cargoCount, itemsThatFit, removeCargo } from './cargo.ts';
import { COMMODITIES } from './commodities.ts';
import { crewDeed } from './crewDeeds.ts';
import { CONTRACT_PREFIX, contractBlock, escortDanger, followUpFor, postedContract, postedContracts } from './contracts.ts';
import { adjustReputation, FACTIONS, standingTier, TIER_LABEL } from './factions.ts';
import { cargoCapacity } from './loadout.ts';
import { carriesPassengers, fare } from './passengers.ts';
import { rating } from './progress.ts';
import { rankLock } from './ranks.ts';
import { denDown } from './dens.ts';
import { dockAccess } from './law.ts';
import { BORDER } from '../content/border/rules.ts';
import { getFront, pushFront } from './border.ts';
import { leaveMark, settleFront, storyMark } from './answers.ts';
import { observeBaseline, observeDone, type ObserveObjective } from './stellar.ts';
import { firstLightSeen, PYRE_HOLE_ID } from './doomed.ts';
import { DOOMED } from '../content/stellar/doomed.ts';
import { asteroidOf } from '../data/asteroids.ts';
import { cometOf } from '../data/comets.ts';
import { EMBERS } from '../content/story/embers.ts';
import { holdPyre, lifeboatTimes, observatoryStands, pyreArcOpen } from './embers.ts';
import { haulById, recordHaul, releaseHaul } from './hauls.ts';
import { notePaid } from './logbook.ts';

export type Objective =
  | { kind: 'have-cargo'; commodity: CommodityId; qty: number; text: string }
  | { kind: 'dock'; locationId: string; text: string }
  | { kind: 'scan'; bodyId: string; systemId: SystemId; text: string }
  /** Fly sightseers close to a sight of the real sky (docs/PROCGEN.md §23; JobProgress.seen), seen before or not. */
  | { kind: 'sight'; sightId: string; systemId: SystemId; targetId: string; text: string }
  /** Observe a dying far star from open space while its window is open (docs/PROCGEN.md §25; JobProgress.observed), from two systems far enough apart for a parallax. */
  | ObserveObjective
  | { kind: 'deliver'; commodity: CommodityId; qty: number; locationId: string; text: string }
  | { kind: 'visit'; locationId: string; text: string }
  /**
   * Destroy `count` raiders of a contract pack lurking near a location (progress in
   * JobProgress.kills). With `ace`, the pack is a named raider (the one to destroy) and guards.
   */
  | { kind: 'bounty'; systemId: SystemId; locationId: string; count: number; level: 1 | 2 | 3; text: string; ace?: { name: string; model: string } }
  /**
   * See a trader (catalogue ship `model`) safely from one station to another (JobProgress.escort),
   * in `systemId`, the destination's system. When it sets off in another system it keeps with the
   * player and jumps with them (JobProgress.escortAt). A convoy is several ships (`names`) under
   * `waves` ambushes on the way to the destination, of which `need` must arrive
   * (JobProgress.escorted / lost).
   */
  | {
      kind: 'escort';
      systemId: SystemId;
      fromLocationId: string;
      locationId: string;
      model: string;
      shipName: string;
      level: 1 | 2 | 3;
      text: string;
      convoy?: { names: readonly string[]; need: number; waves: number };
      /** A relief haul or a glut's shipment of the timetable, bound through raided lanes (docs/PROCGEN.md §21.7). */
      haul?: string;
    }
  /** Tractor an item in from a wreck near a location, perhaps guarded by raiders of threat `guard` (JobProgress.recovered). */
  | { kind: 'recover'; systemId: SystemId; locationId: string; item: string; guard: 1 | 2 | 3 | null; text: string }
  /** Destroy `count` haulers of a lawful faction in a system (outlaw work; progress in JobProgress.kills). */
  | { kind: 'piracy'; systemId: SystemId; faction: FactionId; count: number; text: string }
  /** A story decision made at a dock (recorded in GameState.story.choices under `choiceId`). */
  | { kind: 'choice'; locationId: string; choiceId: string; prompt: string; options: readonly StoryOption[]; text: string }
  /** Knock out a raider den's turrets, then its reactor (JobProgress.assault). */
  | { kind: 'assault'; systemId: SystemId; locationId: string; text: string }
  /** Hold a den against a lawful sweep (the Authority's unless `faction` says): destroy `count` of its ships (JobProgress.kills). */
  | { kind: 'defend'; systemId: SystemId; locationId: string; count: number; text: string; faction?: 'sta' | 'frontier' }
  /** Mine `qty` units of a good in a cited belt (JobProgress.mined; docs/PROCGEN.md §19). */
  | { kind: 'mine'; systemId: SystemId; beltId: string; commodity: CommodityId; qty: number; text: string }
  /**
   * Bring `qty` of a good to a ship stranded by a drive failure far from any dock, perhaps watched
   * by scavengers of threat `guard`, and hand it over alongside (JobProgress.rescued).
   */
  | { kind: 'rescue'; systemId: SystemId; shipName: string; model: string; commodity: CommodityId; qty: number; guard: 1 | 2 | 3 | null; text: string; beltId?: string }
  /**
   * A stand in a belt (docs/PROCGEN.md §40.3): the crews' cutters (`crews.names`) work their rocks in
   * the belt's ring while `waves` waves of claim-jumpers, `ships` in all, of threat `level`, come for
   * them; won with at least `crews.need` cutters left (JobProgress.stood).
   */
  | { kind: 'stand'; systemId: SystemId; beltId: string; crews: { names: readonly string[]; need: number }; waves: number; ships: number; level: 1 | 2 | 3; text: string }
  /** Lifeboats launched from Pyre Observatory as it dies (docs/PROCGEN.md §42.4): gather `need` of `count`, then get clear through the lane before the collapse. */
  | { kind: 'lifeboats'; systemId: SystemId; count: number; need: number; text: string }
  /** Meet a rival at a beacon for a duel, one on one, and win it (docs/PROCGEN.md §28; JobProgress.duel). */
  | { kind: 'duel'; systemId: SystemId; rival: string; text: string }
  /** Hold the player's outpost against a raid (docs/PROCGEN.md §29; JobProgress.outpost): the raid's window and when it strikes. */
  | { kind: 'outpost'; systemId: SystemId; locationId: string; window: number; at: number; text: string }
  /** A site marked in flight (docs/PROCGEN.md §31): done when the pilot has done all there is to do there. */
  | { kind: 'site'; systemId: SystemId; siteId: string; text: string };

export interface JobDef {
  id: string;
  title: string;
  giverLocationId: string;
  /** Who posts it (null: an independent station). */
  factionId: FactionId | null;
  /** Short original narrative hook (fiction). */
  briefing: string;
  objectives: Objective[];
  reward: number;
  repReward: Partial<Record<FactionId, number>>;
  difficulty: 1 | 2 | 3;
  difficultyNote: string;
  destinationLocationId: string;
  requires?: {
    jobComplete?: string;
    minRep?: { faction: FactionId; value: number };
    /** A story choice already made one of these ways. */
    choice?: { id: string; oneOf: readonly string[] };
    /** A commission: a rank with this faction, this high or higher (docs/PROCGEN.md §32.4). */
    rank?: { faction: FactionId; rank: number };
    /**
     * Pyre's state (docs/PROCGEN.md §42.1): `before`, only before it has warned (and once a warning
     * could come); `observatory`, only while Pyre Observatory stands.
     */
    pyre?: 'before' | 'observatory';
  };
  /** Jumps ending in this system cost nothing while the job is active. */
  coversJumpFeesTo?: SystemId;
  /** Prices the giver tells you about (shown as "posted in briefing"). */
  briefingPrices?: { locationId: string; prices: Partial<Record<CommodityId, PriceQuote>> };
  /**
   * Generated contracts (economy/contracts.ts): their kind, cargo loaded on acceptance, deposit, and
   * the world event they answer (economy/events.ts), if any.
   */
  contract?: {
    kind: ContractKind;
    cargo?: { commodity: CommodityId; qty: number };
    deposit?: number;
    event?: string;
    /** Urgent jobs: a bonus for finishing within `seconds` of accepting (game clock). */
    urgent?: { seconds: number; bonus: number };
    /** Follow-ups: step of the chain, the contract it follows, and when the offer lapses (game clock). */
    chain?: { step: number; parent: string; expires: number };
    /** War work (economy/border.ts): the front it is for, and whose side it pushes. */
    front?: string;
    side?: 'law' | 'wake';
    /** A side's decisive operation: done, it settles the front for good (docs/PROCGEN.md §20.7). */
    decisive?: true;
    /** Passages and tours (docs/PROCGEN.md §23): the party aboard, by name (fiction); each takes a berth. */
    party?: readonly string[];
    /**
     * An escort for a relief haul or a glut's shipment (docs/PROCGEN.md §21.7): the haul, and when it
     * sets off alone if nobody has taken the job (game clock).
     */
    haul?: string;
    /** Work that comes and goes within a time slot: on the board from `posted` until `until` (game clock). */
    posted?: number;
    until?: number;
    /** A job taken on in flight from a lane encounter (docs/PROCGEN.md §27): the encounter's id. */
    lane?: string;
    /** A job of a rival's story (docs/PROCGEN.md §28): the rival's id. */
    rival?: string;
    /** A favour for someone of the crew (docs/PROCGEN.md §30): their id. */
    crew?: string;
    /** Flare watch (docs/PROCGEN.md §43.5): the flare it is for (`f.<star>.<window>`). */
    flare?: string;
    /** A pair's measurement (docs/PROCGEN.md §44.5): the secondary measured. */
    pair?: string;
    /** A comet's imaging (docs/PROCGEN.md §45.5): the comet imaged. */
    comet?: string;
    /** A near-Earth asteroid's tracking (docs/PROCGEN.md §47.5): the asteroid tracked. */
    asteroid?: string;
  };
  /** Story arc missions (content/story/arcs.ts): arc, step, speaker and beats. */
  story?: StoryMeta;
}

export const LIFELINE_ID = 'lifeline';
export const LIFELINE_QTY = 6;

export const JOBS: readonly JobDef[] = [
  {
    id: LIFELINE_ID,
    title: 'Lifeline to Proxima',
    giverLocationId: 'earth-port',
    factionId: 'frontier',
    briefing:
      'Meridian Outpost, the Frontier Cooperative’s research station at Proxima Centauri, lost its medical fabricator in a power fault. Their regular hauler was ambushed by Hollow Wake raiders near Mars last week. They need a small, quick ship: carry six crates of medical supplies to Meridian. Sol departures are cleared at Deimos Depot, Mars. The Cooperative covers your jump fee to Alpha Centauri.',
    objectives: [
      { kind: 'have-cargo', commodity: 'medical', qty: LIFELINE_QTY, text: 'Buy 6 medical supplies' },
      { kind: 'dock', locationId: 'mars-depot', text: 'Dock at Deimos Depot (Mars) for departure clearance' },
      { kind: 'scan', bodyId: 'proxima-cen-b', systemId: 'alpha-centauri', text: 'Scan Proxima Centauri b near Meridian Outpost' },
      {
        kind: 'deliver',
        commodity: 'medical',
        qty: LIFELINE_QTY,
        locationId: 'meridian-outpost',
        text: 'Deliver 6 medical supplies to Meridian Outpost',
      },
    ],
    reward: 1000,
    repReward: { frontier: 20, sta: 5 },
    difficulty: 2,
    difficultyNote: 'Raider activity reported near Mars',
    destinationLocationId: 'meridian-outpost',
    coversJumpFeesTo: 'alpha-centauri',
    briefingPrices: { locationId: 'meridian-outpost', prices: { medical: { buy: null, sell: 96 } } },
  },
  {
    id: 'relay-courier',
    title: 'Sealed data core',
    giverLocationId: 'barnard-relay',
    factionId: 'sta',
    briefing:
      'The relay’s long-range transmitter is down. Carry a sealed Transit Authority data core back to Deimos Depot. It fits in a pocket: no cargo space needed.',
    objectives: [{ kind: 'visit', locationId: 'mars-depot', text: 'Dock at Deimos Depot (Mars) with the data core' }],
    reward: 320,
    repReward: { sta: 8 },
    difficulty: 1,
    difficultyNote: 'Quiet route',
    destinationLocationId: 'mars-depot',
  },
  {
    id: 'eridani-spares',
    title: 'Spares for the belt',
    giverLocationId: 'meridian-outpost',
    factionId: 'frontier',
    briefing:
      'The Eridani Mining Hub is cannibalising its drills for parts. Bring them three fabricator parts: Horizon Platform at Sirius sells them cheaper than Earth.',
    objectives: [
      {
        kind: 'deliver',
        commodity: 'fabricators',
        qty: 3,
        locationId: 'eridani-hub',
        text: 'Deliver 3 fabricator parts to Eridani Mining Hub',
      },
    ],
    reward: 700,
    repReward: { frontier: 10 },
    difficulty: 1,
    difficultyNote: 'Two jumps via Sirius',
    destinationLocationId: 'eridani-hub',
    requires: { jobComplete: LIFELINE_ID },
  },
  {
    id: 'horizon-survey',
    title: 'Close pass on Sirius B',
    giverLocationId: 'sirius-platform',
    factionId: 'frontier',
    briefing:
      'Horizon’s instruments need a calibration pass: fly close to the white dwarf Sirius B and run a scan, then return. Only pilots the Cooperative trusts get this one.',
    objectives: [
      { kind: 'scan', bodyId: 'sirius-b', systemId: 'sirius', text: 'Scan Sirius B at close range' },
      { kind: 'visit', locationId: 'sirius-platform', text: 'Return to Horizon Platform' },
    ],
    reward: 450,
    repReward: { frontier: 6 },
    difficulty: 2,
    difficultyNote: 'Intense radiation near the white dwarf',
    destinationLocationId: 'sirius-platform',
    requires: { minRep: { faction: 'frontier', value: 10 } },
  },
];

/** A hand-made job, a story mission, or a generated contract the player has accepted (kept in the save). */
export function getJob(id: string, state?: Pick<GameState, 'contracts'>): JobDef {
  const job = JOBS.find((j) => j.id === id) ?? ARC_JOBS.find((j) => j.id === id) ?? state?.contracts[id];
  if (!job) throw new Error(`Unknown job ${id}`);
  return job;
}

/** Why a job cannot be offered, or null when it can be accepted. */
export function jobLockReason(state: GameState, job: JobDef): string | null {
  const req = job.requires;
  if (req?.jobComplete && state.jobs[req.jobComplete]?.status !== 'complete') {
    return `Available after “${getJob(req.jobComplete).title}”`;
  }
  if (req?.minRep && (state.reputation[req.minRep.faction] ?? 0) < req.minRep.value) {
    return `Requires ${TIER_LABEL[standingTier(req.minRep.value)]} standing with the ${FACTIONS[req.minRep.faction].name}`;
  }
  if (req?.choice && !req.choice.oneOf.includes(state.story.choices[req.choice.id] ?? '')) return 'Not after what you chose';
  if (req?.pyre === 'before' && !state.jobs[job.id] && !pyreArcOpen(state)) return 'Not while Pyre is as it is';
  if (req?.pyre === 'observatory' && !observatoryStands(state)) return 'Pyre Observatory is gone';
  const cargo = job.story?.cargo;
  if (cargo && itemsThatFit(state.ship.cargo, cargo.commodity, cargoCapacity(state.ship)) < cargo.qty) {
    return `Needs ${cargo.qty * COMMODITIES[cargo.commodity].unitSize} free hold units`;
  }
  // Ace hunts and den assaults are for pilots with a record.
  const strike = job.contract?.kind === 'den' || (job.contract?.decisive && job.contract.side === 'law');
  if ((job.contract?.kind === 'ace' || strike) && rating(state, 'combat').index < ACE_COMBAT_RANK) {
    return `Needs a ${RATINGS.combat.ranks[ACE_COMBAT_RANK]![0]} combat rating`;
  }
  const assault = job.objectives[0];
  if (strike && assault?.kind === 'assault' && !state.jobs[job.id] && denDown(state, assault.locationId)) return `${getLocation(assault.locationId).name} is already dark`;
  // An escort for a haul of the timetable (docs/PROCGEN.md §21.7): only before it sets off alone, and once.
  const haul = job.contract?.haul;
  if (haul && !state.jobs[job.id]) {
    const name = haulById(haul)?.name ?? 'hauler';
    if (state.clock >= (job.contract!.until ?? Infinity)) return `The ${name} has set off without an escort`;
    if (state.world.hauls?.[haul]) return `The ${name} already has an escort`;
  }
  // A lawful faction that is wary of you only trusts you with the easiest work.
  if (job.contract && job.factionId && job.factionId !== 'hollow-wake' && job.difficulty >= 2) {
    const tier = standingTier(state.reputation[job.factionId] ?? 0);
    if (tier === 'wary' || tier === 'hostile') return `The ${FACTIONS[job.factionId].name} is wary of you: easy work only`;
  }
  // A commission is for the faction's own ranks (docs/PROCGEN.md §32.4).
  const rank = rankLock(state, req?.rank);
  if (rank) return rank;
  return contractBlock(state, job);
}

export interface JobOffer {
  job: JobDef;
  status: 'available' | 'locked' | 'active' | 'complete' | 'abandoned' | 'failed';
  lockReason: string | null;
}

/** A follow-up offered to the player (kept in the save until taken or lapsed), or null. */
export function offeredContract(state: GameState, id: string): JobDef | null {
  const c = state.contracts[id];
  return c?.contract?.chain && !state.jobs[id] && state.clock < c.contract.chain.expires ? c : null;
}

/**
 * Story missions show at their giver's dock once the step before is done (and, after a choice, only
 * the way it went), so nothing is given away early. The first step of each arc shows from the start.
 */
export function storyVisible(state: GameState, job: JobDef): boolean {
  const story = job.story;
  if (!story) return false;
  if (state.jobs[job.id]) return true;
  const req = job.requires;
  if (req?.choice && !req.choice.oneOf.includes(state.story.choices[req.choice.id] ?? '')) return false;
  // An arc of Pyre's (docs/PROCGEN.md §42.1): offered only before it warns, its steps there only while the observatory stands.
  if (req?.pyre === 'before' && !pyreArcOpen(state)) return false;
  if (req?.pyre === 'observatory' && !observatoryStands(state)) return false;
  if (story.step === 1) return true;
  return !!req?.jobComplete && state.jobs[req.jobComplete]?.status === 'complete';
}

/**
 * Jobs posted at a dock (hand-made and story first, then follow-ups offered to you, then the board),
 * with their availability. A pilot docked on sufferance (docs/PROCGEN.md §12, §20) is offered only
 * an independent's story missions: those ask nobody's leave.
 */
export function jobsAt(state: GameState, locationId: string): JobOffer[] {
  const full = dockAccess(state, locationId) === 'full';
  // Finished story missions live on in the journal, not on the board.
  const story = ARC_JOBS.filter((j) => j.giverLocationId === locationId && (full || !j.factionId) && storyVisible(state, j) && state.jobs[j.id]?.status !== 'complete');
  const offers = Object.keys(state.contracts)
    .map((id) => offeredContract(state, id))
    .filter((c): c is JobDef => !!c && c.giverLocationId === locationId);
  const posted = full
    ? [...JOBS.filter((j) => j.giverLocationId === locationId), ...story, ...offers, ...postedContracts(state, locationId).map((c) => state.contracts[c.id] ?? c)]
    : story;
  return posted.map((job) => {
    const progress = state.jobs[job.id];
    if (progress) return { job, status: progress.status, lockReason: null };
    const lockReason = jobLockReason(state, job);
    return { job, status: lockReason ? 'locked' : 'available', lockReason };
  });
}

/** Finished (completed, abandoned or failed) generated contracts kept for the journal; older ones are forgotten. */
const KEEP_COMPLETED_CONTRACTS = 30;

export function acceptJob(state: GameState, jobId: string): { ok: boolean; message: string } {
  const story = ARC_JOBS.find((j) => j.id === jobId && storyVisible(state, j));
  const job = JOBS.find((j) => j.id === jobId) ?? story ?? postedContract(jobId) ?? offeredContract(state, jobId);
  if (!job) return { ok: false, message: 'That contract is no longer posted.' };
  if (state.jobs[jobId]) return { ok: false, message: 'Already accepted.' };
  const lock = jobLockReason(state, job);
  if (lock) return { ok: false, message: lock };
  if (job.contract) {
    // Generated contracts are copied into the save, so they never change under the player.
    state.contracts[jobId] = structuredClone(job);
    const { cargo, deposit } = job.contract;
    // Deposits and their refunds both count as contract money in the voyage report.
    if (deposit) applyCredits(state, -deposit, 'reward', `Deposit: ${job.title}`);
    if (cargo) addCargo(state.ship.cargo, cargo.commodity, cargo.qty, cargoCapacity(state.ship));
    forgetOldContracts(state);
  }
  // A story mission may hand over cargo to carry (it was checked to fit).
  if (job.story?.cargo) addCargo(state.ship.cargo, job.story.cargo.commodity, job.story.cargo.qty, cargoCapacity(state.ship));
  state.jobs[jobId] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
  // Last Light at Pyre taken: Pyre's warning waits for its choice (docs/PROCGEN.md §42.1).
  if (jobId === EMBERS.first) holdPyre(state);
  // The haul waits for its escort, off its timetable (docs/PROCGEN.md §21.7).
  if (job.contract?.haul) recordHaul(state.world, job.contract.haul, { at: state.clock, fate: 'escort', systemId: getLocation(job.giverLocationId).systemId });
  if (job.briefingPrices) {
    const existing = state.knownMarkets[job.briefingPrices.locationId];
    if (!existing || existing.source === 'briefing') {
      state.knownMarkets[job.briefingPrices.locationId] = {
        source: 'briefing',
        observedAt: state.clock,
        prices: job.briefingPrices.prices,
      };
    }
  }
  return { ok: true, message: `Accepted: ${job.title}` };
}

/**
 * Gives up a generated contract (the hand-made ones cannot be dropped): any deposit is forfeit, the
 * cargo stays in the hold and standing with the station's owner drops a little. It stays on its
 * board as abandoned, so it cannot be taken again.
 */
export function abandonJob(state: GameState, jobId: string): { ok: boolean; message: string } {
  const progress = state.jobs[jobId];
  const job = state.contracts[jobId];
  if (!job || progress?.status !== 'active') return { ok: false, message: 'Only generated contracts in progress can be abandoned.' };
  progress.status = 'abandoned';
  progress.completedAt = state.clock;
  // A haul whose escort is given up goes on alone, on its timetable (docs/PROCGEN.md §21.7).
  if (job.contract?.haul) releaseHaul(state.world, job.contract.haul);
  const lost = job.factionId ? -adjustReputation(state.reputation, job.factionId, -CONTRACTS.abandonStanding) : 0;
  const deposit = job.contract?.deposit;
  const costs = [deposit ? `deposit of ${deposit} cr forfeit` : '', lost && job.factionId ? `standing with the ${FACTIONS[job.factionId].name} −${lost}` : ''].filter(Boolean);
  return { ok: true, message: `Abandoned: ${job.title}${costs.length ? ` (${costs.join(', ')})` : ''}` };
}

/**
 * Fails a generated contract in progress (an escorted ship lost or left behind): no pay, any
 * deposit is forfeit and standing with the station's owner drops. A story mission is not lost:
 * it goes back to its giver, to try again.
 */
export function failJob(state: GameState, jobId: string, reason: string): JobEvent | null {
  const progress = state.jobs[jobId];
  const story = ARC_JOBS.find((j) => j.id === jobId);
  if (story && progress?.status === 'active') {
    delete state.jobs[jobId];
    const giver = CHARACTERS[story.story!.speaker];
    return { jobId, kind: 'failed', text: `${story.title} failed: ${reason}. ${giver.name} will give you another try at ${getLocation(story.giverLocationId).name}.` };
  }
  const job = state.contracts[jobId];
  if (!job || progress?.status !== 'active') return null;
  progress.status = 'failed';
  progress.completedAt = state.clock;
  // A haul left behind by its escort goes on alone; one destroyed was recorded lost (escortLost).
  if (job.contract?.haul) releaseHaul(state.world, job.contract.haul);
  if (job.factionId) adjustReputation(state.reputation, job.factionId, -CONTRACTS.failStanding);
  return { jobId, kind: 'failed', text: `${job.title} failed: ${reason}` };
}

function forgetOldContracts(state: GameState): void {
  const done = Object.entries(state.jobs)
    .filter(([id, p]) => id.startsWith(CONTRACT_PREFIX) && p.status !== 'active')
    .sort((a, b) => (b[1].completedAt ?? 0) - (a[1].completedAt ?? 0));
  for (const [id] of done.slice(KEEP_COMPLETED_CONTRACTS)) {
    delete state.jobs[id];
    delete state.contracts[id];
  }
  // Follow-ups nobody took lapse.
  for (const [id, c] of Object.entries(state.contracts)) {
    if (!state.jobs[id] && c.contract?.chain && state.clock >= c.contract.chain.expires) delete state.contracts[id];
  }
}

export function activeJobIds(state: GameState): string[] {
  return Object.entries(state.jobs)
    .filter(([, p]) => p.status === 'active')
    .map(([id]) => id);
}

export function currentObjective(state: GameState, jobId: string): Objective | null {
  const progress = state.jobs[jobId];
  if (!progress || progress.status !== 'active') return null;
  return getJob(jobId, state).objectives[progress.objectiveIndex] ?? null;
}

export interface JobContext {
  dockedAt: string | null;
  systemId: SystemId;
}

function objectiveSatisfied(state: GameState, jobId: string, o: Objective, ctx: JobContext): boolean {
  switch (o.kind) {
    case 'bounty':
      return (state.jobs[jobId]?.kills ?? 0) >= o.count;
    case 'escort': {
      const p = state.jobs[jobId];
      if (!o.convoy) return p?.escort === 'arrived';
      // A convoy is through when every ship has arrived or been lost, and enough arrived.
      return (p?.escorted ?? 0) >= o.convoy.need && (p?.escorted ?? 0) + (p?.lost ?? 0) >= o.convoy.names.length;
    }
    case 'choice':
      return state.story.choices[o.choiceId] !== undefined;
    case 'assault':
      return state.jobs[jobId]?.assault === 'done';
    case 'defend':
      return (state.jobs[jobId]?.kills ?? 0) >= o.count;
    case 'recover':
      return !!state.jobs[jobId]?.recovered;
    case 'piracy':
      return (state.jobs[jobId]?.kills ?? 0) >= o.count;
    case 'mine':
      return (state.jobs[jobId]?.mined ?? 0) >= o.qty;
    case 'rescue':
      return !!state.jobs[jobId]?.rescued;
    case 'stand':
      return state.jobs[jobId]?.stood === true;
    case 'lifeboats':
      return state.jobs[jobId]?.clear === true;
    case 'duel':
      return state.jobs[jobId]?.duel === 'won';
    case 'outpost':
      return state.jobs[jobId]?.outpost === 'held';
    case 'site':
      return state.world.wrecks?.sites[o.siteId]?.ended?.how === 'done';
    case 'have-cargo':
      return cargoCount(state.ship.cargo, o.commodity) >= o.qty;
    case 'dock':
    case 'visit':
      return ctx.dockedAt === o.locationId;
    case 'scan':
      return state.discoveredBodies.includes(o.bodyId);
    case 'sight':
      return !!state.jobs[jobId]?.seen;
    case 'observe':
      // Pyre's first light (docs/PROCGEN.md §26.5) wants two fresh readings, the second farther out.
      if (o.firstLight) return firstLightSeen(o, state.jobs[jobId]?.observed ?? [], state.world.sky?.edge ?? null) >= 2;
      return observeDone(o, state.jobs[jobId]?.observed ?? []);
    case 'deliver':
      // Deliveries complete only when the player turns the cargo in (see deliverJob).
      return false;
  }
}

export interface JobEvent {
  jobId: string;
  /** `offer`: a follow-up is offered at the station (its id is `jobId`). */
  kind: 'objective' | 'complete' | 'failed' | 'offer';
  text: string;
  /** A completed job: what it paid, all told (a passenger fare less its fright, an urgent bonus). */
  paid?: number;
}

/**
 * Advances every active job past objectives already satisfied by the current state.
 * Safe to call after any change (dock, trade, scan, jump) and idempotent. Jobs whose last
 * objective is a 'visit' complete here and pay out.
 */
export function advanceJobs(state: GameState, ctx: JobContext): JobEvent[] {
  const events: JobEvent[] = [];
  for (const jobId of activeJobIds(state)) {
    const job = getJob(jobId, state);
    const progress = state.jobs[jobId]!;
    while (progress.status === 'active') {
      const o = job.objectives[progress.objectiveIndex];
      if (!o || !objectiveSatisfied(state, jobId, o, ctx)) break;
      progress.objectiveIndex += 1;
      if (progress.objectiveIndex >= job.objectives.length) {
        const out = payOut(state, job);
        events.push({ jobId, kind: 'complete', text: `${job.title} complete${out.note}`, paid: out.paid });
        if (out.offer) events.push(out.offer);
      } else {
        events.push({ jobId, kind: 'objective', text: o.text });
      }
    }
  }
  return events;
}

/** Seconds left to earn an urgent job's bonus (negative once late), or null for other jobs. */
export function urgentTimeLeft(state: GameState, jobId: string): number | null {
  const urgent = state.contracts[jobId]?.contract?.urgent;
  const progress = state.jobs[jobId];
  return urgent && progress ? progress.acceptedAt + urgent.seconds - state.clock : null;
}

interface Payout {
  repChanges: Partial<Record<FactionId, number>>;
  /** Pay including any urgent bonus. */
  paid: number;
  /** Said after "complete" (bonus or lateness). */
  note: string;
  offer: JobEvent | null;
}

function payOut(state: GameState, job: JobDef): Payout {
  const progress = state.jobs[job.id]!;
  const left = urgentTimeLeft(state, job.id);
  progress.status = 'complete';
  progress.completedAt = state.clock;
  // Passengers pay their fare less what a rough trip frightened out of them (docs/PROCGEN.md §23).
  const reward = carriesPassengers(job) ? fare(state, job) : job.reward;
  applyCredits(state, reward, 'reward', `${job.title} reward`);
  if (job.contract?.deposit) applyCredits(state, job.contract.deposit, 'reward', `Deposit returned: ${job.title}`);
  const repChanges: Partial<Record<FactionId, number>> = {};
  for (const [faction, delta] of Object.entries(job.repReward) as [FactionId, number][]) {
    repChanges[faction] = adjustReputation(state.reputation, faction, delta);
  }
  // Urgent jobs: a bonus in time, a little standing lost when late.
  let paid = reward;
  let note = reward < job.reward ? ` (a rough trip: ${job.reward - reward} cr off the fare)` : '';
  const urgent = job.contract?.urgent;
  if (urgent && left !== null && left >= 0) {
    applyCredits(state, urgent.bonus, 'reward', `On-time bonus: ${job.title}`);
    paid += urgent.bonus;
    note = ` with the on-time bonus (+${urgent.bonus} cr)`;
  } else if (urgent) {
    if (job.factionId) repChanges[job.factionId] = (repChanges[job.factionId] ?? 0) + adjustReputation(state.reputation, job.factionId, -CONTRACTS.urgent.lateStanding);
    note = ' (late: no bonus)';
  }
  state.stats.deliveries += 1;
  state.stats.rewards += paid;
  // The logbook (docs/PROCGEN.md §46): the biggest pay, and an arc's finale.
  notePaid(state, paid, job.title, job.story?.finale ? job.story.arc : undefined);
  // A stranded hauler rescued, contraband run: deeds the crew aboard saw (docs/PROCGEN.md §30.4).
  crewDeed(state, job.contract ? CREW.jobDeeds[job.contract.kind] : undefined);
  // War work pushes its front the poster's way; The Long Border's finale settles its front for good (docs/PROCGEN.md §20).
  const front = job.contract?.front ? getFront(job.contract.front) : undefined;
  if (front) {
    const wake = job.contract!.side === 'wake';
    if (pushFront(state, front.id, wake ? -BORDER.deeds.warContract : BORDER.deeds.warContract)) {
      note += `; ${front.name} shifts ${wake ? 'the Wake’s way' : `the ${FACTIONS[front.faction].shortName}’s way`}`;
    }
  }
  const settles = job.story?.settles;
  if (settles) settleFront(state, settles.front, settles.ending);
  // A decisive operation settles its front for good, the way its side wanted (docs/PROCGEN.md §20.7).
  if (front && job.contract?.decisive && !state.world.border[front.id]?.ending) {
    settleFront(state, front.id, job.contract.side === 'wake' ? 'wake' : 'law');
    note += `; ${front.name} is settled for good`;
  }
  // A story's ending may change a station for good (docs/PROCGEN.md §14.7).
  const mark = storyMark(state, job.story);
  if (mark) leaveMark(state, mark);
  // A parcel or haul may lead to a follow-up at its destination.
  let offer: JobEvent | null = null;
  const next = followUpFor(job, state.clock);
  if (next && !state.contracts[next.id]) {
    state.contracts[next.id] = next;
    offer = { jobId: next.id, kind: 'offer', text: `Follow-up offered at ${getLocation(next.giverLocationId).name}: ${next.title}` };
  }
  return { repChanges, paid, note, offer };
}

/** Whether the active objective of `jobId` is a delivery that can be turned in here. */
export function canDeliver(state: GameState, jobId: string, locationId: string): boolean {
  const o = currentObjective(state, jobId);
  return !!o && o.kind === 'deliver' && o.locationId === locationId && cargoCount(state.ship.cargo, o.commodity) >= o.qty;
}

export function deliverJob(
  state: GameState,
  jobId: string,
  locationId: string,
): { ok: false; message: string } | { ok: true; reward: number; repChanges: Partial<Record<FactionId, number>> } {
  if (!canDeliver(state, jobId, locationId)) return { ok: false, message: 'Nothing to deliver here.' };
  const job = getJob(jobId, state);
  const o = currentObjective(state, jobId) as Extract<Objective, { kind: 'deliver' }>;
  removeCargo(state.ship.cargo, o.commodity, o.qty);
  const progress = state.jobs[jobId]!;
  progress.objectiveIndex += 1;
  if (progress.objectiveIndex < job.objectives.length) {
    return { ok: true, reward: 0, repChanges: {} };
  }
  const { repChanges, paid } = payOut(state, job);
  return { ok: true, reward: paid, repChanges };
}

export interface ObjectiveSummary {
  jobId: string;
  jobTitle: string;
  text: string;
  /** Where the player should go next, for waypoints and map highlights. */
  targetSystemId: SystemId | null;
  targetLocationId: string | null;
  targetBodyId: string | null;
  /** A flight target to steer to instead (a wreck), when there is one. */
  targetId?: string;
}

/**
 * Human-readable current objective, adapted to where the player is (handles detours:
 * e.g. "Jump to Alpha Centauri" when the objective lies in another system, or
 * "Buy 2 more medical supplies" after selling some).
 */
export function describeObjective(state: GameState, jobId: string): ObjectiveSummary | null {
  const summary = describeCurrent(state, jobId);
  const left = urgentTimeLeft(state, jobId);
  if (!summary || left === null) return summary;
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return { ...summary, text: `${summary.text} (${left >= 0 ? `${clock(left)} left for the bonus` : 'late: no bonus'})` };
}

function describeCurrent(state: GameState, jobId: string): ObjectiveSummary | null {
  const o = currentObjective(state, jobId);
  if (!o) return null;
  const job = getJob(jobId, state);
  const here = state.location.systemId;
  const base = { jobId, jobTitle: job.title, targetBodyId: null as string | null };
  const inOtherSystem = (systemId: SystemId, then: string) =>
    systemId !== here ? `Jump to ${getSystem(systemId).displayName} (open the map), then: ${then}` : then;
  switch (o.kind) {
    case 'have-cargo': {
      const have = cargoCount(state.ship.cargo, o.commodity);
      return {
        ...base,
        text: `${o.text} (${have}/${o.qty}) — Halcyon Ring market`,
        targetSystemId: 'sol',
        targetLocationId: 'earth-port',
      };
    }
    case 'dock':
    case 'visit': {
      const loc = getLocation(o.locationId);
      return { ...base, text: inOtherSystem(loc.systemId, o.text), targetSystemId: loc.systemId, targetLocationId: loc.id };
    }
    case 'scan':
      return {
        ...base,
        text: inOtherSystem(o.systemId, o.text),
        targetSystemId: o.systemId,
        targetLocationId: null,
        targetBodyId: o.bodyId,
      };
    case 'sight':
      // A planet is steered to as a body; a dwarf star or a belt by its target in the scene.
      return {
        ...base,
        text: inOtherSystem(o.systemId, o.text),
        targetSystemId: o.systemId,
        targetLocationId: null,
        ...(o.targetId.startsWith('planet:') ? { targetBodyId: o.sightId } : o.systemId === here ? { targetId: o.targetId } : {}),
      };
    case 'observe': {
      // Any system will do: the sky is the same everywhere (a parallax wants two, far enough apart).
      const now = state.clock;
      const mins = (s: number) => Math.max(1, Math.round(s / 60));
      const when = now < o.from ? `opens in ${mins(o.from - now)} min` : now <= o.to ? `${mins(o.to - now)} min left` : 'closed';
      // A flaring star is read where it is, in its own system (docs/PROCGEN.md §43.5).
      // So is a comet or an asteroid, in Sol (§45.5, §47.5).
      if (o.systemId) return { ...base, text: inOtherSystem(o.systemId, `${o.text} (${when})`), targetSystemId: o.systemId, targetLocationId: null, ...(o.systemId === here ? { targetId: cometOf(o.star) ? `comet:${o.star}` : asteroidOf(o.star) ? `asteroid:${o.star}` : `star:${o.star}` } : {}) };
      // Pyre's black hole is read where it is (docs/PROCGEN.md §26.5).
      if (o.star === PYRE_HOLE_ID) {
        const pyre = DOOMED.star.id as SystemId;
        return { ...base, text: inOtherSystem(pyre, `${o.text} (${when})`), targetSystemId: pyre, targetLocationId: null, targetId: `hole:${PYRE_HOLE_ID}` };
      }
      if (o.firstLight) {
        const seen = firstLightSeen(o, state.jobs[jobId]?.observed ?? [], state.world.sky?.edge ?? null);
        return { ...base, text: `${o.text} (${when}; ${seen} of 2 seen)`, targetSystemId: here, targetLocationId: null, targetId: `sky:${o.star}` };
      }
      const best = o.baselineLy ? observeBaseline(o, state.jobs[jobId]?.observed ?? []) : 0;
      const progress = o.baselineLy ? `; widest baseline so far ${best.toFixed(1)} of ${o.baselineLy} ly` : '';
      return { ...base, text: `${o.text} (${when}${progress})`, targetSystemId: here, targetLocationId: null, targetId: `sky:${o.star}` };
    }
    case 'bounty': {
      const kills = state.jobs[jobId]?.kills ?? 0;
      const text = o.ace ? o.text : `${o.text} (${kills}/${o.count})`;
      return { ...base, text: inOtherSystem(o.systemId, text), targetSystemId: o.systemId, targetLocationId: o.locationId };
    }
    case 'escort': {
      const at = escortSystem(state, jobId, o);
      const p = state.jobs[jobId];
      const tally = o.convoy ? ` (${p?.escorted ?? 0} in, ${p?.lost ?? 0} lost; ${o.convoy.need} of ${o.convoy.names.length} must arrive)` : '';
      const target = { targetSystemId: o.systemId, targetLocationId: o.locationId };
      if (at !== o.systemId) {
        // Not there yet: the ships keep with the player, and jump with them when close.
        const jump = `jump to ${getSystem(o.systemId).displayName} with ${o.convoy ? 'the convoy' : 'it'} within ${CONTRACTS.escort.keepUpM / 1000} km`;
        if (at === here) return { ...base, ...target, text: `${o.text}${tally}: ${jump}` };
        return { ...base, text: inOtherSystem(at, `${o.text}${tally}: it is waiting for you there`), targetSystemId: at, targetLocationId: null };
      }
      return { ...base, ...target, text: inOtherSystem(o.systemId, o.convoy ? `${o.text}${tally}` : `${o.text}: stay close and keep it alive`) };
    }
    case 'rescue': {
      const have = cargoCount(state.ship.cargo, o.commodity);
      const name = COMMODITIES[o.commodity].name.toLowerCase();
      const then = have >= o.qty ? `${o.text}: fly alongside it` : `${o.text} (you have ${have} of ${o.qty} ${name})`;
      return { ...base, text: inOtherSystem(o.systemId, then), targetSystemId: o.systemId, targetLocationId: null, ...(o.systemId === here ? { targetId: strandedTargetId(jobId) } : {}) };
    }
    case 'outpost': {
      // The raid on the player's outpost (docs/PROCGEN.md §29): how long until it strikes, or that it has.
      const left = o.at - state.clock;
      const when = left > 0 ? `${Math.max(1, Math.round(left / 60))} min` : 'under way';
      return { ...base, text: inOtherSystem(o.systemId, `${o.text} (${when})`), targetSystemId: o.systemId, targetLocationId: o.locationId };
    }
    case 'stand':
      // The crews' cutters at their rocks (docs/PROCGEN.md §40.3): steering to the lead cutter in its system.
      return { ...base, text: inOtherSystem(o.systemId, o.text), targetSystemId: o.systemId, targetLocationId: null, ...(o.systemId === here ? { targetId: standTargetId(jobId) } : {}) };
    case 'lifeboats': {
      // Pyre's lifeboats (docs/PROCGEN.md §42.4): to the nearest still out; with enough aboard, out through the lane.
      const got = state.jobs[jobId]?.gathered ?? 0;
      if (got >= o.need) return { ...base, text: `${o.text} (${got} aboard: get clear through the lane)`, targetSystemId: DOOMED.star.anchor, targetLocationId: null };
      return { ...base, text: inOtherSystem(o.systemId, `${o.text} (${got} of ${o.need} aboard)`), targetSystemId: o.systemId, targetLocationId: null, ...(o.systemId === here ? { targetId: lifeboatTargetId(jobId) } : {}) };
    }
    case 'duel':
      // The rival waits off the jump beacon (docs/PROCGEN.md §28).
      return { ...base, text: inOtherSystem(o.systemId, o.text), targetSystemId: o.systemId, targetLocationId: null, ...(o.systemId === here ? { targetId: duelTargetId(jobId) } : {}) };
    case 'site': {
      // A site marked in flight (docs/PROCGEN.md §31): steering to it in its system.
      return { ...base, text: inOtherSystem(o.systemId, o.text), targetSystemId: o.systemId, targetLocationId: null, ...(o.systemId === here ? { targetId: `site:${o.siteId}` } : {}) };
    }
    case 'choice': {
      const loc = getLocation(o.locationId);
      const text = state.location.dockedAt === o.locationId ? `${o.text}: open the Jobs window` : `Dock at ${loc.name}: ${o.text.charAt(0).toLowerCase()}${o.text.slice(1)}`;
      return { ...base, text: inOtherSystem(loc.systemId, text), targetSystemId: loc.systemId, targetLocationId: loc.id };
    }
    case 'assault': {
      const turrets = state.jobs[jobId]?.kills ?? 0;
      const den = getLocation(o.locationId).name;
      const text = turrets < DENS.turrets ? `Destroy ${den}’s turrets (${turrets}/${DENS.turrets}), then its reactor` : `Destroy ${den}’s reactor: its shield is down`;
      return { ...base, text: o.systemId === here ? text : inOtherSystem(o.systemId, o.text), targetSystemId: o.systemId, targetLocationId: o.locationId };
    }
    case 'defend': {
      const kills = state.jobs[jobId]?.kills ?? 0;
      return { ...base, text: inOtherSystem(o.systemId, `${o.text} (${kills}/${o.count})`), targetSystemId: o.systemId, targetLocationId: o.locationId };
    }
    case 'piracy': {
      const kills = state.jobs[jobId]?.kills ?? 0;
      return { ...base, text: inOtherSystem(o.systemId, `${o.text} (${kills}/${o.count}): target a hauler to open fire`), targetSystemId: o.systemId, targetLocationId: null };
    }
    case 'mine': {
      const mined = Math.min(o.qty, state.jobs[jobId]?.mined ?? 0);
      return {
        ...base,
        text: inOtherSystem(o.systemId, `${o.text}: ${mined} of ${o.qty} cut (select a rock and mine it)`),
        targetSystemId: o.systemId,
        targetLocationId: null,
        ...(o.systemId === here ? { targetId: beltTargetId(o.beltId) } : {}),
      };
    }
    case 'recover':
      return {
        ...base,
        text: inOtherSystem(o.systemId, `${o.text}: fly close to tractor it in`),
        targetSystemId: o.systemId,
        targetLocationId: o.locationId,
        ...(o.systemId === here ? { targetId: wreckTargetId(jobId) } : {}),
      };
    case 'deliver': {
      const loc = getLocation(o.locationId);
      const have = cargoCount(state.ship.cargo, o.commodity);
      if (have < o.qty) {
        return {
          ...base,
          text: `Acquire ${o.qty - have} more ${COMMODITIES[o.commodity].name.toLowerCase()} (${have}/${o.qty}), then deliver to ${loc.name}`,
          targetSystemId: loc.systemId,
          targetLocationId: loc.id,
        };
      }
      return { ...base, text: inOtherSystem(loc.systemId, o.text), targetSystemId: loc.systemId, targetLocationId: loc.id };
    }
  }
}

/** Raider packs the player's bounty contracts send them after in a system (raiders still to destroy, or an ace). */
export function contractPacksIn(state: GameState, systemId: SystemId): { jobId: string; locationId: string; count: number; level: 1 | 2 | 3; ace?: { name: string; model: string } }[] {
  const out: { jobId: string; locationId: string; count: number; level: 1 | 2 | 3; ace?: { name: string; model: string } }[] = [];
  for (const jobId of activeJobIds(state)) {
    const o = currentObjective(state, jobId);
    if (o?.kind !== 'bounty' || o.systemId !== systemId) continue;
    const left = o.count - (state.jobs[jobId]?.kills ?? 0);
    if (left > 0) out.push({ jobId, locationId: o.locationId, count: left, level: o.level, ...(o.ace ? { ace: o.ace } : {}) });
  }
  return out;
}

export interface EscortSetup {
  jobId: string;
  from: string;
  to: string;
  model: string;
  name: string;
  level: 1 | 2 | 3;
  /** A convoy: the ships still to see in, and how many ambushes come on the way to the destination. */
  convoy?: { names: readonly string[]; waves: number };
  /** Not yet in its destination's system: it keeps with the player, to jump with them. */
  follow?: true;
  /** An escort across jumps in a system with something to fear: raiders wait at its jump beacon for it. */
  beacon?: true;
}

type EscortObjective = Extract<Objective, { kind: 'escort' }>;

/** Where an escort's ships are: where they set off, until they jump with the player. */
export function escortSystem(state: GameState, jobId: string, o: EscortObjective): SystemId {
  return state.jobs[jobId]?.escortAt ?? getLocation(o.fromLocationId).systemId;
}

/** Ships the player is escorting in a system (escorts under way; a convoy's ships not yet in or lost). */
export function escortsIn(state: GameState, systemId: SystemId): EscortSetup[] {
  return activeJobIds(state).flatMap((jobId) => {
    const o = currentObjective(state, jobId);
    if (o?.kind !== 'escort' || escortSystem(state, jobId, o) !== systemId) return [];
    const crossing = getLocation(o.fromLocationId).systemId !== o.systemId;
    const base: EscortSetup = {
      jobId,
      from: o.fromLocationId,
      to: o.locationId,
      model: o.model,
      name: o.shipName,
      level: o.level,
      ...(systemId !== o.systemId ? { follow: true as const } : {}),
      ...(crossing && escortDanger(systemId) ? { beacon: true as const } : {}),
    };
    if (!o.convoy) return [base];
    const p = state.jobs[jobId];
    const done = (p?.escorted ?? 0) + (p?.lost ?? 0);
    return [{ ...base, convoy: { names: o.convoy.names.slice(done), waves: o.convoy.waves } }];
  });
}

/** The escorted ships a jump from here takes along: those not yet in their destination's system. */
export function escortsFollowing(state: GameState, systemId: SystemId): EscortSetup[] {
  return escortsIn(state, systemId).filter((e) => e.follow);
}

/** Den assaults under way in a system (the den to knock out, its turrets still standing, and the lawful wing that flies with the player). */
export function assaultsIn(state: GameState, systemId: SystemId): { jobId: string; locationId: string; turretsLeft: number; wing: FactionId | null }[] {
  return activeJobIds(state).flatMap((jobId) => {
    const o = currentObjective(state, jobId);
    const turretsLeft = Math.max(0, DENS.turrets - (state.jobs[jobId]?.kills ?? 0));
    const faction = getJob(jobId, state).factionId;
    const wing = faction === 'sta' || faction === 'frontier' ? faction : null;
    return o?.kind === 'assault' && o.systemId === systemId ? [{ jobId, locationId: o.locationId, turretsLeft, wing }] : [];
  });
}

/** Den defences under way in a system (sweep ships still to destroy). */
export function defencesIn(state: GameState, systemId: SystemId): { jobId: string; locationId: string; count: number; faction: 'sta' | 'frontier' }[] {
  return activeJobIds(state).flatMap((jobId) => {
    const o = currentObjective(state, jobId);
    const left = o?.kind === 'defend' ? o.count - (state.jobs[jobId]?.kills ?? 0) : 0;
    return o?.kind === 'defend' && o.systemId === systemId && left > 0 ? [{ jobId, locationId: o.locationId, count: left, faction: o.faction ?? 'sta' }] : [];
  });
}

/** The flight target of a recovery contract's wreck. */
export function wreckTargetId(jobId: string): string {
  return `wreck:${jobId}`;
}

/** Wrecks the player's recovery contracts send them to in a system (items not yet recovered). */
export function wrecksIn(state: GameState, systemId: SystemId): { jobId: string; locationId: string; item: string; guard: 1 | 2 | 3 | null }[] {
  return activeJobIds(state).flatMap((jobId) => {
    const o = currentObjective(state, jobId);
    return o?.kind === 'recover' && o.systemId === systemId ? [{ jobId, locationId: o.locationId, item: o.item, guard: o.guard }] : [];
  });
}

/** The flight target of a rescue's stranded ship. */
export function strandedTargetId(jobId: string): string {
  return `stranded:${jobId}`;
}

/** The flight target of a rival waiting for a duel (docs/PROCGEN.md §28). */
export function duelTargetId(jobId: string): string {
  return `duel:${jobId}`;
}

/** Ships stranded far from any dock (or adrift in a belt) that the player's rescues send them to in a system (not yet helped). */
export function rescuesIn(state: GameState, systemId: SystemId): { jobId: string; name: string; model: string; commodity: CommodityId; qty: number; guard: 1 | 2 | 3 | null; beltId?: string }[] {
  return activeJobIds(state).flatMap((jobId) => {
    const o = currentObjective(state, jobId);
    return o?.kind === 'rescue' && o.systemId === systemId ? [{ jobId, name: o.shipName, model: o.model, commodity: o.commodity, qty: o.qty, guard: o.guard, ...(o.beltId ? { beltId: o.beltId } : {}) }] : [];
  });
}

/** The flight target of a stand's lead cutter (docs/PROCGEN.md §40.3). */
export function standTargetId(jobId: string): string {
  return `stand:${jobId}`;
}

/** The HUD target of a lifeboats objective: the flight points it at the nearest lifeboat still out (docs/PROCGEN.md §42.4). */
export function lifeboatTargetId(jobId: string): string {
  return `lifeboat:${jobId}`;
}

/** Pyre's lifeboats under way in a system (docs/PROCGEN.md §42.4), as the flight needs them. */
export interface LifeboatSetup {
  jobId: string;
  count: number;
  need: number;
  /** How many are aboard already; when they leave the observatory, and when Pyre collapses. */
  gathered: number;
  launch: number;
  collapse: number;
}

/** The lifeboats objective under way in a system, once Pyre has warned. */
export function lifeboatsIn(state: GameState, systemId: SystemId): LifeboatSetup[] {
  const times = lifeboatTimes(state);
  if (!times) return [];
  return activeJobIds(state).flatMap((jobId) => {
    const o = currentObjective(state, jobId);
    return o?.kind === 'lifeboats' && o.systemId === systemId ? [{ jobId, count: o.count, need: o.need, gathered: state.jobs[jobId]?.gathered ?? 0, ...times }] : [];
  });
}

/** A lifeboat taken aboard (docs/PROCGEN.md §42.4). How many are aboard now. */
export function lifeboatAboard(state: GameState, jobId: string): number {
  const o = currentObjective(state, jobId);
  const p = state.jobs[jobId];
  if (o?.kind !== 'lifeboats' || !p) return 0;
  p.gathered = Math.min(o.count, (p.gathered ?? 0) + 1);
  return p.gathered;
}

/**
 * Leaving a system (a jump begun): with enough lifeboats aboard, out of their system before the
 * collapse, they are clear and the objective is done.
 */
export function lifeboatsClear(state: GameState, fromSystemId: SystemId): JobEvent[] {
  const times = lifeboatTimes(state);
  let done = false;
  for (const jobId of activeJobIds(state)) {
    const o = currentObjective(state, jobId);
    const p = state.jobs[jobId];
    if (o?.kind !== 'lifeboats' || !p || o.systemId !== fromSystemId || (p.gathered ?? 0) < o.need || !times || state.clock >= times.collapse) continue;
    p.clear = true;
    done = true;
  }
  return done ? advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId }) : [];
}

/** At Pyre's collapse, lifeboats not got clear: the mission fails, and with the observatory gone it is not offered again. */
export function lifeboatsLapse(state: GameState): JobEvent[] {
  const times = lifeboatTimes(state);
  if (!times || state.clock < times.collapse) return [];
  return activeJobIds(state).flatMap((jobId) => {
    const o = currentObjective(state, jobId);
    if (o?.kind !== 'lifeboats' || state.jobs[jobId]?.clear) return [];
    const e = failJob(state, jobId, 'the collapse came with the lifeboats still out');
    return e ? [e] : [];
  });
}

/** A stand in a belt under way in a system (docs/PROCGEN.md §40.3), as the flight needs it. */
export interface StandSetup {
  jobId: string;
  beltId: string;
  crews: { names: readonly string[]; need: number };
  waves: number;
  ships: number;
  level: 1 | 2 | 3;
}

/** The stands the player's jobs want in a system now (not yet won). */
export function standsIn(state: GameState, systemId: SystemId): StandSetup[] {
  return activeJobIds(state).flatMap((jobId) => {
    const o = currentObjective(state, jobId);
    return o?.kind === 'stand' && o.systemId === systemId ? [{ jobId, beltId: o.beltId, crews: o.crews, waves: o.waves, ships: o.ships, level: o.level }] : [];
  });
}

/** The stand was won (the waves downed with enough cutters left): the objective is done. */
export function standWon(state: GameState, jobId: string): JobEvent[] {
  const o = currentObjective(state, jobId);
  if (o?.kind !== 'stand') return [];
  state.jobs[jobId]!.stood = true;
  return advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId });
}

/** The stand was lost (too few cutters left): the mission fails (a story mission goes back to its giver). */
export function standLost(state: GameState, jobId: string): JobEvent[] {
  const o = currentObjective(state, jobId);
  if (o?.kind !== 'stand') return [];
  const e = failJob(state, jobId, 'the crews’ cutters were lost');
  return e ? [e] : [];
}

/**
 * The player came alongside a stranded ship: with the goods in the hold, they are handed over and
 * the rescue is done; without enough, nothing happens (the reason says what is missing).
 */
export function handOver(state: GameState, jobId: string): { events: JobEvent[]; missing: number } {
  const o = currentObjective(state, jobId);
  if (o?.kind !== 'rescue') return { events: [], missing: 0 };
  const have = cargoCount(state.ship.cargo, o.commodity);
  if (have < o.qty) return { events: [], missing: o.qty - have };
  removeCargo(state.ship.cargo, o.commodity, o.qty);
  state.jobs[jobId]!.rescued = true;
  return { events: advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId }), missing: 0 };
}

/** The flight target of a belt (its first ring). */
export function beltTargetId(beltId: string): string {
  return `belt:${beltId}`;
}

/**
 * The mining laser cut `qty` units of a good in a belt: they count for claims on that belt and good
 * (docs/PROCGEN.md §19), each unit for one claim only, the claim taken first filled first.
 */
export function countMined(state: GameState, beltId: string, commodity: CommodityId, qty = 1): JobEvent[] {
  const claims = activeJobIds(state)
    .flatMap((id) => {
      const o = currentObjective(state, id);
      return o?.kind === 'mine' && o.beltId === beltId && o.commodity === commodity ? [{ id, o, p: state.jobs[id]! }] : [];
    })
    .sort((a, b) => a.p.acceptedAt - b.p.acceptedAt || a.id.localeCompare(b.id));
  let left = qty;
  for (const c of claims) {
    const take = Math.min(left, c.o.qty - (c.p.mined ?? 0));
    if (take <= 0) continue;
    c.p.mined = (c.p.mined ?? 0) + take;
    left -= take;
    if (left <= 0) break;
  }
  return left < qty ? advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId }) : [];
}

/** A lawful hauler went down to the player's guns: count it for piracy work in that system. */
export function countPiracy(state: GameState, systemId: SystemId, faction: FactionId | 'independent'): JobEvent[] {
  let counted = false;
  for (const jobId of activeJobIds(state)) {
    const o = currentObjective(state, jobId);
    if (o?.kind !== 'piracy' || o.systemId !== systemId || o.faction !== faction) continue;
    state.jobs[jobId]!.kills = (state.jobs[jobId]!.kills ?? 0) + 1;
    counted = true;
  }
  return counted ? advanceJobs(state, { dockedAt: state.location.dockedAt, systemId }) : [];
}

/** An escorted ship docked at its destination: the escort is done, or one more ship of a convoy is in. */
export function escortArrived(state: GameState, jobId: string): JobEvent[] {
  const progress = state.jobs[jobId];
  const o = currentObjective(state, jobId);
  if (!progress || progress.status !== 'active' || o?.kind !== 'escort') return [];
  if (o.convoy) progress.escorted = (progress.escorted ?? 0) + 1;
  else progress.escort = 'arrived';
  // A haul of the timetable is in, with its cargo (docs/PROCGEN.md §21.7).
  if (o.haul) recordHaul(state.world, o.haul, { at: state.clock, fate: 'arrived', systemId: o.systemId });
  return advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId });
}

/** An escorted ship was destroyed: the escort fails, or a convoy once more ships are lost than it can spare. */
export function escortLost(state: GameState, jobId: string): JobEvent[] {
  const progress = state.jobs[jobId];
  const o = currentObjective(state, jobId);
  if (!progress || progress.status !== 'active' || o?.kind !== 'escort') return [];
  if (!o.convoy) {
    // A haul of the timetable is lost with its cargo (docs/PROCGEN.md §21.7).
    if (o.haul) recordHaul(state.world, o.haul, { at: state.clock, fate: 'lost', systemId: state.location.systemId, by: 'raiders' });
    const ev = failJob(state, jobId, `the ${o.shipName} was destroyed`);
    return ev ? [ev] : [];
  }
  progress.lost = (progress.lost ?? 0) + 1;
  if (progress.lost > o.convoy.names.length - o.convoy.need) {
    const ev = failJob(state, jobId, `${progress.lost} ships of the ${o.shipName} were lost`);
    return ev ? [ev] : [];
  }
  return [{ jobId, kind: 'objective', text: `A ship of the ${o.shipName} is lost (${progress.lost} of ${o.convoy.names.length - o.convoy.need} you can spare)` }, ...advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId })];
}

/**
 * The player jumps out of a system. Escorted ships still on their way to another system jump with
 * them (the controller has checked they are close enough; without `to`, they stay behind); an
 * escort in its destination's system is left behind, and fails.
 */
export function leaveSystem(state: GameState, systemId: SystemId, to?: SystemId): JobEvent[] {
  const events: JobEvent[] = [];
  for (const e of escortsIn(state, systemId)) {
    if (e.follow && to) {
      state.jobs[e.jobId]!.escortAt = to;
      continue;
    }
    const ev = failJob(state, e.jobId, `you left the ${e.name} behind`);
    if (ev) events.push(ev);
  }
  return events;
}

/** The objective to show in the HUD: the first delivery chain first, then story missions, then other jobs. */
export function primaryObjective(state: GameState): ObjectiveSummary | null {
  const rank = (id: string) => (id === LIFELINE_ID ? 0 : id.startsWith('arc.') ? 1 : 2);
  const ids = activeJobIds(state).sort((a, b) => rank(a) - rank(b));
  for (const id of ids) {
    const summary = describeObjective(state, id);
    if (summary) return summary;
  }
  return null;
}

/** Contract fee coverage for the map (the first delivery pays the jump to Alpha Centauri). */
export function activeFeeCoverage(state: GameState): { systemId: SystemId; note: string } | null {
  for (const id of activeJobIds(state)) {
    const job = getJob(id, state);
    if (job.coversJumpFeesTo) {
      return { systemId: job.coversJumpFeesTo, note: `Fee covered by contract: ${job.title}` };
    }
  }
  return null;
}
