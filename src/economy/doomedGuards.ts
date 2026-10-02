import { DOOMED, type DoomedRules } from '../content/stellar/doomed.ts';
import { EDGE_COMMS, EDGE_EARTH, EDGE_FICTION, EDGE_JOBS, EDGE_NEWS } from '../content/stellar/doomedLines.ts';
import { EVENTS } from '../content/events/rules.ts';
import { PASSENGERS } from '../content/passengers/rules.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { MAX_REWARD } from './contractGuards.ts';
import { STELLAR } from '../content/stellar/rules.ts';
import type { Issue } from '../content/validate.ts';
import { ALL_LOCATIONS, ASTROMETRY, BELTS, EXOPLANETS, FAR_STARS, isFrontier, SYSTEMS, WORLD } from '../data/systems.ts';
import { equatorialToCartesian } from '../data/coords.ts';
import type { SystemId } from '../data/types.ts';
import { skyTimeline } from './stellar.ts';
import { apparentAt, horizonKm, pyreRadiusSolar, tidalLimitKm } from './doomed.ts';

/** The archives' census of the Sun's neighbourhood: everything with a parallax of at least 120 mas, as far as this (light-years). */
const CENSUS_LY = (1_000 / 120) * 3.261563777;
/** Venus at its brightest, the full Moon, and the Sun, seen from Earth (apparent magnitudes). */
const VENUS = -4.9;
const FULL_MOON = -12.7;
const SUN = -26.74;
/** The long-range drive's reach at its first class, light-years (content/rules/gearFamilies.ts). */
const DRIVE_REACH = 11;

/** Words that would make an invented name look like a catalogue designation. */
const CATALOGUE_LIKE = /^(HD|HIP|HR|GJ|Gl|Gliese|LHS|LP|LTT|Ross|Wolf|Luyten|Lalande|Lacaille|Kapteyn|Kruger|Struve|BD|CD|CPD|2MASS|WISE|Gaia|TYC|SCR|DENIS|UGPS|PSO|L)\b|\d/i;

/**
 * Guardrails for Pyre, the invented star (docs/PROCGEN.md §26.7): it is kept apart from everything
 * real (no id or name of the game's, nothing like a catalogue name, nowhere in the real sky's
 * data); it sits beyond the census, near one frontier system its one lane reaches; its numbers are
 * a red supergiant's, and how bright it gets stays between the full Moon and the Sun; its story runs
 * forward, after Antares has gone, and crosses the map in good time; prices make sense; and no line
 * holds a number of its own or a field it cannot fill.
 */
export function validateDoomed(rules: DoomedRules = DOOMED): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const star = rules.star;

  // Kept apart: nothing real shares its id or name, and its name is like no catalogue's.
  const taken = new Set<string>(
    [
      ...SYSTEMS.flatMap((s) => [s.id, s.displayName]),
      ...ASTROMETRY.stars.flatMap((s) => [s.id, s.name]),
      ...FAR_STARS.stars.flatMap((s) => [s.id, s.name]),
      ...EXOPLANETS.planets.flatMap((p) => [p.id, p.archiveName, p.displayName]),
      ...BELTS.flatMap((b) => [b.id, b.name]),
      ...ALL_LOCATIONS.flatMap((l) => [l.id, l.name, l.name.split(' ')[0]!]),
    ].map((x) => x.toLowerCase()),
  );
  const names = [star.id, star.name, rules.stations.observatory.id, rules.stations.observatory.name, rules.stations.remnant.id, rules.stations.remnant.name];
  for (const n of names) if (taken.has(n.toLowerCase())) report('apart', n, 'shares its id or name with something of the game');
  if (CATALOGUE_LIKE.test(star.name)) report('apart', star.name, 'looks like a catalogue name');
  if (WORLD.links.has(star.id as SystemId) || [...WORLD.links.values()].some((l) => l.includes(star.id as SystemId))) report('apart', star.id, 'is in the world’s jump network');

  // Its place: beyond the census, near its anchor, within a first drive's reach of it.
  const p = equatorialToCartesian(star.raDegrees, star.decDegrees, star.distanceLy);
  if (!(star.distanceLy >= CENSUS_LY + 3 && star.distanceLy <= 40)) report('place', star.id, `${star.distanceLy} ly: not beyond the census (${CENSUS_LY.toFixed(2)} ly) by three light-years, or too far`);
  const near = SYSTEMS.map((s) => ({ id: s.id, ly: Math.hypot(s.positionLy[0] - p[0], s.positionLy[1] - p[1], s.positionLy[2] - p[2]) })).sort((a, b) => a.ly - b.ly);
  const [first, second] = near;
  if (first?.id !== star.anchor) report('place', star.anchor, `is not the nearest system to it (${first?.id} is)`);
  if (!isFrontier(star.anchor as SystemId)) report('place', star.anchor, 'is not in the frontier');
  if ((WORLD.links.get(star.anchor as SystemId)?.length ?? 0) >= 5) report('place', star.anchor, 'already has five lanes');
  if (!first || first.ly < 5 || first.ly > DRIVE_REACH || !second || second.ly < first.ly + 2) report('place', star.id, 'not a lane a first long-range drive takes, from a system clearly nearest');

  // A red supergiant's numbers, and how bright it gets.
  const absolute = 4.74 - 2.5 * star.logLuminosity - star.bolometricCorrectionV;
  if (!(star.massSolar >= 20 && star.massSolar > rules.blackHole.massSolar)) report('physics', star.id, 'not massive enough to leave a black hole');
  if (!(absolute >= -8 && absolute <= -4)) report('physics', star.id, `absolute magnitude ${absolute.toFixed(1)}: not a red supergiant’s`);
  if (rules === DOOMED && !(pyreRadiusSolar() >= 500 && pyreRadiusSolar() <= 1_600)) report('physics', star.id, `${pyreRadiusSolar().toFixed(0)} solar radii: not a red supergiant’s`);
  if (!(apparentAt(absolute, star.distanceLy) < VENUS)) report('brightness', star.id, 'not brighter than Venus from Earth, as the game says it is');
  for (const s of SYSTEMS) {
    const ly = Math.hypot(s.positionLy[0] - p[0], s.positionLy[1] - p[1], s.positionLy[2] - p[2]);
    const peak = apparentAt(STELLAR.supernova.peakAbsoluteMagnitude, ly);
    if (!(peak < FULL_MOON && peak > SUN)) report('brightness', s.id, `a peak of ${peak.toFixed(1)}: not between the full Moon and the Sun`);
    if (!(apparentAt(rules.timeline.remnantAbsoluteMagnitude, ly) > peak + 0.5)) report('brightness', s.id, 'a remnant as bright as the supernova');
  }
  if (rules === DOOMED && !(tidalLimitKm() > horizonKm())) report('physics', 'blackHole', 'tides that tear a ship apart only inside the horizon');
  if (!(rules.blackHole.hullStrainPerSecond > 0 && rules.blackHole.hullStrainPerSecond <= 10)) report('physics', 'blackHole', 'a hull strain at the tidal zone’s edge out of 0–10 a second');
  if (!(rules.blackHole.fallbackDecay > 1 && rules.blackHole.fallbackDecay < 3)) report('physics', 'blackHole', 'its infalling gas does not fade, or fades too fast');

  // The story runs forward, after Antares, and crosses the map in good time.
  const T = rules.timeline;
  const S = STELLAR.supernova;
  if (![T.collapseAfterWarning, T.breakoutAfterCollapse, T.secondsPerLy, T.laneOpensAfterBreakout, T.stationOpensAfterBreakout].every((x) => x > 0)) report('timeline', 'timeline', 'a stretch that is not positive');
  if (!(rules.schedule.afterAntares > 0 && rules.schedule.afterFrontier > 0 && rules.schedule.afterLoad > 0)) report('timeline', 'schedule', 'a warning that does not come after what it waits for');
  if (T.laneOpensAfterBreakout < S.rise + S.plateau) report('timeline', 'lane', 'opens before the supernova is past its peak at Pyre');
  if (T.stationOpensAfterBreakout < S.rise + S.plateau + S.fade) report('timeline', 'station', 'opens before the supernova has faded at Pyre');
  const widest = Math.max(...SYSTEMS.map((s) => Math.hypot(s.positionLy[0] - p[0], s.positionLy[1] - p[1], s.positionLy[2] - p[2])));
  if (widest * T.secondsPerLy > 7_200) report('timeline', 'light', 'its light takes more than two hours to cross the map');
  if (skyTimeline(0).bhGone <= 0) report('timeline', 'antares', 'Antares does not go out');

  // Prices, and the words.
  if (!(rules.market.price > 1 && rules.market.price <= 2) || !rules.market.goods.length) report('market', 'price', 'a price effect out of 1–2, or on no goods');
  if (ALL_LOCATIONS.filter((l) => l.stationType === 'research-station' && l.status === 'functional').length < 3) report('market', 'stations', 'fewer than three research stations');
  const check = (subject: string, text: string, allowed: readonly string[]) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
  };
  const fields = ['star', 'distance', 'brightness', 'peak', 'anchor', 'system', 'here', 'herePeak', 'ozoneNear', 'ozoneFar'];
  for (const [kind, n] of Object.entries(EDGE_NEWS)) {
    check(`news.${kind}`, n.headline, fields);
    check(`news.${kind}`, n.detail, fields);
  }
  for (const [kind, line] of Object.entries(EDGE_COMMS)) check(`comms.${kind}`, line, fields);
  check('earth', EDGE_EARTH.headline, fields);
  check('earth', EDGE_EARTH.detail, fields);
  check('fiction', EDGE_FICTION, ['star']);
  for (const [kind, l] of Object.entries(EDGE_JOBS)) for (const text of [l.title, l.briefing, l.objective]) check(`jobs.${kind}`, text, ['star', 'anchor', 'refuge', 'party', 'giver', 'firstLight', 'ahead']);

  // Its work: under the contracts' ceiling, a party the passages take, a first light a pilot can see
  // twice by outrunning it through a lane near it, and a black hole that still glows once its station opens.
  const J = rules.jobs;
  for (const [kind, j] of Object.entries(J)) if (!(j.reward > 0 && j.reward <= MAX_REWARD)) report('jobs', kind, `a reward of ${j.reward}, out of 1–${MAX_REWARD}`);
  const [lo, hi] = J.evacuate.party;
  if (!(lo >= 1 && lo <= hi && lo >= PASSENGERS.passage.party[0] && hi <= PASSENGERS.passage.party[1])) report('jobs', 'evacuate', 'a party the passages do not take');
  const lyOf = (id: SystemId) => {
    const q = SYSTEMS.find((s) => s.id === id)!.positionLy;
    return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  };
  const reach = jumpsFrom(WORLD.links, star.anchor as SystemId);
  const within = (id: SystemId) => (reach.get(id) ?? Infinity) <= J.twice.reach + 1;
  const outrun = [...WORLD.links].some(([a, lanes]) =>
    within(a) && lanes.some((b) => within(b) && lyOf(b) - lyOf(a) >= J.twice.aheadLy && EVENTS.jumpSeconds <= T.secondsPerLy * (lyOf(b) - lyOf(a)) + J.twice.firstLight),
  );
  if (!(J.twice.firstLight > 0 && J.twice.aheadLy > 0 && J.twice.reach >= 1) || !outrun) report('jobs', 'twice', 'no lane near it lets a pilot outrun its light');
  const glowsUntil = T.laneOpensAfterBreakout * J.hole.glowAbove ** (-1 / rules.blackHole.fallbackDecay);
  if (!(J.hole.glowAbove > 0 && J.hole.glowAbove < 1) || glowsUntil <= T.stationOpensAfterBreakout) report('jobs', 'hole', 'its gas has faded before its station opens');
  if (!(rules.earth.ozoneNearPc > 0 && rules.earth.ozoneFarPc > rules.earth.ozoneNearPc)) report('earth', 'ozone', 'estimates out of order');
  return issues;
}
