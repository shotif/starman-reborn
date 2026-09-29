import { distance3 } from '../data/coords.ts';
import type { StarSystemRecord, SystemId } from '../data/types.ts';

/**
 * Fictional jump-travel rules. Distances come from the source-backed star positions; the fee and
 * transit time are game fiction, applied consistently per light-year.
 */
export const JUMP_BASE_FEE = 10;
export const JUMP_FEE_PER_LY = 16;
/** Fictional in-universe transit time per light-year (shown to the player, not real physics). */
export const TRANSIT_DAYS_PER_LY = 1.4;

export interface RouteHop {
  from: SystemId;
  to: SystemId;
  distanceLy: number;
  fee: number;
  transitDays: number;
}

export interface Route {
  from: SystemId;
  to: SystemId;
  /** Systems visited in order, including both ends. */
  path: SystemId[];
  hops: RouteHop[];
  totalDistanceLy: number;
  totalFee: number;
  totalTransitDays: number;
}

export function jumpFee(distanceLy: number): number {
  return Math.round(JUMP_BASE_FEE + JUMP_FEE_PER_LY * distanceLy);
}

export function transitDays(distanceLy: number): number {
  return Math.round(distanceLy * TRANSIT_DAYS_PER_LY * 10) / 10;
}

export function linkDistance(systems: readonly StarSystemRecord[], a: SystemId, b: SystemId): number {
  const sa = systems.find((s) => s.id === a);
  const sb = systems.find((s) => s.id === b);
  if (!sa || !sb) throw new Error(`Unknown system in link ${a}-${b}`);
  return distance3(sa.positionLy, sb.positionLy);
}

/**
 * Shortest route by total light-years over the fictional jump links (Dijkstra).
 * Returns null when no route exists; a zero-hop route when from === to.
 */
export function findRoute(systems: readonly StarSystemRecord[], from: SystemId, to: SystemId): Route | null {
  const byId = new Map(systems.map((s) => [s.id, s]));
  if (!byId.has(from) || !byId.has(to)) return null;
  const dist = new Map<SystemId, number>([[from, 0]]);
  const prev = new Map<SystemId, SystemId>();
  const done = new Set<SystemId>();
  while (done.size < systems.length) {
    let current: SystemId | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) {
        best = d;
        current = id;
      }
    }
    if (current === null) break;
    if (current === to) break;
    done.add(current);
    for (const next of byId.get(current)!.jumpLinks) {
      if (done.has(next)) continue;
      const candidate = best + linkDistance(systems, current, next);
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        prev.set(next, current);
      }
    }
  }
  if (!dist.has(to)) return null;
  const path: SystemId[] = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
  const hops: RouteHop[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const d = linkDistance(systems, a, b);
    hops.push({ from: a, to: b, distanceLy: d, fee: jumpFee(d), transitDays: transitDays(d) });
  }
  return {
    from,
    to,
    path,
    hops,
    totalDistanceLy: hops.reduce((sum, h) => sum + h.distanceLy, 0),
    totalFee: hops.reduce((sum, h) => sum + h.fee, 0),
    totalTransitDays: Math.round(hops.reduce((sum, h) => sum + h.transitDays, 0) * 10) / 10,
  };
}
