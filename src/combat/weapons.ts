import * as THREE from 'three';
import type { DamageType } from '../content/types.ts';
import type { ProjectileKind, ProjectileView } from '../world/art/effects.ts';
import type { ShipBody } from '../flight/ShipBody.ts';
import { clampToCone } from './lead.ts';

export interface Projectile extends ProjectileView {
  ownerId: string;
  damage: number;
  damageType: DamageType;
  /** Seconds left before the bolt fizzles (range / speed). */
  life: number;
}

/** Half-angle (radians) of the cone the guns can swivel through around the ship's nose. */
export const GUN_ARC = THREE.MathUtils.degToRad(32);

export interface GunProfile {
  damage: number;
  shotsPerSecond: number;
  projectileSpeed: number;
  range: number;
  energyPerShot: number;
  kind: ProjectileKind;
  damageType: DamageType;
}

const tmpMuzzle = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpFwd = new THREE.Vector3();

/** Simple fixed-capacity projectile store with swap-remove. */
export class ProjectileSystem {
  readonly list: Projectile[] = [];
  private readonly pool: Projectile[] = [];
  readonly capacity: number;

  constructor(capacity = 256) {
    this.capacity = capacity;
  }

  spawn(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    kind: ProjectileKind,
    ownerId: string,
    damage: number,
    life: number,
    damageType: DamageType = 'energy',
  ): void {
    if (this.list.length >= this.capacity) return;
    const p = this.pool.pop() ?? {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      kind,
      ownerId,
      damage,
      damageType,
      life,
    };
    p.position.copy(position);
    p.velocity.copy(velocity);
    p.kind = kind;
    p.ownerId = ownerId;
    p.damage = damage;
    p.damageType = damageType;
    p.life = life;
    this.list.push(p);
  }

  /**
   * Advances every bolt and asks `hit` whether the swept segment struck something.
   * `hit` returns true to consume the bolt.
   */
  update(dt: number, hit: (p: Projectile, from: THREE.Vector3, to: THREE.Vector3) => boolean): void {
    const from = tmpMuzzle;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      from.copy(p.position);
      p.position.addScaledVector(p.velocity, dt);
      p.life -= dt;
      if (p.life <= 0 || hit(p, from, p.position)) {
        const last = this.list.pop()!;
        if (i < this.list.length) this.list[i] = last;
        this.pool.push(p);
      }
    }
  }

  clear(): void {
    this.pool.push(...this.list);
    this.list.length = 0;
  }
}

/** Closest-approach test between a segment and a sphere. */
export function segmentHitsSphere(p0: THREE.Vector3, p1: THREE.Vector3, center: THREE.Vector3, radius: number): boolean {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dz = p1.z - p0.z;
  const fx = p0.x - center.x;
  const fy = p0.y - center.y;
  const fz = p0.z - center.z;
  const dd = dx * dx + dy * dy + dz * dz;
  let t = dd > 0 ? -(fx * dx + fy * dy + fz * dz) / dd : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = fx + dx * t;
  const cy = fy + dy * t;
  const cz = fz + dz * t;
  return cx * cx + cy * cy + cz * cz <= radius * radius;
}

export class Gun {
  profile: GunProfile;
  private cooldown = 0;
  private nextMuzzle = 0;

  constructor(profile: GunProfile) {
    this.profile = profile;
  }

  tick(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  /** Delays the first shot, so several guns on one ship fire in turn rather than together. */
  stagger(seconds: number): void {
    this.cooldown = Math.max(this.cooldown, seconds);
  }

  get ready(): boolean {
    return this.cooldown <= 0;
  }

  /**
   * Fires one bolt toward `aimPoint` (world), alternating between muzzles. The bolt's direction is
   * clamped to the gun arc around the ship's nose and inherits the ship's velocity. Returns whether
   * a shot fired and whether the aim point was outside the arc.
   */
  fire(
    ship: ShipBody,
    muzzles: readonly THREE.Vector3[],
    aimPoint: THREE.Vector3,
    projectiles: ProjectileSystem,
    ownerId: string,
    damageScale = 1,
  ): { fired: boolean; clamped: boolean } {
    if (this.cooldown > 0) return { fired: false, clamped: false };
    if (ship.energy < this.profile.energyPerShot) return { fired: false, clamped: false };
    ship.energy -= this.profile.energyPerShot;
    this.cooldown = 1 / this.profile.shotsPerSecond;
    const forward = ship.forward(tmpFwd);
    let clamped = false;
    const life = this.profile.range / this.profile.projectileSpeed;
    const m = muzzles.length ? muzzles[this.nextMuzzle++ % muzzles.length]! : null;
    if (m) {
      tmpMuzzle.copy(m).applyQuaternion(ship.quaternion).add(ship.position);
      tmpDir.copy(aimPoint).sub(tmpMuzzle);
      if (tmpDir.lengthSq() < 1e-6) tmpDir.copy(forward);
      tmpDir.normalize();
      if (clampToCone(tmpDir, forward, GUN_ARC)) clamped = true;
      const velocity = tmpDir.multiplyScalar(this.profile.projectileSpeed).add(ship.velocity);
      projectiles.spawn(tmpMuzzle, velocity, this.profile.kind, ownerId, this.profile.damage * damageScale, life, this.profile.damageType);
    }
    return { fired: true, clamped };
  }
}

/** True when `point` lies within the gun arc around the ship's nose. */
export function withinArc(ship: ShipBody, point: THREE.Vector3): boolean {
  tmpDir.copy(point).sub(ship.position).normalize();
  return tmpDir.dot(ship.forward(tmpFwd)) >= Math.cos(GUN_ARC);
}
