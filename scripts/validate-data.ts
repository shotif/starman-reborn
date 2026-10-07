/**
 * Validates the bundled astronomy + location dataset.
 * Usage: node scripts/validate-data.ts   (exit code 1 on any error)
 */
import { ASTROMETRY, EXOPLANETS, FAR_STARS, SYSTEMS } from '../src/data/systems.ts';
import { reachableSystems, validateAsteroids, validateComets, validateDataset, validateFarStars, validateOrbits } from '../src/data/validate.ts';
import { ORBITS } from '../src/data/orbits.ts';
import { ASTEROID_DATA } from '../src/data/asteroids.ts';
import { COMET_DATA } from '../src/data/comets.ts';
import { validateBundledWorld } from '../src/content/world/bundled.ts';
import { WORLD } from '../src/data/systems.ts';

const issues = [...validateDataset({ systems: SYSTEMS, astrometry: ASTROMETRY, exoplanets: EXOPLANETS }), ...validateFarStars(FAR_STARS, SYSTEMS, ASTROMETRY), ...validateOrbits(ORBITS, ASTROMETRY), ...validateComets(COMET_DATA), ...validateAsteroids(ASTEROID_DATA)];
for (const w of validateBundledWorld()) issues.push({ level: 'error', code: `world-${w.rule}`, message: `${w.subject}: ${w.message}` });
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');

console.log(`Dataset: ${SYSTEMS.length} systems, ${ASTROMETRY.stars.length} stellar components, ${EXOPLANETS.planets.length} confirmed planets`);
console.log(`Astrometry: ${ASTROMETRY.verification}${ASTROMETRY.retrieved ? ` (retrieved ${ASTROMETRY.retrieved})` : ''}, ${ASTROMETRY.frame} epoch J${ASTROMETRY.referenceEpoch.toFixed(1)}`);
console.log(`Exoplanets: ${EXOPLANETS.verification}, as of ${EXOPLANETS.asOfDate}`);
console.log(`Far stars: ${FAR_STARS.stars.map((f) => `${f.name} (${f.distanceLightYears.toFixed(0)} ly)`).join(', ')}, ${FAR_STARS.verification}`);
console.log(`Binary orbits: ${ORBITS.pairs.length} pairs from ORB6 (retrieved ${ORBITS.retrieved}), ${ORBITS.left.length} left out`);
console.log(`Comets: ${COMET_DATA.comets.length} in Sol from JPL (elements on ${COMET_DATA.retrieved})`);
console.log(`Asteroids: ${ASTEROID_DATA.asteroids.length} in Sol from JPL (elements on ${ASTEROID_DATA.retrieved}), ${ASTEROID_DATA.asteroids.reduce((n, a) => n + a.approaches.length, 0)} close passes of Earth`);
console.log(`Jump graph: ${[...reachableSystems(SYSTEMS, 'sol')].length}/${SYSTEMS.length} systems reachable from Sol`);
const dens = WORLD.stations.filter((s) => !s.dockable).length;
console.log(`World: ${WORLD.stations.length - dens} generated stations and ${dens} pirate dens (fiction)`);
for (const w of warnings) console.log(`  warning [${w.code}] ${w.message}`);
for (const e of errors) console.log(`  ERROR   [${e.code}] ${e.message}`);
if (errors.length) {
  console.log(`\nValidation failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`\nValidation passed (${warnings.length} warning(s)).`);
