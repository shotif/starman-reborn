import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { disposeObject } from './util.ts';

export interface LaneRingArt extends ArtObject<THREE.Group> {
  /** Inner opening radius; the lane axis runs along the ring's local Z. */
  readonly radius: number;
  /** Lit when a ship is travelling through the lane. */
  setActive(on: boolean): void;
}

/** Fictional trade-lane ring, ~70 units across. PLACEHOLDER implementation. */
export function createLaneRing(_ctx: ArtContext): LaneRingArt {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(30, 4, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0x9aa6b8, emissive: 0x113355, metalness: 0.6, roughness: 0.4 }),
  );
  group.add(ring);
  return {
    object: group,
    radius: 26,
    setActive: () => {},
    dispose: () => disposeObject(group),
  };
}

/** Jump arrival/departure beacon (fictional), ~40 units tall. PLACEHOLDER. */
export function createJumpBeacon(_ctx: ArtContext): ArtObject {
  const group = new THREE.Group();
  const mast = new THREE.Mesh(
    new THREE.OctahedronGeometry(18),
    new THREE.MeshStandardMaterial({ color: 0x7f8ca3, emissive: 0x3a2a66 }),
  );
  group.add(mast);
  return { object: group, dispose: () => disposeObject(group) };
}

/** Small navigation buoy with a coloured light. PLACEHOLDER. */
export function createNavBuoy(color: THREE.ColorRepresentation, _ctx: ArtContext): ArtObject {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(5), new THREE.MeshBasicMaterial({ color }));
  group.add(body);
  return { object: group, dispose: () => disposeObject(group) };
}
