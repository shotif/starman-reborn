import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { disposeObject, seededRandom } from './util.ts';

export interface AsteroidFieldOptions {
  seed: number;
  count: number;
  /** 'ring': annulus around the local origin in the XZ plane. 'cluster': ball around the origin. */
  shape: 'ring' | 'cluster';
  innerRadius: number;
  outerRadius: number;
  /** Vertical spread for rings. */
  thickness: number;
  sizeMin: number;
  sizeMax: number;
  color: THREE.ColorRepresentation;
}

export interface AsteroidHit {
  position: THREE.Vector3;
  radius: number;
}

export interface AsteroidFieldArt extends ArtObject {
  /**
   * Writes asteroids whose bodies come within `radius` of `point` (world space) into `out`
   * (reusing existing entries) and returns how many were written. Used for collisions.
   */
  queryNear(point: THREE.Vector3, radius: number, out: AsteroidHit[]): number;
}

/** Instanced asteroid field. PLACEHOLDER implementation (no collision data). */
export function createAsteroidField(opts: AsteroidFieldOptions, _ctx: ArtContext): AsteroidFieldArt {
  const rand = seededRandom(opts.seed);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({ color: opts.color, roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, opts.count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < opts.count; i++) {
    const a = rand() * Math.PI * 2;
    const r = opts.innerRadius + rand() * (opts.outerRadius - opts.innerRadius);
    p.set(Math.cos(a) * r, (rand() - 0.5) * opts.thickness, Math.sin(a) * r);
    const size = opts.sizeMin + rand() * (opts.sizeMax - opts.sizeMin);
    s.setScalar(size);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  return {
    object: mesh,
    queryNear: () => 0,
    dispose: () => disposeObject(mesh),
  };
}

export interface DustRingOptions {
  innerRadius: number;
  outerRadius: number;
  color: THREE.ColorRepresentation;
  opacity: number;
  seed: number;
}

/** Faint flat dust annulus (schematic debris disk) in the XZ plane. PLACEHOLDER. */
export function createDustRing(opts: DustRingOptions, _ctx: ArtContext): ArtObject {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(opts.innerRadius, opts.outerRadius, 128),
    new THREE.MeshBasicMaterial({
      color: opts.color,
      transparent: true,
      opacity: opts.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return { object: mesh, dispose: () => disposeObject(mesh) };
}
