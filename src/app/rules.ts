import { CONTRACTS } from '../content/contracts/rules.ts';
import { EVENTS } from '../content/events/rules.ts';
import { getLocation, getSystem } from '../data/systems.ts';
import { rechargeShield } from '../economy/equipment.ts';
import { activeFeeCoverage, advanceJobs, leaveSystem, type JobEvent } from '../economy/jobs.ts';
import { hullMax } from '../economy/loadout.ts';
import { recordMarketVisit } from '../economy/trade.ts';
import { watchOnDock, type WatchNote } from '../economy/tradeComputer.ts';
import { settleLaw } from '../economy/law.ts';
import { tidyWorldLog } from '../economy/answers.ts';
import { settleFleet, type FleetSettlement } from '../economy/fleet.ts';
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
  const jobEvents = advanceJobs(state, { dockedAt: locationId, systemId: loc.systemId });
  return { jobEvents, clearanceGranted, firstVisit, watchNotes, lawNotes, fleet };
}

export function undock(state: GameState): void {
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

/** Fee for a route after contract coverage. */
export function routeFee(state: GameState, route: Route): number {
  const coverage = activeFeeCoverage(state);
  if (coverage && coverage.systemId === route.to) return 0;
  return route.totalFee;
}

export function performJump(state: GameState, route: Route, fee: number): JobEvent[] {
  if (route.hops.length === 0) throw new Error('Route has no hops');
  if (fee > state.credits) throw new Error('Insufficient credits for jump fee');
  if (fee > 0) {
    applyCredits(state, -fee, 'fee', `Jump fee ${getSystem(route.from).displayName} → ${getSystem(route.to).displayName}`);
  }
  for (const id of route.path) markVisited(state, id);
  // Escorted ships on their way elsewhere jump too; an escort left in its destination's system fails.
  const left = leaveSystem(state, route.from, route.to);
  // Lane transit takes time: the world (prices, events, contract boards) moves on meanwhile.
  state.clock += route.hops.length * EVENTS.jumpSeconds;
  state.location.systemId = route.to;
  state.location.dockedAt = null;
  state.location.flight = null;
  state.stats.jumps += route.hops.length;
  return [...left, ...advanceJobs(state, { dockedAt: null, systemId: route.to })];
}

/** Marks a body as discovered. Returns true on first discovery. */
export function discoverBody(state: GameState, bodyId: string): { first: boolean; jobEvents: JobEvent[] } {
  if (state.discoveredBodies.includes(bodyId)) return { first: false, jobEvents: [] };
  state.discoveredBodies.push(bodyId);
  const jobEvents = advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId });
  return { first: true, jobEvents };
}

export const RESCUE_FEE = 150;

/** After losing a fight: towed back to the last dock, repaired, charged a capped fee. Cargo is kept. */
export function rescueAfterDefeat(state: GameState): { fee: number; dockId: string } {
  const dockId = state.location.lastDockId;
  const dock = getLocation(dockId);
  const fee = Math.min(state.credits, RESCUE_FEE);
  if (fee > 0) applyCredits(state, -fee, 'rescue', `Rescue tow and repairs to ${dock.name}`);
  state.ship.hull = hullMax(state.ship);
  rechargeShield(state);
  state.location.systemId = dock.systemId;
  state.location.dockedAt = dockId;
  state.location.flight = null;
  state.stats.deaths += 1;
  return { fee, dockId };
}
