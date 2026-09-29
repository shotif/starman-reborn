/**
 * Pure math for the neighborhood map (no DOM, no three.js), so it can be unit tested in node.
 *
 * Map axes. Bundled positions are equatorial Cartesian light-years with Sol at the origin
 * (x toward RA 0h, y toward RA 6h, z toward the north celestial pole; see src/data/coords.ts).
 * The 3D map uses three.js y-up axes with the celestial equator as the horizontal plane:
 *   map X =  x   (toward RA 0h)
 *   map Y =  z   (north celestial pole is "up")
 *   map Z = -y   (RA 6h lies toward -Z)
 * The mapping is a proper rotation (determinant +1): distances and handedness are preserved.
 */
import type { Vec3Tuple } from '../data/types.ts';

export type Vec3 = [number, number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEG = Math.PI / 180;

export function equatorialToMap(p: Readonly<Vec3Tuple>, out: Vec3 = [0, 0, 0]): Vec3 {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  out[0] = x;
  out[1] = z;
  out[2] = -y;
  return out;
}

export function mapToEquatorial(p: Readonly<Vec3>, out: Vec3 = [0, 0, 0]): Vec3 {
  const mx = p[0];
  const my = p[1];
  const mz = p[2];
  out[0] = mx;
  out[1] = -mz;
  out[2] = my;
  return out;
}

/**
 * Camera-relative rendering: every object is drawn at (world - camera) computed here in double
 * precision, while the GPU camera sits at the origin. Float32 only ever sees small offsets.
 */
export function cameraRelative(world: Readonly<Vec3>, camera: Readonly<Vec3>, out: Vec3): Vec3 {
  out[0] = world[0] - camera[0];
  out[1] = world[1] - camera[1];
  out[2] = world[2] - camera[2];
  return out;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  let r = a % t;
  if (r <= -Math.PI) r += t;
  else if (r > Math.PI) r -= t;
  return r;
}

/** Signed smallest rotation from `from` to `to`. */
export function shortestAngleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

// ---------- Orbit camera ----------

/** Orbit camera state; all values are double-precision JS numbers in map light-years/radians. */
export interface OrbitState {
  target: Vec3;
  /** Azimuth around the map Y (north) axis; 0 puts the camera on the +Z side of the target. */
  yaw: number;
  /** Elevation above the equatorial plane; positive looks down from the north side. */
  pitch: number;
  distance: number;
}

export interface OrbitLimits {
  minDistance: number;
  maxDistance: number;
  minPitch: number;
  maxPitch: number;
  /** The orbit target stays within this many light-years of Sol. */
  maxTargetRadius: number;
}

export const ORBIT_LIMITS: OrbitLimits = {
  minDistance: 0.25,
  maxDistance: 60,
  minPitch: -1.45,
  maxPitch: 1.45,
  maxTargetRadius: 16,
};

export function cloneOrbit(s: OrbitState): OrbitState {
  return { target: [s.target[0], s.target[1], s.target[2]], yaw: s.yaw, pitch: s.pitch, distance: s.distance };
}

export function copyOrbit(dst: OrbitState, src: OrbitState): void {
  dst.target[0] = src.target[0];
  dst.target[1] = src.target[1];
  dst.target[2] = src.target[2];
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  dst.distance = src.distance;
}

export function clampOrbit(s: OrbitState, limits: OrbitLimits = ORBIT_LIMITS): void {
  s.pitch = clamp(s.pitch, limits.minPitch, limits.maxPitch);
  s.distance = clamp(s.distance, limits.minDistance, limits.maxDistance);
  s.yaw = wrapAngle(s.yaw);
  const r = Math.hypot(s.target[0], s.target[1], s.target[2]);
  if (r > limits.maxTargetRadius) {
    const k = limits.maxTargetRadius / r;
    s.target[0] *= k;
    s.target[1] *= k;
    s.target[2] *= k;
  }
}

/** Unit vector from the target toward the camera. */
export function orbitDirection(yaw: number, pitch: number, out: Vec3): Vec3 {
  const cp = Math.cos(pitch);
  out[0] = cp * Math.sin(yaw);
  out[1] = Math.sin(pitch);
  out[2] = cp * Math.cos(yaw);
  return out;
}

/** Camera position in map coordinates (double precision). */
export function orbitCameraPosition(s: OrbitState, out: Vec3): Vec3 {
  orbitDirection(s.yaw, s.pitch, out);
  out[0] = s.target[0] + out[0] * s.distance;
  out[1] = s.target[1] + out[1] * s.distance;
  out[2] = s.target[2] + out[2] * s.distance;
  return out;
}

/** Screen-right and screen-up unit vectors of an orbit camera (world up = map +Y). */
export function orbitBasis(yaw: number, pitch: number, right: Vec3, up: Vec3): void {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  right[0] = cy;
  right[1] = 0;
  right[2] = -sy;
  up[0] = -sp * sy;
  up[1] = cp;
  up[2] = -sp * cy;
}

export function rotateOrbit(s: OrbitState, dYaw: number, dPitch: number, limits: OrbitLimits = ORBIT_LIMITS): void {
  s.yaw = wrapAngle(s.yaw + dYaw);
  s.pitch = clamp(s.pitch + dPitch, limits.minPitch, limits.maxPitch);
}

/** factor < 1 zooms in (moves closer), > 1 zooms out. */
export function zoomOrbit(s: OrbitState, factor: number, limits: OrbitLimits = ORBIT_LIMITS): void {
  if (!(factor > 0) || !Number.isFinite(factor)) return;
  s.distance = clamp(s.distance * factor, limits.minDistance, limits.maxDistance);
}

/** World light-years covered by one CSS pixel at the orbit target's depth. */
export function worldPerPixel(distance: number, fovDeg: number, viewportHeightPx: number): number {
  return (2 * distance * Math.tan((fovDeg * DEG) / 2)) / Math.max(1, viewportHeightPx);
}

const panRight: Vec3 = [0, 0, 0];
const panUp: Vec3 = [0, 0, 0];

/** Drag-to-pan: the scene follows the pointer (dx right, dy down in CSS pixels). */
export function panOrbit(
  s: OrbitState,
  dxPx: number,
  dyPx: number,
  viewportHeightPx: number,
  fovDeg: number,
  limits: OrbitLimits = ORBIT_LIMITS,
): void {
  const k = worldPerPixel(s.distance, fovDeg, viewportHeightPx);
  orbitBasis(s.yaw, s.pitch, panRight, panUp);
  s.target[0] += (-panRight[0] * dxPx + panUp[0] * dyPx) * k;
  s.target[1] += (-panRight[1] * dxPx + panUp[1] * dyPx) * k;
  s.target[2] += (-panRight[2] * dxPx + panUp[2] * dyPx) * k;
  clampOrbit(s, limits);
}

/** Exponential smoothing weight for frame time `dt` and a half-life in seconds. */
export function smoothingFactor(dt: number, halfLife: number): number {
  if (!(halfLife > 0)) return 1;
  return 1 - Math.pow(2, -Math.max(0, dt) / halfLife);
}

/**
 * Moves `current` toward `goal` by weight k (0..1): target linearly, distance in log space, yaw
 * along the shorter arc. Snaps and returns false once the remaining difference is negligible.
 */
export function approachOrbit(current: OrbitState, goal: OrbitState, k: number): boolean {
  const w = clamp(k, 0, 1);
  const dYaw = shortestAngleDelta(current.yaw, goal.yaw);
  const dPitch = goal.pitch - current.pitch;
  const dLog = Math.log(goal.distance) - Math.log(current.distance);
  const dx = goal.target[0] - current.target[0];
  const dy = goal.target[1] - current.target[1];
  const dz = goal.target[2] - current.target[2];
  const posErr = Math.hypot(dx, dy, dz) / Math.max(current.distance, 1e-6);
  if (w >= 1 || (Math.abs(dYaw) < 1e-4 && Math.abs(dPitch) < 1e-4 && Math.abs(dLog) < 1e-4 && posErr < 1e-4)) {
    copyOrbit(current, goal);
    return false;
  }
  current.yaw = wrapAngle(current.yaw + dYaw * w);
  current.pitch += dPitch * w;
  current.distance = Math.exp(Math.log(current.distance) + dLog * w);
  current.target[0] += dx * w;
  current.target[1] += dy * w;
  current.target[2] += dz * w;
  return true;
}

// ---------- Projection ----------

export interface ScreenPoint {
  x: number;
  y: number;
  /** Clip-space w (distance along the view direction); larger is farther. */
  depth: number;
  /** In front of the camera and between the near and far planes. */
  visible: boolean;
}

export function createScreenPoint(): ScreenPoint {
  return { x: 0, y: 0, depth: 0, visible: false };
}

/**
 * Projects a camera-relative point through a column-major 4x4 view-projection matrix (three.js
 * Matrix4.elements layout) to CSS pixels with the origin at the top-left of the viewport.
 */
export function projectPoint(
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  out: ScreenPoint,
): ScreenPoint {
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const cz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (!(cw > 1e-9)) {
    out.visible = false;
    out.depth = cw;
    return out;
  }
  const nz = cz / cw;
  out.x = ((cx / cw + 1) / 2) * width;
  out.y = ((1 - cy / cw) / 2) * height;
  out.depth = cw;
  out.visible = nz >= -1 && nz <= 1;
  return out;
}

/**
 * Scale for a three.js Sprite with sizeAttenuation=false so it spans `px` CSS pixels.
 * `projYY` is projectionMatrix.elements[5] (1 / tan(fov/2) for an unzoomed camera).
 */
export function spriteScaleForPixels(px: number, projYY: number, viewportHeightPx: number): number {
  return (2 * px) / (projYY * Math.max(1, viewportHeightPx));
}

/** Pixel shift that moves the canvas centre to the centre of the visible stage rectangle. */
export function stageShift(canvasWidth: number, canvasHeight: number, stage: Rect, out: { x: number; y: number }): void {
  out.x = stage.x + stage.w / 2 - canvasWidth / 2;
  out.y = stage.y + stage.h / 2 - canvasHeight / 2;
}

/**
 * Smallest orbit distance at which every point projects inside the stage (minus `marginPx`),
 * for a camera looking at `target` from (yaw, pitch). Bisection on the exact pinhole projection,
 * so the framing uses the stage fully whatever the viewing angle. Returns `maxDistance` if even
 * that does not fit.
 */
export function fitOrbitDistance(
  points: readonly Readonly<Vec3>[],
  target: Readonly<Vec3>,
  yaw: number,
  pitch: number,
  fovDeg: number,
  stageWidthPx: number,
  stageHeightPx: number,
  canvasHeightPx: number,
  marginPx: number,
  minDistance = 0.5,
  maxDistance = 200,
): number {
  const f = Math.max(1, canvasHeightPx) / 2 / Math.tan((fovDeg * DEG) / 2);
  const halfW = Math.max(8, stageWidthPx / 2 - marginPx);
  const halfH = Math.max(8, stageHeightPx / 2 - marginPx);
  const dir: Vec3 = [0, 0, 0];
  const right: Vec3 = [0, 0, 0];
  const up: Vec3 = [0, 0, 0];
  orbitDirection(yaw, pitch, dir);
  orbitBasis(yaw, pitch, right, up);
  const fits = (d: number): boolean => {
    for (const p of points) {
      // Point relative to the camera at target + dir * d; depth along the view direction (-dir).
      const rx = p[0] - (target[0] + dir[0] * d);
      const ry = p[1] - (target[1] + dir[1] * d);
      const rz = p[2] - (target[2] + dir[2] * d);
      const depth = -(rx * dir[0] + ry * dir[1] + rz * dir[2]);
      if (depth <= 1e-3) return false;
      const sx = ((rx * right[0] + ry * right[1] + rz * right[2]) / depth) * f;
      const sy = ((rx * up[0] + ry * up[1] + rz * up[2]) / depth) * f;
      if (Math.abs(sx) > halfW || Math.abs(sy) > halfH) return false;
    }
    return true;
  };
  if (!fits(maxDistance)) return maxDistance;
  if (fits(minDistance)) return minDistance;
  let lo = minDistance;
  let hi = maxDistance;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
