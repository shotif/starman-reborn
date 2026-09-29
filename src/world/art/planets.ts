import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { disposeObject } from './util.ts';

export type PlanetStyle =
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'moon'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  /** Rocky exoplanet around a red dwarf (artist's impression, e.g. Proxima b). */
  | 'exo-rocky-warm'
  /** Airless, scorched close-in exoplanet (e.g. Barnard's Star planets). */
  | 'exo-scorched'
  /** Cold rocky/icy exoplanet. */
  | 'exo-rocky-cold'
  /** Jupiter-like exoplanet (e.g. Epsilon Eridani b). */
  | 'exo-gas-giant';

export interface PlanetArtOptions {
  radius: number;
  style: PlanetStyle;
  seed?: number;
  /** World-space position of the light source (the host star). */
  lightPosition: THREE.Vector3;
  lightColor?: THREE.ColorRepresentation;
  rings?: { inner: number; outer: number; color?: THREE.ColorRepresentation; opacity?: number };
  /** Draw an atmospheric rim. Defaults per style. */
  atmosphere?: boolean;
  /** Axial spin, radians per second. */
  spinSpeed?: number;
  /** Axial tilt, radians. */
  tilt?: number;
}

export interface PlanetArt extends ArtObject {
  readonly radius: number;
  /** Update the host star position (world space) used for day/night shading. */
  setLightPosition(worldPos: THREE.Vector3): void;
}

const PLACEHOLDER_COLORS: Record<PlanetStyle, number> = {
  mercury: 0x8a8580,
  venus: 0xd9c28f,
  earth: 0x3f7fd0,
  moon: 0x9a9a9a,
  mars: 0xc2542d,
  jupiter: 0xc9a27a,
  saturn: 0xd8c08c,
  uranus: 0x9fd8e0,
  neptune: 0x3b5fd6,
  'exo-rocky-warm': 0x8a4a3a,
  'exo-scorched': 0x5a4a44,
  'exo-rocky-cold': 0x7d8a99,
  'exo-gas-giant': 0xb58b62,
};

/** PLACEHOLDER implementation; replaced by the procedural art pass (shader-lit, original look). */
export function createPlanet(opts: PlanetArtOptions, _ctx: ArtContext): PlanetArt {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(opts.radius, 48, 32),
    new THREE.MeshStandardMaterial({ color: PLACEHOLDER_COLORS[opts.style], roughness: 0.9 }),
  );
  group.add(mesh);
  if (opts.rings) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(opts.rings.inner, opts.rings.outer, 96),
      new THREE.MeshBasicMaterial({
        color: opts.rings.color ?? 0xd8c7a0,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: opts.rings.opacity ?? 0.6,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
  }
  return {
    object: group,
    radius: opts.radius,
    setLightPosition: () => {},
    dispose: () => disposeObject(group),
  };
}
