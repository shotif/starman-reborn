import * as THREE from 'three';
import { WRECKS } from '../content/wrecks/rules.ts';
import { hashString } from '../content/random.ts';
import { seededRandom } from './art/util.ts';
import type { SystemSceneDef } from './sceneTypes.ts';

/**
 * Where a wreck, pod, ship or derelict lies in a system's scene (docs/PROCGEN.md §31.1), worked out
 * from its id: a hail's site somewhere off the arrival point; a derelict or a scan's find a few
 * kilometres off its body's surface; always clear of the stations and of every star's and planet's
 * surface. Pure: the scene definition itself is never changed.
 */
export function placeSite(def: SystemSceneDef, id: string, bodyId: string | null): THREE.Vector3 {
  const r = seededRandom(hashString(`site-place|${id}`));
  const P = WRECKS.place;
  const body = bodyId ? (def.planets.find((p) => p.id === bodyId) ?? def.stars.find((s) => s.id === bodyId)) : undefined;
  const isStar = !!body && def.stars.some((s) => s === body);
  const clear = (p: THREE.Vector3) =>
    def.stations.every((s) => s.position.distanceTo(p) >= P.clearOfDocks) &&
    def.stars.every((s) => s.position.distanceTo(p) > s.radius * 1.3 + P.clearOfBodies) &&
    def.planets.every((pl) => pl.position.distanceTo(p) > pl.radius + P.clearOfBodies);
  for (let i = 0; i < 24; i++) {
    const dir = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.3, r() - 0.5).normalize();
    let p: THREE.Vector3;
    if (body) {
      const [lo, hi] = P.nearBody;
      const surface = isStar ? body.radius * 1.3 : body.radius;
      p = body.position.clone().addScaledVector(dir, surface + P.clearOfBodies + lo + r() * (hi - lo));
    } else {
      const [lo, hi] = P.fromArrival;
      p = def.arrival.position.clone().addScaledVector(dir, lo + r() * (hi - lo));
    }
    if (clear(p)) return p;
  }
  // Nowhere clear by luck: straight up from the anchor, clear of the dock it might be near.
  const anchor = body ? body.position : def.arrival.position;
  const up = (body ? body.radius * (isStar ? 1.3 : 1) : 0) + P.clearOfDocks + P.clearOfBodies + P.nearBody[1];
  return anchor.clone().add(new THREE.Vector3(0, up, 0));
}

/** Where a site's pods drift round it (index by index), from the same id. */
export function podOffset(id: string, index: number): THREE.Vector3 {
  const r = seededRandom(hashString(`site-pod|${id}|${index}`));
  const dir = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.5, r() - 0.5).normalize();
  return dir.multiplyScalar(60 + r() * 90);
}
