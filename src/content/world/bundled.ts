import { ALL_LOCATIONS, GROWTH_SEEDS, SYSTEMS, WORLD, WORLD_SEEDS } from '../../data/systems.ts';
import { FACTIONS } from '../../economy/factions.ts';
import type { Issue } from '../validate.ts';
import { validateWorld, type WorldContext } from './validate.ts';

/** The guardrail context for the bundled world: hand-placed stations and every reserved name. */
export function bundledWorldContext(): WorldContext {
  const generated = new Set(WORLD.stations.map((s) => s.id));
  return {
    curated: ALL_LOCATIONS.filter((l) => !generated.has(l.id)).map((l) => ({
      id: l.id,
      name: l.name,
      systemId: l.systemId,
      open: l.status === 'functional' && l.services.length > 0 && l.dockable !== false,
    })),
    reservedNames: [...SYSTEMS.map((s) => s.displayName), ...Object.values(FACTIONS).flatMap((f) => [f.name, f.shortName])],
    growth: new Set(GROWTH_SEEDS.map((s) => s.id)),
  };
}

/** Guardrail issues of the world every player flies (empty when it passes). */
export function validateBundledWorld(): Issue[] {
  return validateWorld(WORLD_SEEDS, WORLD, bundledWorldContext());
}
