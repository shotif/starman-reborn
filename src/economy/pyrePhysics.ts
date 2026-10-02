import { DOOMED } from '../content/stellar/doomed.ts';
import { equatorialToCartesian } from '../data/coords.ts';
import { getSystem } from '../data/systems.ts';
import type { SystemId, Vec3Tuple } from '../data/types.ts';

/**
 * Pyre's physics (docs/PROCGEN.md §26): where the invented star is, how bright and big it is, and
 * how small its black hole, worked out from the rules with the real physics. Nothing here touches
 * the game state, so the scenes can use it as they load.
 */

const PC_LY = 3.261563777;
const SUN_TEMPERATURE_K = 5_772;
const SUN_BOLOMETRIC = 4.74;
/** The Sun's mass parameter GM (m³/s²) and the speed of light (m/s). */
const GM_SUN = 1.327_124_400_18e20;
const C = 299_792_458;
const G0 = 9.806_65;

/** Pyre's invented place in the map's frame, light-years from the Sun. */
export function pyrePosition(): Vec3Tuple {
  return equatorialToCartesian(DOOMED.star.raDegrees, DOOMED.star.decDegrees, DOOMED.star.distanceLy) as Vec3Tuple;
}

/** Light-years from Pyre to a real system. */
export function lyFromPyre(systemId: SystemId): number {
  const p = pyrePosition();
  const q = getSystem(systemId).positionLy;
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Pyre's absolute visual magnitude, from its luminosity and bolometric correction. */
export function pyreAbsoluteMagnitude(): number {
  return SUN_BOLOMETRIC - 2.5 * DOOMED.star.logLuminosity - DOOMED.star.bolometricCorrectionV;
}

/** Pyre's radius in solar radii, from its luminosity and temperature (L ∝ R²T⁴). */
export function pyreRadiusSolar(): number {
  return Math.sqrt(10 ** DOOMED.star.logLuminosity) * (SUN_TEMPERATURE_K / DOOMED.star.temperatureK) ** 2;
}

/** An absolute magnitude seen from this many light-years away. */
export const apparentAt = (absolute: number, ly: number): number => absolute + 5 * Math.log10(ly / PC_LY / 10);

/** The black hole's Schwarzschild radius, km. */
export function horizonKm(): number {
  return (2 * GM_SUN * DOOMED.blackHole.massSolar) / C ** 2 / 1_000;
}

/** How close a ship of the rules' length can come before the black hole's tides pull it apart at the rules' limit, km. */
export function tidalLimitKm(): number {
  const T = DOOMED.blackHole.tides;
  return Math.cbrt((2 * GM_SUN * DOOMED.blackHole.massSolar * T.shipLengthM) / (T.limitG * G0)) / 1_000;
}

/** The black hole's body id (its science card and target). */
export const PYRE_HOLE_ID = `${DOOMED.star.id}-black-hole`;
