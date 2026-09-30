import { EVENTS } from '../../content/events/rules.ts';
import { jumpsFrom } from '../../content/world/network.ts';
import { ALL_LOCATIONS, WORLD } from '../../data/systems.ts';
import { systemEventAt, type WorldEvent } from '../../economy/events.ts';
import type { QualityLevel } from '../art/types.ts';
import type { TrafficSetup } from '../FlightSession.ts';
import { TRAFFIC, trafficPlan, type TrafficPlan } from './plan.ts';

let jumps: Map<string, number> | null = null;

/**
 * Traffic for a system from the generated world: its security, owner, stations and remoteness,
 * and, given the game clock, any raid or security sweep under way (docs/PROCGEN.md §11).
 */
export function trafficFor(systemId: string, quality: QualityLevel, clock?: number): TrafficSetup {
  jumps ??= jumpsFrom(WORLD.links, 'sol');
  const profile = WORLD.profiles.get(systemId);
  const here = ALL_LOCATIONS.filter((l) => l.systemId === systemId && l.status === 'functional');
  const openStations = here.filter((l) => l.dockable !== false && l.services.length > 0).length;
  const hasDen = here.some((l) => l.dockable === false);
  // Fewer ships on the Low preset (phones), a few less on Medium.
  const qualityScale = quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1;
  const security = profile?.security ?? 1;
  const owner = profile?.owner ?? null;
  const plan = trafficPlan({ security, owner, openStations, hasDen, jumpsFromSol: jumps.get(systemId) ?? 0 }, qualityScale);
  const event = clock === undefined ? null : systemEventAt(systemId, clock);
  return { plan: event ? withEvent(plan, event, security) : plan, owner };
}

/** A raid brings more and nastier packs and scares traders off; a sweep clears the packs out. */
export function withEvent(plan: TrafficPlan, event: WorldEvent, security: number): TrafficPlan {
  if (event.kind === 'sweep') {
    return { ...plan, packs: null, patrolWings: Math.min(2, plan.patrolWings + EVENTS.sweep.extraWings) };
  }
  if (event.kind !== 'raid' || !event.level) return plan;
  const level = event.level;
  const size = level === 1 ? ([1, 2] as const) : level === 2 ? ([2, 3] as const) : ([2, 4] as const);
  const scale = 0.6 + security;
  const base = plan.packs;
  return {
    ...plan,
    traders: plan.traders > 0 ? Math.max(1, Math.round(plan.traders * EVENTS.raid.traderScale)) : 0,
    packs: {
      max: (base?.max ?? 0) + EVENTS.raid.extraPacks,
      level,
      size,
      firstDelay: EVENTS.raid.firstDelay,
      interval: base
        ? [base.interval[0] * EVENTS.raid.intervalScale, base.interval[1] * EVENTS.raid.intervalScale]
        : [TRAFFIC.packInterval[0] * scale * EVENTS.raid.intervalScale, TRAFFIC.packInterval[1] * scale * EVENTS.raid.intervalScale],
    },
  };
}
