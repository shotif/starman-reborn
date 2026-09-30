import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { StationKind } from '../../src/world/art/stations.ts';
import type { QualityLevel } from '../../src/world/art/types.ts';
import { isShared } from '../../src/world/art/util.ts';
import { ROOM_ORDER, createStationInterior } from '../../src/world/rooms/index.ts';
import type { RoomView, StationInterior, StationInteriorOptions } from '../../src/world/rooms/index.ts';
import { SCENE_DEFS } from '../../src/world/systems/index.ts';

/**
 * Station interiors in a node environment (no WebGL): structure, view transitions, determinism,
 * budgets per quality, hotspots and disposal. The shared art textures draw on a 2D canvas, so a
 * minimal no-op canvas stands in for `document` here; the interior's own textures are pixel buffers.
 */

function installCanvasStub(): void {
  if ((globalThis as { document?: unknown }).document) return;
  const stub = (): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'getImageData' || prop === 'createImageData') {
          return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
        }
        return stub();
      },
      apply() {
        return stub();
      },
      set() {
        return true;
      },
    });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub() }),
  };
}

const STATIONS: StationKind[] = ['earth-port', 'mars-depot', 'proxima-outpost', 'barnard-relay', 'sirius-platform', 'eridani-hub'];
const SYSTEM: Record<StationKind, keyof typeof SCENE_DEFS> = {
  'earth-port': 'sol',
  'mars-depot': 'sol',
  'proxima-outpost': 'alpha-centauri',
  'barnard-relay': 'barnard',
  'sirius-platform': 'sirius',
  'eridani-hub': 'epsilon-eridani',
};
const ALL: RoomView[] = ['deck', 'trader', 'outfitter', 'bar'];

function options(station: StationKind, rooms: readonly RoomView[] = ALL, seed = 7): StationInteriorOptions {
  const def = SCENE_DEFS[SYSTEM[station]];
  return { station, skybox: def.skybox, starColor: def.stars[0]!.color, seed, rooms };
}

function build(station: StationKind, quality: QualityLevel = 'medium', rooms: readonly RoomView[] = ALL, seed = 7, reducedMotion = false): StationInterior {
  return createStationInterior(options(station, rooms, seed), { quality, reducedMotion });
}

interface Stats {
  drawCalls: number;
  triangles: number;
  maxTexture: number;
}

/** Whole scene, every room (visible or not). */
function stats(interior: StationInterior): Stats {
  let drawCalls = 0;
  let triangles = 0;
  let maxTexture = 0;
  interior.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    drawCalls += mats.length;
    if (mesh.isMesh) {
      const g = mesh.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position!.count) / 3;
    }
    for (const m of mats) {
      for (const v of Object.values(m as unknown as Record<string, unknown>)) {
        if (v instanceof THREE.Texture) {
          const img = v.image as { width?: number; height?: number } | undefined;
          maxTexture = Math.max(maxTexture, img?.width ?? 0, img?.height ?? 0);
        }
      }
    }
  });
  return { drawCalls, triangles, maxTexture };
}

function roomGroup(interior: StationInterior, name: 'hangar' | 'bar'): THREE.Object3D | undefined {
  return interior.scene.children.find((c) => c.name === name);
}

beforeAll(() => {
  installCanvasStub();
});

describe('station interiors: structure and views', () => {
  it.each(STATIONS)('%s builds every requested room and starts on the deck', (station) => {
    const interior = build(station);
    expect(interior.rooms).toEqual(ALL);
    expect(interior.view).toBe('deck');
    expect(roomGroup(interior, 'hangar')).toBeDefined();
    expect(roomGroup(interior, 'bar')).toBeDefined();
    expect(interior.camera).toBeInstanceOf(THREE.PerspectiveCamera);
    interior.resize(1440, 900);
    interior.update(1 / 30);
    expect(Number.isFinite(interior.camera.position.x)).toBe(true);
    interior.dispose();
  });

  it('moves between hangar views and cuts to and from the bar', () => {
    const interior = build('earth-port');
    interior.resize(1280, 720);
    expect(interior.setView('trader')).toBe('move');
    expect(interior.view).toBe('trader');
    expect(interior.setView('outfitter')).toBe('move');
    expect(interior.setView('bar')).toBe('cut');
    expect(interior.view).toBe('bar');
    expect(roomGroup(interior, 'bar')!.visible).toBe(true);
    expect(roomGroup(interior, 'hangar')!.visible).toBe(false);
    expect(interior.setView('deck')).toBe('cut');
    expect(roomGroup(interior, 'hangar')!.visible).toBe(true);
    expect(roomGroup(interior, 'bar')!.visible).toBe(false);
    // Already there: nothing to animate.
    expect(interior.setView('deck')).toBe('move');
    // Instant jumps are cuts, even between hangar views.
    expect(interior.setView('trader', true)).toBe('cut');
    interior.dispose();
  });

  it('eases a hangar move over ~1.2 s and settles on the new shot', () => {
    const interior = build('mars-depot');
    interior.resize(1280, 720);
    interior.update(0.5);
    const start = interior.camera.position.clone();
    interior.setView('trader');
    // Frames are clamped to 100 ms (like the game loop), so step in frames.
    for (let i = 0; i < 15; i++) interior.update(1 / 30);
    const mid = interior.camera.position.clone();
    for (let i = 0; i < 40; i++) interior.update(1 / 30);
    const end = interior.camera.position.clone();
    expect(mid.distanceTo(start)).toBeGreaterThan(0.5);
    expect(mid.distanceTo(end)).toBeGreaterThan(0.5);
    // Settled: only the slow idle drift remains.
    interior.update(1 / 30);
    expect(interior.camera.position.distanceTo(end)).toBeLessThan(0.2);
    interior.dispose();
  });

  it('jumps instead of moving with reduced motion, and barely drifts', () => {
    const interior = build('eridani-hub', 'low', ALL, 7, true);
    interior.resize(1280, 720);
    interior.update(0.1);
    expect(interior.setView('outfitter')).toBe('cut');
    interior.update(0.1);
    const a = interior.camera.position.clone();
    for (let i = 0; i < 90; i++) interior.update(1 / 30);
    expect(interior.camera.position.distanceTo(a)).toBeLessThan(0.15);
    interior.dispose();
  });

  it('omits rooms the station does not offer and keeps the canonical order', () => {
    const onlyDeck = build('barnard-relay', 'low', ['deck']);
    expect(onlyDeck.rooms).toEqual(['deck']);
    expect(roomGroup(onlyDeck, 'bar')).toBeUndefined();
    expect(onlyDeck.setView('bar')).toBe('move');
    expect(onlyDeck.view).toBe('deck');
    onlyDeck.dispose();

    const some = build('barnard-relay', 'low', ['bar', 'trader']);
    expect(some.rooms).toEqual(['deck', 'trader', 'bar']);
    expect(some.setView('outfitter')).toBe('move');
    expect(some.view).toBe('deck');
    some.dispose();
    expect(ROOM_ORDER).toEqual(ALL);
  });
});

describe('station interiors: determinism', () => {
  const fingerprint = (interior: StationInterior): string => {
    const parts: string[] = [];
    interior.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(o as THREE.Points).isPoints) return;
      const pos = mesh.geometry.attributes.position!;
      let sum = 0;
      for (let i = 0; i < pos.array.length; i += 7) sum += pos.array[i]! * ((i % 13) + 1);
      parts.push(`${o.parent?.name}/${o.name}:${pos.count}:${sum.toFixed(3)}`);
    });
    return parts.join('|');
  };

  it('is deterministic by seed', () => {
    const a = build('eridani-hub', 'medium', ALL, 21);
    const b = build('eridani-hub', 'medium', ALL, 21);
    const c = build('eridani-hub', 'medium', ALL, 22);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).not.toBe(fingerprint(c));
    for (const i of [a, b, c]) i.dispose();
  });

  it('gives each station its own look', () => {
    const prints = new Set(STATIONS.map((s) => {
      const i = build(s, 'low');
      const f = fingerprint(i);
      i.dispose();
      return f;
    }));
    expect(prints.size).toBe(STATIONS.length);
  });
});

describe('station interiors: budgets', () => {
  const LIMITS: Record<QualityLevel, { calls: number; tris: number; tex: number }> = {
    low: { calls: 60, tris: 60_000, tex: 512 },
    medium: { calls: 90, tris: 110_000, tex: 1024 },
    high: { calls: 120, tris: 150_000, tex: 1024 },
  };

  for (const quality of ['low', 'medium', 'high'] as const) {
    it.each(STATIONS)(`%s stays within the ${quality} budget`, (station) => {
      const interior = build(station, quality);
      const s = stats(interior);
      expect(s.drawCalls).toBeLessThanOrEqual(LIMITS[quality].calls);
      expect(s.triangles).toBeLessThanOrEqual(LIMITS[quality].tris);
      expect(s.maxTexture).toBeLessThanOrEqual(LIMITS[quality].tex);
      interior.dispose();
    });
  }

  it.each(STATIONS)('%s uses one ambient and at most four point/spot/directional lights per room', (station) => {
    const interior = build(station, 'high');
    for (const name of ['hangar', 'bar'] as const) {
      const group = roomGroup(interior, name)!;
      let ambient = 0;
      let dynamic = 0;
      let shadows = 0;
      group.traverse((o) => {
        const l = o as THREE.Light;
        if (!l.isLight) return;
        if ((l as THREE.HemisphereLight).isHemisphereLight || (l as THREE.AmbientLight).isAmbientLight) ambient++;
        else dynamic++;
        if (l.castShadow) shadows++;
      });
      expect(ambient).toBe(1);
      expect(dynamic).toBeLessThanOrEqual(4);
      expect(shadows).toBe(0);
    }
    interior.dispose();
  });

  it('builds quickly once shared caches are warm', () => {
    build('earth-port', 'high').dispose();
    const t0 = performance.now();
    const interior = build('mars-depot', 'high');
    const ms = performance.now() - t0;
    interior.dispose();
    // The target is ~150 ms on a desktop browser; the bound here only guards against regressions on slow CI.
    expect(ms).toBeLessThan(1500);
  });
});

describe('station interiors: hotspots and framing', () => {
  it.each(STATIONS)('%s: the bar lists the bartender and patrons with labels', (station) => {
    const interior = build(station);
    interior.resize(1280, 720);
    interior.setView('bar');
    interior.update(1 / 30);
    const spots = interior.hotspots();
    const ids = spots.map((s) => s.id);
    expect(ids[0]).toBe('bartender');
    expect(ids.filter((id) => id.startsWith('patron-')).length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of spots) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
      if (s.visible) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(1280);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(720);
      }
    }
    // On a desktop screen everyone in the bar is in the shot.
    expect(spots.filter((s) => !s.visible).map((s) => s.id)).toEqual([]);
    interior.dispose();
  });

  it('keeps the subject in frame on portrait and landscape phones', () => {
    for (const [w, h] of [
      [1440, 900],
      [844, 390],
      [390, 844],
      [360, 640],
    ] as const) {
      for (const station of STATIONS) {
        const interior = build(station, 'low');
        interior.resize(w, h);
        interior.update(1 / 30);
        const ship = interior.hotspots().find((s) => s.id === 'ship')!;
        expect(ship.visible).toBe(true);
        // The ship sits in the band the UI leaves free (below the top rail, above the bottom rail).
        expect(ship.y / h).toBeGreaterThan(0.15);
        expect(ship.y / h).toBeLessThan(0.8);
        interior.setView('bar');
        interior.update(1 / 30);
        const bartender = interior.hotspots().find((s) => s.id === 'bartender')!;
        expect(bartender.visible).toBe(true);
        expect(bartender.y / h).toBeGreaterThan(0.15);
        expect(bartender.y / h).toBeLessThan(0.8);
        interior.dispose();
      }
    }
  });

  it.each(STATIONS)('%s: the hangar views mark the ship, the dealer and the mechanic (desktop and phone)', (station) => {
    const interior = build(station, 'medium');
    for (const [w, h] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      interior.setView('deck', true);
      interior.resize(w, h);
      interior.update(1 / 30);
      const ship = interior.hotspots();
      expect(ship.map((s) => s.id)).toEqual(['ship']);
      expect(ship[0]!.label).toBe('Your ship');
      expect(ship[0]!.visible).toBe(true);
      for (const [view, id] of [
        ['trader', 'dealer'],
        ['outfitter', 'mechanic'],
      ] as const) {
        interior.setView(view, true);
        interior.update(1 / 30);
        const spots = interior.hotspots();
        expect(spots.map((s) => s.id)).toEqual([id]);
        expect(spots[0]!.visible, `${id} at ${w}x${h}`).toBe(true);
      }
    }
    interior.dispose();
  });

  it('widens the field of view for portrait screens', () => {
    const interior = build('sirius-platform', 'low');
    interior.resize(1440, 900);
    interior.update(1 / 30);
    const wide = interior.camera.fov;
    interior.resize(390, 844);
    interior.update(1 / 30);
    expect(interior.camera.fov).toBeGreaterThan(wide);
    expect(interior.camera.aspect).toBeCloseTo(390 / 844, 5);
    interior.dispose();
  });
});

describe('station interiors: disposal', () => {
  it.each(['low', 'high'] as const)('disposes every owned geometry, material and texture (%s)', (quality) => {
    const interior = build('proxima-outpost', quality);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    interior.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.geometry) return;
      geometries.add(mesh.geometry);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(m);
        for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) textures.add(v);
      }
    });
    const env = interior.scene.environment;
    if (env) textures.add(env);
    const disposed = new Set<object>();
    const watch = (r: THREE.EventDispatcher<{ dispose: object }> & object): void => r.addEventListener('dispose', () => disposed.add(r));
    for (const g of geometries) watch(g);
    for (const m of materials) watch(m);
    for (const t of textures) watch(t);
    interior.dispose();
    const owned = [...geometries, ...materials, ...textures].filter((r) => !isShared(r));
    expect(owned.length).toBeGreaterThan(20);
    const leaked = owned.filter((r) => !disposed.has(r));
    expect(leaked.map((r) => (r as { name?: string; type?: string }).name || (r as { type?: string }).type)).toEqual([]);
    // Shared caches (art materials, noise, interior textures) survive for the next interior.
    for (const r of [...geometries, ...materials, ...textures].filter((x) => isShared(x))) expect(disposed.has(r)).toBe(false);
    expect(interior.scene.children.length).toBe(0);
    // Safe to call twice and to update after disposal.
    interior.dispose();
    interior.update(0.1);
  });
});
