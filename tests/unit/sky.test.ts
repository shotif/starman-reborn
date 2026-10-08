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
 * install it before each file (tests/setup/sky.ts), as the loading title does in the game.
 */
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
});
