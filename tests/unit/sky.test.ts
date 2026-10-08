import { describe, expect, it, vi } from 'vitest';
import { CRAFT_STORIES } from '../../src/content/stellar/spacecraft.ts';
import { ASTEROID_DATA } from '../../src/data/asteroids.ts';
import { COMET_DATA, cometOf } from '../../src/data/comets.ts';
import { MOON_DATA } from '../../src/data/moons.ts';
import { skyInstalled } from '../../src/data/sky.ts';
import { SKY } from '../../src/data/skyData.ts';
import { CRAFT_DATA } from '../../src/data/spacecraft.ts';

/**
 * Sol's real sky loaded on demand (docs/PROCGEN.md §50): until it is installed the game knows no
 * comet, asteroid, giant planet's moon or spacecraft; installed, it has them all, once. The tests
 * install it before each file (tests/setup/sky.ts), as the loading title does before the game starts.
 */

/** Every module of the game (not the dev pages, the page's entry, or what installs the sky at once). */
const MODULES = import.meta.glob(['../../src/**/*.ts', '!../../src/dev/**', '!../../src/main.ts', '!../../src/data/skyNow.ts']);

/** A value as text, to compare: functions, three.js objects and what has been seen are left out. */
function fingerprint(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'function') return '[function]';
      if (typeof v === 'bigint') return String(v);
      if (v && typeof v === 'object') {
        const three = v as { isObject3D?: boolean; isMaterial?: boolean; isBufferGeometry?: boolean; isTexture?: boolean };
        if (three.isObject3D || three.isMaterial || three.isBufferGeometry || three.isTexture) return '[three.js]';
        if (seen.has(v)) return '[seen]';
        seen.add(v);
        if (v instanceof Map) return { map: [...v.entries()] };
        if (v instanceof Set) return { set: [...v] };
      }
      return v;
    }) ?? 'undefined'
  );
}

/** Loads every module afresh, with Sol's sky put in place before them or after: what each exports, by module. */
async function loadGame(skyFirst: boolean): Promise<Map<string, Record<string, string> | 'failed'>> {
  vi.resetModules();
  const { installSky } = await import('../../src/data/sky.ts');
  const { SKY: sky } = await import('../../src/data/skyData.ts');
  if (skyFirst) installSky(sky);
  const loaded = new Map<string, Record<string, unknown> | 'failed'>();
  for (const [path, load] of Object.entries(MODULES)) {
    try {
      loaded.set(path, (await load()) as Record<string, unknown>);
    } catch {
      loaded.set(path, 'failed');
    }
  }
  if (!skyFirst) installSky(sky);
  const out = new Map<string, Record<string, string> | 'failed'>();
  for (const [path, m] of loaded) out.set(path, m === 'failed' ? m : Object.fromEntries(Object.entries(m).map(([k, v]) => [k, fingerprint(v)])));
  return out;
}

describe('Sol’s sky', () => {
  it('is in place before the tests, every part of it', () => {
    expect(skyInstalled()).toBe(true);
    expect(COMET_DATA).toBe(SKY.comets);
    expect(ASTEROID_DATA).toBe(SKY.asteroids);
    expect(MOON_DATA).toBe(SKY.moons);
    expect(CRAFT_DATA).toBe(SKY.spacecraft);
    expect(CRAFT_STORIES).toBe(SKY.craftStories);
    expect(cometOf('comet-1p')?.name).toBe('1P/Halley');
  });

  it('is empty until installed, and installed once', async () => {
    vi.resetModules();
    const comets = await import('../../src/data/comets.ts');
    const craft = await import('../../src/data/spacecraft.ts');
    const sky = await import('../../src/data/sky.ts');
    expect(comets.COMET_DATA.comets).toEqual([]);
    expect(comets.cometOf('comet-1p')).toBeUndefined();
    expect(craft.CRAFT_DATA.spacecraft).toEqual([]);
    expect(sky.skyInstalled()).toBe(false);
    sky.installSky(SKY);
    expect(sky.skyInstalled()).toBe(true);
    expect(comets.cometOf('comet-1p')?.designation).toBe('1P');
    expect(craft.craftOf('voyager-1')?.name).toBe('Voyager 1');
    // A second install changes nothing.
    sky.installSky({ ...SKY, comets: { ...SKY.comets, comets: [] } });
    expect(comets.COMET_DATA).toBe(SKY.comets);
  });

  it('is read by nothing in the game as its modules load, so the game’s code may start before it is in', async () => {
    const after = await loadGame(false);
    const before = await loadGame(true);
    const differ: string[] = [];
    let compared = 0;
    for (const [path, exports] of before) {
      const late = after.get(path)!;
      expect(late === 'failed', `${path} loads alike either way`).toBe(exports === 'failed');
      if (exports === 'failed' || late === 'failed') continue;
      for (const [name, value] of Object.entries(exports)) {
        compared++;
        if (late[name] !== value) differ.push(`${path}: ${name}`);
      }
    }
    expect(differ, 'exports worked out from Sol’s sky as their module loaded').toEqual([]);
    // Every one of the game's modules loads outside a browser too (none touches the page as it
    // loads), so all of them were compared: 384 modules and 2,375 exports on 8 October 2026.
    expect([...before].filter(([, m]) => m === 'failed').map(([path]) => path)).toEqual([]);
    expect(compared).toBeGreaterThan(2000);
    // What is worked out from it is worked out with it, once it is in.
    const { solarBodies } = await import('../../src/data/systems.ts');
    const { sceneDefFor } = await import('../../src/world/systems/index.ts');
    const { trackedAsteroids } = await import('../../src/economy/asteroids.ts');
    expect(solarBodies().some((b) => b.id === 'titan')).toBe(true);
    expect(sceneDefFor('sol').comets?.length).toBe(SKY.comets.comets.length);
    expect(sceneDefFor('sol').craft?.length).toBeGreaterThan(0);
    expect(trackedAsteroids().some((a) => a.name === 'Apophis')).toBe(true);
  }, 240_000);
});
