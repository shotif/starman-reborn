import { installCraftStories, type CraftStory } from '../content/stellar/spacecraft.ts';
import { installAsteroids, type AsteroidsDataset } from './asteroids.ts';
import { installComets, type CometsDataset } from './comets.ts';
import { installMoons, type MoonsDataset } from './moons.ts';
import { installCraft, type SpacecraftDataset } from './spacecraft.ts';

/**
 * Sol's real sky, loaded on demand (docs/PROCGEN.md §50): the comets, named asteroids, giant
 * planets' moons and spacecraft are kept out of the first load and fetched behind the loading title
 * (src/app/loader.ts, from data/skyData.ts), then installed here before the game's own modules are
 * started, so everything in the game finds them in place.
 */
export interface SkyData {
  comets: CometsDataset;
  asteroids: AsteroidsDataset;
  moons: MoonsDataset;
  spacecraft: SpacecraftDataset;
  craftStories: Record<string, CraftStory>;
}

let installed = false;

/** Puts Sol's sky in place: once, before the game starts (a second call changes nothing). */
export function installSky(sky: SkyData): void {
  if (installed) return;
  installComets(sky.comets);
  installAsteroids(sky.asteroids);
  installMoons(sky.moons);
  installCraft(sky.spacecraft);
  installCraftStories(sky.craftStories);
  installed = true;
}

/** Whether Sol's sky is in place. */
export function skyInstalled(): boolean {
  return installed;
}
