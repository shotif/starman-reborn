import * as THREE from 'three';
import type { PartOptions, V3 } from '../art/kit.ts';
import { createLightPoints } from '../art/lights.ts';
import type { LightPoints, LightSpec } from '../art/lights.ts';
import type { ArtContext } from '../art/types.ts';
import { byQuality, seededRandom } from '../art/util.ts';
import { Stream } from './batch.ts';
import type { MotionSpec } from './batch.ts';
import { HOLO_MODE } from './materials.ts';
import type { HoloMode, RoomMaterials } from './materials.ts';
import type { MotionPartOptions } from './motion.ts';
import { GLOW_UV } from './textures.ts';
import type { GlowKind } from './textures.ts';

export type { V3 };

/** A point the UI may place a tap target on. */
export interface Anchor {
  id: string;
  label: string;
  position: THREE.Vector3;
}

export interface BoxOptions {
  /** Euler XYZ rotation; `ry` is a shortcut for a yaw. */
  rot?: V3;
  ry?: number;
  intensity?: number;
  uv?: number;
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();
const tmpM2 = new THREE.Matrix4();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Collects the geometry of one room into one stream per material key (static parts, and animated
 * parts carrying motion channels), plus glow sprites (light points) and hotspot anchors. `finish`
 * turns every stream into a single mesh under `group`, so a room costs a handful of draw calls.
 */
export class RoomBuilder {
  readonly group = new THREE.Group();
  readonly lights: LightSpec[] = [];
  readonly anchors: Anchor[] = [];
  readonly rand: () => number;
  readonly ctx: ArtContext;
  /** Curve segments for round parts. */
  readonly seg: number;
  lightPoints: LightPoints | null = null;
  private readonly statics = new Map<string, Stream>();
  private readonly moving = new Map<string, Stream>();

  constructor(name: string, seed: number, ctx: ArtContext) {
    this.group.name = name;
    this.rand = seededRandom(seed);
    this.ctx = ctx;
    this.seg = byQuality(ctx.quality, 8, 12, 16);
  }

  get low(): boolean {
    return this.ctx.quality === 'low';
  }

  get high(): boolean {
    return this.ctx.quality === 'high';
  }

  /** Random in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.rand();
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rand() * list.length) % list.length]!;
  }

  private stream(key: string, animated: boolean): Stream {
    const map = animated ? this.moving : this.statics;
    let s = map.get(key);
    if (!s) map.set(key, (s = new Stream(animated, animated ? 1 << 12 : 1 << 14)));
    return s;
  }

  /** Unit cylinders are rebuilt hundreds of times per room: keep one per shape and scale it. */
  private readonly protos = new Map<string, THREE.BufferGeometry>();

  private cylinderProto(topRatio: number, seg: number, open: boolean): THREE.BufferGeometry {
    const key = `${topRatio.toFixed(3)}:${seg}:${open ? 1 : 0}`;
    let g = this.protos.get(key);
    if (!g) {
      g = new THREE.CylinderGeometry(topRatio, 1, 1, seg, 1, open);
      this.protos.set(key, g);
    }
    return g;
  }

  /**
   * Cylinder (or frustum) of radius r / rTop and height h, placed like `add`; animated when a
   * motion is given. Shares prototype shapes.
   */
  cylinder(key: string, r: number, h: number, opts: PartOptions & { rTop?: number; seg?: number; open?: boolean }, a?: MotionSpec, b?: MotionSpec): void {
    const proto = this.cylinderProto((opts.rTop ?? r) / r, opts.seg ?? this.seg, opts.open ?? false);
    const m = this.matrixOf(opts).multiply(tmpM2.makeScale(r, h, r));
    this.stream(key, !!(a || b)).geometry(proto, m, this.colorOf(opts), opts.uv ?? 4, a, b, true);
  }

  private matrixOf(opts: PartOptions): THREE.Matrix4 {
    tmpP.set(...(opts.position ?? [0, 0, 0]));
    if (opts.quaternion) tmpQ.copy(opts.quaternion);
    else tmpQ.setFromEuler(tmpE.set(...(opts.rotation ?? [0, 0, 0])));
    const s = opts.scale ?? 1;
    if (typeof s === 'number') tmpS.setScalar(s);
    else tmpS.set(...s);
    return tmpM.compose(tmpP, tmpQ, tmpS);
  }

  private colorOf(opts: PartOptions): THREE.Color | null {
    return opts.color === undefined ? null : tmpC.set(opts.color).multiplyScalar(opts.intensity ?? 1);
  }

  /** Any shape (ownership passes to the room). uv 0 keeps the shape's own uv. */
  add(key: string, geo: THREE.BufferGeometry, opts: PartOptions = {}): void {
    this.stream(key, false).geometry(geo, this.matrixOf(opts), this.colorOf(opts), opts.uv ?? 4);
  }

  /** Animated shape: `matrix` is applied after the local transform, and to the motion pivots. */
  addMotion(key: string, geo: THREE.BufferGeometry, opts: MotionPartOptions = {}): void {
    const m = this.matrixOf(opts);
    if (opts.matrix) m.premultiply(opts.matrix);
    const pivot = (x?: MotionSpec): MotionSpec | undefined => {
      if (!x) return undefined;
      if (!opts.matrix) return x;
      const p = tmpV.set(...x.pivot).applyMatrix4(opts.matrix);
      return { ...x, pivot: [p.x, p.y, p.z] };
    };
    this.stream(key, true).geometry(geo, m, this.colorOf(opts), opts.uv ?? 4, pivot(opts.a), pivot(opts.b));
  }

  box(key: string, size: V3, pos: V3, color: THREE.ColorRepresentation = '#ffffff', o: BoxOptions = {}): void {
    const rot = o.rot ? tmpQ.setFromEuler(tmpE.set(o.rot[0], o.rot[1], o.rot[2])) : (o.ry ?? 0);
    this.stream(key, false).box(size, pos, rot, color, o.intensity ?? 1, o.uv || 4);
  }

  /** Box with an arbitrary orientation. */
  boxQ(key: string, size: V3, pos: V3, q: THREE.Quaternion, color: THREE.ColorRepresentation, intensity = 1, uv = 4): void {
    this.stream(key, false).box(size, pos, q, color, intensity, uv || 4);
  }

  /** Animated box with an arbitrary orientation. */
  boxMotion(key: string, size: V3, pos: V3, q: THREE.Quaternion, color: THREE.ColorRepresentation, intensity: number, a?: MotionSpec, b?: MotionSpec): void {
    this.stream(key, true).box(size, pos, q, color, intensity, 4, 63, a, b);
  }

  /** Floor decal: only the top face of a flat box (paint never shows its sides). */
  decal(key: string, size: V3, pos: V3, color: THREE.ColorRepresentation, ry = 0, uv = 2): void {
    this.stream(key, false).box(size, pos, ry, color, 1, uv, 1 << 2);
  }

  /** Horizontal quad facing up (floor tiles). */
  quadUp(key: string, cx: number, y: number, cz: number, w: number, d: number, color: THREE.ColorRepresentation, uv = 4): void {
    this.stream(key, false).box([w, 0, d], [cx, y, cz], 0, color, 1, uv, 1 << 2);
  }

  /** Square-section beam between two points. */
  beam(key: string, a: V3, c: V3, w: number, color: THREE.ColorRepresentation, h = w): void {
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const dz = c[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    tmpV.set(dx / len, dy / len, dz / len);
    tmpQ.setFromUnitVectors(Z_AXIS, tmpV);
    this.stream(key, false).box([w, h, len], [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2], tmpQ, color, 1, 4);
  }

  /** Cylinder between two points. */
  rod(key: string, a: V3, c: V3, r: number, color: THREE.ColorRepresentation, seg = 8): void {
    const dir = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const len = dir.length();
    if (len < 1e-6) return;
    const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize());
    this.cylinder(key, r, len, { position: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2], quaternion: q, color, seg });
  }

  /** Square lattice truss from a to c (same layout as the art kit's truss). */
  truss(key: string, a: V3, c: V3, width: number, bays: number, color: THREE.ColorRepresentation, member = width * 0.08): void {
    const va = new THREE.Vector3(...a);
    const dir = new THREE.Vector3(...c).sub(va);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(0, 1, 0);
    if (Math.abs(dir.dot(side)) > 0.9) side.set(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(dir, side).normalize().multiplyScalar(width / 2);
    const v = new THREE.Vector3().crossVectors(dir, u).normalize().multiplyScalar(width / 2);
    const corners = [u.clone().add(v), u.clone().sub(v), u.clone().negate().sub(v), u.clone().negate().add(v)];
    const P = (t: number, cc: THREE.Vector3): V3 => {
      const p = va.clone().addScaledVector(dir, t * len).add(cc);
      return [p.x, p.y, p.z];
    };
    for (const cc of corners) this.beam(key, P(0, cc), P(1, cc), member, color);
    for (let i = 0; i <= bays; i++) {
      const t = i / bays;
      for (let k = 0; k < 4; k++) this.beam(key, P(t, corners[k]!), P(t, corners[(k + 1) % 4]!), member * 0.8, color);
      if (i < bays) {
        const t1 = (i + 1) / bays;
        for (let k = 0; k < 4; k++) {
          const c0 = corners[k]!;
          const c1 = corners[(k + 1) % 4]!;
          if ((i + k) % 2 === 0) this.beam(key, P(t, c0), P(t1, c1), member * 0.6, color);
          else this.beam(key, P(t, c1), P(t1, c0), member * 0.6, color);
        }
      }
    }
  }

  /** Vertical cylinder (or frustum) centred at pos. */
  cyl(
    key: string,
    r: number,
    h: number,
    pos: V3,
    color: THREE.ColorRepresentation,
    o: { rTop?: number; seg?: number; rot?: V3; open?: boolean; intensity?: number; uv?: number } = {},
  ): void {
    this.cylinder(key, r, h, { position: pos, rotation: o.rot ?? [0, 0, 0], color, intensity: o.intensity, uv: o.uv, rTop: o.rTop, seg: o.seg, open: o.open });
  }

  /**
   * A textured quad from the glow atlas (additive). `rot` orients the quad (a plane facing +Z);
   * use `floorGlow` for pools on the floor.
   */
  glow(kind: GlowKind, center: V3, w: number, h: number, rot: V3 | THREE.Quaternion, color: THREE.ColorRepresentation, intensity: number): void {
    const g = new THREE.PlaneGeometry(w, h);
    const [u0, v0] = GLOW_UV[kind];
    const uv = g.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5);
    const opts: PartOptions = { position: center, color, intensity, uv: 0 };
    if (rot instanceof THREE.Quaternion) opts.quaternion = rot;
    else opts.rotation = rot;
    this.add('glow', g, opts);
  }

  /** Soft light pool lying on a horizontal surface at height y. */
  floorGlow(x: number, z: number, w: number, d: number, color: THREE.ColorRepresentation, intensity: number, y = 0.03, ry = 0): void {
    const q = new THREE.Quaternion().setFromEuler(tmpE.set(0, ry, 0)).multiply(tmpQ.setFromEuler(tmpE.set(-Math.PI / 2, 0, 0)));
    this.glow('pool', [x, y, z], w, d, q, color, intensity);
  }

  /**
   * Volumetric-looking light shaft: two crossed vertical glow cards from `top` down to `bottom`
   * (brightest at the top).
   */
  shaft(top: V3, bottom: V3, width: number, color: THREE.ColorRepresentation, intensity: number): void {
    const a = new THREE.Vector3(...top);
    const b = new THREE.Vector3(...bottom);
    const len = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = a.clone().sub(b).normalize();
    for (const yaw of [0, Math.PI / 2]) {
      const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw + Math.PI / 4));
      this.glow('shaft', [mid.x, mid.y, mid.z], width, len, q, color, intensity);
    }
  }

  /** Holographic display panel (see HOLO_MODE); faces +Z rotated by `ry` (and `rx`). */
  holo(mode: HoloMode, seed: number, center: V3, w: number, h: number, color: THREE.ColorRepresentation, intensity: number, ry = 0, rx = 0): void {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv!;
    const m = HOLO_MODE[mode];
    const s = Math.max(0, Math.min(40, Math.round(seed)));
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + m * 2, uv.getY(i) + s * 2);
    this.add('holo', g, { position: center, rotation: [rx, ry, 0], color, intensity, uv: 0 });
  }

  light(spec: LightSpec): void {
    this.lights.push(spec);
  }

  anchor(id: string, label: string, p: V3): void {
    this.anchors.push({ id, label, position: new THREE.Vector3(...p) });
  }

  /** Vertex count so far (static + animated), for budgeting while building. */
  get vertexCount(): number {
    let n = 0;
    for (const s of this.statics.values()) n += s.vertexCount;
    for (const s of this.moving.values()) n += s.vertexCount;
    return n;
  }

  finish(mats: RoomMaterials): void {
    const build = (map: Map<string, Stream>, materials: Record<string, THREE.Material>, animated: boolean): void => {
      for (const [key, stream] of map) {
        const geometry = stream.toGeometry();
        if (!geometry) continue;
        const material = materials[key];
        if (!material) throw new Error(`RoomBuilder: no material for "${key}"`);
        // Moving parts can leave their rest bounds a little.
        if (animated && geometry.boundingSphere) geometry.boundingSphere.radius += 2;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = key;
        this.group.add(mesh);
      }
      map.clear();
    };
    build(this.statics, mats.statics, false);
    build(this.moving, mats.motion, true);
    for (const g of this.protos.values()) g.dispose();
    this.protos.clear();
    if (this.lights.length) {
      const lp = createLightPoints(this.lights, this.ctx);
      lp.points.name = `${this.group.name}-lights`;
      this.group.add(lp.points);
      this.lightPoints = lp;
    }
  }
}

/** Box-projected quad: a thin horizontal strip of paint on the floor. */
export function paintStrip(b: RoomBuilder, x: number, z: number, w: number, d: number, color: THREE.ColorRepresentation, ry = 0, y = 0.012): void {
  b.decal('paint', [w, 0.02, d], [x, y, z], color, ry);
}

/** A ring of paint on the floor made of short straight segments. */
export function paintRing(b: RoomBuilder, cx: number, cz: number, r: number, width: number, color: THREE.ColorRepresentation, segments = 48, y = 0.014, gaps = 0): void {
  const step = (Math.PI * 2) / segments;
  const len = 2 * r * Math.sin(step / 2) + 0.02;
  for (let i = 0; i < segments; i++) {
    if (gaps > 0 && i % gaps === gaps - 1) continue;
    const a = (i + 0.5) * step;
    b.decal('paint', [len, 0.02, width], [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r], color, -a + Math.PI / 2);
  }
}

/** Hazard stripes along a line on the floor (alternating colours). */
export function hazardBand(b: RoomBuilder, a: [number, number], c: [number, number], width: number, colors: [string, string], y = 0.013, key = 'paint'): void {
  const dx = c[0] - a[0];
  const dz = c[1] - a[1];
  const len = Math.hypot(dx, dz);
  const n = Math.max(2, Math.round(len / (width * 1.1)));
  const ry = -Math.atan2(dz, dx);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    b.decal(key, [len / n + 0.01, 0.02, width], [a[0] + dx * t, y, a[1] + dz * t], colors[i % 2]!, ry);
  }
}

/** Seven-segment style digit painted on the floor (abstract bay numbers; no font needed). */
export function floorDigit(b: RoomBuilder, digit: number, x: number, z: number, h: number, color: THREE.ColorRepresentation, ry = 0, y = 0.014): void {
  const SEG: Record<number, string> = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  const w = h * 0.55;
  const t = h * 0.12;
  const segs: Record<string, [number, number, number, number]> = {
    a: [0, h / 2, w, t],
    g: [0, 0, w, t],
    d: [0, -h / 2, w, t],
    f: [-w / 2, h / 4, t, h / 2],
    b: [w / 2, h / 4, t, h / 2],
    e: [-w / 2, -h / 4, t, h / 2],
    c: [w / 2, -h / 4, t, h / 2],
  };
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  for (const k of SEG[digit] ?? '') {
    const [sx, sz, sw, sd] = segs[k]!;
    // Local +Y of the digit maps to -Z on the floor so it reads from the +Z side.
    const lx = sx;
    const lz = -sz;
    b.decal('paint', [sw, 0.02, sd], [x + lx * c + lz * s, y, z - lx * s + lz * c], color, ry);
  }
}
