import * as THREE from 'three';

/**
 * Arcade flight model: damped, frame-rate independent motion. Ships face -Z, +Y is up.
 * Every smoothing term uses 1 - exp(-rate * dt), so stepping 1 x 1/30 s ≈ 2 x 1/60 s.
 */
export interface ShipParams {
  /** Forward speed at full throttle, units/s. */
  maxSpeed: number;
  /** Speed at full reverse throttle (throttle -1 maps to -reverseSpeed). */
  reverseSpeed: number;
  /** Extra forward speed while boosting. */
  boostSpeed: number;
  strafeSpeed: number;
  cruiseSpeed: number;
  /** Seconds to spin up cruise. */
  cruiseChargeTime: number;
  /** Velocity response rate (1/s) in normal flight. */
  linearResponse: number;
  /** Velocity response rate (1/s) while cruising (gentler). */
  cruiseResponse: number;
  /** Max yaw/pitch rate, rad/s. */
  maxTurnRate: number;
  cruiseTurnRate: number;
  /** Angular velocity response rate (1/s). */
  angularResponse: number;
  /** Roll-levelling rate toward the scene's up axis. */
  autoLevelRate: number;
  energyMax: number;
  /** Energy regenerated per second when not boosting. */
  energyRegen: number;
  /** Energy per second consumed by boost. */
  boostDrain: number;
  /** Collision radius. */
  radius: number;
}

export const PLAYER_SHIP: ShipParams = {
  maxSpeed: 110,
  reverseSpeed: 35,
  boostSpeed: 95,
  strafeSpeed: 45,
  cruiseSpeed: 620,
  cruiseChargeTime: 1.8,
  linearResponse: 1.6,
  cruiseResponse: 0.8,
  maxTurnRate: 1.55,
  cruiseTurnRate: 0.55,
  angularResponse: 6,
  autoLevelRate: 1.4,
  energyMax: 100,
  energyRegen: 20,
  boostDrain: 28,
  radius: 8,
};

export const RAIDER_SHIP: ShipParams = {
  ...PLAYER_SHIP,
  maxSpeed: 120,
  boostSpeed: 90,
  maxTurnRate: 1.35,
  angularResponse: 4.5,
  radius: 7,
};

export interface ShipControls {
  /** Yaw command, -1..1 (+1 = turn right). */
  steerX: number;
  /** Pitch command, -1..1 (+1 = nose up). */
  steerY: number;
  /** Target throttle, -1..1 (negative = reverse). */
  throttle: number;
  /** Lateral thrust, -1..1 (+1 = right). */
  strafeX: number;
  /** Vertical thrust, -1..1 (+1 = up). */
  strafeY: number;
  boost: boolean;
  /** Engines off: keep drifting on current velocity (steering still works). */
  engineKill: boolean;
}

export function neutralControls(): ShipControls {
  return { steerX: 0, steerY: 0, throttle: 0, strafeX: 0, strafeY: 0, boost: false, engineKill: false };
}

export type CruiseState = 'off' | 'charging' | 'on';

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

function smooth(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class ShipBody {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  /** Local-space angular velocity: x = pitch, y = yaw, z = roll (rad/s). */
  readonly angularVelocity = new THREE.Vector3();
  params: ShipParams;
  throttle = 0;
  energy: number;
  boosting = false;
  cruise: CruiseState = 'off';
  cruiseCharge = 0;
  /** Set true for one step when boost starts (for sound/FX). */
  boostStarted = false;

  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly desiredVel = new THREE.Vector3();

  constructor(params: ShipParams) {
    this.params = params;
    this.energy = params.energyMax;
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(FORWARD).applyQuaternion(this.quaternion);
  }

  up(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(UP).applyQuaternion(this.quaternion);
  }

  right(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(RIGHT).applyQuaternion(this.quaternion);
  }

  get speed(): number {
    return this.velocity.length();
  }

  /** Forward component of velocity. */
  get forwardSpeed(): number {
    return this.velocity.dot(this.forward(this.tmpC));
  }

  requestCruise(on: boolean): void {
    if (on) {
      if (this.cruise === 'off') {
        this.cruise = 'charging';
        this.cruiseCharge = 0;
      }
    } else {
      this.cruise = 'off';
      this.cruiseCharge = 0;
    }
  }

  /** Aligns the ship's nose (-Z) with `direction`, using the scene up as reference. */
  lookAlong(direction: THREE.Vector3): void {
    lookRotation(direction, this.quaternion);
  }

  step(c: ShipControls, dt: number): void {
    if (dt <= 0) return;
    const p = this.params;
    this.boostStarted = false;

    // --- Cruise spin-up ---
    if (this.cruise === 'charging') {
      this.cruiseCharge += dt;
      if (this.cruiseCharge >= p.cruiseChargeTime) this.cruise = 'on';
    }
    const cruising = this.cruise === 'on';

    // --- Rotation ---
    const turnRate = cruising ? p.cruiseTurnRate : p.maxTurnRate;
    const right = this.right(this.tmpA);
    const up = this.up(this.tmpB);
    // Bank angle relative to the scene's up axis; roll to level it out.
    const bank = Math.atan2(right.y, up.y);
    const desiredPitch = clamp(c.steerY, -1, 1) * turnRate;
    const desiredYaw = -clamp(c.steerX, -1, 1) * turnRate;
    const desiredRoll = clamp(-bank * p.autoLevelRate, -2.5, 2.5);
    const a = smooth(p.angularResponse, dt);
    this.angularVelocity.x += (desiredPitch - this.angularVelocity.x) * a;
    this.angularVelocity.y += (desiredYaw - this.angularVelocity.y) * a;
    this.angularVelocity.z += (desiredRoll - this.angularVelocity.z) * smooth(p.angularResponse * 0.7, dt);
    const angle = this.angularVelocity.length() * dt;
    if (angle > 1e-9) {
      this.tmpC.copy(this.angularVelocity).normalize();
      this.tmpQ.setFromAxisAngle(this.tmpC, angle);
      this.quaternion.multiply(this.tmpQ).normalize();
    }

    // --- Energy and boost ---
    const wantsBoost = c.boost && !cruising && !c.engineKill;
    if (wantsBoost && this.energy > 0) {
      if (!this.boosting) this.boostStarted = true;
      this.boosting = true;
      this.energy = Math.max(0, this.energy - p.boostDrain * dt);
    } else {
      this.boosting = false;
      this.energy = Math.min(p.energyMax, this.energy + p.energyRegen * dt);
    }

    // --- Translation ---
    this.throttle = clamp(c.throttle, -1, 1);
    if (!c.engineKill) {
      const forward = this.forward(this.tmpC);
      const r = this.right(this.tmpA);
      const u = this.up(this.tmpB);
      let targetSpeed: number;
      if (cruising) targetSpeed = p.cruiseSpeed;
      else if (this.throttle >= 0) targetSpeed = this.throttle * p.maxSpeed;
      else targetSpeed = this.throttle * p.reverseSpeed;
      if (this.boosting) targetSpeed = Math.max(targetSpeed, 0) + p.boostSpeed;
      this.desiredVel
        .copy(forward)
        .multiplyScalar(targetSpeed)
        .addScaledVector(r, clamp(c.strafeX, -1, 1) * p.strafeSpeed)
        .addScaledVector(u, clamp(c.strafeY, -1, 1) * p.strafeSpeed);
      const k = smooth(cruising ? p.cruiseResponse : p.linearResponse, dt);
      this.velocity.lerp(this.desiredVel, k);
    }
    this.position.addScaledVector(this.velocity, dt);
  }
}

const ORIGIN = new THREE.Vector3();
const lookMatrix = new THREE.Matrix4();

/**
 * Orientation whose -Z axis points along `direction` (three.js Matrix4.lookAt points -Z from eye
 * toward target), with +Y as close to the scene up as possible.
 */
export function lookRotation(direction: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const up = Math.abs(direction.clone().normalize().y) > 0.999 ? RIGHT : UP;
  lookMatrix.lookAt(ORIGIN, direction, up);
  return out.setFromRotationMatrix(lookMatrix);
}

/** Runs `step` in bounded sub-steps so large frame deltas stay stable. */
export function stepBounded(dt: number, maxStep: number, step: (h: number) => void): void {
  let remaining = dt;
  while (remaining > 1e-6) {
    const h = Math.min(remaining, maxStep);
    step(h);
    remaining -= h;
  }
}
