import * as THREE from 'three';
import { createLightPoints } from './lights.ts';
import type { ArtContext, ArtObject } from './types.ts';
import { byQuality, disposeObject } from './util.ts';

/** How a race gate shows (docs/PROCGEN.md §33.4): the next one bright, the one after dim, passed ones faint. */
export type GateLook = 'next' | 'after' | 'later' | 'passed';

export interface RaceGateArt extends ArtObject<THREE.Group> {
  setLook(look: GateLook): void;
}

const COLOR = { ring: '#7fe0ff', finish: '#ffe08a' } as const;
const OPACITY: Record<GateLook, number> = { next: 0.95, after: 0.55, later: 0.3, passed: 0.1 };

/** A race gate (fiction): a ring of light, its beacons, a double ring for the finish. Faces +Z (its way through). */
export function createRaceGate(radius: number, finish: boolean, ctx: ArtContext): RaceGateArt {
  const group = new THREE.Group();
  const color = finish ? COLOR.finish : COLOR.ring;
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: OPACITY.later, depthWrite: false, blending: THREE.AdditiveBlending });
  const tube = Math.max(2.5, radius * 0.025);
  const seg = byQuality(ctx.quality, 32, 48, 64);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, seg), material);
  group.add(ring);
  if (finish) group.add(new THREE.Mesh(new THREE.TorusGeometry(radius * 0.88, tube * 0.7, 6, seg), material));
  const beacons = createLightPoints(
    [0, 1, 2, 3].map((i) => ({ p: [Math.cos((i * Math.PI) / 2) * radius, Math.sin((i * Math.PI) / 2) * radius, 0] as [number, number, number], color, size: radius * 0.18, intensity: 1.4, blink: ctx.reducedMotion ? 0 : 0.8, phase: i / 4, duty: 0.6, min: 0.4 })),
    ctx,
    3,
  );
  group.add(beacons.points);
  let look: GateLook = 'later';
  const calm = ctx.reducedMotion;
  return {
    object: group,
    setLook(next) {
      look = next;
      beacons.points.visible = next !== 'passed';
    },
    update(_dt, time) {
      const pulse = look === 'next' && !calm ? 0.75 + 0.25 * Math.sin(time * 4) : 1;
      material.opacity = OPACITY[look] * pulse;
      beacons.uniforms.uTime.value = time;
      beacons.uniforms.uIntensity.value = look === 'next' ? 1.3 : 0.7;
    },
    dispose() {
      disposeObject(group);
      material.dispose();
    },
  };
}
