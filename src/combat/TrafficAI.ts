import * as THREE from 'three';
import { avoidObstacles, flyTo, type Obstacle } from '../flight/autopilot.ts';
import type { ShipBody, ShipControls } from '../flight/ShipBody.ts';
import type { Durability } from './damage.ts';

/**
 * Behaviour of peaceful traffic (docs/PROCGEN.md §9). Traders fly from one station to another
 * around planets and stations, and run for the nearest station when shot at. Patrols fly a loop
 * of waypoints; FlightSession hands them a raider to fight when one comes near (PirateBrain does
 * the fighting).
 */

export type TraderState = 'travel' | 'flee' | 'arrived';

const AVOID = 600;

export class TraderBrain {
  state: TraderState = 'travel';
  /** Set when it first takes damage (FlightSession raises the mayday). */
  attacked = false;
  private readonly way = new THREE.Vector3();
  private lastHull: number;
  private lastShield: number;
  destination: { id: string; point: THREE.Vector3 };

  constructor(destination: { id: string; point: THREE.Vector3 }, durability: Durability) {
    this.destination = destination;
    this.lastHull = durability.hull;
    this.lastShield = durability.shield;
  }

  /** Steers toward the destination (or the nearest haven once attacked); returns whether to cruise. */
  update(self: ShipBody, durability: Durability, controls: ShipControls, obstacles: readonly Obstacle[], haven: () => { id: string; point: THREE.Vector3 } | null): boolean {
    controls.strafeX = 0;
    controls.strafeY = 0;
    controls.engineKill = false;
    controls.boost = false;
    const hit = durability.hull < this.lastHull - 0.01 || durability.shield < this.lastShield - 0.01;
    this.lastHull = durability.hull;
    this.lastShield = durability.shield;
    if (hit && this.state === 'travel') {
      this.attacked = true;
      this.state = 'flee';
      const safe = haven();
      if (safe) this.destination = safe;
    }
    if (this.state === 'arrived') {
      controls.throttle = 0;
      return false;
    }
    const w = avoidObstacles(self.position, this.destination.point, obstacles, AVOID, this.way, `station:${this.destination.id}`);
    const st = flyTo(self, w.point, { arriveDistance: w.detour ? 0 : 150, allowCruise: true, maxThrottle: this.state === 'flee' ? 1 : 0.85 }, controls);
    if (this.state === 'flee') controls.boost = self.energy > 10;
    if (!w.detour && self.position.distanceTo(this.destination.point) < 380) this.state = 'arrived';
    return st.wantsCruise && !hit;
  }
}

export type PatrolState = 'patrol' | 'engage';

export class PatrolBrain {
  state: PatrolState = 'patrol';
  private index: number;
  private readonly way = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private readonly waypoints: readonly THREE.Vector3[];

  constructor(waypoints: readonly THREE.Vector3[], start: number) {
    this.waypoints = waypoints;
    this.index = start % Math.max(1, waypoints.length);
  }

  /** Flies the loop; returns whether to cruise. */
  update(self: ShipBody, controls: ShipControls, obstacles: readonly Obstacle[], offset: THREE.Vector3): boolean {
    controls.strafeX = 0;
    controls.strafeY = 0;
    controls.engineKill = false;
    controls.boost = false;
    const goal = this.waypoints[this.index];
    if (!goal) {
      controls.throttle = 0;
      return false;
    }
    // Wingmen fly a little off the leader's line.
    const point = this.goal.copy(goal).add(offset);
    const w = avoidObstacles(self.position, point, obstacles, AVOID, this.way);
    const st = flyTo(self, w.point, { arriveDistance: w.detour ? 0 : 900, allowCruise: true, maxThrottle: 0.8 }, controls);
    if (!w.detour && st.distance < 200) this.index = (this.index + 1) % this.waypoints.length;
    return st.wantsCruise;
  }
}
