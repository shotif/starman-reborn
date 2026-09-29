import type * as THREE from 'three';

/**
 * Contract for procedural art builders. Game code only depends on these types, so the visual
 * implementation can evolve independently. Conventions:
 * - 1 game unit is roughly 1 metre at ship scale; local system scenes are compressed and fictional.
 * - Ships face -Z (like three.js cameras), +Y is up, +X is right.
 * - Every builder returns an ArtObject whose `object` the caller adds to a scene, whose optional
 *   `update` the caller runs every rendered frame, and whose `dispose` frees GPU resources.
 * - All art is original and procedural (no photographs, no third-party models or textures).
 */

export type QualityLevel = 'low' | 'medium' | 'high';

export interface ArtContext {
  quality: QualityLevel;
  /** When true, avoid flashing, rapid pulsing and large camera-filling motion. */
  reducedMotion: boolean;
}

export interface ArtObject<T extends THREE.Object3D = THREE.Object3D> {
  readonly object: T;
  /** Called once per rendered frame. `time` is seconds since the scene was created. */
  update?(dt: number, time: number, camera: THREE.Camera): void;
  dispose(): void;
}
