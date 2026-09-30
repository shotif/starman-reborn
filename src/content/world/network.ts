import type { SystemId, Vec3Tuple } from '../../data/types.ts';
import { GROWTH, NETWORK } from './rules.ts';
import type { SystemSeed } from './types.ts';

/**
 * Jump lanes between systems (fiction): the hand-authored links, then the shortest links that
 * connect everything (a minimum spanning tree), then extra short links so no system is a dead end,
 * then very short hops for loops. Deterministic: ties break by system id.
 */
export function generateJumpNetwork(seeds: readonly SystemSeed[]): Map<SystemId, SystemId[]> {
  const ids = seeds.map((s) => s.id).sort();
  const pos = new Map(seeds.map((s) => [s.id, s.positionLy]));
  const links = new Map<SystemId, Set<SystemId>>(ids.map((id) => [id, new Set()]));
  const link = (a: SystemId, b: SystemId) => {
    links.get(a)!.add(b);
    links.get(b)!.add(a);
  };
  const dist = (a: SystemId, b: SystemId) => distance(pos.get(a)!, pos.get(b)!);

  // 1. Curated links.
  for (const s of seeds) for (const to of s.curated?.links ?? []) if (links.has(to)) link(s.id, to);

  // 2. Minimum spanning tree over what the curated links leave unconnected (Kruskal).
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: SystemId): SystemId => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: SystemId, b: SystemId) => parent.set(find(a), find(b));
  for (const [a, set] of links) for (const b of set) union(a, b);
  const pairs: [SystemId, SystemId, number][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i]!, ids[j]!, dist(ids[i]!, ids[j]!)]);
  pairs.sort((x, y) => x[2] - y[2] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : 1));
  for (const [a, b] of pairs) {
    if (find(a) !== find(b)) {
      link(a, b);
      union(a, b);
    }
  }

  // 3. No dead ends: link each system with too few exits to its nearest unlinked neighbours.
  for (const id of ids) {
    const byDistance = ids.filter((o) => o !== id).sort((x, y) => dist(id, x) - dist(id, y) || (x < y ? -1 : 1));
    for (const other of byDistance) {
      if (links.get(id)!.size >= NETWORK.minLinks) break;
      if (links.get(id)!.has(other) || links.get(other)!.size >= NETWORK.maxLinks || dist(id, other) > NETWORK.maxExtraLinkLy) continue;
      link(id, other);
    }
  }

  // 4. Short hops for loops.
  for (const [a, b, d] of pairs) {
    if (d > NETWORK.shortcutLy) break;
    if (!links.get(a)!.has(b) && links.get(a)!.size < NETWORK.maxLinks - 1 && links.get(b)!.size < NETWORK.maxLinks - 1) link(a, b);
  }

  return new Map([...links].map(([id, set]) => [id, [...set].sort()]));
}

/**
 * Lanes for systems added around a finished core (docs/PROCGEN.md §7.7). Every new lane touches a
 * new system, so the core's lanes stay exactly as they were. New systems join nearest first
 * (outward from Sol), each linked to its nearest placed system that has room; then the same
 * no-dead-end and short-hop passes as the core, over the new systems only. Deterministic.
 */
export function growJumpNetwork(
  core: ReadonlyMap<SystemId, readonly SystemId[]>,
  coreSeeds: readonly SystemSeed[],
  growth: readonly SystemSeed[],
): Map<SystemId, SystemId[]> {
  const links = new Map<SystemId, Set<SystemId>>([...core].map(([id, to]) => [id, new Set(to)]));
  const pos = new Map([...coreSeeds, ...growth].map((s) => [s.id, s.positionLy]));
  const dist = (a: SystemId, b: SystemId) => distance(pos.get(a)!, pos.get(b)!);
  const link = (a: SystemId, b: SystemId) => {
    links.get(a)!.add(b);
    links.get(b)!.add(a);
  };
  const room = (id: SystemId, spare = 0) => links.get(id)!.size < NETWORK.maxLinks - spare;
  const order = [...growth].sort((a, b) => distance(a.positionLy, [0, 0, 0]) - distance(b.positionLy, [0, 0, 0]) || (a.id < b.id ? -1 : 1)).map((s) => s.id);
  const placed = coreSeeds.map((s) => s.id);
  const nearest = (id: SystemId, among: readonly SystemId[]) => among.filter((o) => o !== id).sort((x, y) => dist(id, x) - dist(id, y) || (x < y ? -1 : 1));

  // 1. Join, nearest first: the nearest placed system with room (the nearest at all if none has).
  for (const id of order) {
    links.set(id, new Set());
    const near = nearest(id, placed);
    link(id, near.find((o) => room(o)) ?? near[0]!);
    placed.push(id);
  }
  // 2. No dead ends: new systems link to anything, core dead ends to new systems only.
  for (const id of order) {
    for (const other of nearest(id, placed)) {
      if (links.get(id)!.size >= NETWORK.minLinks) break;
      if (links.get(id)!.has(other) || !room(other) || dist(id, other) > GROWTH.maxExtraLinkLy) continue;
      link(id, other);
    }
  }
  for (const s of coreSeeds) {
    for (const other of nearest(s.id, order)) {
      if (links.get(s.id)!.size >= NETWORK.minLinks) break;
      if (links.get(s.id)!.has(other) || !room(other) || dist(s.id, other) > GROWTH.maxExtraLinkLy) continue;
      link(s.id, other);
    }
  }
  // 3. Short hops for loops, where one end is new.
  const fresh = new Set(order);
  const pairs: [SystemId, SystemId, number][] = [];
  for (const a of order) for (const b of placed) if (a !== b && (!fresh.has(b) || a < b) && dist(a, b) <= NETWORK.shortcutLy) pairs.push([a, b, dist(a, b)]);
  pairs.sort((x, y) => x[2] - y[2] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : 1));
  for (const [a, b] of pairs) if (!links.get(a)!.has(b) && room(a, 1) && room(b, 1)) link(a, b);

  return new Map([...links].map(([id, set]) => [id, [...set].sort()]));
}

export function distance(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Jumps from `from` to every system (breadth first). */
export function jumpsFrom(links: ReadonlyMap<SystemId, readonly SystemId[]>, from: SystemId): Map<SystemId, number> {
  const out = new Map<SystemId, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of links.get(cur) ?? []) {
      if (!out.has(next)) {
        out.set(next, out.get(cur)! + 1);
        queue.push(next);
      }
    }
  }
  return out;
}
