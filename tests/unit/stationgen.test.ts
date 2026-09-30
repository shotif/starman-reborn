import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DOCK_CORRIDOR,
  MAX_STATION_MESHES,
  STATION_OWNERS,
  STATION_TYPES,
  STATION_TRIANGLE_BUDGET,
  createGeneratedStation,
  nominalStationRadius,
} from '../../src/world/art/stationgen/index.ts';
import type { StationLook, StationOwner, StationType } from '../../src/world/art/stationgen/index.ts';
import type { StationArt } from '../../src/world/art/stations.ts';
import type { ArtContext, QualityLevel } from '../../src/world/art/types.ts';
import { isShared } from '../../src/world/art/util.ts';

/**
 * The shared materials paint their plating textures on a 2D canvas, which Node lacks: hand them a
 * blank one (removed again after the file). Geometry builds in plain three.js without WebGL.
 */
let stubbed = false;
function stubCanvas(): void {
  if (typeof document !== 'undefined') return;
  stubbed = true;
  const ctx2d: unknown = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'getImageData'
          ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
          : () => ({ addColorStop: () => undefined }),
      set: () => true,
    },
  );
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
  };
}

beforeAll(stubCanvas);
afterAll(() => {
  if (stubbed) delete (globalThis as { document?: unknown }).document;
});

const QUALITIES: readonly QualityLevel[] = ['low', 'medium', 'high'];
const ctxFor = (quality: QualityLevel): ArtContext => ({ quality, reducedMotion: false });
const lookOf = (type: StationType, owner: StationOwner, extra: Partial<StationLook> = {}): StationLook => ({
  type,
  owner,
  seed: 7,
  starColor: '#fff3e2',
  size: 0.5,
  wear: 0.3,
  ...extra,
});
/** Building every combination takes a few seconds; leave room for slow machines. */
const SLOW = 120_000;
/** Moments of the animation the geometry checks look at (rings, dishes, cranes, turrets move). */
const TIMES = [0, 17.3, 61.1];

interface Placed {
  mesh: THREE.Mesh;
  /** Station-local matrix per drawn copy (one, or one per instance). */
  matrices: THREE.Matrix4[];
}

/** Every mesh of a station with its station-local transform(s) at the current pose. */
function placed(art: StationArt): Placed[] {
  art.object.updateMatrixWorld(true);
  const inv = art.object.matrixWorld.clone().invert();
  const out: Placed[] = [];
  art.object.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const base = inv.clone().multiply(mesh.matrixWorld);
    const inst = n as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      const list: THREE.Matrix4[] = [];
      for (let i = 0; i < inst.count; i++) {
        const m = new THREE.Matrix4();
        inst.getMatrixAt(i, m);
        list.push(base.clone().multiply(m));
      }
      out.push({ mesh, matrices: list });
    } else {
      out.push({ mesh, matrices: [base] });
    }
  });
  return out;
}

/** Calls `fn` with station-local corners of every drawn triangle. */
function forEachTriangle(art: StationArt, fn: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => boolean | void): void {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const { mesh, matrices } of placed(art)) {
    const pos = mesh.geometry.attributes.position!;
    const idx = mesh.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (const m of matrices) {
      for (let i = 0; i + 2 < n; i += 3) {
        a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
        b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m);
        c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m);
        if (fn(a, b, c) === true) return;
      }
    }
  }
}

/** Triangles drawn per frame (instances counted). */
function triangleCount(art: StationArt): number {
  let n = 0;
  for (const { mesh, matrices } of placed(art)) {
    const g = mesh.geometry;
    n += ((g.index ? g.index.count : g.attributes.position!.count) / 3) * matrices.length;
  }
  return n;
}

function meshCount(art: StationArt): number {
  let n = 0;
  art.object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
}

/** Light point positions, station-local. */
function lightPositions(art: StationArt): THREE.Vector3[] {
  art.object.updateMatrixWorld(true);
  const inv = art.object.matrixWorld.clone().invert();
  const out: THREE.Vector3[] = [];
  art.object.traverse((o) => {
    const pts = o as THREE.Points;
    if (!pts.isPoints) return;
    const m = inv.clone().multiply(pts.matrixWorld);
    const pos = pts.geometry.attributes.position!;
    for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m));
  });
  return out;
}

/** Exact hash of every vertex and light, per mesh. */
function fingerprint(art: StationArt): string[] {
  const out: string[] = [];
  art.object.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (!g) return;
    const arr = g.attributes.position!.array as Float32Array;
    const bits = new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
    let h = 0x811c9dc5;
    for (let i = 0; i < bits.length; i++) h = Math.imul(h ^ bits[i]!, 0x01000193);
    const col = g.attributes.color ?? g.attributes.aColor;
    if (col) {
      const c = col.array as Float32Array;
      const cb = new Uint32Array(c.buffer, c.byteOffset, c.length);
      for (let i = 0; i < cb.length; i++) h = Math.imul(h ^ cb[i]!, 0x01000193);
    }
    out.push(`${o.parent?.name}/${o.name}:${arr.length / 3}:${(h >>> 0).toString(16)}`);
  });
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Approach corridor geometry.
 * ---------------------------------------------------------------------------------------------- */

interface Corridor {
  p: THREE.Vector3;
  a: THREE.Vector3;
  s0: number;
  s1: number;
  r: number;
}

const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const pv = new THREE.Vector3();
const tv = new THREE.Vector3();
const qv = new THREE.Vector3();

/** Möller–Trumbore, double-sided: distance along the ray to the triangle, or -1. */
function rayTriangle(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  e1.subVectors(b, a);
  e2.subVectors(c, a);
  pv.crossVectors(d, e2);
  const det = e1.dot(pv);
  if (Math.abs(det) < 1e-9) return -1;
  const inv = 1 / det;
  tv.subVectors(o, a);
  const u = tv.dot(pv) * inv;
  if (u < 0 || u > 1) return -1;
  qv.crossVectors(tv, e1);
  const v = d.dot(qv) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = e2.dot(qv) * inv;
  return t >= 0 ? t : -1;
}

/** True if the triangle reaches into the corridor (a finite cylinder). */
function hitsCorridor(A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3, cor: Corridor): boolean {
  const verts = [A, B, C];
  const s: number[] = [];
  const L: THREE.Vector3[] = [];
  for (const v of verts) {
    const d = v.clone().sub(cor.p);
    const sv = d.dot(cor.a);
    s.push(sv);
    L.push(d.addScaledVector(cor.a, -sv));
  }
  if (Math.max(...s) < cor.s0 || Math.min(...s) > cor.s1) return false;
  const maxEdge = Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A));
  if (Math.min(...L.map((l) => l.length())) - maxEdge > cor.r) return false;
  for (let i = 0; i < 3; i++) if (s[i]! >= cor.s0 && s[i]! <= cor.s1 && L[i]!.length() < cor.r) return true;
  // Edges: closest approach to the axis within the corridor's length.
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const ds = s[j]! - s[i]!;
    let lo = 0;
    let hi = 1;
    if (Math.abs(ds) < 1e-9) {
      if (s[i]! < cor.s0 || s[i]! > cor.s1) continue;
    } else {
      const t0 = (cor.s0 - s[i]!) / ds;
      const t1 = (cor.s1 - s[i]!) / ds;
      lo = Math.max(0, Math.min(t0, t1));
      hi = Math.min(1, Math.max(t0, t1));
      if (lo > hi) continue;
    }
    const D = L[j]!.clone().sub(L[i]!);
    const dd = D.lengthSq();
    const t = dd < 1e-12 ? lo : Math.min(hi, Math.max(lo, -L[i]!.dot(D) / dd));
    if (L[i]!.clone().addScaledVector(D, t).length() < cor.r) return true;
  }
  // The axis itself piercing the face.
  const start = cor.p.clone().addScaledVector(cor.a, cor.s0);
  const hit = rayTriangle(start, cor.a, A, B, C);
  return hit >= 0 && hit <= cor.s1 - cor.s0;
}

function corridorOf(art: StationArt, s0: number, s1: number, r: number): Corridor {
  return { p: art.dockPoint.clone(), a: art.dockApproach.clone().normalize(), s0, s1, r };
}

/** First blocking triangle, described for a readable failure. */
function corridorBlocker(art: StationArt, cor: Corridor): string | null {
  let found: string | null = null;
  forEachTriangle(art, (a, b, c) => {
    if (!hitsCorridor(a, b, c, cor)) return false;
    found = [a, b, c].map((v) => v.toArray().map((x) => x.toFixed(1)).join(',')).join(' | ');
    return true;
  });
  return found;
}

/** Nearest geometry along a ray from `o` (station-local), or Infinity. */
function nearestHit(art: StationArt, o: THREE.Vector3, d: THREE.Vector3): number {
  let best = Infinity;
  forEachTriangle(art, (a, b, c) => {
    const t = rayTriangle(o, d, a, b, c);
    if (t >= 0 && t < best) best = t;
  });
  return best;
}

/* ------------------------------------------------------------------------------------------------ */

describe('generated station exteriors', () => {
  it('builds every type for every owner', () => {
    for (const type of STATION_TYPES) {
      for (const owner of STATION_OWNERS) {
        const art = createGeneratedStation(lookOf(type, owner), ctxFor('medium'));
        const label = `${type}/${owner}`;
        expect(meshCount(art), label).toBeGreaterThanOrEqual(3);
        art.object.traverse((o) => {
          const g = (o as THREE.Mesh).geometry;
          if (g) expect((g.attributes.position!.array as Float32Array).every(Number.isFinite), `${label} ${o.name}`).toBe(true);
        });
        expect(lightPositions(art).length, label).toBeGreaterThan(8);
        expect(art.radius, label).toBeGreaterThan(80);
        expect(art.radius, label).toBeLessThan(345);
        expect(art.dockApproach.length(), label).toBeCloseTo(1, 6);
        expect(art.dockPoint.length(), label).toBeLessThan(art.radius);
        expect(() => art.update?.(1 / 60, 1, new THREE.PerspectiveCamera())).not.toThrow();
        art.dispose();
      }
    }
  }, SLOW);

  it('is deterministic: the same look builds the same geometry, another seed a different one', () => {
    for (const type of STATION_TYPES) {
      const look = lookOf(type, 'independent', { seed: 12345, wear: 0.6 });
      const a = createGeneratedStation(look, ctxFor('medium'));
      const b = createGeneratedStation({ ...look }, ctxFor('medium'));
      expect(fingerprint(b), type).toEqual(fingerprint(a));
      expect(b.radius).toBe(a.radius);
      expect(b.dockPoint.toArray()).toEqual(a.dockPoint.toArray());
      const c = createGeneratedStation({ ...look, seed: 54321 }, ctxFor('medium'));
      expect(fingerprint(c), type).not.toEqual(fingerprint(a));
      for (const s of [a, b, c]) s.dispose();
    }
  }, SLOW);

  it('owners paint the same station differently, size scales it', () => {
    for (const type of STATION_TYPES) {
      const sta = createGeneratedStation(lookOf(type, 'sta'), ctxFor('low'));
      const wake = createGeneratedStation(lookOf(type, 'hollow-wake'), ctxFor('low'));
      expect(fingerprint(wake), type).not.toEqual(fingerprint(sta));
      const small = createGeneratedStation(lookOf(type, 'sta', { size: 0 }), ctxFor('low'));
      const large = createGeneratedStation(lookOf(type, 'sta', { size: 1 }), ctxFor('low'));
      expect(large.radius, type).toBeGreaterThan(small.radius * 1.2);
      // The built radius lands near the nominal one used for placement.
      for (const [art, size] of [
        [small, 0],
        [large, 1],
      ] as const) {
        const nominal = nominalStationRadius(type, size);
        expect(art.radius / nominal, `${type} size ${size}`).toBeGreaterThan(0.7);
        expect(art.radius / nominal, `${type} size ${size}`).toBeLessThan(1.12);
      }
      for (const s of [sta, wake, small, large]) s.dispose();
    }
  }, SLOW);

  it('radius encloses every vertex and light in every animated pose', () => {
    for (const type of STATION_TYPES) {
      for (const size of [0, 1]) {
        const art = createGeneratedStation(lookOf(type, 'frontier', { size, seed: 3 + size }), ctxFor('medium'));
        for (const t of TIMES) {
          art.update?.(1 / 30, t, new THREE.PerspectiveCamera());
          let far = 0;
          forEachTriangle(art, (a, b, c) => {
            far = Math.max(far, a.length(), b.length(), c.length());
          });
          for (const p of lightPositions(art)) far = Math.max(far, p.length());
          expect(far, `${type} size ${size} t ${t}`).toBeLessThanOrEqual(art.radius);
          // ... and is not loose: the mesh reaches most of the way out.
          if (t === 0) expect(far / art.radius, `${type} size ${size}`).toBeGreaterThan(0.93);
        }
        art.dispose();
      }
    }
  }, SLOW);

  it('keeps the dock point outside the hull and the approach corridor clear at every pose', () => {
    for (const type of STATION_TYPES) {
      for (const owner of STATION_OWNERS) {
        for (const [size, seed] of [
          [0, 11],
          [1, 12],
        ] as const) {
          const art = createGeneratedStation(lookOf(type, owner, { size, seed, wear: 1 }), ctxFor('medium'));
          const label = `${type}/${owner} size ${size}`;
          for (const t of TIMES) {
            art.update?.(1 / 30, t, new THREE.PerspectiveCamera());
            const cor = corridorOf(art, 0, DOCK_CORRIDOR.length, DOCK_CORRIDOR.radius);
            expect(corridorBlocker(art, cor), `${label} t ${t}`).toBeNull();
          }
          // Just outside a real bay: the lit back wall is a short way behind the dock point, with
          // open space between (a clear ring round the dock point), and nothing in front.
          const back = nearestHit(art, art.dockPoint, art.dockApproach.clone().negate());
          expect(back, label).toBeGreaterThan(20);
          expect(back, label).toBeLessThan(90);
          expect(corridorBlocker(art, corridorOf(art, -8, 0, 8)), label).toBeNull();
          expect(nearestHit(art, art.dockPoint, art.dockApproach), label).toBe(Infinity);
          art.dispose();
        }
      }
    }
  }, SLOW);

  it('stays within the draw-call and triangle budgets at every quality', () => {
    for (const quality of QUALITIES) {
      for (const type of STATION_TYPES) {
        for (const owner of STATION_OWNERS) {
          // The heaviest case: the largest size with the most wear detail.
          const art = createGeneratedStation(lookOf(type, owner, { size: 1, wear: 1, seed: 99 }), ctxFor(quality));
          const label = `${type}/${owner} ${quality}`;
          expect(meshCount(art), label).toBeLessThanOrEqual(MAX_STATION_MESHES);
          expect(triangleCount(art), label).toBeLessThanOrEqual(STATION_TRIANGLE_BUDGET[quality]);
          art.dispose();
        }
      }
    }
  }, SLOW);

  it('wear dims and drops lights but never the bay lights', () => {
    for (const type of STATION_TYPES) {
      const clean = createGeneratedStation(lookOf(type, 'independent', { wear: 0 }), ctxFor('low'));
      const worn = createGeneratedStation(lookOf(type, 'independent', { wear: 1 }), ctxFor('low'));
      expect(lightPositions(worn).length, type).toBeLessThan(lightPositions(clean).length);
      // Bay lights: something bright stays right at the dock mouth.
      const nearDock = lightPositions(worn).filter((p) => p.distanceTo(worn.dockPoint) < 60);
      expect(nearDock.length, type).toBeGreaterThanOrEqual(6);
      clean.dispose();
      worn.dispose();
    }
  }, SLOW);

  it('rejects unknown types, paints unknown owners as independents and clamps size and wear', () => {
    expect(() => createGeneratedStation({ ...lookOf('relay', 'sta'), type: 'moon-base' as StationType }, ctxFor('low'))).toThrow(/unknown station type/);
    const odd = createGeneratedStation({ ...lookOf('relay', 'independent'), owner: 'nobody' as StationOwner }, ctxFor('low'));
    const indie = createGeneratedStation(lookOf('relay', 'independent'), ctxFor('low'));
    expect(fingerprint(odd)).toEqual(fingerprint(indie));
    const wild = createGeneratedStation(lookOf('relay', 'sta', { size: 7, wear: -3 }), ctxFor('low'));
    const tame = createGeneratedStation(lookOf('relay', 'sta', { size: 1, wear: 0 }), ctxFor('low'));
    expect(fingerprint(wild)).toEqual(fingerprint(tame));
    for (const s of [odd, indie, wild, tame]) s.dispose();
  }, SLOW);

  it('dispose frees every geometry and the light materials, never the shared materials', () => {
    for (const type of STATION_TYPES) {
      const art = createGeneratedStation(lookOf(type, 'sta'), ctxFor('high'));
      const other = createGeneratedStation(lookOf(type, 'sta'), ctxFor('high'));
      const geos = new Map<THREE.BufferGeometry, boolean>();
      const mats = new Map<THREE.Material, boolean>();
      art.object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && !geos.has(m.geometry)) {
          geos.set(m.geometry, false);
          m.geometry.addEventListener('dispose', () => geos.set(m.geometry, true));
        }
        const mat = m.material as THREE.Material | undefined;
        if (mat && !mats.has(mat)) {
          mats.set(mat, false);
          mat.addEventListener('dispose', () => mats.set(mat, true));
        }
      });
      // Nothing is shared between two stations but the standard materials.
      other.object.traverse((o) => {
        const g = (o as THREE.Mesh).geometry;
        if (g) expect(geos.has(g), type).toBe(false);
      });
      art.dispose();
      for (const [geo, disposed] of geos) expect(disposed, `${type} geometry ${geo.type}`).toBe(true);
      for (const [m, disposed] of mats) expect(disposed, `${type} ${m.type}`).toBe(!isShared(m));
      expect([...mats.keys()].some((m) => m instanceof THREE.ShaderMaterial), type).toBe(true);
      // Disposing twice is harmless; the other station still animates.
      expect(() => art.dispose()).not.toThrow();
      expect(() => other.update?.(1 / 60, 2, new THREE.PerspectiveCamera())).not.toThrow();
      other.dispose();
    }
  }, SLOW);
});
