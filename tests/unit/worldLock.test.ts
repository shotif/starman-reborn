import { describe, expect, it } from 'vitest';
import { generateWorld } from '../../src/content/world/generate.ts';
import { WORLD_SEED } from '../../src/content/world/rules.ts';
import { ASTROMETRY, CORE_SEEDS, EXOPLANETS, GROWTH_SEEDS, WORLD } from '../../src/data/systems.ts';
import lock from './fixtures/core-world.json' with { type: 'json' };

/**
 * The core world is frozen (docs/PROCGEN.md §7.6): the stations, lanes, owners and names of the 32
 * systems it shipped with never move, whatever the sky data or the world's growth does, so every
 * save keeps working. A rule change that moves them fails here; it would need a save migration.
 */

const fingerprint = (w: ReturnType<typeof generateWorld>) => ({
  stations: w.stations.map((s) => [s.id, s.name, s.systemId, s.type, s.owner, s.anchorId]),
  links: Object.fromEntries([...w.links].map(([k, v]) => [k, [...v]])),
  profiles: Object.fromEntries([...w.profiles].map(([k, p]) => [k, [p.owner, p.security]])),
});

describe('the frozen core', () => {
  it('generates exactly as it shipped', () => {
    const core = fingerprint(generateWorld(CORE_SEEDS, WORLD_SEED));
    expect(core.stations).toEqual(lock.stations);
    expect(core.links).toEqual(lock.links);
    expect(core.profiles).toEqual(lock.profiles);
  });

  it('is untouched by the systems the world grows into', () => {
    const grown = fingerprint(WORLD);
    const coreIds = new Set(CORE_SEEDS.map((s) => s.id));
    expect(grown.stations.slice(0, lock.stations.length)).toEqual(lock.stations);
    for (const [id, owner] of Object.entries(lock.profiles)) expect(grown.profiles[id]).toEqual(owner);
    for (const [id, to] of Object.entries(lock.links as Record<string, string[]>)) {
      // A core system may gain lanes to new systems, never to another core system.
      const now = grown.links[id]!;
      expect(now).toEqual(expect.arrayContaining(to));
      for (const extra of now.filter((x) => !to.includes(x))) expect(coreIds.has(extra), `${id}→${extra}`).toBe(false);
    }
    expect(GROWTH_SEEDS.every((s) => !coreIds.has(s.id))).toBe(true);
  });

  it('keeps every body a core station orbits in the dataset', () => {
    const bodies = new Set([...ASTROMETRY.stars.map((s) => s.id), ...EXOPLANETS.planets.map((p) => p.id)]);
    for (const [id, , , , , anchor] of lock.stations as string[][]) expect(bodies.has(anchor!), `${id} orbits ${anchor}`).toBe(true);
  });
});
