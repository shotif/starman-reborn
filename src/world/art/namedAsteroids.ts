import * as THREE from 'three';
import { rockGeometry } from './rocks.ts';
import type { ArtContext, ArtObject } from './types.ts';
import { disposeObject } from './util.ts';

/**
 * A named asteroid in Sol (docs/PROCGEN.md §47.3), drawn far larger than life: a lumpy, cratered rock
 * in the proportions of its measured shape, in its spectral type's colour, turning faster than life.
 */
export interface NamedAsteroidArtOptions {
  /** The drawn radius (the longest axis) and each axis's share of it. */
  radius: number;
  shape: [number, number, number];
  /** Turning speed (radians a second). */
  spin: number;
  color: string;
  seed: number;
}

export function createNamedAsteroid(opts: NamedAsteroidArtOptions, ctx: ArtContext): ArtObject<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'named-asteroid';
  const rock = new THREE.Mesh(
    rockGeometry(opts.seed, { detail: ctx.quality === 'low' ? 2 : 3, stretch: opts.shape, rough: 0.3, craters: 6, ice: 0.04, color: opts.color }),
    // Faintly lit on its dark side, so it never reads as a hole in the sky.
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, emissive: new THREE.Color(opts.color), emissiveIntensity: 0.12 }),
  );
  rock.scale.setScalar(opts.radius);
  // A tilt of its own, so they do not all turn alike.
  rock.rotation.set(((opts.seed % 7) / 7) * 0.8, 0, ((opts.seed % 5) / 5) * 0.6);
  group.add(rock);
  const spin = ctx.reducedMotion ? 0 : opts.spin;
  return {
    object: group,
    update(dt) {
      rock.rotateY(dt * spin);
    },
    dispose() {
      disposeObject(group);
    },
  };
}
