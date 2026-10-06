import { CONTRACTS } from '../content/contracts/rules.ts';
import { EVENTS } from '../content/events/rules.ts';
import { getLocation, getPlanet, getSystem } from '../data/systems.ts';
import { rechargeShield } from '../economy/equipment.ts';
import { activeFeeCoverage, advanceJobs, leaveSystem, type JobEvent } from '../economy/jobs.ts';
import { hullMax } from '../economy/loadout.ts';
import { recordMarketVisit } from '../economy/trade.ts';
import { watchOnDock, type WatchNote } from '../economy/tradeComputer.ts';
import { settleLaw } from '../economy/law.ts';
import { tidyWorldLog } from '../economy/answers.ts';
import { pyreRefugeId, rescueDockId } from '../economy/doomed.ts';
import { settleFleet, type FleetSettlement } from '../economy/fleet.ts';
import { alliesDock, settleRivalStories, type StoryNote } from '../economy/rivalStories.ts';
import { crewFee, crewShipLost, settleCrew, type CrewNote } from '../economy/crew.ts';
import { settleSites, tidySites, type SiteOutcome } from '../economy/wrecks.ts';
import { settleRanks, type RankNote } from '../economy/ranks.ts';
import { dockFolk, leaveFolk } from '../economy/folk.ts';
import { logWrite, noteJump } from '../economy/logbook.ts';
import type { Route } from '../galaxy/routing.ts';
import type { JumpReadiness } from '../galaxy/types.ts';
import { applyCredits, markVisited, type GameState } from './state.ts';

/**
 * Pure game-state transitions shared by the game controller and the tests. None of these touch
 * rendering; the controller saves after calling them.
 */

export interface DockOutcome {
  jobEvents: JobEvent[];
  clearanceGranted: boolean;
  firstVisit: boolean;
  /** Watched prices within reach that moved (docs/PROCGEN.md §16). */
  watchNotes: WatchNote[];
  /** Fines that lapsed (docs/PROCGEN.md §17). */
  lawNotes: string[];
  /** What the fleet did since the last settle (docs/PROCGEN.md §18). */
  fleet: FleetSettlement;
  /** Allies who left the wing here, and what rivals' stories said since the last settle (docs/PROCGEN.md §28). */
  allies: string[];
  stories: { notes: StoryNote[]; jobs: JobEvent[] };
  /** What the crew aboard did and said since the last dock (docs/PROCGEN.md §30). */
  crew: { notes: CrewNote[]; jobs: JobEvent[] };
  /** Sites and trails whose time ran out (docs/PROCGEN.md §31). */
  sites: SiteOutcome;
  /** Ranks given here, or fallen (docs/PROCGEN.md §32). */
  ranks: RankNote[];
  /** The people at the pilot's outposts (docs/PROCGEN.md §41.4): one fetched come aboard, and what is said docking at one. */
  folk: ReturnType<typeof dockFolk>;
}

export function dockAt(state: GameState, locationId: string): DockOutcome {
  const loc = getLocation(locationId);
  if (loc.systemId !== state.location.systemId) throw new Error(`${locationId} is not in ${state.location.systemId}`);
  const firstVisit = !state.visitedLocations.includes(locationId);
  state.location.dockedAt = locationId;
  state.location.flight = null;
  state.location.lastDockId = locationId;
  markVisited(state, loc.systemId, locationId);
  // The fleet first: the prices seen here and the watched ones include what its haulers moved.
  const fleet = settleFleet(state);
  // Then the people at the outposts, their asks settled with it (docs/PROCGEN.md §41.4).
  const folk = dockFolk(state, locationId);
  recordMarketVisit(state, locationId);
  const watchNotes = watchOnDock(state, locationId);
  const lawNotes = settleLaw(state);
  tidyWorldLog(state);
  rechargeShield(state);
  let clearanceGranted = false;
  if (loc.services.includes('jump-clearance') && !state.flags.clearance) {
    state.flags.clearance = true;
    clearanceGranted = true;
  }
  // Sites and trails whose time ran out go before the jobs (docs/PROCGEN.md §31).
  const sites = settleSites(state, null);
  tidySites(state);
  const jobEvents = advanceJobs(state, { dockedAt: locationId, systemId: loc.systemId });
  // Rivals' stories after the jobs: an escort seen in here is done (docs/PROCGEN.md §28).
  const allies = alliesDock(state, locationId);
  const stories = settleRivalStories(state);
  // The crew last: wages to now, and what they made of all that happened since the last dock.
  const crew = settleCrew(state, locationId);
  // Ranks after the jobs, so a contract finished here can earn a rank here.
  const ranks = settleRanks(state, locationId);
  return { jobEvents, clearanceGranted, firstVisit, watchNotes, lawNotes, fleet, allies, stories, crew, sites, ranks, folk };
}

export function undock(state: GameState): void {
  // Launching from one of the pilot's outposts ends the time away too (docs/PROCGEN.md §41.3).
  if (state.location.dockedAt) leaveFolk(state, state.location.dockedAt);
  state.location.dockedAt = null;
}

export interface ReadinessContext {
  hostilesNearby: boolean;
  inLaneOrAutopilot: boolean;
  /** An escorted ship that should jump with the player but is too far away to (its name). */
  escortBehind?: string | null;
}

export function jumpReadiness(state: GameState, ctx: ReadinessContext): JumpReadiness {
  if (state.location.dockedAt) return { canJump: false, reason: 'Launch from the dock before jumping.' };
  if (!state.flags.clearance) {
    return { canJump: false, reason: 'Departure clearance required: dock at Deimos Depot (Mars) first.' };
  }
  if (ctx.hostilesNearby) return { canJump: false, reason: 'Hostile contact nearby: the jump drive cannot spin up.' };
  if (ctx.inLaneOrAutopilot) return { canJump: false, reason: 'Wait until lane travel or docking ends.' };
  if (ctx.escortBehind) {
    return { canJump: false, reason: `The ${ctx.escortBehind} is too far away to jump with you: let it come within ${CONTRACTS.escort.keepUpM / 1000} km.` };
  }
  return { canJump: true };
}

/** Fee for a route after contract coverage, and the navigator's discount (docs/PROCGEN.md §30.2). */
export function routeFee(state: GameState, route: Route): number {
  const coverage = activeFeeCoverage(state);
  if (coverage && coverage.systemId === route.to) return 0;
  return crewFee(state, route.totalFee);
}

export function performJump(state: GameState, route: Route, fee: number): JobEvent[] {
  if (route.hops.length === 0) throw new Error('Route has no hops');
  if (fee > state.credits) throw new Error('Insufficient credits for jump fee');
  if (fee > 0) {
    applyCredits(state, -fee, 'fee', `Jump fee ${getSystem(route.from).displayName} → ${getSystem(route.to).displayName}`);
  }
  // The systems reached for the first time go in the logbook on arrival (docs/PROCGEN.md §46.1).
  const firsts = route.path.filter((id) => !state.visitedSystems.includes(id));
  for (const id of route.path) markVisited(state, id);
  // Escorted ships on their way elsewhere jump too; an escort left in its destination's system fails.
  const left = leaveSystem(state, route.from, route.to);
  // Lane transit takes time: the world (prices, events, contract boards) moves on meanwhile.
  state.clock += route.hops.length * EVENTS.jumpSeconds;
  state.location.systemId = route.to;
  state.location.dockedAt = null;
  state.location.flight = null;
  state.stats.jumps += route.hops.length;
  noteJump(state, firsts, route.hops);
  return [...left, ...advanceJobs(state, { dockedAt: null, systemId: route.to })];
}

/** Marks a body as discovered. Returns true on first discovery. */
export function discoverBody(state: GameState, bodyId: string): { first: boolean; jobEvents: JobEvent[] } {
  if (state.discoveredBodies.includes(bodyId)) return { first: false, jobEvents: [] };
  state.discoveredBodies.push(bodyId);
  if (getPlanet(bodyId)) logWrite(state, { kind: 'planet', id: bodyId, where: state.location.systemId });
  const jobEvents = advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId });
  return { first: true, jobEvents };
}

export const RESCUE_FEE = 150;

/**
 * After losing a fight: towed back to the last dock (or, if that is one of Pyre's stations and shut
 * now, to Pyre's refuge: docs/PROCGEN.md §26), repaired, charged a capped fee. Cargo is kept.
 */
export function rescueAfterDefeat(state: GameState): { fee: number; dockId: string } {
  // The crew came through it hurt and shaken (docs/PROCGEN.md §30.5).
  crewShipLost(state);
  const lostIn = state.location.systemId;
  const r = rescueTo(state, rescueDockId(state.location.lastDockId, state.clock, state.world.sky?.edge ?? null), 'Rescue tow and repairs');
  state.stats.deaths += 1;
  logWrite(state, { kind: 'towed', id: lostIn, where: r.dockId });
  return r;
}

/** Caught in Pyre's system when it exploded (docs/PROCGEN.md §26): carried out to its refuge, repaired, charged as a rescue. Cargo and passengers stay aboard. */
export function rescueFromPyre(state: GameState): { fee: number; dockId: string } {
  return rescueTo(state, pyreRefugeId(), 'Emergency drive and repairs');
}

function rescueTo(state: GameState, dockId: string, why: string): { fee: number; dockId: string } {
  const dock = getLocation(dockId);
  const fee = Math.min(state.credits, RESCUE_FEE);
  if (fee > 0) applyCredits(state, -fee, 'rescue', `${why} to ${dock.name}`);
  state.ship.hull = hullMax(state.ship);
  rechargeShield(state);
  state.location.systemId = dock.systemId;
  state.location.dockedAt = dockId;
  state.location.lastDockId = dockId;
  state.location.flight = null;
  return { fee, dockId };
}
