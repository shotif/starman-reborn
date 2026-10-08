import { installCraftStories, type CraftStory } from '../content/stellar/spacecraft.ts';
import { installAsteroids, type AsteroidsDataset } from './asteroids.ts';
import { installComets, type CometsDataset } from './comets.ts';
import { installLunar, type LunarDataset } from './lunar.ts';
import { installMoons, type MoonsDataset } from './moons.ts';
import { installCraft, type SpacecraftDataset } from './spacecraft.ts';

/**
 * Sol's real sky, loaded on demand (docs/PROCGEN.md §50): the comets, named asteroids, giant
 * planets' moons, spacecraft and Earth's Moon (§51) are kept out of the first load and fetched behind the loading title
 * while the game's own code starts up (src/app/loader.ts, from data/skyData.ts), then installed here
 * before the game starts. Nothing in the game reads them as its module loads, so the code may start
 * before they are in; what is worked out from them is worked out again once they are
 * (`skyVersion`).
 */
export interface SkyData {
  comets: CometsDataset;
  asteroids: AsteroidsDataset;
  moons: MoonsDataset;
  spacecraft: SpacecraftDataset;
  craftStories: Record<string, CraftStory>;
  lunar: LunarDataset;
}

let version = 0;

/** Puts Sol's sky in place: once, before the game starts (a second call changes nothing). */
export function installSky(sky: SkyData): void {
  if (version) return;
  installComets(sky.comets);
  installAsteroids(sky.asteroids);
  installMoons(sky.moons);
  installCraft(sky.spacecraft);
  installCraftStories(sky.craftStories);
  installLunar(sky.lunar);
  version++;
}

/** Whether Sol's sky is in place. */
export function skyInstalled(): boolean {
  return version > 0;
}

/** Changes when Sol's sky is put in place: anything kept that was worked out from it is worked out again. */
export function skyVersion(): number {
  return version;
}
