import * as THREE from 'three';
import type { DockSite, SystemScene } from './SystemScene.ts';

/**
 * Backdrop while docked (and on the title screen): the camera drifts slowly around the station
 * so the local star and planet stay visible behind the dock menus.
 */
export class DockedView {
  private readonly system: SystemScene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly center = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly basis = { a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
  private radius: number;
  private angle = 0;
  reducedMotion = false;

  constructor(system: SystemScene, camera: THREE.PerspectiveCamera, site: DockSite | null) {
    this.system = system;
    this.camera = camera;
    if (site) {
      this.center.copy(site.def.position);
      this.radius = site.radius * 3.2 + 200;
      this.lookAt.copy(site.def.position);
      this.basis.a.copy(site.approach);
    } else {
      // No dock (title screen fallback): orbit the arrival point.
      this.center.copy(system.def.arrival.position);
      this.lookAt.copy(system.def.arrival.lookAt);
      this.radius = 900;
      this.basis.a.copy(system.def.arrival.lookAt).sub(system.def.arrival.position).normalize().negate();
    }
    this.basis.b.crossVectors(this.basis.up, this.basis.a).normalize();
    this.angle = -0.6;
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.angle += dt * (this.reducedMotion ? 0.01 : 0.035);
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    this.camera.position
      .copy(this.center)
      .addScaledVector(this.basis.a, c * this.radius)
      .addScaledVector(this.basis.b, s * this.radius)
      .addScaledVector(this.basis.up, this.radius * 0.28);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld();
    this.system.update(dt, this.camera, this.center);
  }
}
