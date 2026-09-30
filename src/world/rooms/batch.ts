import * as THREE from 'three';
import type { V3 } from '../art/kit.ts';

/**
 * Geometry streams: every part of a room (thousands of boxes plus arbitrary shapes) is transformed
 * straight into growable typed arrays, one stream per material key. Nothing is allocated per part
 * beyond the source shape, and there is no merge pass at the end. Streams produce non-indexed
 * geometry with position, normal, box-projected uv and colour (the art Kit's layout), plus the two
 * motion channels (pivot + motion vec4) for animated streams.
 */

/** Motion channel of a part: type, rate, amplitude and phase around a pivot (see motion.ts). */
export interface MotionSpec {
  type: number;
  pivot: V3;
  speed: number;
  amp?: number;
  phase?: number;
}

// Box faces as corner sign triples in counter-clockwise order seen from outside.
const FACES: { n: V3; c: [V3, V3, V3, V3] }[] = [
  { n: [1, 0, 0], c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];
const TRI = [0, 1, 2, 0, 2, 3];

class Grow {
  data: Float32Array;
  length = 0;
  constructor(size: number) {
    this.data = new Float32Array(size);
  }
  reserve(n: number): Float32Array {
    if (this.length + n > this.data.length) {
      let cap = this.data.length * 2;
      while (cap < this.length + n) cap *= 2;
      const next = new Float32Array(cap);
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }
    return this.data;
  }
  toArray(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

const m3 = new THREE.Matrix3();
const nm = new THREE.Matrix3();
const q4 = new THREE.Matrix4();
const col = new THREE.Color();
const vA = new THREE.Vector3();

export class Stream {
  readonly animated: boolean;
  private readonly pos: Grow;
  private readonly nrm: Grow;
  private readonly uv: Grow;
  private readonly col: Grow;
  private readonly pivA: Grow | null;
  private readonly motA: Grow | null;
  private readonly pivB: Grow | null;
  private readonly motB: Grow | null;

  constructor(animated: boolean, sizeHint = 1 << 14) {
    this.animated = animated;
    this.pos = new Grow(sizeHint * 3);
    this.nrm = new Grow(sizeHint * 3);
    this.uv = new Grow(sizeHint * 2);
    this.col = new Grow(sizeHint * 3);
    this.pivA = animated ? new Grow(1 << 12) : null;
    this.motA = animated ? new Grow(1 << 12) : null;
    this.pivB = animated ? new Grow(1 << 12) : null;
    this.motB = animated ? new Grow(1 << 12) : null;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private pushMotion(n: number, a?: MotionSpec, b?: MotionSpec): void {
    if (!this.animated) return;
    const fill = (piv: Grow, mot: Grow, m?: MotionSpec): void => {
      const P = piv.reserve(n * 3);
      const M = mot.reserve(n * 4);
      for (let i = 0; i < n; i++) {
        const pi = piv.length + i * 3;
        const mi = mot.length + i * 4;
        P[pi] = m ? m.pivot[0] : 0;
        P[pi + 1] = m ? m.pivot[1] : 0;
        P[pi + 2] = m ? m.pivot[2] : 0;
        M[mi] = m ? m.type : 0;
        M[mi + 1] = m ? m.speed : 0;
        M[mi + 2] = m?.amp ?? 0;
        M[mi + 3] = m?.phase ?? 0;
      }
      piv.length += n * 3;
      mot.length += n * 4;
    };
    fill(this.pivA!, this.motA!, a);
    fill(this.pivB!, this.motB!, b);
  }

  /** Box of `size` centred at `p`, rotated by `q` (or a yaw), coloured, box-projected uv. */
  box(size: V3, p: V3, q: THREE.Quaternion | number, color: THREE.ColorRepresentation, intensity: number, uvScale: number, faces = 63, a?: MotionSpec, b?: MotionSpec): void {
    if (typeof q === 'number') {
      const c = Math.cos(q);
      const s = Math.sin(q);
      m3.set(c, 0, s, 0, 1, 0, -s, 0, c);
    } else {
      m3.setFromMatrix4(q4.makeRotationFromQuaternion(q));
    }
    col.set(color).multiplyScalar(intensity);
    const e = m3.elements;
    const hx = size[0] / 2;
    const hy = size[1] / 2;
    const hz = size[2] / 2;
    const k = 1 / uvScale;
    let nFaces = 0;
    for (let f = 0; f < 6; f++) if (faces & (1 << f)) nFaces++;
    const nv = nFaces * 6;
    const P = this.pos.reserve(nv * 3);
    const N = this.nrm.reserve(nv * 3);
    const U = this.uv.reserve(nv * 2);
    const C = this.col.reserve(nv * 3);
    let pi = this.pos.length;
    let ui = this.uv.length;
    for (let f = 0; f < 6; f++) {
      if (!(faces & (1 << f))) continue;
      const face = FACES[f]!;
      const [fnx, fny, fnz] = face.n;
      const nx = e[0]! * fnx + e[3]! * fny + e[6]! * fnz;
      const ny = e[1]! * fnx + e[4]! * fny + e[7]! * fnz;
      const nz = e[2]! * fnx + e[5]! * fny + e[8]! * fnz;
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const az = Math.abs(nz);
      const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
      for (const t of TRI) {
        const [sx, sy, sz] = face.c[t]!;
        const lx = sx * hx;
        const ly = sy * hy;
        const lz = sz * hz;
        const x = p[0] + e[0]! * lx + e[3]! * ly + e[6]! * lz;
        const y = p[1] + e[1]! * lx + e[4]! * ly + e[7]! * lz;
        const z = p[2] + e[2]! * lx + e[5]! * ly + e[8]! * lz;
        P[pi] = x;
        P[pi + 1] = y;
        P[pi + 2] = z;
        N[pi] = nx;
        N[pi + 1] = ny;
        N[pi + 2] = nz;
        C[pi] = col.r;
        C[pi + 1] = col.g;
        C[pi + 2] = col.b;
        pi += 3;
        U[ui] = axis === 0 ? z * k : x * k;
        U[ui + 1] = axis === 1 ? z * k : y * k;
        ui += 2;
      }
    }
    this.pos.length = pi;
    this.nrm.length = pi;
    this.col.length = pi;
    this.uv.length = ui;
    this.pushMotion(nv, a, b);
  }

  /**
   * Any shape, transformed by `matrix`. `color` overrides the shape's colour attribute (white if it
   * has none); `uvScale` 0 keeps the shape's own uv, otherwise uv is box-projected per triangle.
   * The source geometry is disposed (ownership passes to the stream).
   */
  geometry(g: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color | null, uvScale: number, a?: MotionSpec, b?: MotionSpec, keep = false): void {
    if (!g.attributes.normal) g.computeVertexNormals();
    const Ps = g.attributes.position!;
    const Ns = g.attributes.normal!;
    const Us = g.attributes.uv;
    const Cs = g.attributes.color;
    const index = g.index;
    const n = index ? index.count : Ps.count;
    const e = matrix.elements;
    nm.getNormalMatrix(matrix);
    const ne = nm.elements;
    const P = this.pos.reserve(n * 3);
    const N = this.nrm.reserve(n * 3);
    const U = this.uv.reserve(n * 2);
    const C = this.col.reserve(n * 3);
    const p0 = this.pos.length;
    const u0 = this.uv.length;
    const keepUv = uvScale <= 0 && !!Us;
    for (let i = 0; i < n; i++) {
      const vi = index ? index.getX(i) : i;
      const x = Ps.getX(vi);
      const y = Ps.getY(vi);
      const z = Ps.getZ(vi);
      const w = 1 / (e[3]! * x + e[7]! * y + e[11]! * z + e[15]!);
      const pi = p0 + i * 3;
      P[pi] = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * w;
      P[pi + 1] = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * w;
      P[pi + 2] = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * w;
      const nx = Ns.getX(vi);
      const ny = Ns.getY(vi);
      const nz = Ns.getZ(vi);
      vA.set(ne[0]! * nx + ne[3]! * ny + ne[6]! * nz, ne[1]! * nx + ne[4]! * ny + ne[7]! * nz, ne[2]! * nx + ne[5]! * ny + ne[8]! * nz).normalize();
      N[pi] = vA.x;
      N[pi + 1] = vA.y;
      N[pi + 2] = vA.z;
      if (color) {
        C[pi] = color.r;
        C[pi + 1] = color.g;
        C[pi + 2] = color.b;
      } else if (Cs) {
        C[pi] = Cs.getX(vi);
        C[pi + 1] = Cs.getY(vi);
        C[pi + 2] = Cs.getZ(vi);
      } else {
        C[pi] = C[pi + 1] = C[pi + 2] = 1;
      }
      if (keepUv) {
        U[u0 + i * 2] = Us!.getX(vi);
        U[u0 + i * 2 + 1] = Us!.getY(vi);
      }
    }
    if (!keepUv) {
      // Box projection per triangle, from the transformed positions (same rule as the art Kit).
      const k = 1 / (uvScale > 0 ? uvScale : 4);
      for (let t = 0; t + 2 < n; t += 3) {
        const a0 = p0 + t * 3;
        const b0 = a0 + 3;
        const c0 = a0 + 6;
        const e1x = P[b0]! - P[a0]!;
        const e1y = P[b0 + 1]! - P[a0 + 1]!;
        const e1z = P[b0 + 2]! - P[a0 + 2]!;
        const e2x = P[c0]! - P[a0]!;
        const e2y = P[c0 + 1]! - P[a0 + 1]!;
        const e2z = P[c0 + 2]! - P[a0 + 2]!;
        const cx = Math.abs(e1y * e2z - e1z * e2y);
        const cy = Math.abs(e1z * e2x - e1x * e2z);
        const cz = Math.abs(e1x * e2y - e1y * e2x);
        const axis = cx >= cy && cx >= cz ? 0 : cy >= cz ? 1 : 2;
        for (let j = 0; j < 3; j++) {
          const q = a0 + j * 3;
          const ui = u0 + (t + j) * 2;
          U[ui] = axis === 0 ? P[q + 2]! * k : P[q]! * k;
          U[ui + 1] = axis === 1 ? P[q + 2]! * k : P[q + 1]! * k;
        }
      }
    }
    this.pos.length = p0 + n * 3;
    this.nrm.length = p0 + n * 3;
    this.col.length = p0 + n * 3;
    this.uv.length = u0 + n * 2;
    this.pushMotion(n, a, b);
    if (!keep) g.dispose();
  }

  toGeometry(): THREE.BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.toArray(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.toArray(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.toArray(), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.toArray(), 3));
    if (this.animated) {
      g.setAttribute('aPivotA', new THREE.BufferAttribute(this.pivA!.toArray(), 3));
      g.setAttribute('aMotionA', new THREE.BufferAttribute(this.motA!.toArray(), 4));
      g.setAttribute('aPivotB', new THREE.BufferAttribute(this.pivB!.toArray(), 3));
      g.setAttribute('aMotionB', new THREE.BufferAttribute(this.motB!.toArray(), 4));
    }
    // Bounding sphere around the min/max box: one pass, and plenty tight for frustum culling.
    const P = this.pos.data;
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < this.pos.length; i += 3) {
      const x = P[i]!;
      const y = P[i + 1]!;
      const z = P[i + 2]!;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const center = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    g.boundingSphere = new THREE.Sphere(center, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2);
    return g;
  }
}
