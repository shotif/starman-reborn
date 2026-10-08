import asteroidsFile from './generated/asteroids.json' with { type: 'json' };
import cometsFile from './generated/comets.json' with { type: 'json' };
import moonsFile from './generated/moons.json' with { type: 'json' };
import craftFile from './generated/spacecraft.json' with { type: 'json' };
import { CRAFT_STORIES_DATA } from '../content/stellar/craftStories.ts';
import type { SkyData } from './sky.ts';

/**
 * Sol's real sky (docs/PROCGEN.md §50): JPL's comets, named asteroids, the giant planets' moons and
 * the spacecraft, with the facts of the craft's missions. Its own part of the build, fetched behind
 * the loading title once the game's own files are in (src/app/loader.ts), and installed by
 * data/sky.ts before the game starts. Nothing in the game imports it but the loader, and the tests
 * and scripts through data/skyNow.ts.
 */
export const SKY: SkyData = {
  comets: cometsFile as unknown as SkyData['comets'],
  asteroids: asteroidsFile as unknown as SkyData['asteroids'],
  moons: moonsFile as unknown as SkyData['moons'],
  spacecraft: craftFile as unknown as SkyData['spacecraft'],
  craftStories: CRAFT_STORIES_DATA,
};
