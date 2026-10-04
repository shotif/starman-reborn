import type * as THREE from 'three';
import type { OutpostSite } from '../content/outposts/sites.ts';
import type { SystemSceneDef } from './sceneTypes.ts';
import { dirTo, polar, v } from './systems/helpers.ts';

/**
 * Where an outpost at a site stands in a scene (docs/PROCGEN.md §22, §36.1): in orbit of its planet
 * where the site says, its bay facing away from the planet; or in its belt's first ring (Epsilon
 * Eridani's inner one), halfway across and level with it, its bay facing out from the ring's middle.
 * Null when the scene has no such planet or ring.
 */
export function siteDock(def: Pick<SystemSceneDef, 'planets' | 'belts'>, site: OutpostSite): { position: THREE.Vector3; approach: THREE.Vector3 } | null {
  if (site.planetId && site.orbit) {
    const planet = def.planets.find((p) => p.id === site.planetId);
    if (!planet) return null;
    const position = polar(planet.position, site.orbit.distance + planet.radius, site.orbit.angle, site.orbit.height);
    return { position, approach: dirTo(planet.position, position).add(v(0, 0.15, 0)).normalize() };
  }
  const ring = site.beltId && site.ring ? def.belts.find((b) => b.beltId === site.beltId && b.shape === 'ring') : undefined;
  if (!ring || !site.ring) return null;
  const position = polar(ring.center, (ring.innerRadius + ring.outerRadius) / 2, site.ring.angle);
  return { position, approach: dirTo(ring.center, position).add(v(0, 0.15, 0)).normalize() };
}
