/**
 * Small orbit controller for the neighborhood map (OrbitControls is deliberately not used).
 * State stays in double-precision numbers; the renderer only receives camera-relative offsets.
 * Direct manipulation (drag, pinch, wheel, keys) applies immediately; focus/reset moves animate
 * unless reduced motion is on, in which case they snap.
 */
import {
  ORBIT_LIMITS,
  approachOrbit,
  clampOrbit,
  cloneOrbit,
  copyOrbit,
  orbitCameraPosition,
  panOrbit,
  rotateOrbit,
  smoothingFactor,
  zoomOrbit,
  zoomOrbitAt,
  type OrbitLimits,
  type OrbitState,
  type Vec3,
} from './mapMath.ts';

/** Radians of rotation per CSS pixel dragged. */
export const ROTATE_PER_PIXEL = 0.0065;
/** Radians per arrow-key press. */
export const KEY_ROTATE_STEP = 0.14;
/** Distance multiplier per +/- key press (zoom in uses the inverse). */
export const KEY_ZOOM_STEP = 1.25;

export class OrbitController {
  readonly current: OrbitState;
  readonly goal: OrbitState;
  readonly limits: OrbitLimits;
  reducedMotion = false;
  /** Incremented whenever `current` changes, so callers can skip work while the view is idle. */
  version = 0;
  private animating = false;
  private halfLife = 0.12;

  constructor(initial: OrbitState, limits: OrbitLimits = ORBIT_LIMITS) {
    this.limits = limits;
    this.current = cloneOrbit(initial);
    clampOrbit(this.current, limits);
    this.goal = cloneOrbit(this.current);
  }

  get isAnimating(): boolean {
    return this.animating;
  }

  /** Cancels a running transition so direct manipulation starts from what is on screen. */
  private beginDirect(): void {
    if (this.animating) {
      copyOrbit(this.goal, this.current);
      this.animating = false;
    }
  }

  private endDirect(): void {
    copyOrbit(this.goal, this.current);
    this.version++;
  }

  /** Drag rotation: dx/dy in CSS pixels (drag right turns the scene right, drag down tilts). */
  rotateByPixels(dx: number, dy: number): void {
    this.rotate(-dx * ROTATE_PER_PIXEL, dy * ROTATE_PER_PIXEL);
  }

  rotate(dYaw: number, dPitch: number): void {
    this.beginDirect();
    rotateOrbit(this.current, dYaw, dPitch, this.limits);
    this.endDirect();
  }

  /** factor < 1 zooms in. */
  zoom(factor: number): void {
    this.beginDirect();
    zoomOrbit(this.current, factor, this.limits);
    this.endDirect();
  }

  /**
   * Zoom toward a point on screen (CSS px from the projection centre): what is under it stays
   * there. `animate` eases there (a double tap) instead of moving at once (a pinch or the wheel).
   */
  zoomAt(factor: number, dxPx: number, dyPx: number, viewportHeightPx: number, fovDeg: number, animate = false): void {
    if (animate) {
      const goal = cloneOrbit(this.current);
      zoomOrbitAt(goal, factor, dxPx, dyPx, viewportHeightPx, fovDeg, this.limits);
      this.transitionTo({ target: goal.target, distance: goal.distance }, 0.12);
      return;
    }
    this.beginDirect();
    zoomOrbitAt(this.current, factor, dxPx, dyPx, viewportHeightPx, fovDeg, this.limits);
    this.endDirect();
  }

  pan(dxPx: number, dyPx: number, viewportHeightPx: number, fovDeg: number): void {
    this.beginDirect();
    panOrbit(this.current, dxPx, dyPx, viewportHeightPx, fovDeg, this.limits);
    this.endDirect();
  }

  /** Animated move to a new view (instant under reduced motion). Omitted fields keep the goal's. */
  transitionTo(view: Partial<OrbitState>, halfLife = 0.12): void {
    if (!this.animating) copyOrbit(this.goal, this.current);
    if (view.target) {
      this.goal.target[0] = view.target[0];
      this.goal.target[1] = view.target[1];
      this.goal.target[2] = view.target[2];
    }
    if (view.yaw !== undefined) this.goal.yaw = view.yaw;
    if (view.pitch !== undefined) this.goal.pitch = view.pitch;
    if (view.distance !== undefined) this.goal.distance = view.distance;
    clampOrbit(this.goal, this.limits);
    this.halfLife = halfLife;
    if (this.reducedMotion || halfLife <= 0) {
      copyOrbit(this.current, this.goal);
      this.animating = false;
    } else {
      this.animating = true;
    }
    this.version++;
  }

  /** Instant move with no animation. */
  jumpTo(view: OrbitState): void {
    copyOrbit(this.current, view);
    clampOrbit(this.current, this.limits);
    copyOrbit(this.goal, this.current);
    this.animating = false;
    this.version++;
  }

  /** Advances a running transition; returns true when the view changed this frame. */
  update(dt: number): boolean {
    if (!this.animating) return false;
    const k = this.reducedMotion ? 1 : smoothingFactor(dt, this.halfLife);
    this.animating = approachOrbit(this.current, this.goal, k);
    this.version++;
    return true;
  }

  cameraPosition(out: Vec3): Vec3 {
    return orbitCameraPosition(this.current, out);
  }
}
