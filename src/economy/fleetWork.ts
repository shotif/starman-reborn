import * as THREE from 'three';
import type { GameState, Hauler, OwnedShip, ShipState } from '../app/state.ts';
import { FLEET } from '../content/fleet/rules.ts';
import { beltGoods, COMPOSITION, type MinedGood } from '../content/mining/rules.ts';
import { outpostSite, siteOfStation, type OutpostSite } from '../content/outposts/sites.ts';
import { findBelt, getLocation } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import type { SystemSceneDef } from '../world/sceneTypes.ts';
import { siteDock } from '../world/siteDock.ts';
import { polar } from '../world/systems/helpers.ts';
import { COMMODITIES } from './commodities.ts';
import { cargoCapacity, performanceOf } from './loadout.ts';

/**
 * Captains who work for the pilot's outposts (docs/PROCGEN.md §37; rules in FLEET.work): the
 * pure parts of a mining captain's work, what it cuts and how long it takes, where in the ring it
 * works, and where it is at a moment. The fleet's settle (economy/fleet.ts) works the steps out.
 */

const W = FLEET.work;

/** What a ship brings to mining: its lasers' rate (units of rock a minute) and its prospecting scanner. */
export function miningRig(ship: Pick<ShipState, 'model' | 'fittings'>): { rate: number; prospect: number } {
  const p = performanceOf(ship);
  return { rate: p.miningRate, prospect: Math.max(1, p.prospect) };
}

/** A belt kind's goods in the mean shares of its rocks (docs/PROCGEN.md §19), adding up to one. */
export function meanShares(kind: keyof typeof COMPOSITION): Partial<Record<MinedGood, number>> {
  const raw = beltGoods(kind).map((g) => [g, (COMPOSITION[kind][g]![0] + COMPOSITION[kind][g]![1]) / 2] as const);
  const sum = raw.reduce((s, [, w]) => s + w, 0);
  return Object.fromEntries(raw.map(([g, w]) => [g, w / sum]));
}

/** The belt a site lies in (null for a planet's). */
function beltOf(siteId: string) {
  const site = outpostSite(siteId);
  return site?.beltId ? (findBelt(site.beltId) ?? null) : null;
}

/**
 * A mining captain's load for the refinery at a site: the belt's goods in their mean shares, in
 * whole units (the largest remainders rounded up), filling at most `holdShare` of the hold.
 */
export function mineLoad(ship: ShipState, siteId: string): Partial<Record<MinedGood, number>> {
  const belt = beltOf(siteId);
  if (!belt) return {};
  const shares = meanShares(belt.kind);
  const room = cargoCapacity(ship) * FLEET.haulers.holdShare;
  const goods = Object.keys(shares) as MinedGood[];
  const size = goods.reduce((s, g) => s + shares[g]! * COMMODITIES[g].unitSize, 0);
  for (let n = Math.floor(room / size); n > 0; n--) {
    const exact = goods.map((g) => ({ g, x: n * shares[g]! }));
    const load: Partial<Record<MinedGood, number>> = Object.fromEntries(exact.map(({ g, x }) => [g, Math.floor(x)]));
    let left = n - exact.reduce((s, { x }) => s + Math.floor(x), 0);
    for (const { g } of [...exact].sort((a, b) => b.x - Math.floor(b.x) - (a.x - Math.floor(a.x)) || a.g.localeCompare(b.g))) {
      if (left <= 0) break;
      load[g] = load[g]! + 1;
      left--;
    }
    const used = goods.reduce((s, g) => s + (load[g] ?? 0) * COMMODITIES[g].unitSize, 0);
    if (used <= room) return Object.fromEntries(Object.entries(load).filter(([, q]) => q > 0));
  }
  return {};
}

/** Units in a load. */
export const loadUnits = (load: Partial<Record<string, number>>): number => Object.values(load).reduce<number>((s, q) => s + (q ?? 0), 0);

/** Seconds a ship cuts a load: each unit of rock yields the scanner's factor, at the lasers' rate. */
export function cutSeconds(ship: Pick<ShipState, 'model' | 'fittings'>, units: number): number {
  const { rate, prospect } = miningRig(ship);
  return rate > 0 ? Math.max(1, Math.round((units / (rate * prospect)) * 60)) : Infinity;
}

/** When a mining captain's phase ends (at work in its refinery's system). */
export function phaseEnd(o: OwnedShip, h: Hauler): number {
  switch (h.phase) {
    case 'to-rocks':
    case 'to-dock':
      return h.since + W.transit;
    case 'cutting':
      return h.since + cutSeconds(o.ship, loadUnits(mineLoad(o.ship, siteIdOf(h))));
    default:
      return h.since;
  }
}

/** The outpost site a working captain's route ends at. */
export function siteIdOf(h: Hauler): string {
  return siteOfStation(h.route.to)?.id ?? '';
}

/**
 * A mining captain's spot (docs/PROCGEN.md §37.2): in its refinery's ring (the belt's first), halfway
 * across and level with it, `spot` metres along the ring from the refinery.
 */
export function miningSpot(def: Pick<SystemSceneDef, 'planets' | 'belts'>, site: OutpostSite): THREE.Vector3 | null {
  const ring = site.beltId && site.ring ? def.belts.find((b) => b.beltId === site.beltId && b.shape === 'ring') : undefined;
  if (!ring || !site.ring || !siteDock(def, site)) return null;
  const r = (ring.innerRadius + ring.outerRadius) / 2;
  return polar(ring.center, r, site.ring.angle + THREE.MathUtils.radToDeg(W.spot / r));
}

/** One of the pilot's mining captains at work in a system now (for the flight scene, docs/PROCGEN.md §37.4). */
export interface MinerHere {
  ship: OwnedShip;
  hauler: Hauler;
  /** The refinery it works for (its station id). */
  dockId: string;
  phase: NonNullable<Hauler['phase']>;
  /** How far through its phase (0–1). */
  progress: number;
}

/** The pilot's mining captains at work in a system at a moment. */
export function minersIn(state: GameState, systemId: SystemId, clock: number): MinerHere[] {
  const out: MinerHere[] = [];
  for (const o of state.fleet.ships) {
    const h = o.hauler;
    if (h?.work !== 'mine' || h.leg !== 'work' || !h.phase || getLocation(h.route.to).systemId !== systemId) continue;
    const end = phaseEnd(o, h);
    const span = Math.max(1, end - h.since);
    out.push({ ship: o, hauler: h, dockId: h.route.to, phase: h.phase, progress: Math.max(0, Math.min(1, (clock - h.since) / span)) });
  }
  return out;
}
