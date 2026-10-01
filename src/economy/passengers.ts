import type { GameState } from '../app/state.ts';
import { PASSAGE_LINES, SIGHT_LINES, TOUR_LINES } from '../content/passengers/lines.ts';
import { PASSENGERS } from '../content/passengers/rules.ts';
import { sightById, sightFacts, type Sight } from '../content/passengers/sights.ts';
import { hashString } from '../content/random.ts';
import { getLocation, getSystem } from '../data/systems.ts';
import type { JobDef } from './jobs.ts';
import { performanceOf } from './loadout.ts';

/**
 * Passengers and sightseers (docs/PROCGEN.md §23; rules in src/content/passengers/rules.ts): who
 * is aboard, the berths left for more, how a fight frightens them, and what they pay.
 */

/** Contracts that carry passengers. */
export const carriesPassengers = (job: Pick<JobDef, 'contract'>): boolean => job.contract?.kind === 'passage' || job.contract?.kind === 'tour';

/** The passenger contracts under way (their parties are aboard until each is done). */
export function passengerJobs(state: GameState): JobDef[] {
  return Object.values(state.contracts).filter((c) => carriesPassengers(c) && state.jobs[c.id]?.status === 'active');
}

/** Passengers aboard now. */
export function passengersAboard(state: GameState): number {
  return passengerJobs(state).reduce((n, c) => n + (c.contract?.party?.length ?? 0), 0);
}

/** Berths the ship's cabins give, and those still free. */
export function berths(state: GameState): { total: number; free: number } {
  const total = performanceOf(state.ship).berths;
  return { total, free: Math.max(0, total - passengersAboard(state)) };
}

/** Why a ship or its fittings cannot change now: the passengers aboard need their berths (null: they would still fit). */
export function berthBlock(state: GameState, berthsAfter: number): string | null {
  const aboard = passengersAboard(state);
  return berthsAfter < aboard ? `Your ${aboard} passenger${aboard === 1 ? ' needs a berth' : 's need their berths'}` : null;
}

/**
 * The hull took `share` of its maximum with passengers aboard: each party's fright grows by it
 * (it cuts the fare, PASSENGERS.fright). Returns the parties frightened.
 */
export function frighten(state: GameState, share: number): JobDef[] {
  const jobs = passengerJobs(state);
  if (share <= 0) return [];
  for (const c of jobs) {
    const p = state.jobs[c.id]!;
    p.fright = Math.min(1, (p.fright ?? 0) + share);
  }
  return jobs;
}

/** What a passenger contract pays, its fright taken off (never below the floor). */
export function fare(state: GameState, job: JobDef): number {
  const { perHull, floor } = PASSENGERS.fright;
  const fright = state.jobs[job.id]?.fright ?? 0;
  return Math.round(job.reward * Math.max(floor, 1 - perHull * fright));
}

// ---------------------------------------------------------------- what they say

/** A line filled with its values (every number in it comes from the data, through `values`). */
function fillLine(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

const pick = <T>(list: readonly T[], key: string): T => list[hashString(key) % list.length]!;

/** The party's speaker: its first passenger. */
const lead = (job: JobDef) => job.contract?.party?.[0] ?? 'Your passenger';

/** What a party says as it leaves the ship, done: home from a tour, or at the end of a passage. */
export function passengerGoodbye(job: JobDef): { speaker: string; text: string } | null {
  if (!carriesPassengers(job)) return null;
  const o = job.objectives.find((x) => x.kind === 'sight');
  if (job.contract?.kind === 'tour' && o?.kind === 'sight') return { speaker: lead(job), text: fillLine(pick(TOUR_LINES.home, job.id), { sight: sightById(o.sightId)?.name ?? '' }) };
  return { speaker: lead(job), text: fillLine(pick(PASSAGE_LINES.arrive, job.id), { dest: getLocation(job.destinationLocationId).name }) };
}

/** What a frightened party says (one line for one hit; the fare is cut either way). */
export function passengerFright(job: JobDef, key: string): { speaker: string; text: string } {
  const lines = job.contract?.kind === 'tour' ? TOUR_LINES.fright : PASSAGE_LINES.fright;
  return { speaker: lead(job), text: pick(lines, `${job.id}|${key}`) };
}

/** What sightseers say arriving in their sight's system. */
export function sightseersArrive(job: JobDef): { speaker: string; text: string } | null {
  const o = job.objectives.find((x) => x.kind === 'sight');
  const sight = o?.kind === 'sight' ? sightById(o.sightId) : undefined;
  if (!sight) return null;
  return { speaker: lead(job), text: fillLine(pick(TOUR_LINES.arrive, job.id), { star: sight.star, system: getSystem(sight.systemId).displayName, sight: sight.name }) };
}

/**
 * What sightseers say at their sight: a line about it whose fields the archive has, every number
 * printed from the catalogue (sightFacts).
 */
export function sightLine(job: JobDef, sight: Sight): { speaker: string; text: string } {
  const facts = sightFacts(sight);
  const usable = SIGHT_LINES[sight.kind].filter((l) => l.needs.every((f) => facts[f] !== undefined));
  const line = pick(usable, job.id);
  return { speaker: lead(job), text: fillLine(line.text, { ...facts, name: sight.name, star: sight.star }) };
}

// ---------------------------------------------------------------- in flight

/** Tours whose sight is in this system, still to be seen (for the flight scene). */
export function sightsIn(state: GameState, systemId: string): { jobId: string; targetId: string }[] {
  return passengerJobs(state).flatMap((c) => {
    const p = state.jobs[c.id]!;
    const o = c.objectives[p.objectiveIndex];
    return o?.kind === 'sight' && o.systemId === systemId && !p.seen ? [{ jobId: c.id, targetId: o.targetId }] : [];
  });
}

/** Sightseers have seen their sight: what they say about it (null: not a tour on its way to one). */
export function seeSight(state: GameState, jobId: string): { speaker: string; text: string } | null {
  const job = state.contracts[jobId];
  const p = state.jobs[jobId];
  const o = job && p ? job.objectives[p.objectiveIndex] : undefined;
  const sight = o?.kind === 'sight' ? sightById(o.sightId) : undefined;
  if (!job || !p || p.status !== 'active' || !sight || p.seen) return null;
  p.seen = true;
  return sightLine(job, sight);
}
