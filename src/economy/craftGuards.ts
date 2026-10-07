import * as THREE from 'three';
import checksFile from '../data/generated/spacecraft-checks.json' with { type: 'json' };
import { CRAFT_LINES, CRAFT_STORIES, SPACECRAFT, type CraftFact, type CraftStory } from '../content/stellar/spacecraft.ts';
import type { Issue } from '../content/validate.ts';
import { AU_KM } from '../data/asteroids.ts';
import { twoBodyAt } from '../data/kepler.ts';
import { CRAFT_DATA, CRAFT_EPOCH_JD, SUN_GM, arcElements, arcOn, craftAt, craftOn, craftOnPath, type Spacecraft } from '../data/spacecraft.ts';
import { compressedSolDistance, craftCrowds, eclipticToScene, nearEarthDistance } from '../world/systems/sol.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { craftNews, factJd } from './spacecraft.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type CraftRules = typeof SPACECRAFT;

interface CraftChecks {
  /** Horizons' places of the craft from the Sun every four days: [Julian date, x, y, z] (au). */
  places: [number, number, number, number][];
  /** Its full paths from Earth's centre (au), as Horizons gave them. */
  path: [number, number, number, number][];
  /** The text of Horizons' record of it, and of NSSDCA's page on it (null where it has none). */
  record: string;
  nssdca: string | null;
}

/** For each craft: Horizons' places, its paths and its sources' text (scripts/spacecraft-process.ts). */
export const CRAFT_CHECKS = (checksFile as unknown as { craft: Record<string, CraftChecks> }).craft;

/**
 * How closely the game's reckoning must match Horizons (§49.2): on every one of its places from the
 * Sun, the angle seen from the Sun (degrees) and the fraction of the distance; on its paths from
 * Earth's centre, between kept points, the angle seen from Earth and the fraction (looser for a craft
 * that never leaves Earth's neighbourhood); a pass's nearest point, in distance (fraction) and time (days).
 */
export const CRAFT_TOLERANCE = { deg: 0.1, fraction: 0.002, pathDeg: 0.5, pathFraction: 0.02, wholeDeg: 1.5, wholeFraction: 0.03, passFraction: 0.01, passDays: 1 / 24 } as const;

/** A pass is a pass of Earth nearer than this (au): Horizons' paths are fetched round them (scripts/sky-fetch.ts). */
export const CRAFT_NEAR_AU = 0.05;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The ways a source writes a date (`YYYY-MM-DD`, or `YYYY-MM` for a month), so a quotation can be checked to give it. */
export function dateWritings(on: string): string[] {
  const [y, m, d] = on.split('-').map(Number) as [number, number, number?];
  const long = MONTHS[m - 1]!;
  const short = long.slice(0, 3);
  if (d === undefined) return [`${long} ${y}`, `${long}, ${y}`, `${y} ${short}`, `${y}-${short}`, `${short} ${y}`];
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return [
    `${y}-${mm}-${dd}`,
    `${y}-${short}-${dd}`,
    `${y}-${short}-${d}`,
    `${y}-${short.toUpperCase()}-${dd}`,
    `${dd} ${long} ${y}`,
    `${d} ${long} ${y}`,
    `${dd} ${short}. ${y}`,
    `${d} ${short}. ${y}`,
    `${d} ${short} ${y}`,
    `${long} ${d}, ${y}`,
    `${short} ${d}, ${y}`,
    `${short} ${dd}, ${y}`,
  ];
}

/** The dates a scene is checked on: every 10 days across the snapshot's window, and every six hours along each pass's path. */
export function craftSceneDates(craft: readonly Spacecraft[] = CRAFT_DATA.spacecraft): number[] {
  const dates = Array.from({ length: 220 }, (_, i) => CRAFT_EPOCH_JD - 730 + i * 10);
  for (const c of craft)
    for (const p of c.passes) {
      const path = c.paths.find((x) => x.length && x[0]![0] <= p.jd && x.at(-1)![0] >= p.jd);
      if (!path) continue;
      for (let jd = path[0]![0]; jd <= path.at(-1)![0]; jd += 0.25) dates.push(jd);
      dates.push(p.jd);
    }
  return dates;
}

/** How far a craft's reckoning is from Horizons' places of it from the Sun: the worst angle (degrees) and distance (fraction). */
export function craftMisses(craft: Spacecraft): { deg: number; fraction: number; checked: number } {
  const out = { deg: 0, fraction: 0, checked: 0 };
  if (!craft.arcs.length) return out;
  for (const [jd, x, y, z] of CRAFT_CHECKS[craft.id]?.places ?? []) {
    const el = arcOn(craft, jd);
    if (!el) continue;
    const got = new THREE.Vector3(...twoBodyAt(el, jd).xyz);
    const truth = new THREE.Vector3(x, y, z);
    out.checked++;
    out.deg = Math.max(out.deg, (got.angleTo(truth) * 180) / Math.PI);
    out.fraction = Math.max(out.fraction, Math.abs(got.length() - truth.length()) / truth.length());
  }
  return out;
}

/** How far a craft's kept paths are from Horizons' full ones, between kept points: the worst angle (degrees, seen from Earth) and distance (fraction). */
export function pathMisses(craft: Spacecraft): { deg: number; fraction: number; checked: number } {
  const out = { deg: 0, fraction: 0, checked: 0 };
  for (const [jd, x, y, z] of CRAFT_CHECKS[craft.id]?.path ?? []) {
    const got = craftOnPath(craft, jd);
    if (!got) continue;
    const g = new THREE.Vector3(...got);
    const truth = new THREE.Vector3(x, y, z);
    out.checked++;
    out.deg = Math.max(out.deg, (g.angleTo(truth) * 180) / Math.PI);
    out.fraction = Math.max(out.fraction, Math.abs(g.length() - truth.length()) / truth.length());
  }
  return out;
}

/** Every fact of a story, with what it is. */
function factsOf(story: CraftStory): [string, CraftFact][] {
  return [['agency', story.agency], ['summary', story.summary], ['launched', story.launched], ...story.events.map((f, i): [string, CraftFact] => [`event ${i + 1}`, f]), ...story.notes.map((f, i): [string, CraftFact] => [`note ${i + 1}`, f])];
}

/**
 * Spacecraft guardrails (docs/PROCGEN.md §49.6): each craft named once and by its name, with a story
 * and a look; its span in order; its arcs in order from its span's start, each a true ellipse or
 * hyperbola agreeing with Kepler's third law, matching every one of Horizons' places from the Sun;
 * its paths in time order, near Earth, matching Horizons' full paths; each pass inside a path, near
 * Earth, at its nearest point; every fact quoted word for word from its source, a dated one's date
 * in its quotation, every figure a line gives in its quotation, a fact after the snapshot told as to
 * come and one before as done, the agency's name in its quotation, launched before its span and the
 * events in order; as drawn, in Sol on every date checked, each craft Horizons has drawn and none
 * other, in its real direction (from the Sun, or from Earth on its path) to 0.01 radian, no nearer
 * than its compressed distance, crowding nothing; the News only of a real pass within its window;
 * and no line with a number of its own or a field it cannot fill.
 */
export function validateCraftRules(craft: readonly Spacecraft[] = CRAFT_DATA.spacecraft, rules: CraftRules = SPACECRAFT, stories: Record<string, CraftStory> = CRAFT_STORIES): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const t = CRAFT_TOLERANCE;
  const seen = new Set<string>();
  for (const c of craft) {
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (seen.has(c.id) || c.id !== slug) report('craft', c.id, 'named twice, or not by its name');
    seen.add(c.id);
    if (!stories[c.id]) report('story', c.id, 'no story');
    if (!rules.look[c.id]) report('look', c.id, 'no look');
    if (!(c.from < c.to && c.from <= CRAFT_EPOCH_JD + 1 && c.to >= CRAFT_EPOCH_JD)) report('craft', c.id, 'a span that does not hold the snapshot');

    // Arcs.
    if (!c.arcs.length && !(c.paths.length === 1 && c.paths[0]![0]![0] <= c.from && c.paths[0]!.at(-1)![0] >= c.to)) report('arcs', c.id, 'no arcs, and no path over its whole span');
    if (c.arcs.length && c.arcs[0]![0] !== c.from) report('arcs', c.id, 'arcs not from its span’s start');
    for (const [i, a] of c.arcs.entries()) {
      const el = arcElements(a);
      if (i > 0 && !(a[0] > c.arcs[i - 1]![0])) report('arcs', `${c.id} ${i + 1}`, 'out of order');
      if (!(el.e >= 0 && (el.e < 1 ? el.aAu > 0 : el.aAu < 0) && el.inclinationDeg >= 0 && el.inclinationDeg <= 180 && el.motionDegPerDay > 0)) report('arcs', `${c.id} ${i + 1}`, 'not a true ellipse or hyperbola');
      // Kepler's third law, to a tenth: an arc's motion is set to meet where Horizons has the craft at its end, a little off the osculating.
      const n = (Math.sqrt(SUN_GM / Math.abs(el.aAu) ** 3) * 180) / Math.PI;
      if (Math.abs(n - el.motionDegPerDay) / n > 0.1) report('arcs', `${c.id} ${i + 1}`, 'its motion and size disagree by Kepler’s third law');
    }
    const miss = craftMisses(c);
    if (c.arcs.length && miss.checked < 10) report('ephemeris', c.id, `only ${miss.checked} of Horizons' places to test against`);
    if (miss.deg > t.deg || miss.fraction > t.fraction) report('ephemeris', c.id, `${miss.deg.toFixed(3)}° and ${(miss.fraction * 100).toFixed(2)}% from Horizons`);

    // Paths and passes.
    const whole = !c.arcs.length;
    for (const [i, p] of c.paths.entries()) {
      if (p.length < 2 || p.some((x, k) => k > 0 && !(x[0] > p[k - 1]![0]))) report('paths', `${c.id} ${i + 1}`, 'fewer than two points, or out of order');
      if (!whole && Math.min(...p.map((x) => Math.hypot(x[1], x[2], x[3]))) > CRAFT_NEAR_AU) report('paths', `${c.id} ${i + 1}`, 'a path never near Earth');
    }
    const pm = pathMisses(c);
    if (pm.deg > (whole ? t.wholeDeg : t.pathDeg) || pm.fraction > (whole ? t.wholeFraction : t.pathFraction)) report('paths', c.id, `${pm.deg.toFixed(2)}° and ${(pm.fraction * 100).toFixed(1)}% from Horizons' path`);
    const full = CRAFT_CHECKS[c.id]?.path ?? [];
    for (const p of c.passes) {
      if (!(p.au > 0 && p.au < CRAFT_NEAR_AU) || !craftOnPath(c, p.jd)) report('passes', `${c.id}@${p.jd}`, 'not near Earth, or not on a path');
      const near = full.filter((x) => Math.abs(x[0] - p.jd) < 0.5);
      const least = near.reduce<[number, number, number, number] | null>((m, x) => (!m || Math.hypot(x[1], x[2], x[3]) < Math.hypot(m[1], m[2], m[3]) ? x : m), null);
      if (!least || Math.abs(least[0] - p.jd) > t.passDays || Math.abs(Math.hypot(least[1], least[2], least[3]) - p.au) / p.au > t.passFraction) report('passes', `${c.id}@${p.jd}`, 'not at its path’s nearest point');
    }

    // The story.
    const story = stories[c.id];
    const text = CRAFT_CHECKS[c.id];
    if (story && text) {
      for (const [what, f] of factsOf(story)) {
        const source = f.source === 'horizons' ? text.record : text.nssdca;
        if (!source || !source.includes(f.quote)) report('story', `${c.id} ${what}`, `not found word for word in its source (${f.source})`);
        if (f.on !== undefined) {
          if (!/^\d{4}-\d{2}(-\d{2})?$/.test(f.on)) report('story', `${c.id} ${what}`, `a date it cannot read: ${f.on}`);
          else if (!dateWritings(f.on).some((w) => f.quote.toLowerCase().includes(w.toLowerCase()))) report('story', `${c.id} ${what}`, `its date (${f.on}) is not in its quotation`);
        }
        const figures = f.quote.replace(/(\d),(\d)/g, '$1$2');
        for (const [n] of f.line.replace(/(\d),(\d)/g, '$1$2').matchAll(/\d+(\.\d+)?/g)) if (!new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}([^\\d]|$)`).test(figures)) report('story', `${c.id} ${what}`, `a figure (${n}) not in its quotation`);
      }
      if (!story.agency.quote.includes(story.agency.line) && !(story.agency.line === 'NASA' && story.agency.quote.includes('National Aeronautics and Space Administration'))) report('story', `${c.id} agency`, 'its name is not in its quotation');
      if (!story.launched.on || factJd(story.launched.on) > c.from) report('story', `${c.id} launched`, 'launched after where Horizons has it');
      for (const [i, f] of story.events.entries()) {
        if (!f.on) report('story', `${c.id} event ${i + 1}`, 'no date');
        else {
          if (i > 0 && story.events[i - 1]!.on && factJd(f.on) < factJd(story.events[i - 1]!.on!)) report('story', `${c.id} event ${i + 1}`, 'out of order');
          const toCome = factJd(f.on) > CRAFT_EPOCH_JD;
          if (toCome !== f.line.startsWith('To ')) report('story', `${c.id} event ${i + 1}`, toCome ? 'after the snapshot, but told as done' : 'before the snapshot, but told as to come');
        }
      }
    }
  }
  for (const id of Object.keys(stories)) if (!craft.some((c) => c.id === id)) report('story', id, 'a story for a craft Horizons does not give');
  if (!(rules.size > 0 && rules.scanRange > rules.size && Object.values(rules.clear).every((x) => x >= 0) && rules.news.days > 0 && rules.news.reach >= 0)) report('rules', 'spacecraft', 'a size, scan range, clearance or news window out of range');

  // In Sol, on every date checked.
  for (const jd of craftSceneDates(craft)) {
    const def = sceneDefFor('sol', jd);
    const drawn = def.craft ?? [];
    const earth = def.planets.find((p) => p.id === 'earth')!;
    for (const c of craft) if (craftOn(c, jd) !== drawn.some((d) => d.id === c.id)) report('scene', `${c.id}@${jd}`, craftOn(c, jd) ? 'not drawn where Horizons has it' : 'drawn where Horizons has no place for it');
    for (const d of drawn) {
      const c = craft.find((x) => x.id === d.id);
      if (!c) continue;
      const geo = craftOnPath(c, jd);
      if (d.near !== (geo !== null)) report('scene', `${d.id}@${jd}`, d.near ? 'drawn by Earth off its path' : 'not drawn by Earth on its path');
      if (geo) {
        const from = d.position.clone().sub(earth.position);
        const want = eclipticToScene(geo);
        if (from.angleTo(want) > 0.01) report('scene', `${d.id}@${jd}`, `drawn ${((from.angleTo(want) * 180) / Math.PI).toFixed(1)}° off its real direction from Earth`);
        if (from.length() < (nearEarthDistance(def, Math.hypot(...geo) * AU_KM) ?? 0) - 1) report('scene', `${d.id}@${jd}`, 'drawn nearer Earth than its compressed distance');
      } else {
        const at = craftAt(c, jd)!;
        const want = eclipticToScene(at.xyz);
        if (d.position.angleTo(want) > 0.01) report('scene', `${d.id}@${jd}`, `drawn ${((d.position.angleTo(want) * 180) / Math.PI).toFixed(1)}° from its real direction`);
        if (d.position.length() < (compressedSolDistance(at.r) ?? 0) - 1) report('scene', `${d.id}@${jd}`, 'drawn nearer the Sun than its compressed distance');
      }
      const crowds = craftCrowds(def, drawn, d.position, d.radius, d.id);
      if (crowds) report('scene', `${d.id}@${jd}`, `crowds ${crowds}`);
    }
    for (const n of craftNews(jd)) if (Math.abs(n.pass.jd - jd) > rules.news.days || !n.craft.passes.includes(n.pass)) report('news', `${n.craft.id}@${jd}`, 'news of a pass outside its window, or not its own');
  }

  // The lines.
  const fields = ['craft', 'distance', 'light', 'period', 'date', 'near'];
  for (const [k, line] of Object.entries(CRAFT_LINES)) {
    if (/\d/.test(line)) report('lines', k, `a number written into the line: “${line}”`);
    for (const [, key] of line.matchAll(/\{(\w+)\}/g)) if (!fields.includes(key!)) report('lines', k, `{${key}} it cannot fill`);
  }
  return issues;
}
