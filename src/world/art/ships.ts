import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { disposeObject } from './util.ts';

export interface ShipArt extends ArtObject<THREE.Group> {
  /** Approximate bounding radius used for hits and collisions. */
  readonly radius: number;
  /** Gun muzzle positions in ship-local space (ship faces -Z). */
  readonly muzzles: readonly THREE.Vector3[];
  /** 0..1 main engine output (drives exhaust glow length/brightness). */
  setThrottle(value: number): void;
  setBoost(on: boolean): void;
  setCruise(on: boolean): void;
  /** Brief shield shimmer when hit; strength 0..1. */
  flashShield(strength: number): void;
}

function placeholderShip(color: number, length: number): ShipArt {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(length * 0.25, length, 8),
    new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 }),
  );
  hull.rotation.x = -Math.PI / 2;
  group.add(hull);
  return {
    object: group,
    radius: length * 0.6,
    muzzles: [new THREE.Vector3(-length * 0.2, 0, -length * 0.3), new THREE.Vector3(length * 0.2, 0, -length * 0.3)],
    setThrottle: () => {},
    setBoost: () => {},
    setCruise: () => {},
    flashShield: () => {},
    dispose: () => disposeObject(group),
  };
}

/** Player's "Kite" courier, ~14 units long. PLACEHOLDER implementation. */
export function createPlayerShip(_ctx: ArtContext): ShipArt {
  return placeholderShip(0xc8d6e8, 14);
}

/** Hostile raider fighter, ~11 units long, visibly different silhouette. PLACEHOLDER. */
export function createPirateShip(_ctx: ArtContext): ShipArt {
  return placeholderShip(0x8a3a32, 11);
}

/** Civilian hauler for ambient traffic, ~40 units long. PLACEHOLDER. */
export function createHaulerShip(_ctx: ArtContext): ShipArt {
  return placeholderShip(0x9aa39a, 40);
}
