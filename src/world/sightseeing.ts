import { PASSENGERS } from '../content/passengers/rules.ts';
import { allSights, type Sight } from '../content/passengers/sights.ts';
import type { SystemSceneDef } from './sceneTypes.ts';
import { sceneDefFor } from './systems/index.ts';

interface Point {
  x: number;
  y: number;
  z: number;
}

/**
 * Whether sightseers have a good look at a sight from `pos` (docs/PROCGEN.md §23.2): within
 * PASSENGERS.sightRange of a planet's or dwarf star's surface, or inside a belt's band of rock (its
 * width, and its thickness give or take the range). A belt counts only from inside it: the jump
 * beacons of several systems sit just outside their discs, and a tour should not end on arrival.
 */
export function sightInView(def: SystemSceneDef, targetId: string, pos: Point): boolean {
  const range = PASSENGERS.sightRange;
  const [kind, id] = [targetId.slice(0, targetId.indexOf(':')), targetId.slice(targetId.indexOf(':') + 1)];
  const near = (c: Point, radius: number) => Math.hypot(pos.x - c.x, pos.y - c.y, pos.z - c.z) - radius < range;
  if (kind === 'planet') return def.planets.some((p) => p.id === id && near(p.position, p.radius));
  if (kind === 'star') return def.stars.some((s) => s.id === id && near(s.position, s.radius));
  if (kind === 'belt') {
    return def.belts.some((b) => {
      if (b.beltId !== id) return false;
      const radial = Math.hypot(pos.x - b.center.x, pos.z - b.center.z);
      return radial >= b.innerRadius && radial <= b.outerRadius && Math.abs(pos.y - b.center.y) < b.thickness + range;
    });
  }
  return false;
}

/** Whether a sight is in view from where a pilot jumps in or out of its system. */
export function inViewFromGates(s: Sight): boolean {
  const def = sceneDefFor(s.systemId);
  return [def.arrival.position, ...def.beacons.map((b) => b.position)].some((g) => sightInView(def, s.targetId, g));
}

/** Whether a sight is in view from a station, where a pilot undocks (only one in its own system can be). */
export function inViewFromStation(s: Sight, locationId: string): boolean {
  const def = sceneDefFor(s.systemId);
  return def.stations.some((st) => st.locationId === locationId && sightInView(def, s.targetId, st.position));
}

let tours: Sight[] | null = null;

/**
 * The sights a tour goes out to: every sight but the few in view from a jump beacon (a tour is a
 * trip out, not a look on arrival). They stay sights of the real sky, scanned and charted as ever.
 */
export function tourSights(): readonly Sight[] {
  tours ??= allSights().filter((s) => !inViewFromGates(s));
  return tours;
}
