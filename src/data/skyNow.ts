import { installSky } from './sky.ts';
import { SKY } from './skyData.ts';

/**
 * Sol's sky, installed at once (docs/PROCGEN.md §50): for the unit tests (tests/setup/sky.ts) and the
 * scripts, which have the data on disk and nothing to wait for. Imported first, before anything that
 * reads the sky. The game never imports it: it fetches the sky behind the loading title instead.
 */
installSky(SKY);
