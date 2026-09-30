import { jumpsFrom } from '../../content/world/network.ts';
import { ALL_LOCATIONS, WORLD } from '../../data/systems.ts';
import type { QualityLevel } from '../art/types.ts';
import type { TrafficSetup } from '../FlightSession.ts';
import { trafficPlan } from './plan.ts';

let jumps: Map<string, number> | null = null;

/** Traffic for a system from the generated world: its security, owner, stations and remoteness. */
export function trafficFor(systemId: string, quality: QualityLevel): TrafficSetup {
  jumps ??= jumpsFrom(WORLD.links, 'sol');
  const profile = WORLD.profiles.get(systemId);
  const here = ALL_LOCATIONS.filter((l) => l.systemId === systemId && l.status === 'functional');
  const openStations = here.filter((l) => l.dockable !== false && l.services.length > 0).length;
  const hasDen = here.some((l) => l.dockable === false);
  // Fewer ships on the Low preset (phones), a few less on Medium.
  const qualityScale = quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1;
  return {
    plan: trafficPlan({ security: profile?.security ?? 1, owner: profile?.owner ?? null, openStations, hasDen, jumpsFromSol: jumps.get(systemId) ?? 0 }, qualityScale),
    owner: profile?.owner ?? null,
  };
}
