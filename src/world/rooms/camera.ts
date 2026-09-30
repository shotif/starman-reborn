import * as THREE from 'three';
import type { V3 } from '../art/kit.ts';
import type { RoomView } from './types.ts';

/**
 * Camera direction for the interiors: one composed shot per view (with a portrait variant),
 * blended by aspect ratio; a subject sphere that must stay in frame on narrow screens (the FOV
 * widens, then the camera pulls back); eased moves between hangar views with a small crane arc;
 * and a slow idle drift so the room feels alive.
 */

export interface Shot {
  pos: V3;
  target: V3;
  /** Vertical FOV in degrees. */
  fov: number;
}

export interface ViewShots {
  wide: Shot;
  tall: Shot;
  /** What must stay in frame horizontally (centre and radius). */
  subject: { center: V3; radius: number };
  /** Tighter subject for portrait screens (defaults to `subject`). */
  tallSubject?: { center: V3; radius: number };
  /** Farthest the camera may pull back along its view axis (multiple of the shot distance). */
  maxPull?: number;
  /** Drift amplitude multiplier (small rooms drift less). */
  drift?: number;
}

interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

export const MOVE_SECONDS = 1.2;
const MAX_FOV = 68;

const smoother = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

function blend(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly shots: Partial<Record<RoomView, ViewShots>>;
  private readonly reducedMotion: boolean;
  private width = 1280;
  private height = 720;
  private current: RoomView;
  private from: Pose | null = null;
  private progress = 1;
  private time = 0;
  private readonly pose: Pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45 };
  private readonly goal: Pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45 };
  private readonly tmp = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, shots: Partial<Record<RoomView, ViewShots>>, initial: RoomView, reducedMotion: boolean) {
    this.camera = camera;
    this.shots = shots;
    this.current = initial;
    this.reducedMotion = reducedMotion;
    this.apply();
  }

  get view(): RoomView {
    return this.current;
  }

  get moving(): boolean {
    return this.from !== null && this.progress < 1;
  }

  /** Jump (animate=false) or glide to a view. */
  go(view: RoomView, animate: boolean): void {
    if (animate) {
      this.from = { pos: this.pose.pos.clone(), target: this.pose.target.clone(), fov: this.pose.fov };
      this.progress = 0;
    } else {
      this.from = null;
      this.progress = 1;
    }
    this.current = view;
    this.apply();
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera.aspect = this.width / this.height;
    this.apply();
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  update(dt: number): void {
    this.time += dt;
    if (this.from) {
      this.progress = Math.min(1, this.progress + dt / MOVE_SECONDS);
      if (this.progress >= 1) this.from = null;
    }
    this.apply();
  }

  /** Composed pose for a view at the current aspect ratio (before drift). */
  shotPose(view: RoomView, out: Pose): Pose {
    const s = this.shots[view] ?? this.shots.deck!;
    const aspect = this.width / this.height;
    // t = 0: landscape framing, t = 1: portrait framing.
    const t = 1 - THREE.MathUtils.smoothstep(aspect, 0.62, 1.35);
    out.pos.set(blend(s.wide.pos[0], s.tall.pos[0], t), blend(s.wide.pos[1], s.tall.pos[1], t), blend(s.wide.pos[2], s.tall.pos[2], t));
    out.target.set(blend(s.wide.target[0], s.tall.target[0], t), blend(s.wide.target[1], s.tall.target[1], t), blend(s.wide.target[2], s.tall.target[2], t));
    let fov = blend(s.wide.fov, s.tall.fov, t);
    // Keep the subject inside the horizontal field: widen the FOV, then pull back.
    const dist = out.pos.distanceTo(out.target);
    const subj = t > 0.5 && s.tallSubject ? s.tallSubject : s.subject;
    const subject = this.tmp.set(...subj.center);
    const sd = Math.max(1, out.pos.distanceTo(subject));
    const need = (subj.radius * 1.08) / sd;
    const halfV = THREE.MathUtils.degToRad(fov / 2);
    if (Math.tan(halfV) * aspect < need) {
      const wantV = THREE.MathUtils.radToDeg(2 * Math.atan(need / aspect));
      fov = Math.min(MAX_FOV, Math.max(fov, wantV));
      const have = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect;
      if (have < need) {
        const pull = Math.min(s.maxPull ?? 1.35, need / have);
        const dir = this.tmp.copy(out.pos).sub(out.target).normalize();
        out.pos.copy(out.target).addScaledVector(dir, dist * pull);
      }
    }
    out.fov = fov;
    return out;
  }

  private apply(): void {
    const goal = this.shotPose(this.current, this.goal);
    const pose = this.pose;
    if (this.from && this.progress < 1) {
      const e = smoother(this.progress);
      pose.pos.lerpVectors(this.from.pos, goal.pos, e);
      pose.target.lerpVectors(this.from.target, goal.target, e);
      pose.fov = blend(this.from.fov, goal.fov, e);
      // Crane arc: rise a little mid-move.
      const span = this.from.pos.distanceTo(goal.pos);
      pose.pos.y += Math.sin(Math.PI * e) * Math.min(4, span * 0.12);
    } else {
      pose.pos.copy(goal.pos);
      pose.target.copy(goal.target);
      pose.fov = goal.fov;
    }
    // Idle drift, in the camera's own right/up axes.
    const s = this.shots[this.current] ?? this.shots.deck!;
    const dist = pose.pos.distanceTo(pose.target);
    const amp = dist * 0.0065 * (s.drift ?? 1) * (this.reducedMotion ? 0.12 : 1);
    const t = this.time;
    this.tmp.copy(pose.target).sub(pose.pos).normalize();
    this.right.crossVectors(this.tmp, THREE.Object3D.DEFAULT_UP).normalize();
    this.up.crossVectors(this.right, this.tmp).normalize();
    const dx = (Math.sin(t * 0.21) + 0.5 * Math.sin(t * 0.13 + 1.3)) * amp;
    const dy = (Math.sin(t * 0.17 + 0.7) + 0.4 * Math.sin(t * 0.29 + 2.2)) * amp * 0.55;
    const tx = Math.sin(t * 0.11 + 0.4) * amp * 0.35;
    const ty = Math.sin(t * 0.09 + 2.0) * amp * 0.2;
    const cam = this.camera;
    cam.position.copy(pose.pos).addScaledVector(this.right, dx).addScaledVector(this.up, dy);
    this.tmp.copy(pose.target).addScaledVector(this.right, tx).addScaledVector(this.up, ty);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.tmp);
    cam.fov = pose.fov;
    cam.aspect = this.width / this.height;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}
