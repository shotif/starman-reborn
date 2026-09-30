import { BORDER } from '../../content/border/rules.ts';
import { EVENTS } from '../../content/events/rules.ts';
import { jumpsFrom } from '../../content/world/network.ts';
import { ALL_LOCATIONS, WORLD } from '../../data/systems.ts';
import { frontsHere } from '../../economy/border.ts';
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
  if (clock === undefined) return { plan, owner };
  // The border war sets the lanes; a raid or a sweep under way comes on top of it.
  const front = withBorder(plan, owner, systemId, clock);
  const event = systemEventAt(systemId, clock);
  return event ? { ...front, plan: withEvent(front.plan, event, security) } : front;
}

/**
 * The border war in the lanes (docs/PROCGEN.md §20): skirmishes bring patrol wings and raider packs
 * to both sides; a blockade or a fallen station puts packs on the lawful side and scares traders
 * off; a pushed-back front sends patrols into the den's system; a truce quiets both.
 */
export function withBorder(plan: TrafficPlan, owner: TrafficSetup['owner'], systemId: string, clock: number): TrafficSetup {
  let out = plan;
  let who = owner;
  for (const s of frontsHere(systemId, clock)) {
    const lawSide = s.front.lawSystem === systemId;
    const t = BORDER.traffic;
    const packs = (extra: number, level: 1 | 2 | 3): TrafficPlan['packs'] => ({
      max: (out.packs?.max ?? 0) + extra,
      level: Math.max(out.packs?.level ?? 1, level) as 1 | 2 | 3,
      size: out.packs?.size ?? [2, 3],
      firstDelay: Math.min(out.packs?.firstDelay ?? 25, 25),
      interval: out.packs?.interval ?? [TRAFFIC.packInterval[0], TRAFFIC.packInterval[1]],
    });
    if (s.phase === 'skirmish') {
      out = { ...out, patrolWings: Math.min(2, out.patrolWings + t.skirmishWings), packs: packs(t.skirmishPacks, 2) };
      if (!lawSide) who = s.front.faction;
    } else if ((s.phase === 'blockade' || s.phase === 'fallen') && lawSide) {
      out = { ...out, traders: Math.max(1, Math.round(out.traders * 0.5)), packs: packs(t.blockadePacks, s.phase === 'fallen' ? 3 : 2) };
    } else if (s.phase === 'pushed-back' && !lawSide) {
      out = { ...out, patrolWings: Math.min(2, out.patrolWings + 1) };
      who = s.front.faction;
    } else if (s.phase === 'truce' && lawSide) {
      out = { ...out, packs: null };
    }
  }
  return { plan: out, owner: who };
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
