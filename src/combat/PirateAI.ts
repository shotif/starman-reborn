import * as THREE from 'three';
import { aimErrors, flyTo, steerToward } from '../flight/autopilot.ts';
import type { ShipBody, ShipControls } from '../flight/ShipBody.ts';
import type { Durability } from './damage.ts';
import { leadPoint } from './lead.ts';

export type AiState = 'intro' | 'approach' | 'attack' | 'breakoff' | 'evade' | 'flee' | 'escaped';

export interface AiTuning {
  /** 0..1: how tightly shots track the lead point. */
  accuracy: number;
  projectileSpeed: number;
  gunRange: number;
  /** The chance of a jink when the shield collapses (a raider's `RAIDER_EVADE`; a wingman's by grade, docs/PROCGEN.md §34). */
  evade?: number;
}

/** A raider's chance to jink when its shield collapses. */
export const RAIDER_EVADE = 0.8;

export interface AiOutput {
  fire: boolean;
  aimPoint: THREE.Vector3;
}

/**
 * A single raider's behaviour: approach, strafing attack runs with lead aiming and imperfect
 * accuracy, break-offs so it doesn't ram, evasive jinks when its shield collapses, and
 * disengagement (flee) when badly damaged.
 */
export class PirateBrain {
  state: AiState = 'intro';
  private timer = 0;
  private attackTime = 0;
  private jitterTimer = 0;
  private readonly jitter = new THREE.Vector3();
  private readonly breakDir = new THREE.Vector3();
  private readonly waypoint = new THREE.Vector3();
  private readonly lead = new THREE.Vector3();
  private readonly out: AiOutput = { fire: false, aimPoint: new THREE.Vector3() };
  private readonly rand: () => number;
  private lastShield = Infinity;

  constructor(rand: () => number) {
    this.rand = rand;
  }

  private setState(s: AiState): void {
    this.state = s;
    this.timer = 0;
  }

  update(
    dt: number,
    self: ShipBody,
    selfDurability: Durability,
    target: ShipBody,
    tuning: AiTuning,
    controls: ShipControls,
  ): AiOutput {
    this.timer += dt;
    this.jitterTimer -= dt;
    const out = this.out;
    out.fire = false;
    controls.boost = false;
    controls.strafeX = 0;
    controls.strafeY = 0;
    controls.engineKill = false;
    const dist = self.position.distanceTo(target.position);

    // Disengage when badly hurt.
    if (this.state !== 'flee' && this.state !== 'escaped' && selfDurability.hull / selfDurability.hullMax < 0.22) {
      this.setState('flee');
    }
    // Shield just collapsed: jink.
    if (
      (this.state === 'attack' || this.state === 'approach') &&
      this.lastShield > 0 &&
      selfDurability.shield <= 0 &&
      this.rand() < (tuning.evade ?? RAIDER_EVADE)
    ) {
      this.setState('evade');
      this.breakDir.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalize();
    }
    this.lastShield = selfDurability.shield;

    leadPoint(self.position, self.velocity, target.position, target.velocity, tuning.projectileSpeed, this.lead);
    if (this.jitterTimer <= 0) {
      this.jitterTimer = 0.35;
      const spread = (1 - tuning.accuracy) * 0.1 + 0.006;
      this.jitter.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(2 * spread);
    }
    out.aimPoint.copy(this.lead).addScaledVector(this.jitter, dist);

    switch (this.state) {
      case 'intro': {
        flyTo(self, target.position, { arriveDistance: 700, allowCruise: false, maxThrottle: 0.6 }, controls);
        if (this.timer > 1.8) this.setState('approach');
        break;
      }
      case 'approach': {
        flyTo(self, this.lead, { arriveDistance: 0, allowCruise: false }, controls);
        controls.throttle = 1;
        controls.boost = dist > 1600 && self.energy > 35;
        if (dist < 950) {
          this.setState('attack');
          this.attackTime = 0;
        }
        break;
      }
      case 'attack': {
        this.attackTime += dt;
        const angle = steerToward(self, out.aimPoint, controls, 2.6);
        controls.throttle = dist > 500 ? 0.85 : 0.55;
        // Slight sideways drift makes the raider harder to track.
        controls.strafeX = Math.sin(this.attackTime * 1.3) * 0.5;
        // Fires in bursts (1.6 s on, 0.7 s off) so the player gets windows to react.
        const burstOn = this.attackTime % 2.3 < 1.6;
        out.fire = burstOn && angle < 0.14 && dist < tuning.gunRange * 0.92;
        if (dist < 170 || this.attackTime > 10) {
          this.setState('breakoff');
          const fwd = self.forward(new THREE.Vector3());
          this.breakDir.set(this.rand() - 0.5, this.rand() - 0.2, this.rand() - 0.5).normalize().add(fwd).normalize();
        } else if (dist > 1400) {
          this.setState('approach');
        }
        break;
      }
      case 'breakoff': {
        this.waypoint.copy(self.position).addScaledVector(this.breakDir, 900);
        steerToward(self, this.waypoint, controls);
        controls.throttle = 1;
        controls.boost = self.energy > 25;
        if (this.timer > 2.4) this.setState('approach');
        break;
      }
      case 'evade': {
        this.waypoint.copy(self.position).addScaledVector(this.breakDir, 500);
        steerToward(self, this.waypoint, controls);
        controls.throttle = 1;
        controls.strafeX = Math.sin(this.timer * 7) > 0 ? 1 : -1;
        controls.boost = self.energy > 30;
        if (this.timer > 1.6) this.setState('approach');
        break;
      }
      case 'flee': {
        this.waypoint.copy(self.position).multiplyScalar(2).sub(target.position);
        steerToward(self, this.waypoint, controls);
        controls.throttle = 1;
        controls.boost = self.energy > 5;
        const facingAway = aimErrors(self, target.position).angle > 2.2;
        // Parting shots are rare; mostly it runs.
        out.fire = !facingAway && dist < 600 && this.rand() < 0.02;
        if (dist > 3200) this.setState('escaped');
        break;
      }
      case 'escaped':
        controls.throttle = 1;
        controls.boost = true;
        break;
    }
    return out;
  }
}
