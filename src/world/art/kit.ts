import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Geometry kit for hard-surface models. Parts are added per material key with a transform and a
 * vertex colour, then merged into one mesh per material, so a whole ship or station costs a
 * handful of draw calls. Parts get box-projected UVs at a fixed texel density so plating reads
 * at the same scale on every surface.
 */

export type V3 = [number, number, number];

export interface PartOptions {
  position?: V3;
  /** Euler XYZ, radians. */
  rotation?: V3;
  quaternion?: THREE.Quaternion;
  scale?: V3 | number;
  /** Vertex colour (sRGB hex or Color). Omit to keep a colour attribute already on the geometry. */
  color?: THREE.ColorRepresentation;
  /** Multiplier on the colour (HDR emissive parts). */
  intensity?: number;
  /** World units per texture repeat for box-projected UVs; 0 keeps the geometry's own UVs. */
  uv?: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export class Kit {
  private readonly parts = new Map<string, THREE.BufferGeometry[]>();
  /** Default world units per texture repeat. */
  private readonly uvScale: number;

  constructor(uvScale = 4) {
    this.uvScale = uvScale;
  }

  add(key: string, geometry: THREE.BufferGeometry, opts: PartOptions = {}): this {
    let g = geometry;
    if (g.index) {
      g = geometry.toNonIndexed();
      geometry.dispose();
    }
    tmpP.set(...(opts.position ?? [0, 0, 0]));
    if (opts.quaternion) tmpQ.copy(opts.quaternion);
    else tmpQ.setFromEuler(tmpE.set(...(opts.rotation ?? [0, 0, 0])));
    const s = opts.scale ?? 1;
    if (typeof s === 'number') tmpS.setScalar(s);
    else tmpS.set(...s);
    g.applyMatrix4(tmpM.compose(tmpP, tmpQ, tmpS));
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const count = g.attributes.position!.count;
    if (opts.color !== undefined || !g.attributes.color) {
      const c = new THREE.Color(opts.color ?? 0xffffff).multiplyScalar(opts.intensity ?? 1);
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    const uvScale = opts.uv ?? this.uvScale;
    if (uvScale > 0 || !g.attributes.uv) boxUV(g, uvScale > 0 ? uvScale : this.uvScale);
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(g);
    return this;
  }

  has(key: string): boolean {
    return (this.parts.get(key)?.length ?? 0) > 0;
  }

  /** Merges every material group into one mesh and adds it to `parent`. */
  build(parent: THREE.Object3D, materials: Record<string, THREE.Material>): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [key, list] of this.parts) {
      if (list.length === 0) continue;
      const material = materials[key];
      if (!material) throw new Error(`Kit: no material for part key "${key}"`);
      const merged = list.length === 1 ? list[0]! : mergeGeometries(list, false);
      if (list.length > 1) for (const g of list) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = key;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}

/** Per-triangle box projection (non-indexed geometry): UVs follow the dominant face axis. */
export function boxUV(g: THREE.BufferGeometry, unitsPerRepeat: number): void {
  const pos = g.attributes.position!;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const k = 1 / unitsPerRepeat;
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    b.sub(a);
    c.sub(a);
    b.cross(c);
    const ax = Math.abs(b.x);
    const ay = Math.abs(b.y);
    const az = Math.abs(b.z);
    for (let j = 0; j < 3; j++) {
      const x = pos.getX(i + j);
      const y = pos.getY(i + j);
      const z = pos.getZ(i + j);
      let u: number;
      let v: number;
      if (ax >= ay && ax >= az) {
        u = z;
        v = y;
      } else if (ay >= az) {
        u = x;
        v = z;
      } else {
        u = x;
        v = y;
      }
      uv[(i + j) * 2] = u * k;
      uv[(i + j) * 2 + 1] = v * k;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/* ------------------------------------------------------------------------------------------------
 * Shape helpers. All return fresh geometries (ownership passes to Kit.add).
 * ---------------------------------------------------------------------------------------------- */

export interface LoftSection {
  z: number;
  /** Closed outline, [x, y] pairs. Every section needs the same point count. */
  pts: [number, number][];
}

/**
 * Lofts cross-sections along Z into a flat-shaded shell. `faceColor(segment, edge)` can paint
 * individual face strips (stripes, keels); faces are oriented outwards automatically.
 */
export function loft(
  sections: LoftSection[],
  opts: { capStart?: boolean; capEnd?: boolean; faceColor?: (seg: number, edge: number) => THREE.ColorRepresentation | null; baseColor?: THREE.ColorRepresentation } = {},
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const base = new THREE.Color(opts.baseColor ?? 0xffffff);
  const col = new THREE.Color();
  const m = sections[0]!.pts.length;
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  const D = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const ref = new THREE.Vector3();
  const centroid = (s: LoftSection): [number, number] => {
    let x = 0;
    let y = 0;
    for (const p of s.pts) {
      x += p[0];
      y += p[1];
    }
    return [x / s.pts.length, y / s.pts.length];
  };
  const pushTri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, outward: THREE.Vector3, c: THREE.Color): void => {
    e1.subVectors(q, p);
    e2.subVectors(r, p);
    nrm.crossVectors(e1, e2);
    const flip = nrm.dot(outward) < 0;
    const verts = flip ? [p, r, q] : [p, q, r];
    for (const v of verts) {
      positions.push(v.x, v.y, v.z);
      colors.push(c.r, c.g, c.b);
    }
  };
  for (let i = 0; i + 1 < sections.length; i++) {
    const s0 = sections[i]!;
    const s1 = sections[i + 1]!;
    const c0 = centroid(s0);
    const c1 = centroid(s1);
    for (let j = 0; j < m; j++) {
      const k = (j + 1) % m;
      A.set(s0.pts[j]![0], s0.pts[j]![1], s0.z);
      B.set(s0.pts[k]![0], s0.pts[k]![1], s0.z);
      C.set(s1.pts[k]![0], s1.pts[k]![1], s1.z);
      D.set(s1.pts[j]![0], s1.pts[j]![1], s1.z);
      ref.set((A.x + B.x + C.x + D.x) / 4 - (c0[0] + c1[0]) / 2, (A.y + B.y + C.y + D.y) / 4 - (c0[1] + c1[1]) / 2, 0);
      const fc = opts.faceColor?.(i, j);
      col.set(fc ?? base);
      if (A.distanceToSquared(B) > 1e-10) pushTri(A, B, C, ref, col);
      if (C.distanceToSquared(D) > 1e-10) pushTri(A, C, D, ref, col);
    }
  }
  const cap = (s: LoftSection, dir: number, seg: number): void => {
    const [cx, cy] = centroid(s);
    const O = new THREE.Vector3(cx, cy, s.z);
    const out = new THREE.Vector3(0, 0, dir);
    const fc = opts.faceColor?.(seg, -1);
    col.set(fc ?? base);
    for (let j = 0; j < m; j++) {
      const k = (j + 1) % m;
      A.set(s.pts[j]![0], s.pts[j]![1], s.z);
      B.set(s.pts[k]![0], s.pts[k]![1], s.z);
      pushTri(O, A, B, out, col);
    }
  };
  if (opts.capStart) cap(sections[0]!, sections[0]!.z < sections[sections.length - 1]!.z ? -1 : 1, -1);
  if (opts.capEnd) cap(sections[sections.length - 1]!, sections[0]!.z < sections[sections.length - 1]!.z ? 1 : -1, sections.length - 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Symmetric outline helper: right-half points (x >= 0) from top to bottom, mirrored to a loop. */
export function mirrored(right: [number, number][]): [number, number][] {
  const out: [number, number][] = [...right];
  for (let i = right.length - 1; i >= 0; i--) {
    const [x, y] = right[i]!;
    if (Math.abs(x) > 1e-6) out.push([-x, y]);
  }
  return out;
}

/** A flat slab from an (x, z) planform, `thickness` along Y, centred on y = 0, bevelled edges. */
export function slab(planform: [number, number][], thickness: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(planform.map(([x, z]) => new THREE.Vector2(x, z)));
  const b = Math.min(bevel, thickness * 0.45);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-3, thickness - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });
  // Shape XY -> ship XZ; extrusion -> -Y.
  g.rotateX(Math.PI / 2);
  g.translate(0, thickness / 2 - b, 0);
  return g;
}

/** Surface of revolution around Z from [radius, z] profile points. */
export function latheZ(profile: [number, number][], segments: number, phiLength = Math.PI * 2): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, z]) => new THREE.Vector2(r, z)),
    segments,
    0,
    phiLength,
  );
  g.rotateX(Math.PI / 2);
  return g;
}

const UP = new THREE.Vector3(0, 0, 1);

/** Quaternion that turns +Z onto `dir`. */
export function aimZ(dir: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
}

/** Box beam from a to b (square section `w`). */
export function beam(kit: Kit, key: string, a: V3, b: V3, w: number, color: THREE.ColorRepresentation, h = w): void {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const d = vb.clone().sub(va);
  const len = d.length();
  if (len < 1e-6) return;
  const mid = va.add(vb).multiplyScalar(0.5);
  kit.add(key, new THREE.BoxGeometry(w, h, len), { position: [mid.x, mid.y, mid.z], quaternion: aimZ(d), color });
}

/** Cylinder from a to b. */
export function rod(kit: Kit, key: string, a: V3, b: V3, r: number, color: THREE.ColorRepresentation, seg = 8, opts: PartOptions = {}): void {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const d = vb.clone().sub(va);
  const len = d.length();
  if (len < 1e-6) return;
  const mid = va.add(vb).multiplyScalar(0.5);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  g.rotateX(Math.PI / 2);
  kit.add(key, g, { ...opts, position: [mid.x, mid.y, mid.z], quaternion: aimZ(d), color });
}

/**
 * Square lattice truss from a to b: four longerons, cross frames and alternating diagonals.
 * `bays` controls how many braced sections it has.
 */
export function truss(kit: Kit, key: string, a: V3, b: V3, width: number, bays: number, color: THREE.ColorRepresentation, member = width * 0.08): void {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  dir.normalize();
  const side = new THREE.Vector3(0, 1, 0);
  if (Math.abs(dir.dot(side)) > 0.9) side.set(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, side).normalize().multiplyScalar(width / 2);
  const v = new THREE.Vector3().crossVectors(dir, u).normalize().multiplyScalar(width / 2);
  const corners = [u.clone().add(v), u.clone().sub(v), u.clone().negate().sub(v), u.clone().negate().add(v)];
  const P = (t: number, c: THREE.Vector3): V3 => {
    const p = va.clone().addScaledVector(dir, t * len).add(c);
    return [p.x, p.y, p.z];
  };
  for (const c of corners) beam(kit, key, P(0, c), P(1, c), member, color);
  for (let i = 0; i <= bays; i++) {
    const t = i / bays;
    for (let k = 0; k < 4; k++) beam(kit, key, P(t, corners[k]!), P(t, corners[(k + 1) % 4]!), member * 0.8, color);
    if (i < bays) {
      const t1 = (i + 1) / bays;
      for (let k = 0; k < 4; k++) {
        const c0 = corners[k]!;
        const c1 = corners[(k + 1) % 4]!;
        if ((i + k) % 2 === 0) beam(kit, key, P(t, c0), P(t1, c1), member * 0.6, color);
        else beam(kit, key, P(t, c1), P(t1, c0), member * 0.6, color);
      }
    }
  }
}

/** Capsule tank along `axis` ('x' | 'y' | 'z'). */
export function tank(kit: Kit, key: string, pos: V3, axis: 'x' | 'y' | 'z', radius: number, length: number, color: THREE.ColorRepresentation, seg = 16): void {
  const h = Math.max(0, length - 2 * radius);
  const g = new THREE.CapsuleGeometry(radius, h, Math.max(3, seg >> 2), seg);
  const rot: V3 = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
  kit.add(key, g, { position: pos, rotation: rot, color });
}
