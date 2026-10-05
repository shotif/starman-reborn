import type { GameState } from '../app/state.ts';
import { EMBERS } from '../content/story/embers.ts';
import { DOOMED } from '../content/stellar/doomed.ts';
import { skyTimeline } from './stellar.ts';

/**
 * Last Light at Pyre and Pyre's death (docs/PROCGEN.md §42.1): the arc is offered only before Pyre
 * warns; once taken, Pyre's warning waits for its choice; the choice made, the warning comes a
 * minute later. Pyre's own timeline is economy/doomed.ts's, from the warning kept in the save.
 */

/** Pyre has given no warning yet: none set, or one set for later. */
export function pyreUnwarned(state: GameState): boolean {
  const edge = state.world.sky?.edge;
  return edge === undefined || edge > state.clock;
}

/** The arc may be offered: the opening done, the frontier reached, Antares gone (§25), Pyre not yet warned. */
export function pyreArcOpen(state: GameState): boolean {
  const sky = state.world.sky;
  return !!sky && state.milestones['frontier-first'] !== undefined && state.clock >= skyTimeline(sky.from).bhGone && pyreUnwarned(state);
}

/** Pyre Observatory still stands: no warning, or before its collapse. */
export function observatoryStands(state: GameState): boolean {
  const edge = state.world.sky?.edge;
  return edge === undefined || state.clock < edge + DOOMED.timeline.collapseAfterWarning;
}

/** The arc holds Pyre's warning: its first step taken, its choice not yet made. */
export function pyreHeld(state: GameState): boolean {
  return !!state.jobs[EMBERS.first] && state.story.choices[EMBERS.choice] === undefined;
}

/** Taking the arc's first step: a warning not yet come is withdrawn (scheduleEdge waits while it is held). */
export function holdPyre(state: GameState): void {
  const sky = state.world.sky;
  if (sky?.edge !== undefined && sky.edge > state.clock) delete sky.edge;
}

/** The arc's choice made: Pyre's warning comes `EMBERS.warnAfter` later (if it has not come already). */
export function startPyre(state: GameState): void {
  const sky = state.world.sky;
  if (sky && pyreUnwarned(state)) sky.edge = state.clock + EMBERS.warnAfter;
}

/** When the lifeboats leave the observatory, and when Pyre collapses (null before a warning is set). */
export function lifeboatTimes(state: GameState): { launch: number; collapse: number } | null {
  const edge = state.world.sky?.edge;
  return edge === undefined ? null : { launch: edge + EMBERS.launch, collapse: edge + DOOMED.timeline.collapseAfterWarning };
}
