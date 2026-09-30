import * as THREE from 'three';
import { truss } from '../kit.ts';
import type { Kit, PartOptions, V3 } from '../kit.ts';

/**
 * Low-level geometry for generated stations: sub-assembly frames, cylindrical bands and annuli with
 * arc-length UVs, and window strips whose UVs line up with the rows of the shared window texture
 * (8 rows x 16 columns per repeat), so every strip shows whole rows of windows at a set size.
 */

const tmpMat = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpV = new THREE.Vector3();

/** Frame whose +Z points along `dir` (and +Y roughly along `up`), placed at `pos`. */
export function frameAt(pos: V3, dir: V3 = [0, 0, 1], up: V3 = [0, 1, 0]): THREE.Matrix4 {
  const z = new THREE.Vector3(...dir).normalize();
  const upV = new THREE.Vector3(...up);
  const x = new THREE.Vector3().crossVectors(upV, z);
  if (x.lengthSq() < 1e-6) {
    // `dir` runs along `up`: any perpendicular will do.
    upV.set(Math.abs(z.x) < 0.9 ? 1 : 0, 0, Math.abs(z.x) < 0.9 ? 0 : 1);
    x.crossVectors(upV, z);
  }
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(...pos);
}

/** A frame moved by `offset` in its own axes and optionally turned about its own axes (Euler XYZ). */
export function subFrame(frame: THREE.Matrix4, offset: V3, rotation: V3 = [0, 0, 0]): THREE.Matrix4 {
  const local = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)).setPosition(...offset);
  return frame.clone().multiply(local);
}

/** Transforms a frame-local point to station-local coordinates. */
export function tp(frame: THREE.Matrix4, p: V3): V3 {
  tmpV.set(...p).applyMatrix4(frame);
  return [tmpV.x, tmpV.y, tmpV.z];
}

/** Adds a part placed by `opts` inside `frame` (a sub-assembly transform). */
export function addIn(kit: Kit, frame: THREE.Matrix4, key: string, geo: THREE.BufferGeometry, opts: PartOptions = {}): void {
  tmpPos.set(...(opts.position ?? [0, 0, 0]));
  if (opts.quaternion) tmpQuat.copy(opts.quaternion);
  else tmpQuat.setFromEuler(tmpEuler.set(...(opts.rotation ?? [0, 0, 0])));
  const s = opts.scale ?? 1;
  if (typeof s === 'number') tmpScale.setScalar(s);
  else tmpScale.set(...s);
  geo.applyMatrix4(tmpMat.compose(tmpPos, tmpQuat, tmpScale));
  geo.applyMatrix4(frame);
  kit.add(key, geo, { color: opts.color, intensity: opts.intensity, uv: opts.uv });
}

/** Box in a frame. */
export function boxIn(kit: Kit, frame: THREE.Matrix4, key: string, size: V3, position: V3, color: THREE.ColorRepresentation, extra: PartOptions = {}): void {
  addIn(kit, frame, key, new THREE.BoxGeometry(size[0], size[1], size[2]), { ...extra, position, color });
}

/** Band geometry around Z with UVs from `uvAt(arcLength, upperEdge)`. */
function bandWith(
  radius: number,
  z0: number,
  z1: number,
  seg: number,
  inward: boolean,
  a0: number,
  a1: number,
  uvAt: (arc: number, z: number, upper: boolean) => [number, number],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (i / seg) * (a1 - a0);
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const z of [z0, z1]) {
      pos.push(c * radius, s * radius, z);
      nrm.push(inward ? -c : c, inward ? -s : s, 0);
      uv.push(...uvAt((a - a0) * radius, z, z === z1));
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    if (inward) idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    else idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Cylindrical band around Z (outer or inward-facing) with arc-length UVs, optionally a partial arc. */
export function band(radius: number, z0: number, z1: number, seg: number, inward: boolean, uvScale: number, a0 = 0, a1 = Math.PI * 2): THREE.BufferGeometry {
  return bandWith(radius, z0, z1, seg, inward, a0, a1, (arc, z) => [arc / uvScale, z / uvScale]);
}

/** Flat annulus in a z = const plane facing +Z (dir 1) or -Z (dir -1), with polar UVs. */
export function annulus(r0: number, r1: number, z: number, seg: number, dir: 1 | -1, uvScale: number, a0 = 0, a1 = Math.PI * 2): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(r0, r1, seg, 1, a0, a1 - a0);
  if (dir < 0) g.rotateY(Math.PI);
  g.translate(0, 0, z);
  const pos = g.attributes.position!;
  const uv = g.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uv.setXY(i, (Math.atan2(y, x) * (r0 + r1)) / 2 / uvScale, Math.hypot(x, y) / uvScale);
  }
  return g;
}

/** Size of one window cell of the shared window texture, in metres. */
export interface WindowScale {
  /** Row pitch (a window is ~40% of it tall). */
  row: number;
  /** Column pitch. */
  col: number;
}

/**
 * Window strip facing +Z, `w` wide, showing `rows` whole rows of windows. `u0` shifts the column
 * pattern and `row0` picks which texture rows appear (so strips side by side differ).
 */
export function windowPlane(w: number, rows: number, ws: WindowScale, u0 = 0, row0 = 0): THREE.BufferGeometry {
  const h = rows * ws.row;
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv!;
  const u1 = w / (ws.col * 16);
  const v0 = row0 / 8;
  const v1 = v0 + rows / 8;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * u1, v0 + uv.getY(i) * (v1 - v0));
  return g;
}

/** Window band around Z (outward-facing unless `inward`), `rows` rows high, centred on `zc`. */
export function windowBand(
  radius: number,
  zc: number,
  rows: number,
  ws: WindowScale,
  seg: number,
  inward = false,
  a0 = 0,
  a1 = Math.PI * 2,
  u0 = 0,
  row0 = 0,
): THREE.BufferGeometry {
  const h = rows * ws.row;
  return bandWith(radius, zc - h / 2, zc + h / 2, seg, inward, a0, a1, (arc, _z, upper) => [
    u0 + arc / (ws.col * 16),
    (row0 + (upper ? rows : 0)) / 8,
  ]);
}

/**
 * Square lattice truss from a to b with bays about `bayLength` long (fewer on lower quality):
 * longerons, cross frames and alternating diagonals.
 */
export function lattice(kit: Kit, key: string, a: V3, b: V3, width: number, color: THREE.ColorRepresentation, bayLength: number, member = width * 0.08): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (len < 1e-3) return;
  truss(kit, key, a, b, width, Math.max(1, Math.round(len / bayLength)), color, member);
}

const rayA = new THREE.Vector3();
const rayB = new THREE.Vector3();
const rayC = new THREE.Vector3();
const rayHit = new THREE.Vector3();

/**
 * Highest z of a (non-indexed) surface over the footprint |x - cx| < hx, |y - cy| < hy: a grid of
 * rays cast down -Z plus the vertices inside. Returns `fallback` if nothing is under the footprint.
 */
export function surfaceZ(g: THREE.BufferGeometry, cx: number, cy: number, hx: number, hy: number, fallback = 0, steps = 5): number {
  const pos = g.attributes.position!;
  let best = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i) - cx) < hx && Math.abs(pos.getY(i) - cy) < hy) best = Math.max(best, pos.getZ(i));
  }
  let top = -Infinity;
  for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getZ(i));
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  for (let ix = 0; ix < steps; ix++) {
    for (let iy = 0; iy < steps; iy++) {
      ray.origin.set(cx + hx * ((2 * ix) / (steps - 1) - 1), cy + hy * ((2 * iy) / (steps - 1) - 1), top + 1);
      for (let i = 0; i + 2 < pos.count; i += 3) {
        rayA.fromBufferAttribute(pos, i);
        rayB.fromBufferAttribute(pos, i + 1);
        rayC.fromBufferAttribute(pos, i + 2);
        if (ray.intersectTriangle(rayA, rayB, rayC, false, rayHit)) best = Math.max(best, rayHit.z);
      }
    }
  }
  return Number.isFinite(best) ? best : fallback;
}

/**
 * Distance from the origin to a star-shaped (non-indexed) surface along `dir`: the farthest hit of
 * a ray from the centre. Returns `fallback` if the ray misses.
 */
export function surfaceAlong(g: THREE.BufferGeometry, dir: V3, fallback: number): number {
  const pos = g.attributes.position!;
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(...dir).normalize());
  let best = 0;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    rayA.fromBufferAttribute(pos, i);
    rayB.fromBufferAttribute(pos, i + 1);
    rayC.fromBufferAttribute(pos, i + 2);
    if (ray.intersectTriangle(rayA, rayB, rayC, false, rayHit)) best = Math.max(best, rayHit.length());
  }
  return best > 0 ? best : fallback;
}

/** Distance between two points. */
export function dist(a: V3, b: V3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/** Linear interpolation between points. */
export function mix(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function add(a: V3, b: V3, s = 1): V3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}

export function scale(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function len(a: V3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function norm(a: V3): V3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
