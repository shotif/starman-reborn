import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { disposeObject } from './util.ts';

export interface SkyboxOptions {
  seed: number;
  /** Deep background colour. */
  baseColor: THREE.ColorRepresentation;
  /** Nebula tints (artistic; not observational imagery). */
  nebulaColors: THREE.ColorRepresentation[];
  /** 0..1 */
  nebulaIntensity: number;
  /** 0..1 relative density of background stars. */
  starDensity: number;
  /** Tilt of the faint Milky Way band, radians. */
  bandTilt?: number;
}

/**
 * Background sphere (nebula + stars). `update` must keep it centred on the camera. It renders
 * behind everything (depthWrite off, renderOrder very low) and must fit inside a far plane of 2e6.
 * PLACEHOLDER implementation; replaced by the procedural art pass.
 */
export function createSkybox(opts: SkyboxOptions, _ctx: ArtContext): ArtObject {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(900_000, 32, 16),
    new THREE.MeshBasicMaterial({ color: opts.baseColor, side: THREE.BackSide, depthWrite: false }),
  );
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return {
    object: mesh,
    update: (_dt, _time, camera) => {
      mesh.position.copy(camera.position);
    },
    dispose: () => disposeObject(mesh),
  };
}
