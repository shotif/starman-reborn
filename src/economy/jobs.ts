import { applyCredits, type CommodityId, type GameState, type PriceQuote } from '../app/state.ts';
import { getLocation, getSystem } from '../data/systems.ts';
import type { FactionId, SystemId } from '../data/types.ts';
import { cargoCount, removeCargo } from './cargo.ts';
import { COMMODITIES } from './commodities.ts';
import { adjustReputation, FACTIONS } from './factions.ts';

export type Objective =
  | { kind: 'have-cargo'; commodity: CommodityId; qty: number; text: string }
  | { kind: 'dock'; locationId: string; text: string }
  | { kind: 'scan'; bodyId: string; systemId: SystemId; text: string }
  | { kind: 'deliver'; commodity: CommodityId; qty: number; locationId: string; text: string }
  | { kind: 'visit'; locationId: string; text: string };

export interface JobDef {
  id: string;
  title: string;
  giverLocationId: string;
  factionId: FactionId;
  /** Short original narrative hook (fiction). */
  briefing: string;
  objectives: Objective[];
  reward: number;
  repReward: Partial<Record<FactionId, number>>;
  difficulty: 1 | 2 | 3;
  difficultyNote: string;
  destinationLocationId: string;
  requires?: { jobComplete?: string; minRep?: { faction: FactionId; value: number } };
  /** Jumps ending in this system cost nothing while the job is active. */
  coversJumpFeesTo?: SystemId;
  /** Prices the giver tells you about (shown as "posted in briefing"). */
  briefingPrices?: { locationId: string; prices: Partial<Record<CommodityId, PriceQuote>> };
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

export function getJob(id: string): JobDef {
  const job = JOBS.find((j) => j.id === id);
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
    return `Requires Friendly standing with the ${FACTIONS[req.minRep.faction].name}`;
  }
  return null;
}

export interface JobOffer {
  job: JobDef;
  status: 'available' | 'locked' | 'active' | 'complete';
  lockReason: string | null;
}

/** Jobs posted at a dock, with their availability. */
export function jobsAt(state: GameState, locationId: string): JobOffer[] {
  return JOBS.filter((j) => j.giverLocationId === locationId).map((job) => {
    const progress = state.jobs[job.id];
    if (progress) return { job, status: progress.status, lockReason: null };
    const lockReason = jobLockReason(state, job);
    return { job, status: lockReason ? 'locked' : 'available', lockReason };
  });
}

export function acceptJob(state: GameState, jobId: string): { ok: boolean; message: string } {
  const job = getJob(jobId);
  if (state.jobs[jobId]) return { ok: false, message: 'Already accepted.' };
  const lock = jobLockReason(state, job);
  if (lock) return { ok: false, message: lock };
  state.jobs[jobId] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
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

export function activeJobIds(state: GameState): string[] {
  return Object.entries(state.jobs)
    .filter(([, p]) => p.status === 'active')
    .map(([id]) => id);
}

export function currentObjective(state: GameState, jobId: string): Objective | null {
  const progress = state.jobs[jobId];
  if (!progress || progress.status !== 'active') return null;
  return getJob(jobId).objectives[progress.objectiveIndex] ?? null;
}

export interface JobContext {
  dockedAt: string | null;
  systemId: SystemId;
}

function objectiveSatisfied(state: GameState, o: Objective, ctx: JobContext): boolean {
  switch (o.kind) {
    case 'have-cargo':
      return cargoCount(state.ship.cargo, o.commodity) >= o.qty;
    case 'dock':
    case 'visit':
      return ctx.dockedAt === o.locationId;
    case 'scan':
      return state.discoveredBodies.includes(o.bodyId);
    case 'deliver':
      // Deliveries complete only when the player turns the cargo in (see deliverJob).
      return false;
  }
}

export interface JobEvent {
  jobId: string;
  kind: 'objective' | 'complete';
  text: string;
}

/**
 * Advances every active job past objectives already satisfied by the current state.
 * Safe to call after any change (dock, trade, scan, jump) and idempotent. Jobs whose last
 * objective is a 'visit' complete here and pay out.
 */
export function advanceJobs(state: GameState, ctx: JobContext): JobEvent[] {
  const events: JobEvent[] = [];
  for (const jobId of activeJobIds(state)) {
    const job = getJob(jobId);
    const progress = state.jobs[jobId]!;
    while (progress.status === 'active') {
      const o = job.objectives[progress.objectiveIndex];
      if (!o || !objectiveSatisfied(state, o, ctx)) break;
      progress.objectiveIndex += 1;
      if (progress.objectiveIndex >= job.objectives.length) {
        payOut(state, job);
        events.push({ jobId, kind: 'complete', text: `${job.title} complete` });
      } else {
        events.push({ jobId, kind: 'objective', text: o.text });
      }
    }
  }
  return events;
}

function payOut(state: GameState, job: JobDef): { repChanges: Partial<Record<FactionId, number>> } {
  const progress = state.jobs[job.id]!;
  progress.status = 'complete';
  progress.completedAt = state.clock;
  applyCredits(state, job.reward, 'reward', `${job.title} reward`);
  const repChanges: Partial<Record<FactionId, number>> = {};
  for (const [faction, delta] of Object.entries(job.repReward) as [FactionId, number][]) {
    repChanges[faction] = adjustReputation(state.reputation, faction, delta);
  }
  state.stats.deliveries += 1;
  return { repChanges };
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
  const job = getJob(jobId);
  const o = currentObjective(state, jobId) as Extract<Objective, { kind: 'deliver' }>;
  removeCargo(state.ship.cargo, o.commodity, o.qty);
  const progress = state.jobs[jobId]!;
  progress.objectiveIndex += 1;
  if (progress.objectiveIndex < job.objectives.length) {
    return { ok: true, reward: 0, repChanges: {} };
  }
  const { repChanges } = payOut(state, job);
  return { ok: true, reward: job.reward, repChanges };
}

export interface ObjectiveSummary {
  jobId: string;
  jobTitle: string;
  text: string;
  /** Where the player should go next, for waypoints and map highlights. */
  targetSystemId: SystemId | null;
  targetLocationId: string | null;
  targetBodyId: string | null;
}

/**
 * Human-readable current objective, adapted to where the player is (handles detours:
 * e.g. "Jump to Alpha Centauri" when the objective lies in another system, or
 * "Buy 2 more medical supplies" after selling some).
 */
export function describeObjective(state: GameState, jobId: string): ObjectiveSummary | null {
  const o = currentObjective(state, jobId);
  if (!o) return null;
  const job = getJob(jobId);
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

/** The objective to show in the HUD: the first delivery chain first, then other jobs. */
export function primaryObjective(state: GameState): ObjectiveSummary | null {
  const ids = activeJobIds(state).sort((a, b) => (a === LIFELINE_ID ? -1 : b === LIFELINE_ID ? 1 : 0));
  for (const id of ids) {
    const summary = describeObjective(state, id);
    if (summary) return summary;
  }
  return null;
}

/** Contract fee coverage for the map (the first delivery pays the jump to Alpha Centauri). */
export function activeFeeCoverage(state: GameState): { systemId: SystemId; note: string } | null {
  for (const id of activeJobIds(state)) {
    const job = getJob(id);
    if (job.coversJumpFeesTo) {
      return { systemId: job.coversJumpFeesTo, note: `Fee covered by contract: ${job.title}` };
    }
  }
  return null;
}
