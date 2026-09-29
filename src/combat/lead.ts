import * as THREE from 'three';

/**
 * Smallest positive time t at which a projectile fired from the origin at `speed` (in the shooter's
 * frame) meets a target at relative position r moving with relative velocity v:
 * |r + v t| = speed * t. Returns null when no interception is possible.
 */
export function interceptTime(r: THREE.Vector3, v: THREE.Vector3, speed: number): number | null {
  const a = v.dot(v) - speed * speed;
  const b = 2 * r.dot(v);
  const c = r.dot(r);
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) return null;
    const t = -c / b;
    return t > 0 ? t : null;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  if (lo > 0) return lo;
  if (hi > 0) return hi;
  return null;
}

const rel = new THREE.Vector3();
const relV = new THREE.Vector3();

/**
 * World-space point to aim at so a projectile inheriting the shooter's velocity hits the target.
 * Falls back to the target's current position when no solution exists. Returns flight time.
 */
export function leadPoint(
  shooterPos: THREE.Vector3,
  shooterVel: THREE.Vector3,
  targetPos: THREE.Vector3,
  targetVel: THREE.Vector3,
  projectileSpeed: number,
  out: THREE.Vector3,
): number | null {
  rel.copy(targetPos).sub(shooterPos);
  relV.copy(targetVel).sub(shooterVel);
  const t = interceptTime(rel, relV, projectileSpeed);
  if (t === null) {
    out.copy(targetPos);
    return null;
  }
  out.copy(targetPos).addScaledVector(relV, t);
  return t;
}

/**
 * Rotates unit vector `dir` toward unit vector `axis` so the angle between them is at most
 * `maxAngle` (radians). Returns true when clamping was needed.
 */
export function clampToCone(dir: THREE.Vector3, axis: THREE.Vector3, maxAngle: number): boolean {
  const cos = THREE.MathUtils.clamp(dir.dot(axis), -1, 1);
  const angle = Math.acos(cos);
  if (angle <= maxAngle) return false;
  // Component of dir perpendicular to axis.
  const perp = rel.copy(dir).addScaledVector(axis, -cos);
  if (perp.lengthSq() < 1e-12) perp.set(axis.y, -axis.x, 0.3).cross(axis);
  perp.normalize();
  dir.copy(axis).multiplyScalar(Math.cos(maxAngle)).addScaledVector(perp, Math.sin(maxAngle)).normalize();
  return true;
}
