import type { GameState } from '../app/state.ts';
import { DENS } from '../content/dens/rules.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';

/**
 * Raider dens knocked out (docs/PROCGEN.md §14.3, §15): a den whose reactor went down stays dark
 * for a while, sends no packs and is closed, then the Wake rebuilds it.
 */

export function denDown(state: GameState, locationId: string): boolean {
  const t = state.dens[locationId];
  return t !== undefined && state.clock < t + DENS.downSeconds;
}

export function knockOutDen(state: GameState, locationId: string): void {
  state.dens[locationId] = state.clock;
}

/** Dens dark within `reach` jumps of a system, nearest first, with the seconds until each is rebuilt. */
export function densDownNear(state: GameState, systemId: SystemId, reach = 2): { locationId: string; jumps: number; left: number }[] {
  const jumps = jumpsFrom(WORLD.links, systemId);
  return ALL_LOCATIONS.filter((l) => l.stationType === 'pirate-den' && denDown(state, l.id) && (jumps.get(l.systemId) ?? 99) <= reach)
    .map((l) => ({ locationId: l.id, jumps: jumps.get(l.systemId) ?? 0, left: state.dens[l.id]! + DENS.downSeconds - state.clock }))
    .sort((a, b) => a.jumps - b.jumps);
}
