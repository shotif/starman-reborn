import * as THREE from 'three';
import checksFile from '../data/generated/comet-checks.json' with { type: 'json' };
import { COMET_LINES, COMET_SIGHT, COMETS } from '../content/stellar/comets.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import type { Issue } from '../content/validate.ts';
import { COMET_DATA, COMET_EPOCH_JD, cometAt, perihelia, type Comet } from '../data/comets.ts';
import { ALL_LOCATIONS } from '../data/systems.ts';
import { cometCrowds, compressedSolDistance, eclipticToScene } from '../world/systems/sol.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { COMET_CHECKED_DAYS, cometNews, imagingJumps } from './comets.ts';
import { MAX_REWARD } from './contractGuards.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type CometRules = typeof COMETS;

/** Horizons' positions of each comet (by designation): [Julian date, x, y, z] in au. */
export const COMET_CHECKS = (checksFile as unknown as { positions: Record<string, [number, number, number, number][]> }).positions;

/**
 * How closely the game's reckoning must match Horizons (§45.2): within `near` days of the snapshot
 * `nearDeg` and `nearFraction`, and over the whole span checked `farDeg` and `farFraction`.
 */
export const COMET_TOLERANCE = { near: 366, nearDeg: 0.1, nearFraction: 0.002, farDeg: 3.5, farFraction: 0.07 } as const;

/** The dates a scene is checked on: every 20 days across the span checked against Horizons. */
export function cometSceneDates(): number[] {
  const [from, to] = COMET_CHECKED_DAYS;
  return Array.from({ length: Math.floor((to - from) / 20) + 1 }, (_, i) => COMET_EPOCH_JD + from + i * 20);
}

/** How far the game's reckoning is from Horizons' positions of a comet: the worst angle (degrees) and distance (fraction), near and over all. */
export function cometMisses(comet: Comet): { nearDeg: number; nearFraction: number; farDeg: number; farFraction: number; checked: number } {
  const out = { nearDeg: 0, nearFraction: 0, farDeg: 0, farFraction: 0, checked: 0 };
  for (const [jd, x, y, z] of COMET_CHECKS[comet.designation] ?? []) {
    const at = cometAt(comet, jd);
    const truth = new THREE.Vector3(x, y, z);
    const got = new THREE.Vector3(...at.xyz);
    const deg = (got.angleTo(truth) * 180) / Math.PI;
    const fraction = Math.abs(got.length() - truth.length()) / truth.length();
    out.checked++;
    out.farDeg = Math.max(out.farDeg, deg);
    out.farFraction = Math.max(out.farFraction, fraction);
    if (Math.abs(jd - COMET_EPOCH_JD) <= COMET_TOLERANCE.near) {
      out.nearDeg = Math.max(out.nearDeg, deg);
      out.nearFraction = Math.max(out.nearFraction, fraction);
    }
  }
  return out;
}

/**
 * Comet guardrails (docs/PROCGEN.md §45.7): each comet named once, its elements bound and in range,
 * its period matching its semi-major axis by Kepler's third law, its size and magnitude parameters
 * sensible; the reckoning matching Horizons; in Sol on every date checked, each comet in its real
 * direction from the Sun, no nearer than its compressed distance, crowding nothing, its tails away
 * from the Sun; the News only of a real perihelion within its window; imaging paying sensibly
 * within reach; and no line with a number of its own or a field it cannot fill.
 */
export function validateCometRules(comets: readonly Comet[] = COMET_DATA.comets, rules: CometRules = COMETS): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const seen = new Set<string>();
  for (const c of comets) {
    if (seen.has(c.id) || c.id !== `comet-${c.designation.toLowerCase()}` || !c.name.startsWith(`${c.designation}/`)) report('comets', c.id, 'named twice, or not by its designation');
    seen.add(c.id);
    const el = c.elements;
    if (!(el.e >= 0 && el.e < 1 && el.qAu > 0 && el.aAu > el.qAu && el.inclinationDeg >= 0 && el.inclinationDeg <= 180 && Number.isFinite(el.perihelionJd) && el.motionDegPerDay > 0))
      report('elements', c.id, 'an element out of range, or an orbit that is not bound');
    // Kepler's third law: P² = a³ (years, au), to a part in a thousand; q = a(1 − e).
    const years = el.periodDays / 365.25;
    if (Math.abs(years ** 2 / el.aAu ** 3 - 1) > 0.002 || Math.abs(el.aAu * (1 - el.e) - el.qAu) > 1e-6 * el.aAu || Math.abs(360 / el.motionDegPerDay - el.periodDays) > 1e-3 * el.periodDays)
      report('elements', c.id, 'its period, motion, axis and perihelion do not agree');
    if (c.diameterKm !== null && !(c.diameterKm > 0.1 && c.diameterKm < 200)) report('comets', c.id, `a nucleus ${c.diameterKm} km across`);
    if (c.m1 !== null && !(c.m1 > -5 && c.m1 < 25 && (c.k1 ?? 0) > 0 && (c.k1 ?? 0) < 40)) report('comets', c.id, 'magnitude parameters out of range');
    // The reckoning against Horizons.
    const miss = cometMisses(c);
    if (miss.checked < 20) report('ephemeris', c.id, `only ${miss.checked} of Horizons' positions to test against`);
    if (miss.nearDeg > COMET_TOLERANCE.nearDeg || miss.nearFraction > COMET_TOLERANCE.nearFraction)
      report('ephemeris', c.id, `${miss.nearDeg.toFixed(3)}° and ${(miss.nearFraction * 100).toFixed(2)}% from Horizons within a year of the snapshot`);
    if (miss.farDeg > COMET_TOLERANCE.farDeg || miss.farFraction > COMET_TOLERANCE.farFraction)
      report('ephemeris', c.id, `${miss.farDeg.toFixed(2)}° and ${(miss.farFraction * 100).toFixed(1)}% from Horizons over the years checked`);
    const { last, next } = perihelia(c, COMET_EPOCH_JD);
    if (!(last <= COMET_EPOCH_JD && next > COMET_EPOCH_JD && Math.abs(next - last - el.periodDays) < 1e-6)) report('elements', c.id, 'its perihelia do not straddle the snapshot');
  }

  // In Sol, on every date checked.
  for (const jd of cometSceneDates()) {
    const def = sceneDefFor('sol', jd);
    const drawn = def.comets ?? [];
    if (drawn.length !== comets.length) report('scene', String(jd), `${drawn.length} of ${comets.length} comets drawn`);
    for (const d of drawn) {
      const c = comets.find((x) => x.id === d.id);
      if (!c) continue;
      const at = cometAt(c, jd);
      const want = eclipticToScene(at.xyz).normalize();
      if (d.position.angleTo(want) > 0.01) report('scene', `${d.id}@${jd}`, `drawn ${((d.position.angleTo(want) * 180) / Math.PI).toFixed(1)}° from its real direction`);
      if (d.position.length() < (compressedSolDistance(at.r) ?? 0) - 1) report('scene', `${d.id}@${jd}`, 'drawn nearer the Sun than its compressed distance');
      const crowds = cometCrowds(def, d.position, d.radius + d.coma);
      if (crowds) report('scene', `${d.id}@${jd}`, `crowds ${crowds}`);
      if (d.tail > 0 && (d.gasDir.angleTo(d.position) > 1e-6 || d.dustDir.dot(d.position) <= 0)) report('scene', `${d.id}@${jd}`, 'a tail not away from the Sun');
      if ((d.tail > 0) !== at.r < rules.activity.from) report('scene', `${d.id}@${jd}`, 'a tail where the comet is quiet, or none where it is active');
    }
    for (const n of cometNews(jd)) {
      const days = Math.abs(n.perihelionJd - jd);
      const { last, next } = perihelia(n.comet, jd);
      if (days > rules.news.days || (n.perihelionJd !== last && n.perihelionJd !== next)) report('news', `${n.comet.id}@${jd}`, 'news of a perihelion outside its window, or not its own');
    }
  }

  // Imaging.
  const m = rules.image;
  if (!(m.odds > 0 && m.odds < 1)) report('image', 'odds', `odds of ${m.odds}: not between none and all`);
  if (!(m.reward > 0 && m.perJump >= 0 && m.reward + m.perJump * m.reach <= MAX_REWARD)) report('image', 'reward', `pay out of range, or above the ${MAX_REWARD} any contract may pay`);
  if (!(m.reach >= 0 && m.reach <= CONTRACTS.maxJumps.observe)) report('image', 'reach', `${m.reach} jumps: beyond what an observation may send a pilot`);
  if (!(m.window >= CONTRACTS.epochSeconds)) report('image', 'window', 'a window shorter than a time slot');
  if (!ALL_LOCATIONS.some((l) => imagingJumps(l.id) !== null)) report('image', 'stations', 'no research station within reach of Sol');
  if (!(rules.news.days > 0 && rules.activity.from > rules.activity.full && rules.activity.full > 0)) report('activity', 'rules', 'activity or News windows out of order');
  const s = rules.sight;
  if (!(s.nakedEye < s.binoculars && s.binoculars < s.smallTelescope)) report('sight', 'rules', 'what it takes to see a comet, out of order');

  // The lines.
  const check = (subject: string, text: string, allowed: readonly string[]) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
  };
  const fields = ['comet', 'class', 'period', 'q'];
  check('headline', COMET_LINES.headline, fields);
  check('scene', COMET_LINES.scene, fields);
  check('unsure', COMET_LINES.unsure, fields);
  check('faint', COMET_LINES.faint, fields);
  check('bright', COMET_LINES.bright, [...fields, 'magnitude', 'sight']);
  check('target', COMET_LINES.target, fields);
  for (const [k, line] of Object.entries(COMET_LINES.news)) check(`news.${k}`, line, [...fields, 'date']);
  for (const [k, line] of Object.entries(COMET_LINES.image)) check(`image.${k}`, line, [...fields, 'giver']);
  for (const [k, line] of Object.entries(COMET_SIGHT)) check(`sight.${k}`, line, []);
  return issues;
}
