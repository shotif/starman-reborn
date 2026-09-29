import * as THREE from 'three';
import { getSystem } from '../../data/systems.ts';
import type { ConfirmedBody, SystemId } from '../../data/types.ts';
import type { PlanetStyle } from '../art/planets.ts';
import type { ScenePlanetDef } from '../sceneTypes.ts';

export function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

/** Point on a circle in the XZ plane around `center` (angle in degrees). */
export function polar(center: THREE.Vector3, radius: number, angleDeg: number, y = 0): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(angleDeg);
  return new THREE.Vector3(center.x + Math.cos(a) * radius, center.y + y, center.z + Math.sin(a) * radius);
}

export function dirTo(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  return to.clone().sub(from).normalize();
}

export interface PlanetPlacement {
  /** Schematic orbit radius (units) around the host star's scene position. */
  orbit: number;
  angle: number;
  y?: number;
  radius: number;
  style: PlanetStyle;
}

function describe(body: ConfirmedBody): string {
  const parts = ['Confirmed exoplanet'];
  if (body.discoveryYear) parts.push(`discovered ${body.discoveryYear}`);
  if (body.controversial) parts.push('flagged controversial in archive');
  parts.push('artist’s impression');
  return parts.join(' · ');
}

/**
 * Builds planet defs for every confirmed planet in the bundled snapshot for this system. Known
 * planets use hand-tuned schematic placements; any planet a newer snapshot adds is placed by its
 * catalogued orbit (if present) so the scene never invents or drops real bodies.
 */
export function confirmedPlanets(
  systemId: SystemId,
  hosts: Record<string, THREE.Vector3>,
  placements: Record<string, PlanetPlacement>,
): ScenePlanetDef[] {
  const bodies = getSystem(systemId).confirmedBodies;
  return bodies.map((body, i) => {
    const host = hosts[body.hostId] ?? Object.values(hosts)[0]!;
    const known = placements[body.archiveName];
    const sma = body.semiMajorAxisAu?.value;
    const place: PlanetPlacement =
      known ??
      ({
        orbit: sma ? 3000 + Math.sqrt(sma) * 14000 : 6000 + i * 2500,
        angle: 40 + i * 67,
        radius: (body.massEarth?.value ?? 1) > 50 ? 3200 : 380,
        style: (body.massEarth?.value ?? 1) > 50 ? 'exo-gas-giant' : 'exo-rocky-cold',
      } satisfies PlanetPlacement);
    return {
      id: body.id,
      name: body.displayName,
      subtitle: describe(body),
      position: polar(host, place.orbit, place.angle, place.y ?? 0),
      radius: place.radius,
      style: place.style,
      hostStarId: body.hostId,
      orbitCenter: host,
      scannable: true,
    };
  });
}
