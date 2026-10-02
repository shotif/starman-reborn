/**
 * Jump-button rules for the map (pure). Route distances come from real star positions via
 * routing.ts; fees, coverage and readiness are game fiction supplied by MapState.
 */
import { laneNeedsDrive, MAP_SYSTEMS } from '../data/systems.ts';
import type { StarSystemRecord, SystemId } from '../data/types.ts';
import { formatCredits } from '../ui/dom.ts';
import { findRoute, type Route } from './routing.ts';
import type { MapState } from './types.ts';

export type JumpInputs = Pick<MapState, 'currentSystemId' | 'credits' | 'readiness' | 'feeCoverage' | 'jumpReach'>;

/** Whether a ship with this drive reach can take a lane: frontier lanes need a long-range jump drive that reaches them. */
export function laneTaker(reach: number): (a: SystemId, b: SystemId, ly: number) => boolean {
  return (a, b, ly) => !laneNeedsDrive(a, b) || reach >= ly;
}

export interface JumpEvaluation {
  destination: SystemId;
  /** Null when the destination is the current system or unreachable over the jump links. */
  route: Route | null;
  /** Route fee before contract coverage. */
  routeFee: number;
  /** Fee the jump will charge (0 when a contract covers the destination). */
  fee: number;
  covered: boolean;
  coverageNote: string | null;
  canJump: boolean;
  /** Every reason the jump is unavailable, most fundamental first; empty when canJump. */
  reasons: string[];
}

export function evaluateJump(
  state: JumpInputs,
  destination: SystemId,
  systems: readonly StarSystemRecord[] = MAP_SYSTEMS,
): JumpEvaluation {
  const name = systems.find((s) => s.id === destination)?.displayName ?? destination;
  const base: JumpEvaluation = {
    destination,
    route: null,
    routeFee: 0,
    fee: 0,
    covered: false,
    coverageNote: null,
    canJump: false,
    reasons: [],
  };
  if (destination === state.currentSystemId) {
    base.reasons.push(`You are already in ${name}.`);
    return base;
  }
  const reach = state.jumpReach ?? 0;
  const route = findRoute(systems, state.currentSystemId, destination, { canTake: laneTaker(reach) });
  if (!route || route.hops.length === 0) {
    // Reachable over the frontier lanes, with a drive that reaches them?
    const far = findRoute(systems, state.currentSystemId, destination);
    const longest = far ? Math.max(0, ...far.hops.filter((h) => laneNeedsDrive(h.from, h.to)).map((h) => h.distanceLy)) : 0;
    base.reasons.push(
      far && longest > 0
        ? reach > 0
          ? `${name} lies beyond your drive: a frontier lane on the way is ${longest.toFixed(1)} ly and your long-range drive reaches ${reach} ly.`
          : `${name} lies in the frontier: its lanes need a long-range jump drive reaching ${longest.toFixed(1)} ly (outfitters stocking Horizon or Wake gear sell them).`
        : `No jump route leads to ${name}.`,
    );
    return base;
  }
  const covered = state.feeCoverage !== null && state.feeCoverage.systemId === destination;
  const fee = covered ? 0 : route.totalFee;
  const reasons: string[] = [];
  if (!state.readiness.canJump) {
    reasons.push(state.readiness.reason?.trim() || 'The jump drive is not ready.');
  }
  if (!(state.credits >= fee)) {
    reasons.push(
      `Not enough credits: the fee is ${formatCredits(fee)} and you have ${formatCredits(Math.max(0, state.credits || 0))}.`,
    );
  }
  return {
    destination,
    route,
    routeFee: route.totalFee,
    fee,
    covered,
    coverageNote: covered ? state.feeCoverage!.note : null,
    canJump: reasons.length === 0,
    reasons,
  };
}
