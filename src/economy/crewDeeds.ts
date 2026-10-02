import type { GameState } from '../app/state.ts';
import { CREW, type CrewDeed } from '../content/crew/rules.ts';

/**
 * A deed the crew aboard saw (docs/PROCGEN.md §30.4): counted until the next dock, where each one's
 * heart weighs it. Nothing is counted with nobody aboard.
 */
export function crewDeed(state: GameState, deed: CrewDeed | undefined, n = 1): void {
  const a = state.aboard;
  if (!deed || !a?.members.length || n <= 0) return;
  a.deeds[deed] = (a.deeds[deed] ?? 0) + n;
}

/** A lane encounter's answer (or its lapse) as a deed, if it is one. */
export function laneDeed(state: GameState, kind: string, pick: string): void {
  crewDeed(state, CREW.laneDeeds[`${kind}.${pick}`]);
}
