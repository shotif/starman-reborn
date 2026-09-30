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

/** Rough luminosity (Suns) by spectral class, only to pick an illustration style. */
const LUMINOSITY: Record<string, number> = { O: 1e4, B: 500, A: 12, F: 3, G: 1, K: 0.3, M: 0.01, D: 0.002 };

/**
 * Default schematic placement and illustration for a planet without a hand-tuned one: orbit from
 * its catalogued semi-major axis, look from how much light it gets (scorched, temperate, cold) and
 * its catalogued mass. An artist's impression, never a claim about the real surface.
 */
export function defaultPlacement(body: ConfirmedBody, index: number, hostClass = 'M'): PlanetPlacement {
  const sma = body.semiMajorAxisAu?.value;
  const mass = body.massEarth?.value;
  const light = sma ? Math.sqrt(LUMINOSITY[hostClass] ?? 0.01) / sma : 0;
  const giant = (mass ?? 1) > 50;
  const style: PlanetStyle = giant ? 'exo-gas-giant' : light > 2.2 ? 'exo-scorched' : light > 0.55 ? 'exo-rocky-warm' : 'exo-rocky-cold';
  return {
    orbit: sma ? 3000 + Math.sqrt(sma) * 14000 : 6000 + index * 2500,
    angle: 40 + index * 67,
    radius: giant ? 3200 : (mass ?? 1) > 10 ? 900 : 380,
    style,
  };
}

/**
 * Builds planet defs for every confirmed planet in the bundled snapshot for this system. Known
 * planets use hand-tuned schematic placements; any other planet is placed by its catalogued orbit
 * (if present) so the scene never invents or drops real bodies.
 */
export function confirmedPlanets(
  systemId: SystemId,
  hosts: Record<string, THREE.Vector3>,
  placements: Record<string, PlanetPlacement>,
  hostInfo: { spectralClass?: Record<string, string>; radius?: Record<string, number> } = {},
): ScenePlanetDef[] {
  const bodies = getSystem(systemId).confirmedBodies;
  const places = bodies.map((body, i) => placements[body.archiveName] ?? defaultPlacement(body, i, hostInfo.spectralClass?.[body.hostId]));
  // Compressed orbits keep their order but never let one planet's orbit cut through its neighbour.
  const byHost = new Map<string, number[]>();
  bodies.forEach((b, i) => {
    if (!placements[b.archiveName]) byHost.set(b.hostId, [...(byHost.get(b.hostId) ?? []), i]);
  });
  for (const [hostId, idx] of byHost) {
    idx.sort((a, b) => places[a]!.orbit - places[b]!.orbit);
    let inner = (hostInfo.radius?.[hostId] ?? 1_000) * 1.6 + 1_500;
    let prevRadius = 0;
    for (const i of idx) {
      const p = places[i]!;
      p.orbit = Math.max(p.orbit, inner + prevRadius + p.radius);
      inner = p.orbit + 1_200;
      prevRadius = p.radius;
    }
  }
  return bodies.map((body, i) => {
    const host = hosts[body.hostId] ?? Object.values(hosts)[0]!;
    const place = places[i]!;
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
