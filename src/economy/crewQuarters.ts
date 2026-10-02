import type { GameState } from '../app/state.ts';
import { shipModel } from '../content/catalog.ts';
import { CREW } from '../content/crew/rules.ts';

/** Crew quarters aboard a ship model (docs/PROCGEN.md §30.3), by its class: never shared with passengers. */
export function quartersOf(modelId: string): number {
  return CREW.quarters[shipModel(modelId).class] ?? 1;
}

/** Why the player cannot fly a ship model with the crew aboard (null: they all have quarters in it). */
export function quartersBlock(state: GameState, modelId: string): string | null {
  const n = state.aboard?.members.length ?? 0;
  const q = quartersOf(modelId);
  return n > q ? `Your ${n} crew need quarters: the ${shipModel(modelId).name} has room for ${q}` : null;
}
