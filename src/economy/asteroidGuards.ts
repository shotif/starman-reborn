import * as THREE from 'three';
import checksFile from '../data/generated/asteroid-checks.json' with { type: 'json' };
import { ASTEROID_CLASSES, ASTEROID_LINES, ASTEROID_TYPES, ASTEROIDS } from '../content/stellar/asteroids.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import type { Issue } from '../content/validate.ts';
import { COMETS } from '../content/stellar/comets.ts';
import { ASTEROID_DATA, ASTEROID_EPOCH_JD, asteroidAt, AU_KM, geocentricOnPath, nearEarthClass, type Asteroid } from '../data/asteroids.ts';
import { ALL_LOCATIONS } from '../data/systems.ts';
import { asteroidRadius, asteroidShape, asteroidSpin, cometCrowds, compressedSolDistance, eclipticToScene, nearEarthDistance, smallBodyCrowds } from '../world/systems/sol.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { asteroidNews, trackingJumps, trackReward } from './asteroids.ts';
import { COMET_CHECKED_DAYS } from './comets.ts';
import { MAX_REWARD } from './contractGuards.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type AsteroidRules = typeof ASTEROIDS;

/** Horizons' positions of each asteroid (by number): [Julian date, x, y, z] in au. */
export const ASTEROID_CHECKS = (checksFile as unknown as { positions: Record<string, [number, number, number, number][]> }).positions;

/**
 * How closely the game's reckoning must match Horizons (§47.2): within `near` days of the snapshot
 * `nearDeg` and `nearFraction`, and over the whole span checked `farDeg` and `farFraction`.
 */
export const ASTEROID_TOLERANCE = { near: 366, nearDeg: 0.1, nearFraction: 0.002, farDeg: 1.5, farFraction: 0.01 } as const;

/** A pass nearer than this (AU) must carry Horizons' path from Earth's centre (scripts/asteroids-process.ts). */
export const PATH_AU = 0.01;

/** The dates a scene is checked on: every 20 days across the span checked against Horizons, and every two hours along each pass's path. */
export function asteroidSceneDates(asteroids: readonly Asteroid[] = ASTEROID_DATA.asteroids): number[] {
  const [from, to] = COMET_CHECKED_DAYS;
  const dates = Array.from({ length: Math.floor((to - from) / 20) + 1 }, (_, i) => ASTEROID_EPOCH_JD + from + i * 20);
  for (const a of asteroids)
    for (const p of a.approaches) {
      if (!p.path?.length) continue;
      for (let jd = p.path[0]![0]; jd <= p.path.at(-1)![0]; jd += 1 / 12) dates.push(jd);
      dates.push(p.jd);
    }
  return dates;
}

/** How far the game's reckoning is from Horizons' positions of an asteroid: the worst angle (degrees) and distance (fraction), near and over all. */
export function asteroidMisses(asteroid: Asteroid): { nearDeg: number; nearFraction: number; farDeg: number; farFraction: number; checked: number } {
  const out = { nearDeg: 0, nearFraction: 0, farDeg: 0, farFraction: 0, checked: 0 };
  for (const [jd, x, y, z] of ASTEROID_CHECKS[asteroid.number] ?? []) {
    const truth = new THREE.Vector3(x, y, z);
    const got = new THREE.Vector3(...asteroidAt(asteroid, jd).xyz);
    const deg = (got.angleTo(truth) * 180) / Math.PI;
    const fraction = Math.abs(got.length() - truth.length()) / truth.length();
    out.checked++;
    out.farDeg = Math.max(out.farDeg, deg);
    out.farFraction = Math.max(out.farFraction, fraction);
    if (Math.abs(jd - ASTEROID_EPOCH_JD) <= ASTEROID_TOLERANCE.near) {
      out.nearDeg = Math.max(out.nearDeg, deg);
      out.nearFraction = Math.max(out.nearFraction, fraction);
    }
  }
  return out;
}

/** The nearest a pass's path comes to Earth's centre (au) and when, along the path as the game reads it (every minute). */
export function pathClosest(asteroid: Asteroid, passJd: number): { au: number; jd: number } | null {
  const path = asteroid.approaches.find((p) => p.jd === passJd)?.path;
  if (!path?.length) return null;
  let best = { au: Infinity, jd: passJd };
  for (let jd = path[0]![0]; jd <= path.at(-1)![0]; jd += 1 / 1_440) {
    const g = geocentricOnPath(asteroid, jd);
    const au = g ? Math.hypot(...g) : Infinity;
    if (au < best.au) best = { au, jd };
  }
  return best;
}

const keplerAgrees = (el: Asteroid['elements']) =>
  Math.abs((el.periodDays / 365.25) ** 2 / el.aAu ** 3 - 1) <= 0.002 && Math.abs(el.aAu * (1 - el.e) - el.qAu) <= 1e-6 * el.aAu && Math.abs(360 / el.motionDegPerDay - el.periodDays) <= 1e-3 * el.periodDays;
const bound = (el: Asteroid['elements']) => el.e >= 0 && el.e < 1 && el.qAu > 0 && el.aAu > el.qAu && el.inclinationDeg >= 0 && el.inclinationDeg <= 180 && Number.isFinite(el.perihelionJd) && el.motionDegPerDay > 0;

/**
 * Asteroid guardrails (docs/PROCGEN.md §47.7): each asteroid named once by its number; its elements
 * bound, in range and agreeing by Kepler's third law, and after a pass that changes its orbit taken
 * from that pass on; its class JPL's, the near-Earth ones agreeing with their elements; its flags,
 * size, shape, rotation, albedo, spectral type and magnitude parameters sensible; every pass within
 * 0.05 AU and in order, a near one with Horizons' path, whose nearest matches JPL's to a hundredth;
 * the reckoning matching Horizons; as drawn, larger for a larger asteroid but never as large as the
 * Moon, turning in the order they really turn; in Sol, on every date checked, each in its real
 * direction (from the Sun, or from Earth while passing it), no nearer than its compressed distance,
 * crowding nothing; the News only of a real pass within its window; tracking paying sensibly within
 * reach; and no line with a number of its own or a field it cannot fill.
 */
export function validateAsteroidRules(asteroids: readonly Asteroid[] = ASTEROID_DATA.asteroids, rules: AsteroidRules = ASTEROIDS): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const seen = new Set<string>();
  for (const a of asteroids) {
    if (seen.has(a.id) || a.id !== `asteroid-${a.number}` || !a.fullname.startsWith(`${a.number} ${a.name}`)) report('asteroids', a.id, 'named twice, or not by its number');
    seen.add(a.id);
    for (const el of [a.elements, ...a.later.map((l) => l.elements)]) {
      if (!bound(el)) report('elements', a.id, 'an element out of range, or an orbit that is not bound');
      if (!keplerAgrees(el)) report('elements', a.id, 'its period, motion, axis and perihelion do not agree');
    }
    let from = ASTEROID_EPOCH_JD;
    for (const l of a.later) {
      if (!(l.fromJd > from) || !a.approaches.some((p) => p.jd === l.fromJd)) report('elements', a.id, 'elements after a pass that is not one of its own, or out of order');
      from = l.fromJd;
    }
    // Its class.
    if (!(a.orbitClass.code in ASTEROID_CLASSES)) report('class', a.id, `a class with no words: ${a.orbitClass.code}`);
    if (a.neo !== (nearEarthClass(a.elements) !== null) || (a.neo && nearEarthClass(a.elements) !== a.orbitClass.code)) report('class', a.id, `JPL's class (${a.orbitClass.code}) or flag does not agree with its elements`);
    if (a.pha && (!a.neo || a.h === null || a.h > rules.hazard.h)) report('class', a.id, 'potentially hazardous, but not near Earth or not large enough');
    // What has been measured.
    if (a.diameterKm !== null && !(a.diameterKm > 0.01 && a.diameterKm < 1_000)) report('asteroids', a.id, `${a.diameterKm} km across`);
    const axes = (a.extentKm ?? '').split('×').map((x) => Number(x.trim()));
    if (a.extentKm !== null && !(axes.length >= 2 && axes.length <= 3 && axes.every((x) => x > 0) && a.diameterKm !== null && Math.max(...axes) >= a.diameterKm * 0.9 && Math.min(...axes) <= a.diameterKm * 1.1)) report('asteroids', a.id, `a shape (${a.extentKm}) that does not fit its size`);
    if (a.rotationHours !== null && !(a.rotationHours > 0.1 && a.rotationHours < 1_000)) report('asteroids', a.id, `turning once every ${a.rotationHours} hours`);
    if (a.albedo !== null && !(a.albedo > 0 && a.albedo < 1)) report('asteroids', a.id, `an albedo of ${a.albedo}`);
    const type = a.spectral.tholen ?? a.spectral.smass;
    if (type && !(type.charAt(0) in ASTEROID_TYPES)) report('asteroids', a.id, `a spectral type with no words: ${type}`);
    if (a.h === null || !(a.h > -2 && a.h < 30) || (a.g !== null && !(a.g > -0.5 && a.g < 1))) report('asteroids', a.id, 'magnitude parameters missing or out of range');
    // Its passes of Earth.
    let last = -Infinity;
    for (const p of a.approaches) {
      if (!(p.jd > last && p.distAu > 0 && p.distAu <= 0.05 && p.distMinAu <= p.distAu && p.distAu <= p.distMaxAu && p.vRelKms > 0 && p.vRelKms < 50)) report('approaches', a.id, `a pass on ${p.when} out of range or out of order`);
      last = p.jd;
      if (p.distAu < PATH_AU) {
        const c = pathClosest(a, p.jd);
        if (!c) report('approaches', a.id, `a pass ${p.distAu} AU from Earth without Horizons' path`);
        else if (Math.abs(c.au - p.distAu) > 0.01 * p.distAu || Math.abs(c.jd - p.jd) > 1 / 24) report('approaches', a.id, `its path comes ${(c.au * AU_KM).toFixed(0)} km near, JPL says ${(p.distAu * AU_KM).toFixed(0)}`);
      }
    }
    // The reckoning against Horizons.
    const miss = asteroidMisses(a);
    if (miss.checked < 20) report('ephemeris', a.id, `only ${miss.checked} of Horizons' positions to test against`);
    if (miss.nearDeg > ASTEROID_TOLERANCE.nearDeg || miss.nearFraction > ASTEROID_TOLERANCE.nearFraction)
      report('ephemeris', a.id, `${miss.nearDeg.toFixed(3)}° and ${(miss.nearFraction * 100).toFixed(2)}% from Horizons within a year of the snapshot`);
    if (miss.farDeg > ASTEROID_TOLERANCE.farDeg || miss.farFraction > ASTEROID_TOLERANCE.farFraction)
      report('ephemeris', a.id, `${miss.farDeg.toFixed(2)}° and ${(miss.farFraction * 100).toFixed(1)}% from Horizons over the years checked`);
  }

  // As drawn: larger for larger, never as large as the Moon, never smaller than a comet's smallest nucleus.
  const s = rules.size;
  const moon = sceneDefFor('sol', null).planets.find((p) => p.id === 'moon')!;
  const bySize = [...asteroids].sort((x, y) => (x.diameterKm ?? s.unknownKm) - (y.diameterKm ?? s.unknownKm));
  for (const [i, a] of bySize.entries()) {
    const r = asteroidRadius(a);
    if (!(r >= COMETS.nucleus.base && r < moon.radius)) report('size', a.id, `drawn ${r.toFixed(0)} across: smaller than a comet's nucleus, or as large as the Moon (${moon.radius})`);
    if (i > 0 && r < asteroidRadius(bySize[i - 1]!)) report('size', a.id, 'drawn smaller than a smaller asteroid');
    if (!asteroidShape(a).every((x) => x >= s.flattest && x <= 1)) report('size', a.id, 'a shape out of proportion');
  }
  if (!(s.flattest > 0 && s.flattest < 1)) report('size', 'flattest', 'no shape can be drawn');
  const turning = asteroids.filter((a) => a.rotationHours !== null).sort((x, y) => x.rotationHours! - y.rotationHours!);
  for (const [i, a] of turning.entries()) {
    const spin = asteroidSpin(a);
    if ((2 * Math.PI) / spin < 10) report('spin', a.id, 'turning more than once in ten seconds as drawn');
    if (i > 0 && spin > asteroidSpin(turning[i - 1]!)) report('spin', a.id, 'drawn turning faster than one that really turns faster');
  }

  // In Sol, on every date checked.
  for (const jd of asteroidSceneDates(asteroids)) {
    const def = sceneDefFor('sol', jd);
    const drawn = def.asteroids ?? [];
    const earth = def.planets.find((p) => p.id === 'earth')!;
    if (drawn.length !== asteroids.length) report('scene', String(jd), `${drawn.length} of ${asteroids.length} asteroids drawn`);
    for (const d of drawn) {
      const a = asteroids.find((x) => x.id === d.id);
      if (!a) continue;
      const geo = geocentricOnPath(a, jd);
      if (d.near !== (geo !== null)) report('scene', `${d.id}@${jd}`, d.near ? 'drawn by Earth off its path' : 'not drawn by Earth on its path');
      if (geo) {
        // Passing Earth: from Earth, in its real direction, no nearer than its compressed distance.
        const from = d.position.clone().sub(earth.position);
        const want = eclipticToScene(geo);
        if (from.angleTo(want) > 0.01) report('scene', `${d.id}@${jd}`, `drawn ${((from.angleTo(want) * 180) / Math.PI).toFixed(1)}° off its real direction from Earth`);
        if (from.length() < (nearEarthDistance(def, Math.hypot(...geo) * AU_KM) ?? 0) - 1) report('scene', `${d.id}@${jd}`, 'drawn nearer Earth than its compressed distance');
      } else {
        const at = asteroidAt(a, jd);
        const want = eclipticToScene(at.xyz);
        if (d.position.angleTo(want) > 0.01) report('scene', `${d.id}@${jd}`, `drawn ${((d.position.angleTo(want) * 180) / Math.PI).toFixed(1)}° from its real direction`);
        if (d.position.length() < (compressedSolDistance(at.r) ?? 0) - 1) report('scene', `${d.id}@${jd}`, 'drawn nearer the Sun than its compressed distance');
      }
      const crowds = cometCrowds(def, d.position, d.radius, rules.clear) ?? smallBodyCrowds(def, drawn, d.position, d.radius, d.id);
      if (crowds) report('scene', `${d.id}@${jd}`, `crowds ${crowds}`);
    }
    for (const n of asteroidNews(jd)) if (Math.abs(n.pass.jd - jd) > rules.news.days || !n.asteroid.approaches.includes(n.pass)) report('news', `${n.asteroid.id}@${jd}`, 'news of a pass outside its window, or not its own');
  }
  // At the nearest of each near pass, nearer Earth than the Moon is drawn, as it is nearer than the Moon.
  for (const a of asteroids)
    for (const p of a.approaches) {
      if (!p.path?.length) continue;
      const def = sceneDefFor('sol', p.jd);
      const d = def.asteroids?.find((x) => x.id === a.id);
      const earth = def.planets.find((x) => x.id === 'earth')!;
      const moonAt = def.planets.find((x) => x.id === 'moon')!.position.distanceTo(earth.position);
      if (p.distAu * AU_KM < 384_400 && d && d.position.distanceTo(earth.position) >= moonAt) report('scene', `${a.id}@${p.jd}`, 'passing nearer than the Moon, but drawn further out');
    }

  // Tracking.
  const t = rules.track;
  if (!(t.odds > 0 && t.odds < 1)) report('track', 'odds', `odds of ${t.odds}: not between none and all`);
  if (!(t.reward > 0 && t.perJump >= 0 && trackReward(t.reach) <= MAX_REWARD)) report('track', 'reward', `pay out of range, or above the ${MAX_REWARD} any contract may pay`);
  if (!(t.reach >= 0 && t.reach <= CONTRACTS.maxJumps.observe)) report('track', 'reach', `${t.reach} jumps: beyond what an observation may send a pilot`);
  if (!(t.window >= CONTRACTS.epochSeconds)) report('track', 'window', 'a window shorter than a time slot');
  if (!(t.passDays > 0 && t.passDays <= rules.news.days)) report('track', 'passDays', 'tracking a pass the News has not heard of');
  if (!ALL_LOCATIONS.some((l) => trackingJumps(l.id) !== null)) report('track', 'stations', 'no research station within reach of Sol');
  if (!asteroids.some((a) => a.neo)) report('track', 'asteroids', 'no near-Earth asteroid to track');
  if (!(rules.scanRange > 0 && rules.news.days > 0 && rules.spinFaster >= 1)) report('rules', 'rules', 'a scan range, News window or spin out of range');

  // The lines.
  const check = (subject: string, text: string, allowed: readonly string[]) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
  };
  const fields = ['asteroid', 'class', 'period', 'moid'];
  const pass = [...fields, 'date', 'distance', 'speed'];
  for (const k of ['headline', 'scene', 'near', 'unsure', 'hazardous', 'target'] as const) check(k, ASTEROID_LINES[k], fields);
  for (const k of ['bright', 'faint'] as const) check(k, ASTEROID_LINES[k], [...fields, 'magnitude', 'sight']);
  for (const k of ['changed', 'willChange'] as const) check(k, ASTEROID_LINES[k], [...fields, 'date']);
  check('pass', ASTEROID_LINES.pass, pass);
  for (const [k, line] of Object.entries(ASTEROID_LINES.news)) check(`news.${k}`, line, pass);
  for (const [k, line] of Object.entries(ASTEROID_LINES.track)) check(`track.${k}`, line, [...fields, 'giver', 'date']);
  for (const [k, line] of [...Object.entries(ASTEROID_CLASSES), ...Object.entries(ASTEROID_TYPES)]) check(`words.${k}`, line, []);
  return issues;
}
