/**
 * Jump-button rules for the map (pure). Route distances come from real star positions via
 * routing.ts; fees, coverage and readiness are game fiction supplied by MapState.
 */
import { SYSTEMS } from '../data/systems.ts';
import type { StarSystemRecord, SystemId } from '../data/types.ts';
import { formatCredits } from '../ui/dom.ts';
import { findRoute, type Route } from './routing.ts';
import type { MapState } from './types.ts';

export type JumpInputs = Pick<MapState, 'currentSystemId' | 'credits' | 'readiness' | 'feeCoverage'>;

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
  systems: readonly StarSystemRecord[] = SYSTEMS,
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
  const route = findRoute(systems, state.currentSystemId, destination);
  if (!route || route.hops.length === 0) {
    base.reasons.push(`No jump route leads to ${name}.`);
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
