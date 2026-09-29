import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { disposeObject } from './util.ts';

export type ProjectileKind = 'player-pulse' | 'player-pulse-mk2' | 'enemy-pulse';

export interface ProjectileView {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  kind: ProjectileKind;
}

export interface ProjectileRenderer extends ArtObject {
  /** Draw exactly these projectiles this frame (called every frame after simulation). */
  render(list: readonly ProjectileView[]): void;
}

/** Instanced/pooled bolt renderer oriented along velocity. PLACEHOLDER implementation. */
export function createProjectileRenderer(maxCount: number, _ctx: ArtContext): ProjectileRenderer {
  const geometry = new THREE.BoxGeometry(0.4, 0.4, 6);
  const material = new THREE.MeshBasicMaterial({ color: 0x9fe8ff });
  const mesh = new THREE.InstancedMesh(geometry, material, maxCount);
  mesh.frustumCulled = false;
  mesh.count = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const dir = new THREE.Vector3();
  const back = new THREE.Vector3(0, 0, 1);
  return {
    object: mesh,
    render(list) {
      const n = Math.min(list.length, maxCount);
      for (let i = 0; i < n; i++) {
        const p = list[i]!;
        dir.copy(p.velocity).normalize();
        q.setFromUnitVectors(back, dir);
        m.compose(p.position, q, one);
        mesh.setMatrixAt(i, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose: () => disposeObject(mesh),
  };
}

export interface TransientEffect extends ArtObject {
  /** True once the effect has finished and can be removed and disposed. */
  readonly finished: boolean;
}

function fadingSphere(position: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, life: number): TransientEffect {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }),
  );
  mesh.position.copy(position);
  let age = 0;
  const effect: TransientEffect = {
    object: mesh,
    finished: false,
    update(dt) {
      age += dt;
      const t = age / life;
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
      mesh.scale.setScalar(1 + t * 2);
      if (t >= 1) (effect as { finished: boolean }).finished = true;
    },
    dispose: () => disposeObject(mesh),
  };
  return effect;
}

/** Ship explosion: flash, fireball, debris sparks, ~1.5 s. `scale` ~ ship radius. PLACEHOLDER. */
export function createExplosion(position: THREE.Vector3, scale: number, _ctx: ArtContext): TransientEffect {
  return fadingSphere(position, scale, 0xffa040, 1.2);
}

/** Small hit spark where a bolt strikes a shield or hull, ~0.3 s. PLACEHOLDER. */
export function createImpactSpark(
  position: THREE.Vector3,
  color: THREE.ColorRepresentation,
  _ctx: ArtContext,
): TransientEffect {
  return fadingSphere(position, 1.5, color, 0.3);
}

/** Missile body with exhaust; faces -Z. ~3 units long. PLACEHOLDER. */
export function createMissileArt(_ctx: ArtContext): ArtObject<THREE.Group> {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 3, 8),
    new THREE.MeshStandardMaterial({ color: 0xdddddd }),
  );
  body.rotation.x = Math.PI / 2;
  group.add(body);
  return { object: group, dispose: () => disposeObject(group) };
}

/** Floating loot container with a blinking beacon, ~3 units. PLACEHOLDER. */
export function createCargoPod(_ctx: ArtContext): ArtObject<THREE.Group> {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 2.5, 3.5),
    new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.5, roughness: 0.4 }),
  );
  group.add(box);
  return { object: group, dispose: () => disposeObject(group) };
}

export interface SpeedStreaksArt extends ArtObject {
  /** 0 = hidden, 1 = full trade-lane streaks. Add `object` as a child of the camera. */
  setIntensity(value: number): void;
}

/** Camera-attached motion streaks for cruise and lane travel. PLACEHOLDER (invisible). */
export function createSpeedStreaks(_ctx: ArtContext): SpeedStreaksArt {
  const group = new THREE.Group();
  return { object: group, setIntensity: () => {}, dispose: () => disposeObject(group) };
}

export interface JumpTunnelArt extends ArtObject {
  /** 0..1 progress through the jump transition. Add `object` as a child of the camera. */
  setProgress(value: number): void;
}

/** Camera-attached fictional jump tunnel effect. PLACEHOLDER (invisible). */
export function createJumpTunnel(_ctx: ArtContext): JumpTunnelArt {
  const group = new THREE.Group();
  return { object: group, setProgress: () => {}, dispose: () => disposeObject(group) };
}
