import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getCatalog } from '../../src/content/catalog.ts';
import { RULES } from '../../src/content/rules/index.ts';
import type { ShipClassId, ShipModel } from '../../src/content/types.ts';
import { buildBlueprint } from '../../src/world/art/shipgen/blueprint.ts';
import {
  MAX_IDLE_BLUEPRINTS,
  clearShipArtCache,
  createCatalogShipArt,
  createShipModelArt,
  shipArtCacheStats,
  shipModelArtOptions,
} from '../../src/world/art/shipgen/index.ts';
import type { GeneratedShipArt } from '../../src/world/art/shipgen/index.ts';
import type { ArtContext, QualityLevel } from '../../src/world/art/types.ts';

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

const catalog = getCatalog();
const QUALITIES: readonly QualityLevel[] = ['low', 'medium', 'high'];
const TRIANGLE_BUDGET: Record<QualityLevel, number> = { low: 3000, medium: 6000, high: 10000 };
const HULL_KEYS = new Set(['hull', 'metal', 'glass', 'glassRed', 'glassWarm', 'emissive']);
const ctxFor = (quality: QualityLevel): ArtContext => ({ quality, reducedMotion: false });
const gunSlots = (m: ShipModel): number => m.slots.filter((s) => s.type === 'gun').length;
/** The first catalogue model of a class. */
const firstOf = (cls: ShipClassId): ShipModel => catalog.ships.find((s) => s.class === cls)!;
const classRadius = (id: ShipClassId): number => RULES.classes.find((c) => c.id === id)!.base.radius;

/** The merged hull meshes (plumes, glows, lights and shield are per ship and excluded). */
function hullMeshes(art: GeneratedShipArt): THREE.Mesh[] {
  return art.object.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh && HULL_KEYS.has(c.name));
}

/** Vertex count and an exact hash of the vertex bits of each hull mesh. */
function fingerprint(art: GeneratedShipArt): string[] {
  return hullMeshes(art).map((m) => {
    const arr = m.geometry.attributes.position!.array as Float32Array;
    const bits = new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
    let h = 0x811c9dc5;
    for (let i = 0; i < bits.length; i++) h = Math.imul(h ^ bits[i]!, 0x01000193);
    return `${m.name}:${arr.length / 3}:${(h >>> 0).toString(16)}`;
  });
}

/** Largest distance of any hull vertex from the ship origin. */
function boundingRadius(art: GeneratedShipArt): number {
  let r = 0;
  const v = new THREE.Vector3();
  for (const m of hullMeshes(art)) {
    const pos = m.geometry.attributes.position!;
    for (let i = 0; i < pos.count; i++) r = Math.max(r, v.fromBufferAttribute(pos, i).length());
  }
  return r;
}

function triangles(art: GeneratedShipArt): number {
  return hullMeshes(art).reduce((n, m) => n + m.geometry.attributes.position!.count / 3, 0);
}

beforeAll(stubCanvas);
afterAll(() => {
  if (stubbed) delete (globalThis as { document?: unknown }).document;
});
afterEach(() => clearShipArtCache());

describe('generated catalogue ships', () => {
  it('builds every catalogue model at every quality, within the draw-call and triangle budgets', () => {
    expect(catalog.ships.length).toBeGreaterThanOrEqual(39);
    for (const quality of QUALITIES) {
      for (const model of catalog.ships) {
        const art = createCatalogShipArt(model, ctxFor(quality));
        const meshes = hullMeshes(art);
        expect(meshes.length, model.id).toBeGreaterThanOrEqual(3);
        for (const m of meshes) {
          const arr = m.geometry.attributes.position!.array as Float32Array;
          expect(arr.every(Number.isFinite), `${model.id} ${m.name}`).toBe(true);
        }
        expect(art.length, model.id).toBeGreaterThan(0);
        expect(art.nozzles.length, model.id).toBeGreaterThan(0);
        expect(triangles(art), `${model.id} ${quality}`).toBeLessThanOrEqual(TRIANGLE_BUDGET[quality]);
        // Hull meshes plus nozzle glows and nav lights (the plumes and the shield come on top).
        let calls = 0;
        art.object.traverseVisible((n) => {
          if (((n as THREE.Mesh).isMesh || (n as THREE.Points).isPoints) && n.name !== 'plumes') calls++;
        });
        expect(calls, model.id).toBeLessThanOrEqual(8);
        art.dispose();
      }
      clearShipArtCache();
    }
  });

  it('is deterministic: the same id builds the same geometry', () => {
    for (const model of catalog.ships) {
      const a = createCatalogShipArt(model, ctxFor('medium'));
      const first = fingerprint(a);
      const muzzles = a.muzzles.map((m) => m.toArray());
      a.dispose();
      clearShipArtCache();
      const b = createCatalogShipArt(model, ctxFor('medium'));
      expect(fingerprint(b), model.id).toEqual(first);
      expect(b.muzzles.map((m) => m.toArray()), model.id).toEqual(muzzles);
      b.dispose();
    }
  });

  it('varies details with the id, keeping the silhouette', () => {
    const base = shipModelArtOptions(firstOf('courier'));
    const a = buildBlueprint(base, 'medium');
    const b = buildBlueprint({ ...base, id: `${base.id}.variant` }, 'medium');
    const flat = (bp: typeof a) => bp.parts.flatMap((p) => Array.from(p.geometry.attributes.position!.array as Float32Array));
    expect(flat(b)).not.toEqual(flat(a));
    expect(b.muzzles.length).toBe(a.muzzles.length);
    expect(b.engine.nozzles.length).toBe(a.engine.nozzles.length);
    expect(b.length / a.length).toBeGreaterThan(0.9);
    expect(b.length / a.length).toBeLessThan(1.1);
  });

  it('faces -Z: guns at the front, engines at the back', () => {
    for (const model of catalog.ships) {
      const art = createCatalogShipArt(model, ctxFor('low'));
      const front = Math.max(...art.muzzles.map((m) => m.z));
      const back = Math.min(...art.nozzles.map((n) => n.z));
      expect(front, model.id).toBeLessThan(0);
      expect(back, model.id).toBeGreaterThan(0);
      // The nose is the far end from the engines.
      const box = new THREE.Box3();
      for (const m of hullMeshes(art)) box.union(m.geometry.boundingBox!);
      expect(-box.min.z, model.id).toBeGreaterThan(art.length * 0.4);
      expect(box.max.z - back, model.id).toBeLessThan(art.length * 0.15);
      art.dispose();
    }
  });

  it('places one muzzle per gun slot', () => {
    for (const model of catalog.ships) {
      const art = createCatalogShipArt(model, ctxFor('low'));
      expect(art.muzzles.length, model.id).toBe(gunSlots(model));
      art.dispose();
    }
    // Gun counts outside the catalogue still come out exact.
    const courier = shipModelArtOptions(firstOf('courier'));
    for (const guns of [0, 1, 3, 7]) {
      const art = createShipModelArt({ ...courier, guns }, ctxFor('low'));
      expect(art.muzzles.length, `${guns} guns`).toBe(guns);
      art.dispose();
    }
  });

  it('fills the class collision radius (within 25%), big classes clearly bigger than fighters', () => {
    const radius = new Map<string, number>();
    for (const model of catalog.ships) {
      const art = createCatalogShipArt(model, ctxFor('low'));
      const r = boundingRadius(art);
      const cls = classRadius(model.class);
      expect(r / cls, model.id).toBeGreaterThan(0.75);
      expect(r / cls, model.id).toBeLessThan(1.25);
      expect(art.radius / cls, model.id).toBeGreaterThan(0.75);
      expect(art.radius / cls, model.id).toBeLessThan(1.25);
      radius.set(model.id, r);
      art.dispose();
    }
    const of = (...classes: ShipClassId[]) => catalog.ships.filter((s) => classes.includes(s.class)).map((s) => radius.get(s.id)!);
    expect(Math.min(...of('freighter', 'gunship'))).toBeGreaterThan(Math.max(...of('light-fighter', 'heavy-fighter')));
  });
});

describe('shared geometry', () => {
  const model = (): ShipModel => firstOf('gunship');

  /** Geometries and materials in a ship, with a flag that flips when each is disposed. */
  function track(art: GeneratedShipArt): Map<THREE.BufferGeometry | THREE.Material, boolean> {
    const seen = new Map<THREE.BufferGeometry | THREE.Material, boolean>();
    art.object.traverse((n) => {
      const mesh = n as THREE.Mesh;
      for (const res of [mesh.geometry, mesh.material as THREE.Material | undefined]) {
        if (!res || seen.has(res)) continue;
        seen.set(res, false);
        res.addEventListener('dispose', () => seen.set(res, true));
      }
    });
    return seen;
  }

  it('reuses the model geometry and frees only what each ship created', () => {
    const ctx = ctxFor('medium');
    const a = createCatalogShipArt(model(), ctx);
    const b = createCatalogShipArt(model(), ctx);
    const shared = hullMeshes(a).map((m) => m.geometry);
    expect(hullMeshes(b).map((m) => m.geometry)).toEqual(shared);
    expect(shipArtCacheStats()).toMatchObject({ models: 1, ships: 2 });

    const ta = track(a);
    const tb = track(b);
    a.dispose();
    for (const [res, disposed] of ta) {
      const isShared = shared.includes(res as THREE.BufferGeometry) || hullMeshes(a).some((m) => m.material === res);
      expect(disposed, `${res.type} ${isShared ? 'shared' : 'own'}`).toBe(!isShared);
    }
    expect([...tb.values()].some(Boolean)).toBe(false);
    // The survivor keeps working; disposing twice changes nothing.
    b.setThrottle(1);
    b.flashShield(1);
    expect(() => b.update?.(1 / 60, 1, new THREE.PerspectiveCamera())).not.toThrow();
    a.dispose();
    expect([...tb.values()].some(Boolean)).toBe(false);

    b.dispose();
    expect(shipArtCacheStats()).toMatchObject({ models: 1, ships: 0 });
    // Idle models stay cached for respawns until the cache is cleared.
    expect(shared.every((g) => tb.get(g) === false)).toBe(true);
    const c = createCatalogShipArt(model(), ctx);
    expect(hullMeshes(c).map((m) => m.geometry)).toEqual(shared);
    c.dispose();
    clearShipArtCache();
    expect(shared.every((g) => tb.get(g) === true)).toBe(true);
    expect(shipArtCacheStats().models).toBe(0);
    const d = createCatalogShipArt(model(), ctx);
    expect(hullMeshes(d)[0]!.geometry).not.toBe(shared[0]);
    d.dispose();
  });

  it('keeps only a few unused models around', () => {
    const ctx = ctxFor('low');
    for (const m of catalog.ships.slice(0, MAX_IDLE_BLUEPRINTS + 6)) createCatalogShipArt(m, ctx).dispose();
    expect(shipArtCacheStats()).toMatchObject({ models: MAX_IDLE_BLUEPRINTS, ships: 0 });
  });

  it('drives plumes and the shield like the hand-built ships', () => {
    const art = createCatalogShipArt(model(), ctxFor('high'));
    const plume = art.object.getObjectByName('plumes') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const shield = art.object.getObjectByName('shield')!;
    const cam = new THREE.PerspectiveCamera();
    art.update?.(1, 1, cam);
    const idle = plume.material.uniforms.uLength!.value as number;
    art.setThrottle(1);
    art.setBoost(true);
    for (let i = 0; i < 60; i++) art.update?.(1 / 30, 1 + i / 30, cam);
    expect(plume.material.uniforms.uLength!.value).toBeGreaterThan(idle * 2);
    expect(shield.visible).toBe(false);
    art.flashShield(1);
    expect(shield.visible).toBe(true);
    for (let i = 0; i < 120; i++) art.update?.(1 / 30, 3 + i / 30, cam);
    expect(shield.visible).toBe(false);
    art.dispose();
  });
});
