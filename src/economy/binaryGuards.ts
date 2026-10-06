import * as THREE from 'three';
import checksFile from '../data/generated/orbit-checks.json' with { type: 'json' };
import { BINARIES, BINARY_LINES, GRADE_WORD } from '../content/stellar/binaries.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import type { Issue } from '../content/validate.ts';
import { equatorialToScene } from '../data/coords.ts';
import { arcsecToAu, besselJd, ORBIT_EPOCH_JD, ORBITS, pairAt, pairMass, relativeVectorLy, type BinaryOrbit } from '../data/orbits.ts';
import { ALL_LOCATIONS, getComponent } from '../data/systems.ts';
import { compressedSeparation, crowdedCompanions } from '../world/systems/generated.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { pairsWithinReach } from './binaries.ts';
import { MAX_REWARD } from './contractGuards.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type BinaryRules = typeof BINARIES;

/** The catalogue's own predictions for each pair, by its secondary (kept out of the game: only the tests read them). */
export const ORBIT_CHECKS = (checksFile as unknown as { ephemeris: Record<string, { year: number; thetaDeg: number; rhoArcsec: number }[]> }).ephemeris;

/** How closely the game's reckoning must match the catalogue's own ephemeris. */
export const EPHEMERIS_TOLERANCE = { thetaDeg: 0.5, rhoFraction: 0.005, rhoArcsec: 0.002 } as const;
/** The total mass a pair of these stars can have (solar masses). */
export const PAIR_MASS = [0.03, 6] as const;

/**
 * Binary orbit guardrails (docs/PROCGEN.md §44.6): each pair two stars of one system in the game,
 * once each; graded 1 to 4; its elements in range and its total mass one these stars could have;
 * the game's reckoning matching the catalogue's own predictions; in flight, each secondary in its
 * real direction from its primary, at least as far as its compressed true separation, crowding
 * nothing that is not its own; the measurement work paying sensibly within reach; and no line with a
 * number of its own or a field it cannot fill.
 */
export function validateBinaries(pairs: readonly BinaryOrbit[] = ORBITS.pairs, rules: BinaryRules = BINARIES): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const seen = new Set<string>();
  for (const o of pairs) {
    const label = `${o.primary}/${o.secondary}`;
    const a = getComponent(o.primary);
    const b = getComponent(o.secondary);
    if (!a || !b || a.systemId !== b.systemId || a.systemId !== o.systemId) {
      report('pairs', label, 'not two stars of one system in the game');
      continue;
    }
    for (const id of [o.primary, o.secondary]) {
      if (seen.has(`${id}|${id === o.secondary ? 's' : 'p'}`)) report('pairs', label, `${id} in two pairs alike`);
      seen.add(`${id}|${id === o.secondary ? 's' : 'p'}`);
    }
    if (!(o.grade in GRADE_WORD)) report('grade', label, `graded ${o.grade}: the game takes 1 to 4`);
    if (!(o.periodYears > 0 && o.axisArcsec > 0 && o.eccentricity >= 0 && o.eccentricity < 1 && o.inclinationDeg >= 0 && o.inclinationDeg <= 180 && Number.isFinite(o.periastronJd)))
      report('elements', label, 'an element out of range');
    const mass = pairMass(o, a.parallaxMas);
    if (!(mass >= PAIR_MASS[0] && mass <= PAIR_MASS[1])) report('mass', label, `${mass.toFixed(2)} solar masses in all: not a pair of these stars`);
    // The game's reckoning against the catalogue's own predictions (as the catalogue has the pair).
    const asCatalogued = { ...o, flip: undefined };
    const ephemeris = ORBIT_CHECKS[o.secondary] ?? [];
    if (!ephemeris.length) report('ephemeris', label, 'no catalogue ephemeris to test the reckoning against');
    for (const x of ephemeris) {
      const at = pairAt(asCatalogued, besselJd(x.year));
      const dTheta = Math.abs(((at.thetaDeg - x.thetaDeg + 540) % 360) - 180);
      const dRho = Math.abs(at.rhoArcsec - x.rhoArcsec);
      if (dTheta > EPHEMERIS_TOLERANCE.thetaDeg || dRho > Math.max(EPHEMERIS_TOLERANCE.rhoArcsec, EPHEMERIS_TOLERANCE.rhoFraction * x.rhoArcsec))
        report('ephemeris', label, `${x.year}: ${at.thetaDeg.toFixed(1)}° ${at.rhoArcsec.toFixed(3)}″ against the catalogue's ${x.thetaDeg}° ${x.rhoArcsec}″`);
    }
    // In flight: its real direction, far enough out, crowding nothing that is not its own.
    const def = sceneDefFor(o.systemId as never);
    const p = def.stars.find((s) => s.id === o.primary)?.position;
    const s = def.stars.find((x) => x.id === o.secondary)?.position;
    if (!p || !s) {
      report('scene', label, 'not both drawn in its system');
      continue;
    }
    const place = pairAt(o, ORBIT_EPOCH_JD);
    const want = new THREE.Vector3(...equatorialToScene(relativeVectorLy(place, a.raDegrees, a.decDegrees, a.distanceLightYears))).normalize();
    const got = s.clone().sub(p);
    if (got.angleTo(want) > 0.01) report('scene', label, `drawn ${((got.angleTo(want) * 180) / Math.PI).toFixed(1)}° from its real direction`);
    if (got.length() < compressedSeparation(arcsecToAu(place.radiusArcsec, a.parallaxMas)) - 1) report('scene', label, 'drawn nearer than its compressed separation');
    if (crowdedCompanions(def).includes(o.secondary)) report('scene', label, 'crowds what is not its own');
  }

  // The measurements.
  const m = rules.measure;
  if (!(m.odds > 0 && m.odds < 1)) report('measure', 'odds', `odds of ${m.odds}: not between none and all`);
  if (!(m.reward > 0 && m.perJump >= 0 && m.reward + m.perJump * m.reach <= MAX_REWARD)) report('measure', 'reward', `pay out of range, or above the ${MAX_REWARD} any contract may pay`);
  if (!(m.reach >= 0 && m.reach <= CONTRACTS.maxJumps.observe)) report('measure', 'reach', `${m.reach} jumps: beyond what an observation may send a pilot`);
  if (!(m.window >= CONTRACTS.epochSeconds)) report('measure', 'window', 'a window shorter than a time slot');
  const research = ALL_LOCATIONS.filter((l) => l.stationType === 'research-station' && l.status === 'functional' && l.dockable !== false);
  const measured = new Set(research.flatMap((l) => pairsWithinReach(l.id).map((x) => x.orbit.secondary)));
  if (measured.size * 2 < pairs.length) report('measure', 'stations', `only ${measured.size} of ${pairs.length} pairs have a research station within reach`);

  // The lines.
  const check = (subject: string, text: string, allowed: readonly string[]) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
  };
  const fields = ['primary', 'secondary', 'system', 'period', 'epoch'];
  check('orbit', BINARY_LINES.orbit, fields);
  check('scene', BINARY_LINES.scene, fields);
  for (const [k, line] of Object.entries(BINARY_LINES.measure)) check(`measure.${k}`, line, [...fields, 'giver']);
  return issues;
}
