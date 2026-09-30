import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { getComponent, getLocation, SYSTEMS, WORLD } from '../../src/data/systems.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { catalogSceneDef, starLook } from '../../src/world/systems/generated.ts';
import { SCENE_DEFS, sceneDefFor } from '../../src/world/systems/index.ts';
import { generatedInteriorStyle } from '../../src/world/systems/interiors.ts';

/**
 * Generated scenes for the catalogue systems: every catalogued star and confirmed planet is drawn,
 * every generated station is placed clear of the bodies, arrivals are safe, and the scenes build.
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

const CATALOG = SYSTEMS.filter((s) => !(s.id in SCENE_DEFS));

describe('generated system scenes', () => {
  beforeAll(installCanvasStub);

  it('covers every catalogue system and keeps the hand-made five', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(25);
    expect(sceneDefFor('sol')).toBe(SCENE_DEFS.sol);
    for (const s of CATALOG) expect(sceneDefFor(s.id).systemId).toBe(s.id);
    expect(catalogSceneDef('tau-ceti')).toBe(catalogSceneDef('tau-ceti'));
  });

  it('draws exactly the catalogued stars and confirmed planets', () => {
    for (const s of CATALOG) {
      const def = sceneDefFor(s.id);
      expect(def.stars.map((x) => x.id)).toEqual(s.componentIds);
      expect(def.planets.map((p) => p.id).sort()).toEqual(s.confirmedBodies.map((p) => p.id).sort());
      expect(def.planets.every((p) => p.scannable)).toBe(true);
      for (const star of def.stars) expect(star.kind).toBe(starLook(getComponent(star.id)!.spectralType).kind);
    }
    const eri40 = sceneDefFor('40-eridani');
    expect(eri40.stars.map((x) => x.kind)).toEqual(['main-sequence', 'white-dwarf', 'red-dwarf']);
  });

  it('places every generated station clear of stars and planets, with raider dens hostile', () => {
    for (const s of CATALOG) {
      const def = sceneDefFor(s.id);
      const own = WORLD.stations.filter((st) => st.systemId === s.id);
      expect(def.stations.map((x) => x.locationId).sort()).toEqual(own.map((x) => x.id).sort());
      for (const st of def.stations) {
        for (const body of [...def.stars, ...def.planets]) {
          expect(st.position.distanceTo(body.position), `${st.locationId} vs ${body.id}`).toBeGreaterThan(body.radius + 1_000);
        }
        expect(st.hostile ?? false).toBe(getLocation(st.locationId).dockable === false);
        expect(st.look?.type).toBe(getLocation(st.locationId).stationType);
      }
      // Ships arrive in open space, near an open station.
      const { position } = def.arrival;
      for (const body of [...def.stars, ...def.planets]) expect(position.distanceTo(body.position)).toBeGreaterThan(body.radius + 2_000);
      const open = def.stations.filter((x) => !x.hostile);
      expect(Math.min(...open.map((x) => x.position.distanceTo(position)))).toBeLessThan(15_000);
      // Lanes stay clear of stars.
      for (const lane of def.lanes) {
        const seg = new THREE.Line3(lane.from, lane.to);
        for (const star of def.stars) expect(seg.closestPointToPoint(star.position, true, new THREE.Vector3()).distanceTo(star.position)).toBeGreaterThan(star.radius * 2);
      }
    }
  });

  it('builds the scene, keeps dens undockable and disposes cleanly', () => {
    for (const id of ['40-eridani', 'tau-ceti', 'gliese-876', 'altair', 'luyten-726-8']) {
      const scene = new SystemScene(sceneDefFor(id), { quality: 'low', reducedMotion: true });
      expect(scene.docks.length).toBe(WORLD.stations.filter((s) => s.systemId === id).length);
      for (const d of scene.docks) expect(d.dockable).toBe(getLocation(d.def.locationId).dockable !== false);
      expect(scene.docks.some((d) => d.dockable)).toBe(true);
      scene.dispose();
    }
  });

  it('keeps the view out of a generated station bay true to the catalogue', () => {
    for (const s of CATALOG) {
      const def = sceneDefFor(s.id);
      for (const st of def.stations) {
        const style = generatedInteriorStyle(def, st)!;
        const orbits = def.planets.find((p) => p.id === getLocation(st.locationId).nearBodyId);
        // Only the confirmed planet it orbits hangs outside; around a star there is none.
        if (orbits) expect(style.outside.planet?.style).toBe(orbits.style);
        else expect(style.outside.planet).toBeUndefined();
        expect(!!style.outside.companion).toBe(def.stars.length > 1);
        expect(style.kind).toBe(st.look!.type);
      }
    }
    expect(generatedInteriorStyle(SCENE_DEFS.sol, SCENE_DEFS.sol.stations[0]!)).toBeNull();
  });
});

