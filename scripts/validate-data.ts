/**
 * Validates the bundled astronomy + location dataset.
 * Usage: node scripts/validate-data.ts   (exit code 1 on any error)
 */
import { ASTROMETRY, EXOPLANETS, SYSTEMS } from '../src/data/systems.ts';
import { reachableSystems, validateDataset } from '../src/data/validate.ts';

const issues = validateDataset({ systems: SYSTEMS, astrometry: ASTROMETRY, exoplanets: EXOPLANETS });
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');

console.log(`Dataset: ${SYSTEMS.length} systems, ${ASTROMETRY.stars.length} stellar components, ${EXOPLANETS.planets.length} confirmed planets`);
console.log(`Astrometry: ${ASTROMETRY.verification}${ASTROMETRY.retrieved ? ` (retrieved ${ASTROMETRY.retrieved})` : ''}, ${ASTROMETRY.frame} epoch J${ASTROMETRY.referenceEpoch.toFixed(1)}`);
console.log(`Exoplanets: ${EXOPLANETS.verification}, as of ${EXOPLANETS.asOfDate}`);
console.log(`Jump graph: ${[...reachableSystems(SYSTEMS, 'sol')].length}/${SYSTEMS.length} systems reachable from Sol`);
for (const w of warnings) console.log(`  warning [${w.code}] ${w.message}`);
for (const e of errors) console.log(`  ERROR   [${e.code}] ${e.message}`);
if (errors.length) {
  console.log(`\nValidation failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`\nValidation passed (${warnings.length} warning(s)).`);
