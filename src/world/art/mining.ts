import * as THREE from 'three';
import { rockMaterial } from './materials.ts';
import { rockGeometry } from './rocks.ts';
import type { ArtContext, ArtObject } from './types.ts';
import { byQuality, disposeObject } from './util.ts';

/**
 * Mining art (docs/PROCGEN.md §19): the larger rocks a mining laser can cut, tinted by what they
 * mostly hold, and the beam itself. Original and procedural, like the rest of the art.
 */

/** How a rock looks: a tint and a share of pale icy faces. */
export interface RockLook {
  color: THREE.ColorRepresentation;
  ice: number;
}

export interface MinableRockArt extends ArtObject<THREE.Group> {
  /** A spent rock shrinks and darkens until it regrows. */
  setSpent(spent: boolean): void;
}

/** A minable rock of `radius` metres, slowly turning. */
export function createMinableRock(seed: number, radius: number, look: RockLook, ctx: ArtContext): MinableRockArt {
  const geo = rockGeometry(seed, { detail: byQuality(ctx.quality, 1, 2, 2), rough: 0.34, craters: 5, ice: look.ice, color: look.color, stretch: [1.15, 0.85, 1] });
  const mesh = new THREE.Mesh(geo, rockMaterial());
  mesh.scale.setScalar(radius);
  mesh.name = 'minable-rock';
  const group = new THREE.Group();
  group.add(mesh);
  const spin = new THREE.Vector3(((seed % 7) - 3) * 0.004, 0.01 + (seed % 5) * 0.003, ((seed % 3) - 1) * 0.005);
  if (ctx.reducedMotion) spin.multiplyScalar(0.5);
  return {
    object: group,
    setSpent(spent) {
      mesh.scale.setScalar(radius * (spent ? 0.55 : 1));
    },
    update(dt) {
      mesh.rotation.x += spin.x * dt;
      mesh.rotation.y += spin.y * dt;
      mesh.rotation.z += spin.z * dt;
    },
    dispose: () => disposeObject(group),
  };
}

export interface MiningBeamArt extends ArtObject<THREE.Group> {
  /** Shows the beam between two world points, or hides it (null). */
  set(from: THREE.Vector3 | null, to?: THREE.Vector3): void;
}

/** The mining laser: a hot core inside a softer glow, flickering a little as it cuts. */
export function createMiningBeam(ctx: ArtContext): MiningBeamArt {
  const group = new THREE.Group();
  group.name = 'mining-beam';
  // A unit cylinder along +Y from 0 to 1, scaled to the beam's length each frame.
  const geo = new THREE.CylinderGeometry(1, 1, 1, byQuality(ctx.quality, 6, 8, 10), 1, true);
  geo.translate(0, 0.5, 0);
  const mat = (color: string, opacity: number) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(geo, mat('#ff9a3c', 0.28));
  const core = new THREE.Mesh(geo, mat('#fff1c8', 0.9));
  glow.renderOrder = core.renderOrder = 9;
  glow.frustumCulled = core.frustumCulled = false;
  group.add(glow, core);
  group.visible = false;
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  let flicker = 0;
  return {
    object: group,
    set(from, to) {
      if (!from || !to) {
        group.visible = false;
        return;
      }
      dir.copy(to).sub(from);
      const length = dir.length();
      if (length < 1e-3) {
        group.visible = false;
        return;
      }
      group.visible = true;
      group.position.copy(from);
      group.quaternion.setFromUnitVectors(up, dir.divideScalar(length));
      const pulse = ctx.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(flicker * 37);
      glow.scale.set(2.6 * pulse, length, 2.6 * pulse);
      core.scale.set(0.7, length, 0.7);
    },
    update(dt) {
      flicker += dt;
    },
    dispose: () => {
      geo.dispose();
      (glow.material as THREE.Material).dispose();
      (core.material as THREE.Material).dispose();
      group.clear();
    },
  };
}
