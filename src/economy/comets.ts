import { COMET_LINES, COMET_SIGHT, COMETS } from '../content/stellar/comets.ts';
import { rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { COMET_DATA, COMET_EPOCH_JD, cometAt, cometMagnitude, distanceFromEarth, perihelia, type Comet } from '../data/comets.ts';
import { getLocation, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { dateText, yearsText } from './binaries.ts';

/**
 * Comets in Sol (docs/PROCGEN.md §45): what the game says of JPL's comets on the game's date, the
 * News of one near the Sun, and the imaging research stations near Sol post. Every number comes from
 * JPL's elements and the date.
 */

/** How far from the snapshot the reckoning is checked well (days): beyond, the cards say it may be off. */
export const COMET_SURE_DAYS = 730;
/** The days around the snapshot Horizons' positions cover (§45.1): a perihelion within them is given to the day. */
export const COMET_CHECKED_DAYS = [-730, 1460] as const;

/** A perihelion's date: to the day within the checked years, else only the year (the planets' pulls shift it). */
export function perihelionText(jd: number): string {
  const d = jd - COMET_EPOCH_JD;
  return d >= COMET_CHECKED_DAYS[0] && d <= COMET_CHECKED_DAYS[1] ? dateText(jd) : `In ${dateText(jd).split(' ').at(-1)}`;
}

/** Fills a line about a comet (`{comet}`, `{class}`, `{period}`, `{q}`, and any given). */
export function fillComet(text: string, comet: Comet, extra: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    comet: comet.name,
    class: comet.orbitClass.charAt(0).toUpperCase() + comet.orbitClass.slice(1),
    period: yearsText(comet.elements.periodDays / 365.25),
    q: comet.elements.qAu.toFixed(2),
    ...extra,
  };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

/** How active a comet is at so many AU from the Sun, 0 (a bare nucleus) to 1 (in full), §45.3. */
export function activity(rAu: number): number {
  const { from, full } = COMETS.activity;
  return Math.min(1, Math.max(0, (from - rAu) / (from - full)));
}

/** What it takes to see a comet of a magnitude, in words. */
export function sightOf(magnitude: number): string {
  const s = COMETS.sight;
  return magnitude <= s.nakedEye ? COMET_SIGHT.nakedEye : magnitude <= s.binoculars ? COMET_SIGHT.binoculars : magnitude <= s.smallTelescope ? COMET_SIGHT.smallTelescope : COMET_SIGHT.largeTelescope;
}

/** How bright it looks from Earth, said (§45.2): a number only while it is active, where the law holds. */
export function brightnessText(comet: Comet, jd: number): string {
  const m = cometMagnitude(comet, jd);
  if (m === null || activity(cometAt(comet, jd).r) <= 0) return COMET_LINES.faint;
  return fillComet(COMET_LINES.bright, comet, { magnitude: String(Math.round(m)), sight: sightOf(m) });
}

const au = (x: number) => (x < 10 ? x.toFixed(2) : x.toFixed(1));

export interface CometFacts {
  comet: Comet;
  /** `{comet} comes round once every {period} years.` */
  headline: string;
  orbitClass: string;
  period: string;
  perihelion: string;
  aphelion: string;
  eccentricity: string;
  inclination: string;
  lastPerihelion: string;
  nextPerihelion: string;
  /** The nucleus's size where measured, or null. */
  nucleus: string | null;
  /** On the date: how far from the Sun and from Earth. */
  now: string;
  /** Distance from the Sun alone (the star map's short line). */
  fromSun: string;
  brightness: string;
  /** Far from when the elements were taken: it may be some way off. */
  unsure: string | null;
  scene: string;
}

/** What is said of a comet on a date (a Julian date: the game's, or the elements' day). */
export function cometFacts(comet: Comet, jd: number): CometFacts {
  const el = comet.elements;
  const at = cometAt(comet, jd);
  const { last, next } = perihelia(comet, jd);
  const delta = distanceFromEarth(comet, jd);
  const fromSun = `${au(at.r)} AU from the Sun`;
  return {
    comet,
    headline: fillComet(COMET_LINES.headline, comet),
    orbitClass: fillComet('{class}', comet),
    period: `${yearsText(el.periodDays / 365.25)} years`,
    perihelion: `${el.qAu.toFixed(2)} AU from the Sun`,
    aphelion: `${au(el.aAu * (1 + el.e))} AU from the Sun`,
    eccentricity: el.e.toFixed(3),
    inclination: `${el.inclinationDeg.toFixed(1)}°`,
    lastPerihelion: perihelionText(last),
    nextPerihelion: perihelionText(next),
    nucleus: comet.diameterKm !== null ? `About ${comet.diameterKm < 10 ? comet.diameterKm.toFixed(1) : Math.round(comet.diameterKm)} km across` : null,
    now: delta !== null ? `${fromSun}; ${au(delta)} AU from Earth` : fromSun,
    fromSun,
    brightness: brightnessText(comet, jd),
    unsure: Math.abs(jd - COMET_EPOCH_JD) > COMET_SURE_DAYS ? COMET_LINES.unsure : null,
    scene: COMET_LINES.scene,
  };
}

/** Every comet, said on a date. */
export function allCometFacts(jd: number): CometFacts[] {
  return COMET_DATA.comets.map((c) => cometFacts(c, jd));
}

// ---------------------------------------------------------------- the News

export interface CometNews {
  comet: Comet;
  /** The perihelion it is near (Julian date), and whether it has passed. */
  perihelionJd: number;
  passed: boolean;
  headline: string;
  detail: string;
  brightness: string;
}

const jumpCache = new Map<SystemId, Map<SystemId, number>>();
function jumpsOf(systemId: SystemId): Map<SystemId, number> {
  let j = jumpCache.get(systemId);
  if (!j) jumpCache.set(systemId, (j = jumpsFrom(WORLD.links, systemId)));
  return j;
}

/** Whether a station hears of comets: Sol's own, and research stations within reach (§45.4). */
export function hearsOfComets(locationId: string): boolean {
  const loc = getLocation(locationId);
  if (loc.systemId === 'sol') return true;
  return loc.stationType === 'research-station' && (jumpsOf('sol').get(loc.systemId) ?? Infinity) <= COMETS.news.reach;
}

/** The comets within the News's window of a perihelion on a date, nearest first (§45.4). */
export function cometNews(jd: number): CometNews[] {
  const days = COMETS.news.days;
  return COMET_DATA.comets
    .flatMap((comet): CometNews[] => {
      const { last, next } = perihelia(comet, jd);
      const p = next - jd <= days ? next : jd - last <= days ? last : null;
      // Only a perihelion whose day the reckoning can vouch for (within the years checked against Horizons).
      if (p === null || p - COMET_EPOCH_JD < COMET_CHECKED_DAYS[0] || p - COMET_EPOCH_JD > COMET_CHECKED_DAYS[1]) return [];
      const passed = p <= jd;
      const date = dateText(p);
      return [
        {
          comet,
          perihelionJd: p,
          passed,
          headline: fillComet(passed ? COMET_LINES.news.passed : COMET_LINES.news.coming, comet),
          detail: fillComet(passed ? COMET_LINES.news.passedDetail : COMET_LINES.news.comingDetail, comet, { date }),
          brightness: brightnessText(comet, jd),
        },
      ];
    })
    .sort((a, b) => Math.abs(a.perihelionJd - jd) - Math.abs(b.perihelionJd - jd));
}

// ---------------------------------------------------------------- imaging

/** How many jumps from Sol a station is, if it is a research station that could post imaging (§45.5). */
export function imagingJumps(locationId: string): number | null {
  const loc = getLocation(locationId);
  if (loc.stationType !== 'research-station' || loc.status !== 'functional' || loc.dockable === false) return null;
  const jumps = jumpsOf('sol').get(loc.systemId) ?? Infinity;
  return jumps <= COMETS.image.reach ? jumps : null;
}

/** The comet a station wants imaged in a time slot, if any: from its own random stream. */
export function imageOffer(locationId: string, epoch: number): { comet: Comet; jumps: number } | null {
  const jumps = imagingJumps(locationId);
  if (jumps === null) return null;
  const r = rng(WORLD_SEED, 'comets', 'image', locationId, epoch);
  if (r.next() >= COMETS.image.odds) return null;
  return { comet: r.pick(COMET_DATA.comets), jumps };
}

/** What imaging pays, so many jumps off. */
export function imageReward(jumps: number): number {
  return COMETS.image.reward + COMETS.image.perJump * jumps;
}
