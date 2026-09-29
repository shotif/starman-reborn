import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { disposeObject } from './util.ts';

export type StarKind = 'main-sequence' | 'red-dwarf' | 'white-dwarf';

export interface StarArtOptions {
  /** Radius of the visible photosphere in game units (schematic). */
  radius: number;
  /** Display colour (artistic, inspired by spectral type). */
  color: THREE.ColorRepresentation;
  kind?: StarKind;
  /** 0..1 surface activity (granulation contrast, flare spots on red dwarfs). */
  activity?: number;
  /** Multiplier for the size of the glow halo relative to the radius. */
  glowScale?: number;
  /** Brightness multiplier for glow sprites. */
  intensity?: number;
  seed?: number;
}

export interface StarArt extends ArtObject {
  readonly radius: number;
}

/**
 * A star: emissive animated photosphere plus additive glow. The glow must stay visible as a bright
 * point with a halo when viewed from 300,000+ units away (e.g. Proxima seen from Alpha Centauri A/B).
 * PLACEHOLDER implementation; replaced by the procedural art pass.
 */
export function createStar(opts: StarArtOptions, _ctx: ArtContext): StarArt {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(opts.radius, 48, 32),
    new THREE.MeshBasicMaterial({ color: opts.color }),
  );
  group.add(mesh);
  return {
    object: group,
    radius: opts.radius,
    dispose: () => disposeObject(group),
  };
}
