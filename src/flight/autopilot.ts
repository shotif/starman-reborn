import * as THREE from 'three';
import type { ShipBody, ShipControls } from './ShipBody.ts';

const tmpLocal = new THREE.Vector3();
const tmpInv = new THREE.Quaternion();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Angle errors (radians) from the ship's nose to a world point: yaw (+ right) and pitch (+ up). */
export function aimErrors(ship: ShipBody, point: THREE.Vector3): { yaw: number; pitch: number; angle: number; distance: number } {
  tmpLocal.copy(point).sub(ship.position);
  const distance = tmpLocal.length();
  tmpInv.copy(ship.quaternion).invert();
  tmpLocal.applyQuaternion(tmpInv);
  const yaw = Math.atan2(tmpLocal.x, -tmpLocal.z);
  const pitch = Math.atan2(tmpLocal.y, Math.hypot(tmpLocal.x, tmpLocal.z));
  const angle = distance > 1e-6 ? Math.acos(clamp(-tmpLocal.z / distance, -1, 1)) : 0;
  return { yaw, pitch, angle, distance };
}

/** Writes steering commands that turn the nose toward `point`. Returns the remaining angle. */
export function steerToward(ship: ShipBody, point: THREE.Vector3, out: ShipControls, gain = 2.2): number {
  const e = aimErrors(ship, point);
  out.steerX = clamp(e.yaw * gain, -1, 1);
  out.steerY = clamp(e.pitch * gain, -1, 1);
  return e.angle;
}

export interface GoToOptions {
  /** Stop this far from the point. */
  arriveDistance: number;
  /** Use cruise when far and aligned. */
  allowCruise: boolean;
  maxThrottle?: number;
}

export interface GoToStatus {
  distance: number;
  arrived: boolean;
  wantsCruise: boolean;
}

/**
 * Point-to-point autopilot: turns toward the target, uses cruise on long legs, drops out of cruise
 * early enough not to overshoot and eases off the throttle while arriving.
 */
export function flyTo(ship: ShipBody, point: THREE.Vector3, opts: GoToOptions, out: ShipControls): GoToStatus {
  const angle = steerToward(ship, point, out);
  const distance = ship.position.distanceTo(point) - opts.arriveDistance;
  out.strafeX = 0;
  out.strafeY = 0;
  out.boost = false;
  out.engineKill = false;
  const maxThrottle = opts.maxThrottle ?? 1;
  const alignFactor = angle < 0.35 ? 1 : angle < 1.2 ? 0.45 : 0.2;
  // Proportional approach with a small creep so the ship actually reaches the point.
  out.throttle = clamp((distance / 500) * alignFactor, distance > 5 ? 0.08 : 0, maxThrottle);
  // Cruise decelerates with rate ~0.8/s, so leave cruise ~1.2 cruise-seconds before arrival.
  const cruiseExit = ship.params.cruiseSpeed * 1.25 + 400;
  const wantsCruise = opts.allowCruise && distance > cruiseExit && angle < 0.12;
  const keepCruise = opts.allowCruise && ship.cruise !== 'off' && distance > cruiseExit && angle < 0.5;
  return { distance, arrived: distance <= 30 && ship.speed < 40, wantsCruise: wantsCruise || keepCruise };
}

/** A sphere the autopilot must not fly through (a planet, a station, a star's photosphere). */
export interface Obstacle {
  id: string;
  center: THREE.Vector3;
  radius: number;
}

const tmpDir = new THREE.Vector3();
const tmpRel = new THREE.Vector3();
const tmpClosest = new THREE.Vector3();

/**
 * Where to steer so the straight path does not cross an obstacle: `goal` itself when the way is
 * clear, otherwise a point beside the nearest blocking sphere (on the side the path already
 * passes). Re-evaluated every step, so the ship rounds the obstacle and then heads for the goal.
 */
export function avoidObstacles(
  from: THREE.Vector3,
  goal: THREE.Vector3,
  obstacles: readonly Obstacle[],
  margin: number,
  out: THREE.Vector3,
): { point: THREE.Vector3; detour: boolean } {
  tmpDir.copy(goal).sub(from);
  const length = tmpDir.length();
  if (length < 1e-6) return { point: out.copy(goal), detour: false };
  tmpDir.divideScalar(length);
  let best: Obstacle | null = null;
  let bestT = Infinity;
  for (const o of obstacles) {
    tmpRel.copy(o.center).sub(from);
    const t = tmpRel.dot(tmpDir);
    if (t <= 0 || t >= length) continue;
    const miss = tmpRel.addScaledVector(tmpDir, -t).length();
    if (miss < o.radius + margin && t < bestT) {
      best = o;
      bestT = t;
    }
  }
  if (!best) return { point: out.copy(goal), detour: false };
  tmpClosest.copy(from).addScaledVector(tmpDir, bestT).sub(best.center);
  if (tmpClosest.lengthSq() < 1e-6) {
    // Dead centre: go over the top (or sideways when flying straight up or down).
    tmpClosest.set(0, 1, 0).addScaledVector(tmpDir, -tmpDir.y);
    if (tmpClosest.lengthSq() < 1e-6) tmpClosest.set(1, 0, 0);
  }
  tmpClosest.normalize();
  return { point: out.copy(best.center).addScaledVector(tmpClosest, (best.radius + margin) * 1.2), detour: true };
}
