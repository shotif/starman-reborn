import * as THREE from 'three';
import checksFile from '../data/generated/lunar-checks.json' with { type: 'json' };
import { ECLIPSE_PLACES, LUNAR, LUNAR_LINES } from '../content/stellar/lunar.ts';
import type { Issue } from '../content/validate.ts';
import { MOON_DISTANCE_KM } from '../data/asteroids.ts';
import { LUNAR_DATA, moonPhase, moonPlace, nextPhase, sunFromEarth, type Eclipse, type PhaseName } from '../data/lunar.ts';
import { eclipseLine, pathText, placesText } from './lunar.ts';
import { eclipticToScene, lunaCrowds } from '../world/systems/sol.ts';
import { sceneDefFor } from '../world/systems/index.ts';

/** What the tests check the Moon against (src/data/generated/lunar-checks.json, written by scripts/lunar-process.ts). */
export interface LunarChecks {
  /** Horizons' positions from Earth's centre not reckoned from, and those for ten years after: [Julian date TDB, x, y, z] in km. */
  positions: [number, number, number, number][];
  beyond: [number, number, number, number][];
  /** Horizons' percentage of the Moon lit, daily: [Julian date UT, %]. */
  lit: [number, number][];
  /** The US Naval Observatory's times of the phases: [Julian date UT, phase]. */
  phases: [number, string][];
  /** The text of NASA's eclipse tables, by page. */
  pages: Record<string, string>;
}
export const LUNAR_CHECKS = checksFile as unknown as LunarChecks;

/**
 * How closely the Moon must be reckoned (§51.6): within its span, the angle seen from Earth's centre
 * (degrees) and the distance (km) of every one of Horizons' positions; for ten years beyond it,
 * looser; the percentage lit (points); and the times of its phases against USNO's (minutes, TDB
 * against UT: some 69 seconds apart, and USNO's to the minute).
 */
export const LUNAR_TOLERANCE = { deg: 0.015, km: 25, beyondDeg: 0.03, beyondKm: 30, litPoints: 0.5, phaseMinutes: 4 } as const;

/** How near an eclipse's Sun and Moon must stand, seen from Earth's centre, at its greatest (degrees): the Sun's direction (solar) or the shadow's (lunar). */
export const ECLIPSE_REACH: Record<string, number> = { 'solar Total': 1.0, 'solar Annular': 1.0, 'solar Hybrid': 1.0, 'solar Partial': 1.6, 'lunar Total': 0.55, 'lunar Partial': 1.05, 'lunar Penumbral': 1.6 };

const DEG = 180 / Math.PI;
const vec = (v: readonly number[]) => new THREE.Vector3(v[0], v[1], v[2]);

/** How far the reckoned Moon is from Horizons' positions: the worst angle (degrees) and distance (km). */
export function lunarMisses(positions: readonly (readonly number[])[]): { deg: number; km: number; checked: number } {
  const out = { deg: 0, km: 0, checked: 0 };
  for (const [jd, x, y, z] of positions) {
    const place = moonPlace(jd!);
    if (!place) continue;
    const truth = vec([x!, y!, z!]);
    const got = vec(place.xyz);
    out.checked++;
    out.deg = Math.max(out.deg, got.angleTo(truth) * DEG);
    out.km = Math.max(out.km, Math.abs(got.length() - truth.length()));
  }
  return out;
}

/** The angle at greatest eclipse (degrees) between the Moon and the Sun (solar) or the point opposite it (lunar), seen from Earth's centre. */
export function eclipseApart(e: Eclipse): number | null {
  const moon = moonPlace(e.jd);
  const sun = sunFromEarth(e.jd);
  if (!moon || !sun) return null;
  const s = vec(sun);
  return vec(moon.xyz).angleTo(e.kind === 'solar' ? s : s.negate()) * DEG;
}

/** The dates a scene is checked on: every 7 days for two years either side of the snapshot, and every 12 hours for a lunar month from it. */
export function lunarSceneDates(): number[] {
  const t0 = LUNAR_DATA.epochJd;
  return [...Array.from({ length: 209 }, (_, i) => t0 - 730 + i * 7), ...Array.from({ length: 60 }, (_, i) => t0 + i / 2)];
}

const USNO_PHASE: Record<string, PhaseName> = { 'New Moon': 'new', 'First Quarter': 'first quarter', 'Full Moon': 'full', 'Last Quarter': 'last quarter' };

/**
 * Moon guardrails (docs/PROCGEN.md §51.6): the reckoning within `LUNAR_TOLERANCE` of every one of
 * Horizons' positions it was not reckoned from, and for ten years after; the lit fraction against
 * Horizons' and every phase against USNO's; every one of NASA's eclipses at a new Moon (of the Sun)
 * or a full one (of the Moon), its Sun and Moon within reach of each other, and no new or full Moon
 * within the tightest reach missing from NASA's tables; every eclipse said, its places spelled out
 * from NASA's words alone, every one of them known, and its quoted words in NASA's page; as drawn, on
 * every date checked, the Moon in its real direction from Earth at its compressed distance, or turned
 * the least it must be and said so, crowding nothing; and no line with a number of its own.
 */
export function validateLunarRules(checks: LunarChecks = LUNAR_CHECKS, rules: typeof LUNAR = LUNAR): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const T = LUNAR_TOLERANCE;

  const within = lunarMisses(checks.positions);
  if (!within.checked || within.deg > T.deg || within.km > T.km) report('motion', 'span', `${within.deg.toFixed(4)}° and ${within.km.toFixed(1)} km from Horizons over ${within.checked} positions`);
  const beyond = lunarMisses(checks.beyond);
  if (!beyond.checked || beyond.deg > T.beyondDeg || beyond.km > T.beyondKm) report('motion', 'beyond', `${beyond.deg.toFixed(3)}° and ${beyond.km.toFixed(0)} km from Horizons over the ten years after`);

  for (const [jd, pct] of checks.lit) {
    const p = moonPhase(jd);
    if (!p || Math.abs(p.lit * 100 - pct) > T.litPoints) report('lit', String(jd), `${p ? (p.lit * 100).toFixed(2) : 'nothing'}% lit, Horizons ${pct}%`);
  }
  for (const [jd, name] of checks.phases) {
    const phase = USNO_PHASE[name];
    const at = phase ? nextPhase(jd - 1, phase) : null;
    if (!phase || at === null || Math.abs(at - jd) * 1_440 > T.phaseMinutes) report('phase', `${name} ${jd}`, at === null ? 'not reckoned' : `${((at - jd) * 1_440).toFixed(1)} minutes from USNO's`);
  }

  const span = LUNAR_DATA.span;
  for (const e of LUNAR_DATA.eclipses) {
    const subject = `${e.kind} ${e.date}`;
    const apart = eclipseApart(e);
    const reach = ECLIPSE_REACH[`${e.kind} ${e.type}`];
    if (apart === null || reach === undefined || apart > reach) report('eclipse', subject, `${apart?.toFixed(2)}° apart at its greatest, more than ${reach}°`);
    const at = nextPhase(e.jd - 1, e.kind === 'solar' ? 'new' : 'full');
    if (at === null || Math.abs(at - e.jd) > 0.25) report('eclipse', subject, 'not at a new or full Moon');
    const page = checks.pages[e.source];
    const quoted = [e.regions, e.path ?? '', e.td, e.type, e.duration ?? ''].filter(Boolean);
    if (!page || quoted.some((q) => !page.includes(q))) report('eclipse', subject, 'its words are not all in NASA’s table');
    // NASA's dates are of its own time scale, some 69 seconds ahead of the clock's: none so near midnight that the date would change.
    if (e.td < '00:02:00') report('eclipse', subject, 'too near midnight to date');
    let line = '';
    try {
      line = eclipseLine(e);
    } catch (err) {
      report('eclipse', subject, String(err));
    }
    // Nothing left unfilled, and no shorthand left in the places once spelled out (`w`, `N.`).
    const spelled = `${placesText(e.regions)}, ${pathText(e) ?? ''}`;
    if (/\{\w+\}/.test(line) || /(^|[\s,])([a-z]{1,2}\.?|[A-Z]\.)(?=[\s,]|$)/.test(spelled)) report('eclipse', subject, `said with something unfilled or unknown: ${line}`);
  }
  // Every new and full Moon in the span near enough to its node that an eclipse cannot be missed is in NASA's tables.
  for (const [kind, phase] of [['solar', 'new'], ['lunar', 'full']] as const) {
    for (let jd = nextPhase(span[0], phase); jd !== null && jd < span[1]; jd = nextPhase(jd + 1, phase)) {
      const listed = LUNAR_DATA.eclipses.some((e) => e.kind === kind && Math.abs(e.jd - jd!) < 1);
      const moon = moonPlace(jd)!;
      const sun = vec(sunFromEarth(jd)!);
      const apart = vec(moon.xyz).angleTo(kind === 'solar' ? sun : sun.negate()) * DEG;
      if (!listed && apart < 1.3) report('eclipse', `${kind} ${jd.toFixed(2)}`, `the Moon ${apart.toFixed(2)}° from it, and no eclipse in NASA's tables`);
    }
  }
  // Every one of NASA's places is spelled out from the words it knows.
  const known = new Set([...Object.keys(ECLIPSE_PLACES.sides), ...Object.keys(ECLIPSE_PLACES.names)]);
  for (const e of LUNAR_DATA.eclipses)
    for (const item of [e.regions, e.path?.replace(/^[A-Za-z]+:\s*/, '') ?? ''].join(',').split(',')) {
      const words = item.trim().split(/\s+/).filter(Boolean);
      for (const w of words) if ((/^[a-z]{1,2}\.?$/.test(w) || /\.$/.test(w)) && !known.has(w) && ![...known].some((k) => item.includes(k) && k.includes(w))) report('places', `${e.kind} ${e.date}`, `NASA's “${w}” is not known`);
    }
  if (placesText('w & s Asia, c US, C. & S. America, s Indian Oc., Mid East, Africa,, N. Z.') !== 'western and southern Asia, the central United States, Central and South America, the southern Indian Ocean, the Middle East, Africa and New Zealand')
    report('places', 'spelling out', placesText('w & s Asia, c US, C. & S. America, s Indian Oc., Mid East, Africa,, N. Z.'));

  for (const jd of lunarSceneDates()) {
    const def = sceneDefFor('sol', jd);
    const earth = def.planets.find((p) => p.id === 'earth')!;
    const moon = def.planets.find((p) => p.id === 'moon')!;
    const place = moonPlace(jd)!;
    const truth = eclipticToScene(place.xyz).normalize();
    const offset = moon.position.clone().sub(earth.position);
    const turned = def.scaleNote.includes(LUNAR_LINES.turned);
    const base = (rules.drawn.distance * place.distKm) / MOON_DISTANCE_KM;
    const subject = `the Moon on ${jd}`;
    if (lunaCrowds(def, moon.position, moon.radius)) report('scene', subject, `crowds ${lunaCrowds(def, moon.position, moon.radius)}`);
    if (!turned) {
      if (offset.angleTo(truth) > 0.01) report('scene', subject, 'not in its real direction from Earth');
      if (offset.length() < base - 1) report('scene', subject, 'nearer than its compressed distance');
    } else {
      // Turned only as far as it must be: a degree less would crowd.
      const angle = offset.angleTo(new THREE.Vector3(truth.x, offset.y / offset.length(), truth.z).normalize()) * DEG;
      if (Math.abs(offset.length() - base) > 1) report('scene', subject, 'turned, and not at its compressed distance');
      if (angle > rules.turnDeg + 1) report('scene', subject, `turned ${angle.toFixed(1)}°`);
    }
  }
  for (const [key, line] of Object.entries({ ...LUNAR_LINES, phases: '', eclipse: '', when: '' })) {
    if (typeof line === 'string' && /\d/.test(line.replace(/\{\w+\}/g, ''))) report('lines', key, `a number of its own: ${line}`);
  }
  return issues;
}
