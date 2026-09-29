import * as THREE from 'three';
import type { ShipBody } from './ShipBody.ts';

/**
 * Third-person chase camera. The camera's orientation lags the ship's (slerp), while its position
 * is derived from that lagged orientation, so the ship stays framed at any speed (no positional
 * rubber-banding in cruise or lanes). Shake and speed FOV respect reduced-motion settings.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Offset from the ship in camera-orientation space (behind and slightly above). */
  offset = new THREE.Vector3(0, 4.6, 25);
  /** Vertical field of view (degrees) on landscape screens. */
  baseFov = 62;
  /** Portrait screens widen the vertical FOV to keep at least this much across (degrees)... */
  minHorizontalFov = 60;
  /** ...up to this vertical limit, before the speed boost. */
  maxFov = 88;
  shakeEnabled = true;
  reducedMotion = false;

  private readonly orientation = new THREE.Quaternion();
  private shake = 0;
  private shakeTime = 0;
  private fovBoost = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Snap to the ship without smoothing (after spawn, jump or dock). */
  snap(ship: ShipBody): void {
    this.orientation.copy(ship.quaternion);
    this.place(ship, 0);
  }

  addShake(amount: number): void {
    if (!this.shakeEnabled || this.reducedMotion) return;
    this.shake = Math.min(1.5, this.shake + amount);
  }

  update(ship: ShipBody, dt: number, speedFraction: number): void {
    const followRate = 7;
    this.orientation.slerp(ship.quaternion, 1 - Math.exp(-followRate * dt));
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.shakeTime += dt;
    const targetFov = this.reducedMotion ? 0 : Math.min(1, speedFraction) * 10;
    this.fovBoost += (targetFov - this.fovBoost) * (1 - Math.exp(-3 * dt));
    this.place(ship, this.shake);
  }

  private place(ship: ShipBody, shake: number): void {
    const cam = this.camera;
    this.tmp.copy(this.offset).applyQuaternion(this.orientation);
    cam.position.copy(ship.position).add(this.tmp);
    // Look slightly ahead of the ship so the horizon and reticle sit comfortably.
    this.tmp2.set(0, 1.2, -40).applyQuaternion(this.orientation).add(ship.position);
    cam.up.set(0, 1, 0).applyQuaternion(this.orientation);
    cam.lookAt(this.tmp2);
    if (shake > 0) {
      const t = this.shakeTime * 40;
      const s = shake * 0.012;
      this.tmpQ.setFromEuler(new THREE.Euler(Math.sin(t * 1.3) * s, Math.cos(t * 1.7) * s, Math.sin(t * 2.1) * s * 0.6));
      cam.quaternion.multiply(this.tmpQ);
    }
    const fov = this.fitFov() + this.fovBoost;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Vertical FOV for the current aspect ratio (wider on tall screens, so the ship fits). */
  fitFov(): number {
    const halfH = THREE.MathUtils.degToRad(this.minHorizontalFov) / 2;
    const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfH) / Math.max(0.1, this.camera.aspect)));
    return Math.min(this.maxFov, Math.max(this.baseFov, needed));
  }
}
