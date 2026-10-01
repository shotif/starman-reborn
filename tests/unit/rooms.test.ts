import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { StationKind } from '../../src/world/art/stations.ts';
import type { QualityLevel } from '../../src/world/art/types.ts';
import { isShared } from '../../src/world/art/util.ts';
import { ROOM_ORDER, STATION_OWNERS, STATION_TYPES, STYLES, createStationInterior, generateInteriorStyle } from '../../src/world/rooms/index.ts';
import type {
  InteriorStyle,
  RoomView,
  StationInterior,
  StationInteriorOptions,
  StationLook,
  StationOwner,
  StationType,
} from '../../src/world/rooms/index.ts';
import { SCENE_DEFS } from '../../src/world/systems/index.ts';

/**
 * Station interiors in a node environment (no WebGL): structure, view transitions, determinism,
 * budgets per quality, hotspots and disposal, for the six hand-built stations and for interiors
 * generated from a station look (every type × owner). The shared art textures draw on a 2D canvas, so a
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

/* ------------------------------------------------------------------------------------------------
 * Hand-built stations: unchanged by the generator's extensions.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Hash of what the rooms code builds (geometry of both rooms, their lights, fog and environment
 * cube in each room), leaving out the ship on the pad and the backdrop, which other modules draw.
 */
function roomsFingerprint(interior: StationInterior): string {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193);
    h ^= h >>> 15;
  };
  const num = (v: number, scale = 1000): void => mix(Math.round(v * scale) | 0);
  const str = (s: string): void => {
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  for (const name of ['hangar', 'bar'] as const) {
    const group = roomGroup(interior, name);
    if (!group) continue;
    for (const o of group.children) {
      const light = o as THREE.Light & { distance?: number; angle?: number; penumbra?: number; decay?: number; groundColor?: THREE.Color; target?: THREE.Object3D };
      const mesh = o as THREE.Mesh;
      if (!light.isLight && !mesh.isMesh && !(o as THREE.Points).isPoints) continue;
      str(`${o.type}:${o.name}`);
      for (const v of [o.position.x, o.position.y, o.position.z]) num(v);
      if (light.isLight) {
        str(light.color.getHexString());
        num(light.intensity);
        if (light.groundColor) str(light.groundColor.getHexString());
        for (const v of [light.distance ?? 0, light.angle ?? 0, light.penumbra ?? 0, light.decay ?? 0]) num(v);
        if (light.target) for (const v of [light.target.position.x, light.target.position.y, light.target.position.z]) num(v);
        continue;
      }
      const g = mesh.geometry;
      for (const key of Object.keys(g.attributes).sort()) {
        const a = g.attributes[key]!;
        str(`${key}:${a.count}`);
        const arr = a.array as ArrayLike<number>;
        for (let i = 0; i < arr.length; i++) num(arr[i]!);
      }
    }
  }
  for (const view of ['deck', 'bar'] as const) {
    interior.setView(view, true);
    const fog = interior.scene.fog as THREE.FogExp2;
    str(fog.color.getHexString());
    num(fog.density, 1e6);
    const env = interior.scene.environment as THREE.CubeTexture | null;
    if (!env) continue;
    for (const img of env.images as unknown as { image: { data: Uint8Array } }[]) {
      const d = img.image.data;
      for (let i = 0; i < d.length; i++) mix(d[i]!);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('station interiors: the hand-built stations are unchanged', () => {
  // Recorded from the interiors before generated styles existed (seed 7, every room, each station's
  // own system); a deliberate change to a hand-built look updates these.
  const AUTHORED: Record<string, string> = {
    'earth-port/low': '170b2326',
    'mars-depot/low': '72896d48',
    'proxima-outpost/low': '00eb2d2a',
    'barnard-relay/low': '6ad62f9b',
    'sirius-platform/low': '546b3b51',
    'eridani-hub/low': '6b0d8794',
    'earth-port/medium': 'a169ec4f',
    'mars-depot/medium': 'f5aa278f',
    'proxima-outpost/medium': 'd72a9321',
    'barnard-relay/medium': 'e5f21fb1',
    'sirius-platform/medium': '5b98516d',
    'eridani-hub/medium': '5692f9c7',
    'earth-port/high': '1671f90d',
    'mars-depot/high': '77b18d6d',
    'proxima-outpost/high': 'cafbc59f',
    'barnard-relay/high': '94b35fe2',
    'sirius-platform/high': '5bb0bed5',
    'eridani-hub/high': 'f42536ce',
  };

  it.each(STATIONS)('%s builds exactly the authored rooms at every quality', (station) => {
    for (const quality of ['low', 'medium', 'high'] as const) {
      const interior = build(station, quality);
      expect(roomsFingerprint(interior), `${station}/${quality}`).toBe(AUTHORED[`${station}/${quality}`]);
      interior.dispose();
    }
  });

  it('keeps the authored styles and uses none of the generated-only features', () => {
    const summary = Object.fromEntries(
      STATIONS.map((k) => {
        const s = STYLES[k];
        const h = s.hangar;
        return [k, `${s.name} | ${h.pillarKind}/${h.bayKind} ${h.mouth.join('x')} | ${s.bar.decor}/${s.bar.window} | ${h.workers}w ${s.bar.patrons}p ${s.crowd.length} roles`];
      }),
    );
    expect(summary).toEqual({
      'earth-port': 'Halcyon Ring | round/open 31x17 | lounge/panorama | 3w 6p 6 roles',
      'mars-depot': 'Deimos Depot | ibeam/blast 28x16 | canteen/portholes | 4w 6p 6 roles',
      'proxima-outpost': 'Meridian Outpost | modular/modular 24x14 | mess/band | 3w 4p 5 roles',
      'barnard-relay': 'Barnard Transit Relay | lattice/slot 19x12 | spare/portholes | 1w 3p 3 roles',
      'sirius-platform': 'Horizon Platform | slab/shielded 15x11 | clinic/none | 2w 4p 4 roles',
      'eridani-hub': 'Eridani Mining Hub | hex/market 29x16 | market/band | 5w 8p 6 roles',
    });
    for (const k of STATIONS) {
      const h = STYLES[k].hangar;
      expect([h.walls, h.ceiling, h.goods, h.dressing, h.grime, h.flicker, STYLES[k].dealer, STYLES[k].mechanic, STYLES[k].bar.spill]).toEqual(Array(9).fill(undefined));
      expect(STYLES[k].kind).toBe(k);
    }
  });
});

/* ------------------------------------------------------------------------------------------------
 * Generated stations: styles from a station look.
 * ---------------------------------------------------------------------------------------------- */

const lookOf = (type: StationType, owner: StationOwner, extra: Partial<StationLook> = {}): StationLook => ({
  type,
  owner,
  seed: 5,
  starColor: '#ffd2a0',
  size: 0.6,
  wear: 0.3,
  ...extra,
});

function buildLook(look: StationLook, quality: QualityLevel = 'medium', rooms: readonly RoomView[] = ALL, reducedMotion = false): StationInterior {
  const def = SCENE_DEFS['epsilon-eridani'];
  return createStationInterior({ style: generateInteriorStyle(look), skybox: def.skybox, starColor: look.starColor, seed: look.seed, rooms }, { quality, reducedMotion });
}

function hsl(hex: string): { h: number; s: number; l: number } {
  const out = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(out, THREE.SRGBColorSpace);
  return out;
}

function colours(o: unknown, out: string[] = []): string[] {
  if (typeof o === 'string') {
    if (o.startsWith('#')) out.push(o);
  } else if (Array.isArray(o)) {
    for (const v of o) colours(v, out);
  } else if (o && typeof o === 'object') {
    for (const v of Object.values(o)) colours(v, out);
  }
  return out;
}

describe('generated interiors: styles', () => {
  it('are deterministic plain data with valid colours', () => {
    for (const type of STATION_TYPES) {
      for (const owner of STATION_OWNERS) {
        const look = lookOf(type, owner);
        const a = generateInteriorStyle(look);
        expect(generateInteriorStyle({ ...look })).toEqual(a);
        expect(JSON.parse(JSON.stringify(a))).toEqual(a);
        expect(a.kind).toBe(type);
        const cols = colours(a);
        expect(cols.length).toBeGreaterThan(60);
        for (const c of cols) expect(c, `${type}/${owner}`).toMatch(/^#[0-9a-f]{6}$/i);
        for (const l of [a.hangar.key, a.hangar.fillTrader, a.hangar.fillOutfitter, a.bar.key, a.bar.fillA, a.bar.fillB]) expect(l.intensity).toBeGreaterThan(0);
        expect(a.dealer).toBeDefined();
        expect(a.mechanic).toBeDefined();
      }
    }
  });

  it('vary with the seed within the family', () => {
    const a = generateInteriorStyle(lookOf('trade-port', 'sta', { seed: 1 }));
    const b = generateInteriorStyle(lookOf('trade-port', 'sta', { seed: 2 }));
    expect(b).not.toEqual(a);
    // Same family: the accent stays Transit Authority blue.
    expect(Math.abs(hsl(a.hangar.accent).h - hsl(b.hangar.accent).h)).toBeLessThan(0.03);
  });

  it('take the palette family and signage from the owner', () => {
    const inRange = (h: number, lo: number, hi: number): boolean => h >= lo && h <= hi;
    for (const type of STATION_TYPES) {
      const sta = generateInteriorStyle(lookOf(type, 'sta'));
      const frontier = generateInteriorStyle(lookOf(type, 'frontier'));
      const wake = generateInteriorStyle(lookOf(type, 'hollow-wake'));
      const indie = generateInteriorStyle(lookOf(type, 'independent'));
      expect(inRange(hsl(sta.hangar.accent).h, 0.52, 0.67), `${type}: Transit Authority blue`).toBe(true);
      expect(inRange(hsl(frontier.hangar.accent).h, 0.42, 0.53), `${type}: Frontier teal`).toBe(true);
      const red = hsl(wake.hangar.accent).h;
      expect(red < 0.06 || red > 0.95, `${type}: Hollow Wake red`).toBe(true);
      expect(hsl(indie.hangar.signs![0]!).s, `${type}: independent neon`).toBeGreaterThan(0.6);
      expect(new Set([sta, frontier, wake, indie].map((s) => s.hangar.signs![0])).size).toBe(4);
      // Soot: the Hollow Wake's halls are darker than the Transit Authority's.
      expect(hsl(wake.hangar.wall).l).toBeLessThan(hsl(sta.hangar.wall).l);
    }
  });

  it('take their character from the station type', () => {
    const styles = Object.fromEntries(STATION_TYPES.map((t) => [t, generateInteriorStyle(lookOf(t, 'frontier'))])) as Record<StationType, InteriorStyle>;
    const signature = (s: InteriorStyle): string =>
      [s.hangar.walls, s.hangar.ceiling, s.hangar.bayKind, s.hangar.goods, s.bar.decor, s.hangar.dressing!.join(',')].join('|');
    expect(new Set(STATION_TYPES.map((t) => signature(styles[t]))).size).toBe(STATION_TYPES.length);
    expect(styles['mining-outpost'].hangar.walls).toBe('rock');
    expect(styles['military-base'].hangar.walls).toBe('armour');
    expect(styles['research-station'].hangar.walls).toBe('clean');
    expect(styles.freeport.hangar.walls).toBe('patched');
    expect(styles['pirate-den'].hangar.walls).toBe('scrap');
    expect(styles.relay.hangar.ceiling).toBe('ducts');
    expect(styles['customs-depot'].hangar.bayKind).toBe('scanner');
    expect(styles.shipyard.hangar.bayKind).toBe('gantry');
    expect(styles['customs-depot'].hangar.goods).toBe('seized');
    expect(styles.freeport.hangar.goods).toBe('bazaar');
    expect(styles['trade-port'].bar.decor).toBe('cafe');
    expect(styles['research-station'].bar.decor).toBe('labcafe');
    expect(styles['military-base'].bar.decor).toBe('messhall');
    expect(styles.freeport.bar.decor).toBe('dive');
    expect(styles['pirate-den'].bar.decor).toBe('hangout');
    // Pale café floors take a softer share of the window's light than the default.
    expect(styles['trade-port'].bar.spill).toBeLessThan(0.3);
    for (const [type, module] of [
      ['shipyard', 'hull-dock'],
      ['mining-outpost', 'ore-carts'],
      ['refinery', 'tanks'],
      ['factory', 'conveyors'],
      ['agri-station', 'planters'],
      ['research-station', 'lab-benches'],
      ['relay', 'relay-racks'],
      ['military-base', 'banners'],
      ['freeport', 'neon'],
      ['pirate-den', 'scrap-piles'],
    ] as const) {
      expect(styles[type].hangar.dressing).toContain(module);
    }
    // A trade port is brighter than a pirate den, a relay smaller than a trade port.
    expect(styles['trade-port'].hangar.key.intensity).toBeGreaterThan(styles['pirate-den'].hangar.key.intensity);
    expect(styles['trade-port'].hangar.mouth[0]).toBeGreaterThan(styles.relay.hangar.mouth[0]);
    // Crowds dress for the job.
    const kinds = (t: StationType): string[] => [...styles[t].crowd.map((o) => o.kind), ...styles[t].crowd.map((o) => o.hat ?? 'none')];
    expect(kinds('military-base')).toContain('armour');
    expect(kinds('pirate-den')).toContain('harness');
    expect(kinds('mining-outpost')).toContain('helmet');
    expect(kinds('research-station')).toContain('coat');
  });

  it('grow bigger and busier with size, grimier and dimmer with wear', () => {
    for (const type of STATION_TYPES) {
      const small = generateInteriorStyle(lookOf(type, 'sta', { size: 0 }));
      const big = generateInteriorStyle(lookOf(type, 'sta', { size: 1 }));
      expect(big.hangar.mouth[0]).toBeGreaterThanOrEqual(small.hangar.mouth[0]);
      expect(big.hangar.workers).toBeGreaterThanOrEqual(small.hangar.workers);
      expect(big.bar.patrons).toBeGreaterThanOrEqual(small.bar.patrons);
      expect(big.hangar.clutter).toBeGreaterThan(small.hangar.clutter);
      const clean = generateInteriorStyle(lookOf(type, 'sta', { wear: 0 }));
      const worn = generateInteriorStyle(lookOf(type, 'sta', { wear: 1 }));
      expect(worn.hangar.grime).toBeGreaterThan(clean.hangar.grime ?? 0);
      expect(worn.hangar.flicker).toBeGreaterThan(0);
      expect(worn.hangar.lampLevel).toBeLessThan(clean.hangar.lampLevel);
      expect(worn.hangar.key.intensity).toBeLessThan(clean.hangar.key.intensity);
      expect(worn.hangar.clutter).toBeGreaterThanOrEqual(clean.hangar.clutter);
    }
    const tiny = generateInteriorStyle(lookOf('trade-port', 'sta', { size: 0 }));
    const huge = generateInteriorStyle(lookOf('trade-port', 'sta', { size: 1 }));
    expect(huge.hangar.workers + huge.bar.patrons).toBeGreaterThan(tiny.hangar.workers + tiny.bar.patrons);
  });

  it('clamp out-of-range looks', () => {
    const odd = generateInteriorStyle(lookOf('refinery', 'independent', { size: 7, wear: -3, seed: Number.NaN }));
    expect(odd).toEqual(generateInteriorStyle(lookOf('refinery', 'independent', { size: 1, wear: 0, seed: 0 })));
  });
});

/* ------------------------------------------------------------------------------------------------
 * Generated stations: building the rooms.
 * ---------------------------------------------------------------------------------------------- */

describe('generated interiors: rooms', () => {
  const LIMITS: Record<QualityLevel, { calls: number; tris: number; tex: number }> = {
    low: { calls: 46, tris: 60_000, tex: 512 },
    medium: { calls: 46, tris: 110_000, tex: 1024 },
    high: { calls: 46, tris: 150_000, tex: 1024 },
  };

  it.each(STATION_TYPES)('%s builds for every owner within the budgets, with one ambient and at most four lights per room (at its busiest and most worn)', (type) => {
    for (const owner of STATION_OWNERS) {
      for (const quality of ['low', 'medium', 'high'] as const) {
        const interior = buildLook(lookOf(type, owner, { size: 1, wear: 1 }), quality);
        const at = `${type}/${owner}/${quality}`;
        expect(interior.rooms).toEqual(ALL);
        const s = stats(interior);
        expect(s.drawCalls, at).toBeLessThanOrEqual(LIMITS[quality].calls);
        expect(s.triangles, at).toBeLessThanOrEqual(LIMITS[quality].tris);
        expect(s.maxTexture, at).toBeLessThanOrEqual(LIMITS[quality].tex);
        for (const name of ['hangar', 'bar'] as const) {
          let ambient = 0;
          let dynamic = 0;
          let shadows = 0;
          roomGroup(interior, name)!.traverse((o) => {
            const l = o as THREE.Light;
            if (!l.isLight) return;
            if ((l as THREE.HemisphereLight).isHemisphereLight || (l as THREE.AmbientLight).isAmbientLight) ambient++;
            else dynamic++;
            if (l.castShadow) shadows++;
          });
          expect([ambient, dynamic <= 4, shadows], `${at} ${name}`).toEqual([1, true, 0]);
        }
        interior.dispose();
      }
    }
  });

  it('lights the shipyard hull on the slip, keeps factory goods matte and mid-toned, and lets mining walls read', () => {
    const meshes = (interior: StationInterior, key: string): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      roomGroup(interior, 'hangar')!.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.name === key) out.push(o as THREE.Mesh);
      });
      return out;
    };
    const lightness = (mesh: THREE.Mesh): number[] => {
      const c = mesh.geometry.attributes.color!;
      const out: number[] = [];
      for (let i = 0; i < c.count; i++) out.push(hsl(`#${new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString()}`).l);
      return out;
    };
    const glows = (mesh: THREE.Mesh): number => (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity;
    for (const owner of STATION_OWNERS) {
      // The half-built hull outside a shipyard's bay: floodlit, and shaded from top to bottom so it
      // reads as round from the deck rather than as a flat block.
      const yard = buildLook(lookOf('shipyard', owner, { size: 1 }));
      const [hull] = meshes(yard, 'hullLit');
      expect(hull, owner).toBeDefined();
      expect(glows(hull!)).toBeGreaterThan(0);
      const shade = lightness(hull!);
      expect(Math.max(...shade) - Math.min(...shade), owner).toBeGreaterThan(0.3);
      yard.dispose();
      // Factory goods ride under the lamps and past the bay's starlight: matte, and never pale.
      const works = buildLook(lookOf('factory', owner, { size: 1 }));
      const [goods] = meshes(works, 'm:matte');
      expect(goods, owner).toBeDefined();
      expect((goods!.material as THREE.MeshStandardMaterial).roughness).toBeGreaterThanOrEqual(0.8);
      expect(Math.max(...lightness(goods!)), owner).toBeLessThanOrEqual(0.61);
      works.dispose();
      // Mining halls: the rock walls keep some light of their own away from the floodlights.
      const mine = buildLook(lookOf('mining-outpost', owner, { size: 1 }));
      const [walls] = meshes(mine, 'rockWall');
      expect(walls, owner).toBeDefined();
      expect(glows(walls!)).toBeGreaterThan(0);
      mine.dispose();
    }
  });

  it('is deterministic by look, and every type looks different', () => {
    const a = buildLook(lookOf('freeport', 'independent', { seed: 11 }), 'low');
    const b = buildLook(lookOf('freeport', 'independent', { seed: 11 }), 'low');
    const c = buildLook(lookOf('freeport', 'independent', { seed: 12 }), 'low');
    expect(roomsFingerprint(a)).toBe(roomsFingerprint(b));
    expect(roomsFingerprint(a)).not.toBe(roomsFingerprint(c));
    for (const i of [a, b, c]) i.dispose();
    const prints = new Set(
      STATION_TYPES.map((type) => {
        const i = buildLook(lookOf(type, 'sta'), 'low');
        const f = roomsFingerprint(i);
        i.dispose();
        return f;
      }),
    );
    expect(prints.size).toBe(STATION_TYPES.length);
  });

  it('builds the given style instead of the station’s own', () => {
    const style = generateInteriorStyle(lookOf('mining-outpost', 'frontier'));
    const def = SCENE_DEFS.sol;
    const both = createStationInterior({ ...options('earth-port'), style }, { quality: 'low', reducedMotion: false });
    const only = createStationInterior({ style, skybox: def.skybox, starColor: def.stars[0]!.color, seed: 7, rooms: ALL }, { quality: 'low', reducedMotion: false });
    const own = build('earth-port', 'low');
    expect(roomsFingerprint(both)).toBe(roomsFingerprint(only));
    expect(roomsFingerprint(both)).not.toBe(roomsFingerprint(own));
    expect(only.scene.name).toBe('interior:mining-outpost');
    for (const i of [both, only, own]) i.dispose();
  });

  it.each(STATION_TYPES)('%s: the ship, dealer, mechanic and bar crowd are in shot (desktop and phone)', (type) => {
    const owner = STATION_OWNERS[STATION_TYPES.indexOf(type) % STATION_OWNERS.length]!;
    const interior = buildLook(lookOf(type, owner, { size: 1 }), 'medium');
    for (const [w, h] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      interior.setView('deck', true);
      interior.resize(w, h);
      interior.update(1 / 30);
      const ship = interior.hotspots();
      expect(ship.map((s) => s.id)).toEqual(['ship']);
      expect(ship[0]!.visible, `ship at ${w}x${h}`).toBe(true);
      for (const [view, id] of [
        ['trader', 'dealer'],
        ['outfitter', 'mechanic'],
      ] as const) {
        interior.setView(view, true);
        interior.update(1 / 30);
        const spots = interior.hotspots();
        expect(spots.map((s) => s.id)).toEqual([id]);
        expect(spots[0]!.visible, `${id} at ${w}x${h}`).toBe(true);
        expect(spots[0]!.label.length).toBeGreaterThan(0);
      }
      interior.setView('bar', true);
      interior.update(1 / 30);
      const bartender = interior.hotspots().find((s) => s.id === 'bartender')!;
      expect(bartender.visible, `bartender at ${w}x${h}`).toBe(true);
    }
    // On a desktop screen everyone in the bar is in the shot.
    interior.resize(1280, 720);
    interior.update(1 / 30);
    const spots = interior.hotspots();
    expect(spots[0]!.id).toBe('bartender');
    expect(spots.filter((s) => s.id.startsWith('patron-')).length).toBeGreaterThanOrEqual(2);
    expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length);
    expect(spots.filter((s) => !s.visible).map((s) => s.id)).toEqual([]);
    for (const s of spots) expect(s.label.length).toBeGreaterThan(0);
    interior.dispose();
  });

  it('flickers worn lamps only when motion is allowed, and animates without errors', () => {
    const calm = buildLook(lookOf('pirate-den', 'hollow-wake', { wear: 1 }), 'low', ALL, true);
    const live = buildLook(lookOf('pirate-den', 'hollow-wake', { wear: 1 }), 'low', ALL, false);
    const keyOf = (i: StationInterior): THREE.SpotLight => roomGroup(i, 'hangar')!.children.filter((o) => (o as THREE.SpotLight).isSpotLight)[1] as THREE.SpotLight;
    const calmLevels = new Set<number>();
    const liveLevels = new Set<number>();
    for (let f = 0; f < 240; f++) {
      calm.update(1 / 30);
      live.update(1 / 30);
      calmLevels.add(Math.round(keyOf(calm).intensity * 100));
      liveLevels.add(Math.round(keyOf(live).intensity * 100));
    }
    expect(calmLevels.size).toBe(1);
    expect(liveLevels.size).toBeGreaterThan(1);
    calm.dispose();
    live.dispose();
  });

  it.each(['low', 'high'] as const)('disposes every owned geometry, material and texture of generated rooms (%s)', (quality) => {
    for (const type of ['mining-outpost', 'freeport', 'pirate-den'] as const) {
      const interior = buildLook(lookOf(type, 'independent', { size: 1, wear: 0.8 }), quality);
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
      const disposed = new Set<object>();
      for (const r of [...geometries, ...materials, ...textures]) (r as THREE.EventDispatcher<{ dispose: object }>).addEventListener('dispose', () => disposed.add(r));
      interior.dispose();
      const leaked = [...geometries, ...materials, ...textures].filter((r) => !isShared(r) && !disposed.has(r));
      expect(leaked.map((r) => (r as { name?: string; type?: string }).name || (r as { type?: string }).type), type).toEqual([]);
      expect(interior.scene.children.length).toBe(0);
    }
  });
});
