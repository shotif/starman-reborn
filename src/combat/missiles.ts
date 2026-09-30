import * as THREE from 'three';
import type { ArtObject } from '../world/art/types.ts';
import { leadPoint } from './lead.ts';

export interface MissileTarget {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  alive: boolean;
}

export interface Missile {
  art: ArtObject<THREE.Group>;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  target: MissileTarget | null;
  ownerId: string;
  damage: number;
  life: number;
  alive: boolean;
  /** Cruise speed and turn rate (0 = unguided) of this round. */
  maxSpeed: number;
  turnRate: number;
}

export const MISSILE_LOCK_RANGE = 1700;
export const MISSILE_LOCK_CONE = THREE.MathUtils.degToRad(40);

const desired = new THREE.Vector3();
const leadTmp = new THREE.Vector3();
const zero = new THREE.Vector3();
const FORWARD = new THREE.Vector3(0, 0, -1);

/**
 * Advances a homing missile: turn-rate-limited pursuit of the target's lead point, acceleration to
 * cruise speed, proximity fuse. Returns 'hit', 'expired' or null (still flying).
 */
export function updateMissile(
  m: Missile,
  dt: number,
  maxSpeed: number,
  turnRate: number,
): 'hit' | 'expired' | null {
  m.life -= dt;
  if (m.life <= 0) return 'expired';
  m.speed = Math.min(maxSpeed, m.speed + 320 * dt);
  const t = m.target;
  if (t && t.alive) {
    leadPoint(m.position, zero, t.position, t.velocity, Math.max(m.speed, 1), leadTmp);
    desired.copy(leadTmp).sub(m.position);
    const dist = desired.length();
    if (dist < t.radius + 5) return 'hit';
    desired.divideScalar(dist || 1);
    const angle = Math.acos(THREE.MathUtils.clamp(m.direction.dot(desired), -1, 1));
    const maxTurn = turnRate * dt;
    if (angle > 1e-5) {
      const f = Math.min(1, maxTurn / angle);
      m.direction.lerp(desired, f).normalize();
    }
  }
  m.position.addScaledVector(m.direction, m.speed * dt);
  if (t && t.alive && m.position.distanceTo(t.position) < t.radius + 5) return 'hit';
  m.art.object.position.copy(m.position);
  m.art.object.quaternion.setFromUnitVectors(FORWARD, m.direction);
  return null;
}
