import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { disposeObject } from './util.ts';

export type StationKind =
  | 'earth-port'
  | 'mars-depot'
  | 'proxima-outpost'
  | 'barnard-relay'
  | 'sirius-platform'
  | 'eridani-hub';

export interface StationArt extends ArtObject<THREE.Group> {
  /** Bounding radius (collision keep-out). */
  readonly radius: number;
  /** Station-local point just outside the docking bay where the ship finishes docking. */
  readonly dockPoint: THREE.Vector3;
  /** Station-local unit vector pointing out of the bay (ships approach along it). */
  readonly dockApproach: THREE.Vector3;
}

const SIZES: Record<StationKind, number> = {
  'earth-port': 320,
  'mars-depot': 220,
  'proxima-outpost': 200,
  'barnard-relay': 140,
  'sirius-platform': 240,
  'eridani-hub': 260,
};

/** PLACEHOLDER implementation; replaced by the procedural art pass. */
export function createStation(kind: StationKind, _ctx: ArtContext): StationArt {
  const size = SIZES[kind];
  const group = new THREE.Group();
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(size * 0.5, size * 0.08, 12, 48),
    new THREE.MeshStandardMaterial({ color: 0xaab4c4, metalness: 0.5, roughness: 0.5 }),
  );
  group.add(torus);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.12, size * 0.12, size * 0.6, 16),
    new THREE.MeshStandardMaterial({ color: 0x8894a8, metalness: 0.5, roughness: 0.5 }),
  );
  hub.rotation.x = Math.PI / 2;
  group.add(hub);
  return {
    object: group,
    radius: size * 0.6,
    dockPoint: new THREE.Vector3(0, 0, size * 0.45),
    dockApproach: new THREE.Vector3(0, 0, 1),
    dispose: () => disposeObject(group),
  };
}
